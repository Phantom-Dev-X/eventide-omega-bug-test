import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceService } from '../src/whatsapp/presence-service.js';

const LINK = 'https://whatsapp.com/channel/test';

function makeEngine(overrides = {}) {
    const presenceControllers = new Map();
    const logs = [];
    const errors = [];
    const delays = [];
    const previews = [];
    const sent = [];
    let sendMode = 'ok';
    const engine = createPresenceService({
        log: (...a) => logs.push(a),
        logError: (...a) => errors.push(a),
        presenceControllers,
        delay: async (ms) => { delays.push(ms); },
        formatForWhatsApp: (t) => String(t ?? ''),
        groupChannelLink: LINK,
        attachChannelPreview: (content) => { previews.push(content); content.linkPreview = { baked: true }; return content; },
        ...overrides
    });
    function makeSock(sessionPhone = null) {
        return {
            _eventidePhone: sessionPhone,
            sendPresenceUpdate: async (state) => { if (sendMode === 'throw') throw new Error('boom'); sent.push({ kind: 'presence', state }); },
            sendMessage: async (remoteJid, content, opts) => {
                if (sendMode === 'fail') throw new Error('send failed');
                sent.push({ kind: 'message', remoteJid, content, opts });
                return { key: { id: 'SENT' } };
            }
        };
    }
    function cleanup(phone = '2348012345678') {
        const ctrl = presenceControllers.get(phone);
        if (ctrl) {
            if (ctrl.cycleTimer) clearTimeout(ctrl.cycleTimer);
            if (ctrl.flashTimer) clearTimeout(ctrl.flashTimer);
        }
    }
    return { engine, presenceControllers, logs, errors, delays, previews, sent, makeSock, cleanup, setSendMode: (m) => { sendMode = m; } };
}

// --- constructor guards ---------------------------------------------------

