import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createConnectionEventService } from '../src/whatsapp/connection-events.js';

function createFixture(overrides = {}) {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventide-connection-events-'));
    const waSessions = new Map();
    const reconnectAttempts = new Map();
    const connectionClosed428s = new Map();
    const webPairSessions = new Map();
    const personaPollKeys = new Map();
    const handlers = new Map();
    const scheduled = [];
    const calls = [];
    const sent = [];
    const config = {};
    const sock = {
        authState: { creds: { registered: false } },
        ev: { on: (event, handler) => handlers.set(event, handler) },
        requestPairingCode: async phoneNumber => {
            calls.push(['requestPairingCode', phoneNumber]);
            return 'ABCD-1234';
        },
        sendMessage: async (jid, content) => {
            sent.push({ jid, content });
            return { key: { id: `sent-${sent.length}` } };
        }
    };

    const dependencies = {
        rootDir,
        disconnectReason: { loggedOut: 401, connectionClosed: 428 },
        waSessions,
        reconnectAttempts,
        connectionClosed428s,
        webPairSessions,
        personaPollKeys,
        personaPollQuestion: 'Choose a persona',
        personaPollOptions: ['Eclipse', 'Ruin'],
        personaPollIds: ['persona:eclipse', 'persona:ruin'],
        getDisconnectCode: lastDisconnect => lastDisconnect?.code ?? null,
        setTelegramUserState: (...args) => calls.push(['setTelegramUserState', ...args]),
        saveUserMap: () => calls.push(['saveUserMap']),
        safeTgSend: async (...args) => calls.push(['safeTgSend', ...args]),
        startPresenceCycle: (...args) => calls.push(['startPresenceCycle', ...args]),
        isSupabaseEnabled: () => false,
        debouncedSyncLocalToSupabase: (...args) => calls.push(['sync', ...args]),
        loadBotConfig: () => config,
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args]),
        sendMenuPoll: async (...args) => {
            calls.push(['sendMenuPoll', ...args]);
            return { key: { id: 'persona-poll' } };
        },
        truncateCommitName: value => value,
        cleanupDisconnectedSession: async options => calls.push(['cleanup', options]),
        handleConnectionClosed428: async options => calls.push(['handle428', options]),
        restartSocketAfterClose: async options => calls.push(['restart', options]),
        delay: async milliseconds => calls.push(['delay', milliseconds]),
        schedule: (callback, milliseconds) => {
            scheduled.push({ callback, milliseconds });
            return scheduled.length;
        },
        now: () => 2_000_000,
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['error', ...args]),
        ...overrides
    };

    const service = createConnectionEventService(dependencies);
    service.setupSocketEvents(
        sock,
        '2348000000001',
        10,
        '/sessions/2348000000001',
        [2, 5000, 1],
        false
    );

    return {
        rootDir,
        service,
        sock,
        handlers,
        scheduled,
        calls,
        sent,
        config,
        waSessions,
        reconnectAttempts,
        connectionClosed428s,
        webPairSessions,
        personaPollKeys,
        cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true })
    };
}

test('connecting event requests and publishes a pairing code only once per socket', async () => {
    const fixture = createFixture();
    try {
        const handler = fixture.handlers.get('connection.update');
        await handler({ connection: 'connecting' });
        await handler({ connection: 'connecting' });

        assert.equal(
            fixture.calls.filter(call => call[0] === 'requestPairingCode').length,
            1
        );
        assert.deepEqual(fixture.webPairSessions.get('2348000000001'), {
            code: 'ABCD-1234',
            status: 'waiting',
            createdAt: 2_000_000
        });
        assert.equal(
            fixture.calls.some(call => call[0] === 'safeTgSend' && call[2].includes('ABCD-1234')),
            true
        );
    } finally {
        fixture.cleanup();
    }
});

test('open event records connected state and schedules presence, welcome, and cloud-sync work', async () => {
    const fixture = createFixture();
    try {
        fixture.sock.authState.creds.registered = true;
        await fixture.handlers.get('connection.update')({ connection: 'open' });

        assert.equal(fixture.reconnectAttempts.get('2348000000001'), 0);
        assert.equal(fixture.waSessions.get('2348000000001').sock, fixture.sock);
        assert.deepEqual(fixture.scheduled.map(item => item.milliseconds), [4000, 10000, 5000]);
        assert.equal(
            fixture.calls.some(call => call[0] === 'setTelegramUserState' && call[2].status === 'connected'),
            true
        );
        assert.equal(
            fixture.calls.some(call => call[0] === 'log' && call[1] === 'READY'),
            true
        );

        await fixture.scheduled.find(item => item.milliseconds === 10000).callback();
        assert.equal(fixture.waSessions.get('2348000000001').allowSupabaseSync, true);
    } finally {
        fixture.cleanup();
    }
});

test('first-pairing scheduled work sends welcome and persona poll once', async () => {
    const fixture = createFixture();
    try {
        fixture.sock.authState.creds = {
            registered: true,
            me: { id: '2348000000001:1@s.whatsapp.net' }
        };
        await fixture.handlers.get('connection.update')({ connection: 'open' });
        await fixture.scheduled.find(item => item.milliseconds === 5000).callback();

        assert.equal(fixture.sent[0].jid, '2348000000001@s.whatsapp.net');
        assert.equal(fixture.calls.some(call => call[0] === 'sendMenuPoll'), true);
        assert.equal(fixture.personaPollKeys.get('2348000000001').id, 'persona-poll');
        assert.equal(fixture.config.bootDmSent, true);
        assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
    } finally {
        fixture.cleanup();
    }
});

test('close events route each disconnect category to the correct policy', async t => {
    const cases = [
        { code: 500, expected: 'cleanup', reason: 'bad session (500)' },
        { code: 401, expected: 'cleanup', reason: 'logged out' },
        { code: 515, expected: 'restart', delayMs: 3000 },
        { code: 428, expected: 'handle428' },
        { code: 503, expected: 'restart', delayMs: 5000 }
    ];

    for (const item of cases) {
        await t.test(`status ${item.code}`, async () => {
            const fixture = createFixture();
            try {
                await fixture.handlers.get('connection.update')({
                    connection: 'close',
                    lastDisconnect: { code: item.code }
                });
                const routed = fixture.calls.find(call => call[0] === item.expected);
                assert.ok(routed);
                if (item.reason) assert.equal(routed[1].reason, item.reason);
                if (item.delayMs) assert.equal(routed[1].delayMs, item.delayMs);
            } finally {
                fixture.cleanup();
            }
        });
    }
});
