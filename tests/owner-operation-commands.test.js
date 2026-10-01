import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createOwnerOperationCommands } from '../src/commands/system/owner-operations.js';

function createFixture({ owner = false, dev = false, backupResult = '/backups/snapshot-1' } = {}) {
    const replies = [];
    const calls = [];
    const scheduled = [];
    const waSessions = new Map([['2348000000001', { sock: {} }]]);
    const webPairSessions = new Map([['2348000000001', { status: 'connected' }]]);
    const sock = {
        end: value => calls.push(['end', value]),
        logout: async () => calls.push(['logout'])
    };
    const registry = createCommandRegistry(createOwnerOperationCommands({
        authDirRoot: '/sessions',
        waSessions,
        webPairSessions,
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        isDevNumber: () => dev,
        runLocalBackup: (...args) => {
            calls.push(['backup', ...args]);
            return backupResult;
        },
        safeRm: target => calls.push(['remove', target]),
        isSupabaseEnabled: () => true,
        deleteSessionFromSupabase: phoneNumber => calls.push(['deleteCloud', phoneNumber]),
        shutdownBot: reason => calls.push(['shutdownBot', reason]),
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['logError', ...args]),
        schedule: (callback, milliseconds) => {
            scheduled.push({ callback, milliseconds });
            return scheduled.length;
        },
        exitProcess: code => calls.push(['exit', code])
    }));
    const context = {
        sock,
        remoteJid: 'chat@s.whatsapp.net',
        message: { key: { id: 'command-message' } },
        phoneNumber: '2348000000001',
        senderJid: 'sender@s.whatsapp.net',
        isSenderOwner: owner
    };
    return {
        registry,
        replies,
        calls,
        scheduled,
        waSessions,
        webPairSessions,
        sock,
        context
    };
}

test('all owner operations reject unauthorized users without scheduling side effects', async () => {
    const fixture = createFixture();
    for (const token of ['.backup', '.restart', '.shutdown', '.reconnect', '.logout']) {
        await fixture.registry.execute(token, fixture.context);
    }

    assert.equal(fixture.replies.length, 5);
    assert.equal(fixture.scheduled.length, 0);
    assert.equal(fixture.calls.some(call => ['backup', 'remove', 'exit'].includes(call[0])), false);
});

test('backup reports the created snapshot name', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.backup', fixture.context);

    assert.equal(fixture.calls[0][0], 'backup');
    assert.match(fixture.replies[0].text, /BACKUP_OK/);
    assert.match(fixture.replies[0].text, /snapshot-1/);
});

test('backup preserves the failure response when no snapshot is created', async () => {
    const fixture = createFixture({ dev: true, backupResult: null });
    await fixture.registry.execute('.backup', fixture.context);
    assert.match(fixture.replies[0].text, /BACKUP_FAIL/);
});

test('restart and shutdown schedule their original delayed process actions', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.restart', fixture.context);
    await fixture.registry.execute('.shutdown', fixture.context);

    assert.deepEqual(fixture.scheduled.map(item => item.milliseconds), [1500, 1200]);
    fixture.scheduled[0].callback();
    fixture.scheduled[1].callback();
    assert.equal(fixture.calls.some(call => call[0] === 'exit' && call[1] === 0), true);
    assert.equal(
        fixture.calls.some(call => call[0] === 'shutdownBot' && call[1] === '.shutdown command'),
        true
    );
});

test('reconnect schedules socket closure after the original delay', async () => {
    const fixture = createFixture({ dev: true });
    await fixture.registry.execute('.reconnect', fixture.context);

    assert.equal(fixture.scheduled[0].milliseconds, 800);
    fixture.scheduled[0].callback();
    assert.deepEqual(fixture.calls.find(call => call[0] === 'end'), ['end', undefined]);
});

test('logout schedules remote logout and removes every session representation', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.logout', fixture.context);

    assert.equal(fixture.scheduled[0].milliseconds, 1500);
    fixture.scheduled[0].callback();
    await Promise.resolve();

    assert.equal(fixture.calls.some(call => call[0] === 'logout'), true);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'remove'),
        ['remove', '/sessions/2348000000001']
    );
    assert.equal(fixture.waSessions.has('2348000000001'), false);
    assert.equal(fixture.webPairSessions.has('2348000000001'), false);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'deleteCloud'),
        ['deleteCloud', '2348000000001']
    );
});

test('owner operation group registers five commands', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), [
        '.backup',
        '.logout',
        '.reconnect',
        '.restart',
        '.shutdown'
    ]);
});