test('createPresenceService throws when deps are missing or wrong-typed', () => {
    const base = {
        log: () => {}, logError: () => {}, presenceControllers: new Map(),
        delay: async () => {}, formatForWhatsApp: () => '', groupChannelLink: LINK,
        attachChannelPreview: (c) => c
    };
    for (const key of ['log', 'logError', 'delay', 'formatForWhatsApp', 'attachChannelPreview']) {
        const broken = { ...base };
        delete broken[key];
        assert.throws(() => createPresenceService(broken), new RegExp(key));
    }
    assert.throws(() => createPresenceService({ ...base, groupChannelLink: '' }), /groupChannelLink/);
    assert.throws(() => createPresenceService({ ...base, presenceControllers: {} }), /presenceControllers/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- applyPresence ---------------------------------------------------------

test('applyPresence no-ops without a socket and logs successful updates', async () => {
    const { engine, logs, errors, makeSock } = makeEngine();
    engine.applyPresence(null, '2348012345678', 'available');
    assert.equal(logs.length, 0);

    const sock = makeSock();
    engine.applyPresence(sock, '2348012345678', 'unavailable');
    assert.equal(logs.length, 1);
    assert.ok(logs[0][1].includes('unavailable'));
    assert.equal(errors.length, 0);

    const { engine: e2, errors: errors2, setSendMode } = makeEngine();
    setSendMode('throw');
    e2.applyPresence({ sendPresenceUpdate: () => { throw new Error('x'); } }, '2348012345678', 'available');
    assert.equal(errors2.length, 1);
});

// --- getPresenceController ---------------------------------------------------

test('getPresenceController creates one controller per session and refreshes the socket', () => {
    const { engine, presenceControllers } = makeEngine();
    const sockA = { x: 1 };
    const sockB = { x: 2 };
    const ctrl = engine.getPresenceController(sockA, '2348012345678');
    assert.equal(ctrl.sock, sockA);
    assert.equal(ctrl.backgroundState, 'unavailable');
    assert.equal(presenceControllers.size, 1);
    const again = engine.getPresenceController(sockB, '2348012345678');
    assert.equal(again, ctrl);
    assert.equal(ctrl.sock, sockB);
    engine.getPresenceController({}, 'other');
    assert.equal(presenceControllers.size, 2);
});

// --- startPresenceCycle / flashPresenceOnline ----------------------------------

test('startPresenceCycle applies a random background state and schedules the cycle', () => {
    const { engine, presenceControllers, sent, makeSock, cleanup } = makeEngine();
    const sock = makeSock();
    engine.startPresenceCycle(sock, '2348012345678');
    const ctrl = presenceControllers.get('2348012345678');
    assert.ok(['available', 'unavailable'].includes(ctrl.backgroundState));
    assert.ok(ctrl.cycleTimer);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].state, ctrl.backgroundState);
    cleanup();
});

test('flashPresenceOnline flashes available and re-arms the flash timer', () => {
    const { engine, presenceControllers, sent, makeSock, cleanup } = makeEngine();
    const sock = makeSock();
    engine.flashPresenceOnline(sock, '2348012345678');
    assert.equal(sent[0].state, 'available');
    const ctrl = presenceControllers.get('2348012345678');
    assert.ok(ctrl.flashTimer);
    const firstTimer = ctrl.flashTimer;
    engine.flashPresenceOnline(sock, '2348012345678');
    assert.notEqual(ctrl.flashTimer, firstTimer);
    assert.equal(sent.length, 2);
    engine.flashPresenceOnline(null, '2348012345678');
    assert.equal(sent.length, 2);
    cleanup();
});

// --- safeWaReply ------------------------------------------------------------------

test('safeWaReply formats, prepends the channel link, paces 1s, and attaches the preview', async () => {
    const { engine, sent, delays, previews, makeSock } = makeEngine();
    const sock = makeSock();
    const quoted = { key: { id: 'Q1' } };
    const ok = await engine.safeWaReply(sock, 'r@s.whatsapp.net', 'hello', quoted);
    assert.equal(ok, true);
    assert.deepEqual(delays, [1000]);
    assert.equal(previews.length, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].remoteJid, 'r@s.whatsapp.net');
    assert.equal(sent[0].opts.quoted, quoted);
    assert.equal(sent[0].content.text, `${LINK}\n\nhello`);
    assert.deepEqual(sent[0].content.linkPreview, { baked: true });
});

test('safeWaReply skips the channel prefix for bot banners and texts that already carry the link', async () => {
    const { engine, sent, makeSock } = makeEngine();
    const sock = makeSock();
    await engine.safeWaReply(sock, 'r@s.whatsapp.net', '🤖 banner text');
    assert.equal(sent[0].content.text, '🤖 banner text');
    await engine.safeWaReply(sock, 'r@s.whatsapp.net', `see ${LINK} pls`);
    assert.equal(sent[1].content.text, `see ${LINK} pls`);
});

test('safeWaReply retries without the quote and reports failure honestly', async () => {
    const { engine, sent, errors, makeSock, setSendMode } = makeEngine();
    const sock = makeSock();
    setSendMode('fail');
    const ok = await engine.safeWaReply(sock, 'r@s.whatsapp.net', 'hello', { key: { id: 'Q' } });
    assert.equal(ok, false);
    assert.equal(sent.length, 0);
    assert.equal(errors.length, 2);
    assert.ok(errors[0][1].includes('Retrying without quote'));
    assert.ok(errors[1][1].includes('Reply failed'));
});

test('safeWaReply flashes the bot online when the socket carries the session phone', async () => {
    const { engine, presenceControllers, sent, makeSock, cleanup } = makeEngine();
    const sock = makeSock('2348012345678');
    await engine.safeWaReply(sock, 'r@s.whatsapp.net', 'hello');
    const ctrl = presenceControllers.get('2348012345678');
    assert.ok(ctrl.flashTimer);
    assert.equal(sent[0].kind, 'presence');
    assert.equal(sent[0].state, 'available');
    cleanup();
});
