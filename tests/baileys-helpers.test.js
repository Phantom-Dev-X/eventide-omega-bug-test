import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaileysHelpers } from '../src/whatsapp/baileys-helpers.js';

function makeEngine(overrides = {}) {
    const sentPolls = new Map();
    const recentMessages = new Map();
    const logs = [];
    let sessionDirs = [];
    let fetchCalls = 0;
    const msgLogs = new Map();
    const pollCaches = new Map();
    const engine = createBaileysHelpers({
        log: (...a) => logs.push(a),
        logError: () => {},
        authDir: '/tmp/auth',
        sentPolls,
        recentMessages,
        getStoredSessionDirectories: () => sessionDirs,
        loadMsgLog: (n) => msgLogs.get(n) || {},
        loadPollCache: (n) => pollCaches.get(n) || new Map(),
        asNumber: (v) => (typeof v === 'number' ? v : Number(v) || null),
        fetchLatestBaileysVersion: async () => { fetchCalls++; return { version: [6, 1, 4] }; },
        commands: { menu: 'MENU_REPLY', ping: 'PONG' },
        recentAppendWindowSeconds: 30,
        ...overrides
    });
    return { engine, sentPolls, recentMessages, logs, setSessionDirs: (d) => { sessionDirs = d; }, getFetchCalls: () => fetchCalls, msgLogs, pollCaches };
}

// --- constructor guards ---------------------------------------------------

