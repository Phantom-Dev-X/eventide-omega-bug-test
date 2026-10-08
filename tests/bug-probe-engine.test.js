import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createBugProbeEngine } from '../src/testing/bug-probe-engine.js';

const CATBOX_CARD_URL = 'https://files.catbox.moe/m1x4bb.jpg';

function makeProto(encodeImpl) {
    return { Message: { encode: encodeImpl } };
}

const defaultProto = makeProto(() => ({ finish: () => ({ length: 4242 }) }));

function makeEngine(overrides = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugprobe-'));
    const logs = [];
    const errors = [];
    const delays = [];
    const calls = [];
    const preps = [];
    const engine = createBugProbeEngine({
        log: (...a) => logs.push(a),
        logError: (...a) => errors.push(a),
        authDir: tmpDir,
        delay: async (ms) => { delays.push(ms); },
        proto: defaultProto,
        generateWAMessageFromContent: (target, content, opts) => {
            const built = { target, content, opts };
            calls.push({ kind: 'generate', target, content, opts, built });
            return built;
        },
        prepareWAMessageMedia: async (media, opts) => {
            preps.push({ media, opts });
            return { imageMessage: { url: 'prepared' } };
        },
        ...overrides
    });
    return { engine, tmpDir, logs, errors, delays, calls, preps };
}

function makePrim() {
    const sends = [];
    const prim = {
        relayMessage: async (target, payload, opts) => {
            sends.push({ target, payload, opts });
            return `RID${sends.length}`;
        }
    };
    return { prim, sends };
}

// --- constructor guards -------------------------------------------------

test('createBugProbeEngine throws when log is missing', () => {
    assert.throws(() => createBugProbeEngine({
        logError: () => {}, authDir: '/tmp', delay: async () => {}, proto: {},
        generateWAMessageFromContent: () => {}, prepareWAMessageMedia: async () => {}
    }), /log/);
});

test('createBugProbeEngine throws when logError is missing', () => {
    assert.throws(() => createBugProbeEngine({
        log: () => {}, authDir: '/tmp', delay: async () => {}, proto: {},
        generateWAMessageFromContent: () => {}, prepareWAMessageMedia: async () => {}
    }), /logError/);
});

test('createBugProbeEngine throws when authDir is missing or not a string', () => {
    const base = { log: () => {}, logError: () => {}, delay: async () => {}, proto: {}, generateWAMessageFromContent: () => {}, prepareWAMessageMedia: async () => {} };
    assert.throws(() => createBugProbeEngine({ ...base }), /authDir/);
    assert.throws(() => createBugProbeEngine({ ...base, authDir: '' }), /authDir/);
    assert.throws(() => createBugProbeEngine({ ...base, authDir: 42 }), /authDir/);
});

test('createBugProbeEngine throws when delay is missing', () => {
    assert.throws(() => createBugProbeEngine({
        log: () => {}, logError: () => {}, authDir: '/tmp', proto: {},
        generateWAMessageFromContent: () => {}, prepareWAMessageMedia: async () => {}
    }), /delay/);
});

test('createBugProbeEngine throws when proto is missing or not an object', () => {
    const base = { log: () => {}, logError: () => {}, authDir: '/tmp', delay: async () => {}, generateWAMessageFromContent: () => {}, prepareWAMessageMedia: async () => {} };
    assert.throws(() => createBugProbeEngine({ ...base }), /proto/);
    assert.throws(() => createBugProbeEngine({ ...base, proto: 'nope' }), /proto/);
});

test('createBugProbeEngine throws when generateWAMessageFromContent is missing', () => {
    assert.throws(() => createBugProbeEngine({
        log: () => {}, logError: () => {}, authDir: '/tmp', delay: async () => {}, proto: {},
        prepareWAMessageMedia: async () => {}
    }), /generateWAMessageFromContent/);
});

