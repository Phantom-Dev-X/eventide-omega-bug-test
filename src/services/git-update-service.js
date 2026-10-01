// 🔄 Git update service — self-update plumbing for .gitpull and the panel,
// extracted from index.js unchanged. `truncateCommitName` shortens commit
// subjects for display; `gitShQ` runs git synchronously in the repo root
// (GIT_TERMINAL_PROMPT=0, hard timeout so the shutdown handler can always
// run); `gitEnsureRepo` clones-in-place when .git is missing (init + attach
// origin from GIT_REMOTE_URL + fetch); `gitCheck` fetches and compares
// HEAD vs origin/main without checking out; `pullLatestCode` force-checkouts
// the remote main, records CURRENT_COMMIT.txt and reinstalls dependencies
// when package.json changed; `relaunchSelf` spawns a replacement process
// (detached, port-bind delayed) and exits.
import { execSync, spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';

export function createGitUpdateService(deps) {
    for (const name of ['rootDir', 'log', 'logError']) {
        if (typeof deps?.[name] !== (name === 'rootDir' ? 'string' : 'function')) {
            throw new Error(`createGitUpdateService: missing required dependency: ${name}`);
        }
    }
    const { rootDir, log, logError } = deps;

    function truncateCommitName(name, max = 38) {
        const s = String(name || 'unknown commit').trim() || 'unknown commit';
        return s.length > max ? s.slice(0, max - 1) + '…' : s;
    }

    // Git helpers used by .gitpull. If the folder has no .git (files copied
    // without history), we init + attach origin + fetch — i.e. clone in place.
    function gitShQ(cmd, timeoutMs = 60000) {
        return execSync(cmd, {
            cwd: rootDir,
            encoding: 'utf8',
            timeout: timeoutMs, // a sync op can never block the event loop forever —
                                // the shutdown handler must always be able to run
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        });
    }

    function gitEnsureRepo() {
        if (!fs.existsSync(path.join(rootDir, '.git'))) {
            log('GIT', 'no .git folder — initializing fresh repo (clone in place).');
            gitShQ('git init');
        }
        try { gitShQ('git config --global --add safe.directory ' + JSON.stringify(rootDir)); } catch (_) {}
        const remoteUrl = String(process.env.GIT_REMOTE_URL || 'https://github.com/Phantom-Dev-X/eventide-omega-bug-test.git').trim();
        try {
            gitShQ(`git remote add origin ${remoteUrl}`);
        } catch (_) {
            try { gitShQ(`git remote set-url origin ${remoteUrl}`); } catch (_) {}
        }
    }

    function gitRemoteName() {
        try { return gitShQ('git log -1 --pretty=%s origin/main').trim() || 'unknown commit'; }
        catch (_) { return 'unknown commit'; }
    }

    // Light check: fetch + compare. Returns { changed, name } — no checkout.
    async function gitCheck() {
        gitEnsureRepo();
        gitShQ('git fetch --depth 1 origin main');
        const local = gitShQ('git rev-parse HEAD').trim();
        const remote = gitShQ('git rev-parse origin/main').trim();
        return { changed: local !== remote, name: gitRemoteName() };
    }

    // Full pull: fetch + force-checkout + npm install if package.json changed.
    // Returns { changed, commit, name }.
    async function pullLatestCode() {
        gitEnsureRepo();
        gitShQ('git fetch --depth 1 origin main');
        const local = gitShQ('git rev-parse HEAD').trim();
        const remote = gitShQ('git rev-parse origin/main').trim();
        if (local === remote) return { changed: false, commit: local, name: gitRemoteName() };
        let pkgBefore = '';
        try { pkgBefore = gitShQ('git rev-parse HEAD:package.json').trim(); } catch (_) {}
        gitShQ('git checkout -f -B main origin/main');
        let commit = remote;
        try { commit = gitShQ('git rev-parse HEAD').trim(); } catch (_) {}
        const name = gitRemoteName();
        try { fs.writeFileSync(path.join(rootDir, 'CURRENT_COMMIT.txt'), `${commit} ${name}\n`, 'utf8'); } catch (_) {}
        let pkgAfter = '';
        try { pkgAfter = gitShQ('git rev-parse HEAD:package.json').trim(); } catch (_) {}
        if (pkgBefore && pkgAfter && pkgBefore !== pkgAfter) {
            log('GIT', 'package.json changed — installing dependencies...');
            try { gitShQ('npm install --omit=dev --no-audit --no-fund', 180000); } catch (err) {
                logError('GIT', 'npm install failed', err);
            }
        }
        return { changed: true, commit, name };
    }

    function relaunchSelf() {
        const entry = path.join(rootDir, 'index.js');
        // New process waits a few seconds before binding the port, giving this
        // process time to exit and free it (no EADDRINUSE on the panel).
        const childProc = spawn(process.execPath, [entry], {
            cwd: rootDir,
            detached: true,
            stdio: 'inherit',
            env: { ...process.env, EVENTIDE_BIND_DELAY_MS: '3500' }
        });
        childProc.unref();
        log('GIT', 'new bot process spawned — old process exiting in 1.5s...');
        setTimeout(() => process.exit(0), 1500);
    }

    return Object.freeze({ truncateCommitName, gitShQ, gitEnsureRepo, gitRemoteName, gitCheck, pullLatestCode, relaunchSelf });
}
