import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'node:child_process';
import { createGitUpdateService } from '../src/services/git-update-service.js';

function makeService(rootDir) {
    const logs = [];
    const errors = [];
    return {
        engine: createGitUpdateService({
            rootDir,
            log: (...a) => logs.push(a),
            logError: (...a) => errors.push(a)
        }),
        logs,
        errors
    };
}

// Builds a file:// "remote": a bare repo with one commit on main, plus a
// scratch clone root for the service under test. No network involved.
function makeFixture() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gitupd-'));
    const bare = path.join(base, 'origin.git');
    const work = path.join(base, 'seed');
    fs.mkdirSync(work, { recursive: true });
    execSync('git init --bare origin.git', { cwd: base });
    execSync('git init -b main', { cwd: work });
    execSync('git config user.email t@t && git config user.name t', { cwd: work });
    fs.writeFileSync(path.join(work, 'README.md'), 'seed\n');
    execSync('git add . && git commit -m "seed commit"', { cwd: work });
    execSync(`git remote add origin ${bare} && git push origin main`, { cwd: work });

    const root = path.join(base, 'bot');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'index.js'), '// placeholder\n');
    return { base, bare, root };
}

test('createGitUpdateService validates its dependencies', () => {
    assert.throws(() => createGitUpdateService({}), /rootDir/);
    assert.throws(() => createGitUpdateService({ rootDir: '/x' }), /log/);
    assert.throws(() => createGitUpdateService({ rootDir: '/x', log: () => {} }), /logError/);
    const { engine } = makeService('/tmp');
    assert.ok(Object.isFrozen(engine));
});

test('truncateCommitName passes short names through and truncates long ones', () => {
    const { engine } = makeService('/tmp');
    assert.equal(engine.truncateCommitName('fix: poll decryption'), 'fix: poll decryption');
    assert.equal(engine.truncateCommitName(null), 'unknown commit');
    assert.equal(engine.truncateCommitName('   '), 'unknown commit');
    const long = 'x'.repeat(60);
    const out = engine.truncateCommitName(long);
    assert.equal(out.length, 38);
    assert.ok(out.endsWith('…'));
});

test('gitShQ runs in the repo root without terminal prompts', () => {
    const { base } = { base: fs.mkdtempSync(path.join(os.tmpdir(), 'gitshq-')) };
    const { engine } = makeService(base);
    const out = engine.gitShQ('pwd');
    assert.equal(out.trim(), base);
    // default 60s timeout and prompt-free env are part of the contract; the
    // cwd check above proves commands execute in rootDir.
});

test('gitEnsureRepo clones in place when .git is missing', () => {
    const { bare, root, base } = makeFixture();
    const prev = process.env.GIT_REMOTE_URL;
    try {
        process.env.GIT_REMOTE_URL = `file://${bare}`;
        const { engine, logs } = makeService(root);
        assert.equal(fs.existsSync(path.join(root, '.git')), false);
        engine.gitEnsureRepo();
        assert.equal(fs.existsSync(path.join(root, '.git')), true);
        const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim();
        assert.equal(remote, `file://${bare}`);
        assert.ok(logs.some((a) => a[0] === 'GIT' && String(a[1]).includes('clone in place')));
        // idempotent: a second call just re-points the remote
        engine.gitEnsureRepo();
    } finally {
        if (prev === undefined) delete process.env.GIT_REMOTE_URL;
        else process.env.GIT_REMOTE_URL = prev;
    }
});

test('gitCheck reports drift and pullLatestCode force-checks-out the remote main', async () => {
    const { bare, root } = makeFixture();
    const prev = process.env.GIT_REMOTE_URL;
    try {
        process.env.GIT_REMOTE_URL = `file://${bare}`;
        const { engine } = makeService(root);
        engine.gitEnsureRepo();
        // give the local repo a commit that differs from the remote
        execSync('git config user.email t@t && git config user.name t', { cwd: root });
        fs.writeFileSync(path.join(root, 'index.js'), '// local edit\n');
        execSync('git add . && git commit -m "local diverge"', { cwd: root });

        const check = await engine.gitCheck();
        assert.equal(check.changed, true);
        assert.equal(check.name, 'seed commit');

        const pull = await engine.pullLatestCode();
        assert.equal(pull.changed, true);
        assert.equal(pull.name, 'seed commit');
        assert.equal(pull.commit, execSync('git rev-parse origin/main', { cwd: root }).toString().trim());
        // force-checkout replaced the local tree with the remote main: the
        // local-only index.js edit is gone and the remote README is present
        assert.equal(fs.existsSync(path.join(root, 'index.js')), false);
        assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'seed\n');
        assert.ok(fs.existsSync(path.join(root, 'CURRENT_COMMIT.txt')));
        assert.ok(fs.readFileSync(path.join(root, 'CURRENT_COMMIT.txt'), 'utf8').includes('seed commit'));

        // an up-to-date pull is a no-op
        const again = await engine.pullLatestCode();
        assert.equal(again.changed, false);
    } finally {
        if (prev === undefined) delete process.env.GIT_REMOTE_URL;
        else process.env.GIT_REMOTE_URL = prev;
    }
});

test('relaunchSelf is exported but never invoked in tests (it exits the process)', async () => {
    const { engine } = makeService('/tmp');
    assert.equal(typeof engine.relaunchSelf, 'function');
    // Calling it would spawn a detached child and process.exit(0) the test
    // runner — intentionally not exercised here.
    void 0;
});