test('createBugProbeEngine throws when prepareWAMessageMedia is missing', () => {
    assert.throws(() => createBugProbeEngine({
        log: () => {}, logError: () => {}, authDir: '/tmp', delay: async () => {}, proto: {},
        generateWAMessageFromContent: () => {}
    }), /prepareWAMessageMedia/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- bug-send registry ----------------------------------------------------

test('bugSendsPath points inside the injected authDir', () => {
    const { engine, tmpDir } = makeEngine();
    assert.equal(engine.bugSendsPath('2348012345678'), path.join(tmpDir, '2348012345678', 'bug_sends.json'));
});

test('loadBugSends returns [] when no registry file exists', () => {
    const { engine } = makeEngine();
    assert.deepEqual(engine.loadBugSends('2348012345678'), []);
});

test('loadBugSends returns [] on corrupted JSON', () => {
    const { engine, tmpDir } = makeEngine();
    fs.mkdirSync(path.join(tmpDir, '2348012345678'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '2348012345678', 'bug_sends.json'), '{not json');
    assert.deepEqual(engine.loadBugSends('2348012345678'), []);
});

test('loadBugSends drops entries older than the 72h TTL and entries without ids', async () => {
    const { engine, tmpDir } = makeEngine();
    const now = Date.now();
    fs.mkdirSync(path.join(tmpDir, '2348012345678'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '2348012345678', 'bug_sends.json'), JSON.stringify({
        sends: [
            { id: 'OLD', jid: 't@s.whatsapp.net', at: now - 73 * 60 * 60 * 1000 },
            { id: 'FRESH', jid: 't@s.whatsapp.net', at: now - 1000 },
            { jid: 't@s.whatsapp.net', at: now },
            { id: 'ALSO_FRESH', jid: 't@s.whatsapp.net', at: now }
        ]
    }));
    const loaded = await engine.loadBugSends('2348012345678');
    assert.deepEqual(loaded.map(e => e.id), ['FRESH', 'ALSO_FRESH']);
});

test('saveBugSends persists the registry file', () => {
    const { engine, tmpDir } = makeEngine();
    engine.saveBugSends('2348012345678', [{ id: 'X1', jid: 't@s.whatsapp.net', at: 123 }]);
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, '2348012345678', 'bug_sends.json'), 'utf8'));
    assert.deepEqual(raw.sends, [{ id: 'X1', jid: 't@s.whatsapp.net', at: 123 }]);
});

test('saveBugSends logs and swallows write failures', () => {
    // Block the session directory path with a regular file so mkdirSync fails.
    const blockedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugprobe-block-'));
    fs.writeFileSync(path.join(blockedDir, '2348012345678'), 'not a dir');
    const { engine, errors } = makeEngine({ authDir: blockedDir });
    engine.saveBugSends('2348012345678', [{ id: 'Y', jid: 't', at: 1 }]);
    assert.equal(errors.length, 1);
});

test('recordBugSends is a no-op for invalid arguments', () => {
    const { engine, tmpDir, logs } = makeEngine();
    engine.recordBugSends('', 't@s.whatsapp.net', ['A']);
    engine.recordBugSends('2348012345678', '', ['A']);
    engine.recordBugSends('2348012345678', 't@s.whatsapp.net', []);
    engine.recordBugSends('2348012345678', 't@s.whatsapp.net', null);
    assert.equal(fs.existsSync(path.join(tmpDir, '2348012345678', 'bug_sends.json')), false);
    assert.equal(logs.length, 0);
});

test('recordBugSends appends ids to the registry and logs the count', () => {
    const { engine, tmpDir, logs } = makeEngine();
    engine.recordBugSends('2348012345678', 't@s.whatsapp.net', ['A', 'B']);
    engine.recordBugSends('2348012345678', 't@s.whatsapp.net', ['C']);
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, '2348012345678', 'bug_sends.json'), 'utf8'));
    assert.deepEqual(raw.sends.map(e => e.id), ['A', 'B', 'C']);
    assert.ok(raw.sends.every(e => e.jid === 't@s.whatsapp.net' && typeof e.at === 'number'));
    assert.equal(logs.length, 2);
});

// --- wireBytesOf ----------------------------------------------------------

test('wireBytesOf measures via proto encode first', () => {
    const { engine } = makeEngine();
    assert.equal(engine.wireBytesOf({ anything: true }), 4242);
});