test('createBaileysHelpers throws when deps are missing or wrong-typed', () => {
    const base = {
        log: () => {}, logError: () => {}, authDir: '/tmp',
        sentPolls: new Map(), recentMessages: new Map(),
        getStoredSessionDirectories: () => [], loadMsgLog: () => ({}), loadPollCache: () => new Map(),
        asNumber: () => null, fetchLatestBaileysVersion: async () => ({ version: [] }),
        commands: {}, recentAppendWindowSeconds: 30
    };
    for (const key of ['log', 'logError', 'getStoredSessionDirectories', 'loadMsgLog', 'loadPollCache', 'asNumber', 'fetchLatestBaileysVersion']) {
        const broken = { ...base };
        delete broken[key];
        assert.throws(() => createBaileysHelpers(broken), new RegExp(key));
    }
    for (const key of ['sentPolls', 'recentMessages']) {
        assert.throws(() => createBaileysHelpers({ ...base, [key]: {} }), new RegExp(key));
    }
    assert.throws(() => createBaileysHelpers({ ...base, authDir: '' }), /authDir/);
    assert.throws(() => createBaileysHelpers({ ...base, commands: null }), /commands/);
    assert.throws(() => createBaileysHelpers({ ...base, recentAppendWindowSeconds: 'x' }), /recentAppendWindowSeconds/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- getDisconnectCode ---------------------------------------------------------

test('getDisconnectCode normalises every statusCode shape', () => {
    const { engine } = makeEngine();
    assert.equal(engine.getDisconnectCode({ error: { output: { statusCode: 428 } } }), 428);
    assert.equal(engine.getDisconnectCode({ error: { statusCode: 515 } }), 515);
    assert.equal(engine.getDisconnectCode({ statusCode: 401 }), 401);
    assert.equal(engine.getDisconnectCode({}), null);
    assert.equal(engine.getDisconnectCode(null), null);
});

// --- getMessageFromStore ----------------------------------------------------------

test('getMessageFromStore resolves from the in-memory sent-poll map first', async () => {
    const { engine, sentPolls } = makeEngine();
    const pollMsg = { poll: true };
    sentPolls.set('MSG1', pollMsg);
    assert.equal(await engine.getMessageFromStore({ id: 'MSG1' }), pollMsg);
});

test('getMessageFromStore falls back to the recent-messages cache by id suffix', async () => {
    const { engine, recentMessages } = makeEngine();
    const cached = { message: { conversation: 'recent' } };
    recentMessages.set('__all__:r@s.whatsapp.net:MSG2', cached);
    recentMessages.set('other:MSG3', { message: { conversation: 'nope' } });
    assert.equal(await engine.getMessageFromStore({ id: 'MSG2', remoteJid: 'r@s.whatsapp.net' }), cached.message);
    assert.equal(await engine.getMessageFromStore({ id: 'MSG4' }), null);
});

test('getMessageFromStore recovers full history from msg_log and poll_cache across sessions', async () => {
    const { engine, setSessionDirs, msgLogs, pollCaches } = makeEngine();
    setSessionDirs(['111', '222']);
    msgLogs.set('111', {});
    msgLogs.set('222', { MSG5: { text: 'recovered text' } });
    assert.deepEqual(await engine.getMessageFromStore({ id: 'MSG5' }), { conversation: 'recovered text' });

    msgLogs.set('222', { MSG6: { message: { imageMessage: { caption: 'pic' } } } });
    assert.deepEqual(await engine.getMessageFromStore({ id: 'MSG6' }), { imageMessage: { caption: 'pic' } });

    pollCaches.set('111', new Map([['MSG7', { fullMessage: { poll: 'name' } }]]));
    pollCaches.set('222', new Map());
    msgLogs.set('111', {}); msgLogs.set('222', {});
    assert.deepEqual(await engine.getMessageFromStore({ id: 'MSG7' }), { poll: 'name' });
});

// --- isRecentMessage -----------------------------------------------------------

test('isRecentMessage honours the recency window', () => {
    const { engine } = makeEngine();
    const now = Math.floor(Date.now() / 1000);
    assert.equal(engine.isRecentMessage({ messageTimestamp: now }), true);
    assert.equal(engine.isRecentMessage({ messageTimestamp: now - 29 }), true);
    assert.equal(engine.isRecentMessage({ messageTimestamp: now - 31 }), false);
    assert.equal(engine.isRecentMessage({ messageTimestamp: now - 100 }), false);
    assert.equal(engine.isRecentMessage({}), false);
    assert.equal(engine.isRecentMessage(null), false);
    assert.equal(engine.isRecentMessage({ messageTimestamp: now - 100 }, 200), true);
});

// --- isIgnoredRemoteJid ------------------------------------------------------------

test('isIgnoredRemoteJid ignores broadcast traffic but keeps chats and newsletters', () => {
    const { engine } = makeEngine();
    assert.equal(engine.isIgnoredRemoteJid(null), true);
    assert.equal(engine.isIgnoredRemoteJid(''), true);
    assert.equal(engine.isIgnoredRemoteJid('status@broadcast'), true);
    assert.equal(engine.isIgnoredRemoteJid('123@broadcast'), true);
    assert.equal(engine.isIgnoredRemoteJid('2348012345678@s.whatsapp.net'), false);
    assert.equal(engine.isIgnoredRemoteJid('news@newsletter'), false);
});

// --- getBaileysVersion / resetBaileysVersionCache ------------------------------------

test('getBaileysVersion caches the fetched version for repeated calls', async () => {
    const { engine, getFetchCalls, logs } = makeEngine();
    const v1 = await engine.getBaileysVersion();
    const v2 = await engine.getBaileysVersion();
    assert.deepEqual(v1, [6, 1, 4]);
    assert.equal(v1, v2);
    assert.equal(getFetchCalls(), 1);
    assert.equal(logs.length, 1);
    assert.ok(logs[0][1].includes('6.1.4'));
});

test('resetBaileysVersionCache forces a fresh fetch', async () => {
    const { engine, getFetchCalls } = makeEngine();
    await engine.getBaileysVersion();
    engine.resetBaileysVersionCache();
    await engine.getBaileysVersion();
    assert.equal(getFetchCalls(), 2);
});

// --- resolveCommandReply -----------------------------------------------------------

test('resolveCommandReply looks commands up in the injected registry', () => {
    const { engine } = makeEngine();
    assert.equal(engine.resolveCommandReply('menu', '2348012345678'), 'MENU_REPLY');
    assert.equal(engine.resolveCommandReply('unknown', '2348012345678'), null);
});
