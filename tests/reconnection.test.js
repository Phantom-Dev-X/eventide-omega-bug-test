import test from 'node:test';
import assert from 'node:assert/strict';

import { createReconnectionService } from '../src/whatsapp/reconnection.js';

function createFixture(overrides = {}) {
    const waSessions = new Map();
    const reconnectAttempts = new Map();
    const connectionClosed428s = new Map();
    const calls = [];

    const dependencies = {
        waSessions,
        reconnectAttempts,
        connectionClosed428s,
        safeRm: target => calls.push(['remove', target]),
        isSupabaseEnabled: () => false,
        deleteSessionFromSupabase: async phone => calls.push(['deleteCloud', phone]),
        clearTelegramUser: chatId => calls.push(['clearTelegramUser', chatId]),
        setTelegramUserState: (...args) => calls.push(['setTelegramUserState', ...args]),
        saveUserMap: () => calls.push(['saveUserMap']),
        safeTgSend: async (...args) => calls.push(['safeTgSend', ...args]),
        createSocketForSession: async options => calls.push(['createSocket', options]),
        resetBaileysVersionCache: () => calls.push(['resetVersion']),
        getBaileysVersion: async () => [2, 4000, 1],
        delay: async milliseconds => calls.push(['delay', milliseconds]),
        getClose428BaseDelayMs: () => 5000,
        getClose428StormBackoffMs: () => 600000,
        now: () => 1_000_000,
        random: () => 0.5,
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['error', ...args]),
        ...overrides
    };

    return {
        service: createReconnectionService(dependencies),
        waSessions,
        reconnectAttempts,
        connectionClosed428s,
        calls
    };
}

test('cleanup removes local and cloud credentials and notifies the mapped Telegram user', async () => {
    const fixture = createFixture({ isSupabaseEnabled: () => true });
    fixture.waSessions.set('2348000000001', { sock: {} });

    await fixture.service.cleanupDisconnectedSession({
        phoneNumber: '2348000000001',
        tgId: 10,
        authDir: '/sessions/2348000000001',
        notifyText: 'reconnect required',
        removeAuthDir: true,
        reason: 'logged out'
    });

    assert.equal(fixture.waSessions.has('2348000000001'), false);
    assert.deepEqual(fixture.calls.filter(call => [
        'remove',
        'deleteCloud',
        'clearTelegramUser',
        'saveUserMap',
        'safeTgSend'
    ].includes(call[0])), [
        ['remove', '/sessions/2348000000001'],
        ['deleteCloud', '2348000000001'],
        ['clearTelegramUser', 10],
        ['saveUserMap'],
        ['safeTgSend', 10, 'reconnect required']
    ]);
});

test('428 handler ignores a close event from a stale socket', async () => {
    const fixture = createFixture();
    const currentSocket = {};
    fixture.waSessions.set('2348000000002', { sock: currentSocket });

    await fixture.service.handleConnectionClosed428({
        sock: {},
        phoneNumber: '2348000000002',
        tgId: 20,
        authDir: '/sessions/2348000000002',
        isRestore: true
    });

    assert.equal(fixture.waSessions.get('2348000000002').sock, currentSocket);
    assert.equal(fixture.calls.some(call => call[0] === 'createSocket'), false);
    assert.equal(fixture.connectionClosed428s.size, 0);
});

test('428 handler preserves credentials and reconnects with a refreshed version', async () => {
    const fixture = createFixture();
    const socket = {};
    fixture.waSessions.set('2348000000003', { sock: socket });

    await fixture.service.handleConnectionClosed428({
        sock: socket,
        phoneNumber: '2348000000003',
        tgId: 30,
        authDir: '/sessions/2348000000003',
        isRestore: true
    });

    assert.equal(fixture.calls.some(call => call[0] === 'remove'), false);
    assert.equal(fixture.calls.some(call => call[0] === 'resetVersion'), true);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'delay'),
        ['delay', 7500]
    );
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'createSocket'),
        ['createSocket', {
            phoneNumber: '2348000000003',
            tgId: 30,
            authDir: '/sessions/2348000000003',
            version: [2, 4000, 1],
            isRestore: true
        }]
    );
    assert.equal(fixture.connectionClosed428s.get('2348000000003').count, 1);
});

test('repeated 428 closes use the storm backoff without deleting credentials', async () => {
    const fixture = createFixture();
    const socket = {};
    fixture.waSessions.set('2348000000004', { sock: socket });
    fixture.connectionClosed428s.set('2348000000004', {
        count: 3,
        windowStart: 999_000,
        lastNotifiedAt: 0
    });

    await fixture.service.handleConnectionClosed428({
        sock: socket,
        phoneNumber: '2348000000004',
        tgId: null,
        authDir: '/sessions/2348000000004',
        isRestore: false
    });

    assert.deepEqual(fixture.calls.find(call => call[0] === 'delay'), ['delay', 600000]);
    assert.equal(fixture.connectionClosed428s.get('2348000000004').count, 4);
    assert.equal(fixture.calls.some(call => call[0] === 'remove'), false);
});

test('ordinary reconnect policy cleans up only after the third retry is exceeded', async () => {
    const fixture = createFixture({ isSupabaseEnabled: () => true });
    const socket = {};
    const options = {
        closingSock: socket,
        phoneNumber: '2348000000005',
        tgId: 50,
        authDir: '/sessions/2348000000005',
        version: [2, 4000, 5],
        isRestore: true,
        reason: 'network close',
        delayMs: 25
    };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        fixture.waSessions.set(options.phoneNumber, { sock: socket });
        await fixture.service.restartSocketAfterClose(options);
    }

    assert.equal(fixture.calls.filter(call => call[0] === 'createSocket').length, 3);
    assert.equal(fixture.calls.some(call => call[0] === 'remove'), false);

    fixture.waSessions.set(options.phoneNumber, { sock: socket });
    await fixture.service.restartSocketAfterClose(options);

    assert.equal(fixture.reconnectAttempts.has(options.phoneNumber), false);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'remove'),
        ['remove', '/sessions/2348000000005']
    );
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'deleteCloud'),
        ['deleteCloud', '2348000000005']
    );
    assert.equal(fixture.calls.filter(call => call[0] === 'createSocket').length, 3);
});