test('wireBytesOf falls back to JSON byte length when encode throws', () => {
    const { engine } = makeEngine({ proto: makeProto(() => { throw new Error('no encoder'); }) });
    assert.equal(engine.wireBytesOf({ a: 'hello' }), Buffer.byteLength(JSON.stringify({ a: 'hello' })));
});

test('wireBytesOf returns 0 when both encode and JSON.stringify fail', () => {
    const { engine } = makeEngine({ proto: makeProto(() => { throw new Error('no encoder'); }) });
    const circular = {};
    circular.self = circular;
    assert.equal(engine.wireBytesOf(circular), 0);
});

// --- sendIozkProbe ----------------------------------------------------------

test('sendIozkProbe relays a richResponseMessage payload and reports sizes', async () => {
    const { engine, delays } = makeEngine();
    const { prim, sends } = makePrim();
    const result = await engine.sendIozkProbe(prim, 'target@s.whatsapp.net');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].target, 'target@s.whatsapp.net');
    assert.equal(sends[0].opts.participant, true);
    assert.ok(sends[0].payload.botForwardedMessage.message.richResponseMessage.unifiedResponse.data);
    assert.equal(result.inlineEntityChars, 500000);
    assert.ok(result.encodedResponseBytes > 500000 && result.encodedResponseBytes < 501000);
    assert.deepEqual(result.ids, ['RID1']);
    assert.deepEqual(delays, [1000]);
});

test('sendIozkProbe returns empty ids when relayMessage returns null', async () => {
    const { engine } = makeEngine();
    const prim = { relayMessage: async () => null };
    const result = await engine.sendIozkProbe(prim, 't@s.whatsapp.net');
    assert.deepEqual(result.ids, []);
});

// --- sendFiosProbe ----------------------------------------------------------

test('sendFiosProbe relays the location/buttons freeze payload', async () => {
    const { engine, delays } = makeEngine();
    const { prim, sends } = makePrim();
    const result = await engine.sendFiosProbe(prim, 'target@s.whatsapp.net');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].opts.participant, true);
    const buttons = sends[0].payload.viewOnceMessage.message.buttonsMessage;
    assert.equal(buttons.locationMessage.name.length, 72000);
    assert.equal(buttons.buttons[0].buttonText.displayText.length, 8000);
    assert.equal(result.locationNameChars, 72000);
    assert.equal(result.buttonTextChars, 8000);
    assert.ok(result.pauseMs >= 700 && result.pauseMs <= 1299);
    assert.deepEqual(delays, [result.pauseMs]);
    assert.deepEqual(result.ids, ['RID1']);
});

// --- sendCrashmsgProbe ------------------------------------------------------

test('sendCrashmsgProbe fires 10 payloads 1s apart and records the first wire size', async () => {
    const { engine, delays } = makeEngine();
    const { prim, sends } = makePrim();
    const result = await engine.sendCrashmsgProbe(prim, 'target@s.whatsapp.net');
    assert.equal(sends.length, 10);
    assert.equal(result.sent, 10);
    assert.equal(result.wireBytes, 4242);
    assert.equal(result.ids.length, 10);
    assert.ok(sends.every(s => s.opts.participant === true));
    assert.ok(sends.every(s => s.payload.viewOnceMessage.message.groupStatusMentionMessage));
    assert.deepEqual(delays, Array(9).fill(1000));
});

// --- sendIoszkProbe ---------------------------------------------------------

test('sendIoszkProbe fires 60 location payloads embedding the thumbnail', async () => {
    const { engine } = makeEngine();
    const { prim, sends } = makePrim();
    const thumb = Buffer.from('fake-jpeg');
    const result = await engine.sendIoszkProbe(prim, 'target@s.whatsapp.net', thumb);
    assert.equal(sends.length, 60);
    assert.equal(result.sent, 60);
    assert.equal(result.wireBytes, 4242);
    assert.equal(result.ids.length, 60);
    const first = sends[0].payload.groupStatusMessageV2.message.locationMessage;
    assert.equal(first.contextInfo.externalAdReply.quotedAd.jpegThumbnail, thumb);
    assert.equal(first.contextInfo.mentionedJid.length, 2000);
});

