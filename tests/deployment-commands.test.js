import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createDeploymentCommands } from '../src/commands/system/deployment.js';

function createFixture({ owner = false, dev = false, busy = false, changed = false, supervised = false } = {}) {
    const replies = [];
    const calls = [];
    const scheduled = [];
    let syncBusy = busy;
    const sock = {};
    const definitions = createDeploymentCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        isDevNumber: () => dev,
        getGitSyncBusy: () => syncBusy,
        setGitSyncBusy: value => {
            syncBusy = value;
            calls.push(['setGitSyncBusy', value]);
        },
        gitCheck: async () => {
            calls.push(['gitCheck']);
            return { changed, name: 'A very long commit name for deployment validation' };
        },
        pullLatestCode: async () => {
            calls.push(['pullLatestCode']);
            return { changed: true, name: 'Deployed commit', commit: 'abcdef1234567890' };
        },
        truncateCommitName: (name, max = 38) => name.length > max ? `${name.slice(0, max - 1)}…` : name,
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['logError', ...args]),
        schedule: (callback, milliseconds) => {
            scheduled.push({ callback, milliseconds });
            return scheduled.length;
        },
        isSupervised: () => supervised,
        exitProcess: code => calls.push(['exitProcess', code]),
        relaunchSelf: () => calls.push(['relaunchSelf'])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        scheduled,
        isBusy: () => syncBusy,
        context: {
            sock,
            remoteJid: 'chat@s.whatsapp.net',
            message: { key: { id: 'command-message' } },
            phoneNumber: '2348000000001',
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner
        }
    };
}

test('git deployment rejects unauthorized callers before inspecting busy state', async () => {
    const fixture = createFixture({ busy: true });
    await fixture.registry.execute('.gitpull', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Dev only.');
    assert.equal(fixture.calls.length, 0);
});

test('git deployment preserves the shared in-flight guard', async () => {
    const fixture = createFixture({ dev: true, busy: true });
    await fixture.registry.execute('.gitupdate', fixture.context);
    assert.equal(fixture.replies[0].text, '⏳ *GIT SYNC* :: already running — one sec...');
    assert.equal(fixture.calls.some(call => call[0] === 'gitCheck'), false);
    assert.equal(fixture.isBusy(), true);
});

test('already-current deployment checks and clears busy state without restart', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.gitpull', fixture.context);

    assert.deepEqual(
        fixture.calls.filter(call => call[0] === 'setGitSyncBusy'),
        [['setGitSyncBusy', true], ['setGitSyncBusy', false]]
    );
    assert.equal(fixture.isBusy(), false);
    assert.equal(fixture.calls.some(call => call[0] === 'pullLatestCode'), false);
    assert.equal(fixture.scheduled.length, 0);
    assert.equal(fixture.replies.length, 2);
    assert.match(fixture.replies[0].text, /checking git/);
    assert.match(fixture.replies[1].text, /already on the latest commit/);
    assert.match(fixture.replies[1].text, /…/);
});

test('changed deployment pulls, reports commit, and schedules restart after 1500ms', async () => {
    const fixture = createFixture({ dev: true, changed: true });
    await fixture.registry.execute('.gitpull', fixture.context);

    assert.equal(fixture.calls.some(call => call[0] === 'pullLatestCode'), true);
    assert.equal(fixture.replies.length, 3);
    assert.match(fixture.replies[1].text, /found a new commit/);
    assert.match(fixture.replies[2].text, /COMMIT DEPLOYED SUCCESSFULLY/);
    assert.match(fixture.replies[2].text, /abcdef1/);
    assert.equal(fixture.scheduled[0].milliseconds, 1500);
    assert.equal(fixture.isBusy(), false);
});

test('scheduled deployment restart exits supervised runtimes', async () => {
    const fixture = createFixture({ owner: true, changed: true, supervised: true });
    await fixture.registry.execute('.gitpull', fixture.context);
    fixture.scheduled[0].callback();
    assert.deepEqual(fixture.calls.find(call => call[0] === 'exitProcess'), ['exitProcess', 0]);
    assert.equal(fixture.calls.some(call => call[0] === 'relaunchSelf'), false);
});

test('scheduled deployment restart relaunches unsupervised runtimes', async () => {
    const fixture = createFixture({ owner: true, changed: true });
    await fixture.registry.execute('.gitpull', fixture.context);
    fixture.scheduled[0].callback();
    assert.equal(fixture.calls.some(call => call[0] === 'relaunchSelf'), true);
    assert.equal(fixture.calls.some(call => call[0] === 'exitProcess'), false);
});

test('deployment failure logs, replies, and always releases busy state', async () => {
    const fixture = createFixture({ owner: true });
    const failure = new Error('fetch unavailable');
    // Replace the injected behavior by creating a focused failing registry.
    let busy = false;
    const calls = [];
    const replies = [];
    const registry = createCommandRegistry(createDeploymentCommands({
        safeWaReply: async (_sock, _jid, text) => replies.push(text),
        isDevNumber: () => false,
        getGitSyncBusy: () => busy,
        setGitSyncBusy: value => { busy = value; calls.push(['busy', value]); },
        gitCheck: async () => { throw failure; },
        pullLatestCode: async () => {},
        truncateCommitName: String,
        log: () => {},
        logError: (...args) => calls.push(['logError', ...args]),
        schedule: () => {},
        isSupervised: () => false,
        exitProcess: () => {},
        relaunchSelf: () => {}
    }));
    await registry.execute('.gitpull', fixture.context);
    assert.equal(busy, false);
    assert.deepEqual(calls.filter(call => call[0] === 'busy'), [['busy', true], ['busy', false]]);
    assert.equal(calls.some(call => call[0] === 'logError'), true);
    assert.equal(replies.at(-1), '❌ GIT SYNC failed: fetch unavailable');
});

test('deployment module registers command and update alias', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.gitpull']);
    assert.equal(fixture.registry.has('.gitupdate'), true);
});
