import test from 'node:test';
import assert from 'node:assert/strict';

import { createSocketService } from '../src/whatsapp/socket.js';

function createFixture(overrides = {}) {
    const telegramUsers = new Map();
    const waSessions = new Map();
    const handlers = new Map();
    const calls = [];
    const sent = [];
    const state = {
        creds: { registered: false },
        keys: {
            set: async data => calls.push(['keys.set', data])
        }
    };
    const sock = {
        ev: {
            on: (event, handler) => handlers.set(event, handler)
        },
        sendMessage: async (jid, content, options) => {
            sent.push({ jid, content, options });
            return { key: { id: `message-${sent.length}` } };
        },
        end: async value => calls.push(['end', value])
    };

    const dependencies = {
        botRuntimeAllowed: true,
        isBlockedRenderService: false,
        currentRenderServiceId: '',
        telegramUsers,
        waSessions,
        makeWASocket: options => {
            calls.push(['makeWASocket', options]);
            return sock;
        },
        makeCacheableSignalKeyStore: (keys, logger) => ({ keys, logger }),
        createSilentLogger: () => ({ level: 'silent' }),
        useMultiFileAuthState: async authDir => {
            calls.push(['auth', authDir]);
            return {
                state,
                saveCreds: async () => calls.push(['saveCreds'])
            };
        },
        getBaileysVersion: async () => [2, 3000, 1],
        getMessageFromStore: async () => undefined,
        ensureDir: directory => calls.push(['ensureDir', directory]),
        isSupabaseEnabled: () => false,
        downloadSessionFromSupabase: async () => false,
        debouncedSyncLocalToSupabase: (...args) => calls.push(['sync', ...args]),
        setTelegramUserState: (...args) => calls.push(['setTelegramUserState', ...args]),
        saveUserMap: () => calls.push(['saveUserMap']),
        setupSocketEvents: (...args) => calls.push(['setupSocketEvents', ...args]),
        setupMessageHandler: (...args) => calls.push(['setupMessageHandler', ...args]),
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['error', ...args]),
        verboseLogs: false,
        ...overrides
    };

    return {
        service: createSocketService(dependencies),
        dependencies,
        telegramUsers,
        waSessions,
        handlers,
        calls,
        sent,
        state,
        sock
    };
}

test('socket service blocks socket creation when the runtime is passive', async () => {
    const fixture = createFixture({ botRuntimeAllowed: false });

    await assert.rejects(
        fixture.service.createSocketForSession({
            phoneNumber: '2348000000001',
            tgId: null,
            authDir: '/sessions/2348000000001'
        }),
        /disabled on non-Render host/
    );
    assert.equal(fixture.waSessions.size, 0);
});

test('socket service creates and wires a pairing socket through injected boundaries', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(7, { phoneNumber: '2348000000007', status: 'pairing', sock: null });

    const result = await fixture.service.createSocketForSession({
        phoneNumber: '2348000000007',
        tgId: 7,
        authDir: '/sessions/2348000000007'
    });

    assert.equal(result.sock, fixture.sock);
    assert.deepEqual(result.version, [2, 3000, 1]);
    assert.equal(fixture.sock._eventidePhone, '2348000000007');
    assert.equal(fixture.handlers.has('creds.update'), true);
    assert.equal(fixture.waSessions.get('2348000000007').allowSupabaseSync, false);

    const socketOptions = fixture.calls.find(call => call[0] === 'makeWASocket')[1];
    assert.deepEqual(socketOptions.version, [2, 3000, 1]);
    assert.equal(socketOptions.keepAliveIntervalMs, 15000);
    assert.equal(socketOptions.markOnlineOnConnect, false);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'setTelegramUserState').slice(1, 3),
        [7, {
            phoneNumber: '2348000000007',
            status: 'pairing',
            sock: fixture.sock
        }]
    );
    assert.equal(fixture.calls.some(call => call[0] === 'setupSocketEvents'), true);
    assert.equal(fixture.calls.some(call => call[0] === 'setupMessageHandler'), true);
});

test('socket send wrapper preserves reaction input and adds a timestamp', async () => {
    const fixture = createFixture();
    await fixture.service.createSocketForSession({
        phoneNumber: '2348000000008',
        tgId: null,
        authDir: '/sessions/2348000000008',
        version: [2, 3000, 9]
    });

    await fixture.sock.sendMessage('chat@s.whatsapp.net', {
        react: {
            text: '⚡',
            key: { id: 'source-id', remoteJid: 'chat@s.whatsapp.net' }
        }
    });

    assert.equal(fixture.sent.length, 1);
    assert.equal(fixture.sent[0].content.react.text, '⚡');
    assert.equal(fixture.sent[0].content.react.key.id, 'source-id');
    assert.equal(Number.isFinite(fixture.sent[0].content.react.senderTimestampMs), true);
});

test('credential updates sync only after cloud synchronization is allowed', async () => {
    const fixture = createFixture({ isSupabaseEnabled: () => true });
    await fixture.service.createSocketForSession({
        phoneNumber: '2348000000009',
        tgId: null,
        authDir: '/sessions/2348000000009'
    });

    await fixture.handlers.get('creds.update')();
    assert.equal(fixture.calls.filter(call => call[0] === 'sync').length, 0);

    fixture.waSessions.get('2348000000009').allowSupabaseSync = true;
    await fixture.handlers.get('creds.update')();
    assert.deepEqual(
        fixture.calls.filter(call => call[0] === 'sync').at(-1),
        ['sync', '2348000000009', '/sessions/2348000000009']
    );
});

test('stopping all sessions closes sockets and resets Telegram runtime state', async () => {
    const fixture = createFixture();
    fixture.waSessions.set('2348000000010', { sock: fixture.sock });
    fixture.telegramUsers.set(10, {
        phoneNumber: '2348000000010',
        status: 'connected',
        sock: fixture.sock
    });
    fixture.telegramUsers.set(11, {
        phoneNumber: null,
        status: 'disconnected',
        sock: null
    });

    await fixture.service.stopAllSessions('test');

    assert.equal(fixture.waSessions.size, 0);
    assert.deepEqual(fixture.telegramUsers.get(10), {
        phoneNumber: '2348000000010',
        status: 'connecting',
        sock: null
    });
    assert.deepEqual(fixture.telegramUsers.get(11), {
        phoneNumber: null,
        status: 'disconnected',
        sock: null
    });
    assert.equal(fixture.calls.some(call => call[0] === 'saveUserMap'), true);
});