// --- sendCrashclickProbe ----------------------------------------------------

test('sendCrashclickProbe relays the static richResponse table payload', async () => {
    const { engine } = makeEngine();
    const { prim, sends } = makePrim();
    const result = await engine.sendCrashclickProbe(prim, 'target@s.whatsapp.net');
    assert.equal(sends.length, 1);
    assert.deepEqual(sends[0].opts, {});
    assert.match(result.responseId, /^[0-9a-f-]{36}$/);
    assert.equal(result.responseBytes, Buffer.byteLength(JSON.stringify({ response_id: result.responseId, sections: [] })));
    assert.deepEqual(result.ids, ['RID1']);
});

// --- buildAndrozPayload ------------------------------------------------------

test('buildAndrozPayload builds the bloksWidget interactiveMessage envelope', () => {
    const { engine } = makeEngine();
    const payload = engine.buildAndrozPayload();
    const interactive = payload.groupStatusMessageV2.message.interactiveMessage;
    assert.equal(interactive.header.title.length, 80000);
    assert.equal(interactive.header.subtitle.length, 50000);
    assert.equal(interactive.header.bloksWidget.uuid.length, 50000);
    assert.equal(interactive.header.bloksWidget.data.length, 50000);
    assert.equal(interactive.body.text, '\u000F');
    assert.equal(interactive.nativeFlowMessage.buttons.length, 50000);
});

// --- buildTestfffMessage ------------------------------------------------------

test('buildTestfffMessage builds a 30-card carousel around the prepared image', () => {
    const { engine, calls } = makeEngine();
    const imageMessage = { url: 'prepared' };
    const result = engine.buildTestfffMessage('target@s.whatsapp.net', imageMessage);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, 'target@s.whatsapp.net');
    const carousel = calls[0].content.groupStatusMessageV2.message.interactiveMessage.carouselMessage;
    assert.equal(carousel.cards.length, 30);
    assert.equal(carousel.cards[0].header.imageMessage, imageMessage);
    assert.equal(carousel.cards[0].header.hasMediaAttachment, true);
    assert.equal(result.target, 'target@s.whatsapp.net');
});

test('buildTestfffMessage uses a text header when no image is available', () => {
    const { engine, calls } = makeEngine();
    engine.buildTestfffMessage('target@s.whatsapp.net', null);
    const header = calls[0].content.groupStatusMessageV2.message.interactiveMessage.carouselMessage.cards[0].header;
    assert.equal(header.imageMessage, undefined);
    assert.equal(header.hasMediaAttachment, false);
    assert.equal(header.title.length, 8000);
    assert.equal(header.subtitle.length, 1000);
});

// --- prepareCardImage --------------------------------------------------------

test('prepareCardImage uploads the catbox image once and returns the imageMessage', async () => {
    const { engine, preps } = makeEngine();
    const sock = { waUploadToServer: async () => ({}) };
    const result = await engine.prepareCardImage(sock);
    assert.equal(preps.length, 1);
    assert.equal(preps[0].media.image.url, CATBOX_CARD_URL);
    assert.equal(preps[0].opts.upload, sock.waUploadToServer);
    assert.deepEqual(result, { url: 'prepared' });
});

test('prepareCardImage returns null when media prep yields no imageMessage', async () => {
    const { engine } = makeEngine({ prepareWAMessageMedia: async () => ({}) });
    const result = await engine.prepareCardImage({ waUploadToServer: async () => ({}) });
    assert.equal(result, null);
});

// --- sendGbHardProbe ----------------------------------------------------------

test('sendGbHardProbe relays one app-level group payload with participant skip', async () => {
    const { engine } = makeEngine();
    const { prim, sends } = makePrim();
    const result = await engine.sendGbHardProbe(prim, 'group@g.us');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].target, 'group@g.us');
    assert.equal(sends[0].opts.participant, true);
    assert.ok(sends[0].payload.groupStatusMessageV2.message.interactiveMessage.header.bloksWidget);
    assert.equal(result.wireBytes, 4242);
    assert.deepEqual(result.ids, ['RID1']);
});
