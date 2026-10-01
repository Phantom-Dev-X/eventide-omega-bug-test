import test from 'node:test';
import assert from 'node:assert/strict';
import { createPairingService } from '../src/whatsapp/pairing.js';

function createHarness(overrides = {}) {
    const calls = {
        sockets: [],
        telegramMessages: [],
        clearedUsers: [],
        ensuredDirectories: [],
        logs: [],
        errors: []
    };
    const telegramUsers = new Map();
    const webPairSessions = new Map();

    const deps = {
        authDirRoot: '/tmp/eventide-pairing-test',
        maxUsers: 10,
        telegramUsers,
        webPairSessions,
        countStoredSessions: () => 0,
        getStoredSessionDirectories: () => [],
        normalizeAuthDirStructure: () => {},
        findTelegramChatIdByPhone: () => null,
        setTelegramUserState: (chatId, value) => telegramUsers.set(chatId, value),
        clearTelegramUser: chatId => calls.clearedUsers.push(chatId),
        saveUserMap: () => {},
        ensureDir: directory => calls.ensuredDirectories.push(directory),
        safeTgSend: async (chatId, text) => calls.telegramMessages.push({ chatId, text }),
        createSocketForSession: async options => calls.sockets.push(options),
        isSupabaseEnabled: () => false,
        getAllSessionPhoneNumbers: async () => [],
        downloadSessionFromSupabase: async () => false,
        loadAuthState: async () => ({ state: { creds: { registered: true } } }),
        log: (scope, message) => calls.logs.push({ scope, message }),
        logError: (scope, message, error) => calls.errors.push({ scope, message, error }),
        ...overrides
    };

    return {
        calls,
        deps,
        telegramUsers,
        webPairSessions,
        service: createPairingService(deps)
    };
}

test('web pairing records pending state and delegates socket creation', async () => {
    const harness = createHarness();
    const result = await harness.service.initiateWebPairing('2348012345678');

    assert.deepEqual(result, { ok: true });
    assert.equal(harness.webPairSessions.get('2348012345678').status, 'pending');
    assert.equal(harness.calls.sockets.length, 1);
    assert.deepEqual(harness.calls.sockets[0], {
        phoneNumber: '2348012345678',
        tgId: null,
        authDir: '/tmp/eventide-pairing-test/2348012345678',
        isRestore: false
    });
});

test('Telegram pairing refuses new sessions at capacity', async () => {
    const harness = createHarness({ countStoredSessions: () => 10 });
    await harness.service.initiatePairing(12345, '2348012345678');

    assert.equal(harness.calls.sockets.length, 0);
    assert.deepEqual(harness.calls.clearedUsers, [12345]);
    assert.match(harness.calls.telegramMessages[0].text, /Server Full/);
});

test('session restoration skips unregistered credentials', async () => {
    const harness = createHarness({
        getStoredSessionDirectories: () => ['111', '222'],
        loadAuthState: async directory => ({
            state: { creds: { registered: directory.endsWith('/111') } }
        }),
        findTelegramChatIdByPhone: phone => phone === '111' ? 9001 : null
    });

    const restored = await harness.service.restoreAllSessions();

    assert.equal(restored, 1);
    assert.equal(harness.calls.sockets.length, 1);
    assert.deepEqual(harness.calls.sockets[0], {
        phoneNumber: '111',
        tgId: 9001,
        authDir: '/tmp/eventide-pairing-test/111',
        isRestore: true
    });
});

test('web pairing cleans pending state when socket creation fails', async () => {
    const harness = createHarness({
        createSocketForSession: async () => {
            throw new Error('socket failed');
        }
    });

    const result = await harness.service.initiateWebPairing('2348012345678');

    assert.deepEqual(result, { ok: false, error: 'socket failed' });
    assert.equal(harness.webPairSessions.has('2348012345678'), false);
    assert.equal(harness.calls.errors.length, 1);
});
