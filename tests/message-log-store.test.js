import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMessageLogStore } from '../src/services/message-log-store.js';

const PHONE = '2348012345678';

function makeEngine(overrides = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msglog-'));
    const msgLogCache = new Map();
    const msgLogSaveTimers = new Map();
    const errors = [];
    const ensuredDirs = [];
    const engine = createMessageLogStore({
        msgLogCache,
        msgLogSaveTimers,
        logError: (...a) => errors.push(a),
        authDir: tmpDir,
        ensureDir: (d) => { ensuredDirs.push(d); fs.mkdirSync(d, { recursive: true }); },
        extractMessageText: (msg) => {
            const text = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
            return { text, leafType: msg?.message ? Object.keys(msg.message)[0] : 'none' };
        },
        ...overrides
    });
    return { engine, tmpDir, msgLogCache, msgLogSaveTimers, errors, ensuredDirs };
}

// --- constructor guards ---------------------------------------------------

test('createMessageLogStore throws when deps are missing', () => {
    const base = {
        msgLogCache: new Map(), msgLogSaveTimers: new Map(),
        logError: () => {}, authDir: '/tmp', ensureDir: () => {},
        extractMessageText: () => ({ text: '' })
    };
    for (const key of Object.keys(base)) {
        const broken = { ...base };
        delete broken[key];
        assert.throws(() => createMessageLogStore(broken), new RegExp(key.replace('/', '\\/')));
    }
    assert.throws(() => createMessageLogStore({ ...base, authDir: '' }), /authDir/);
    assert.throws(() => createMessageLogStore({ ...base, msgLogCache: {} }), /msgLogCache/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- slimProto ---------------------------------------------------------------

test('slimProto strips heavy media fields and reduces contextInfo', () => {
    const { engine } = makeEngine();
    const message = {
        conversation: 'plain stays',
        imageMessage: {
            url: 'https://x', jpegThumbnail: Buffer.from('t'), thumbnailDirectPath: '/d',
            thumbnailSha256: 's', scansSidecar: 'sc', midQualityFileSha256: 'mq', waveform: 'w',
            caption: 'kept'
        },
        extendedTextMessage: {
            text: 'hi',
            contextInfo: { stanzaId: 'Q1', participant: 'p@s.whatsapp.net', mentionedJid: ['a@s.whatsapp.net'], isForwarded: true, quotedMessage: { gone: true }, disappearingMode: {} }
        },
        keepArray: [1, 2, 3]
    };
    const slim = engine.slimProto(message);
    assert.equal(slim.conversation, 'plain stays');
    assert.equal(slim.keepArray, message.keepArray);
    assert.equal(slim.imageMessage.caption, 'kept');
    assert.equal(slim.imageMessage.url, 'https://x');
    assert.equal('jpegThumbnail' in slim.imageMessage, false);
    assert.equal('thumbnailDirectPath' in slim.imageMessage, false);
    assert.equal('thumbnailSha256' in slim.imageMessage, false);
    assert.equal('scansSidecar' in slim.imageMessage, false);
    assert.equal('midQualityFileSha256' in slim.imageMessage, false);
    assert.equal('waveform' in slim.imageMessage, false);
    assert.deepEqual(slim.extendedTextMessage.contextInfo, {
        stanzaId: 'Q1', participant: 'p@s.whatsapp.net', mentionedJid: ['a@s.whatsapp.net'], isForwarded: true
    });
});

test('slimProto passes through non-objects safely', () => {
    const { engine } = makeEngine();
    assert.equal(engine.slimProto(null), null);
    assert.equal(engine.slimProto(undefined), null);
    assert.equal(engine.slimProto('str'), 'str');
});

// --- loadMsgLog / flushMsgLog ---------------------------------------------------

test('loadMsgLog returns {} for missing or corrupted files and caches aggressively', () => {
    const { engine, tmpDir, msgLogCache, errors } = makeEngine();
    assert.deepEqual(engine.loadMsgLog(PHONE), {});
    assert.ok(msgLogCache.has(PHONE));

    fs.mkdirSync(path.join(tmpDir, PHONE), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PHONE, 'msg_log.json'), '{corrupt');
    msgLogCache.clear();
    assert.deepEqual(engine.loadMsgLog(PHONE), {});
    assert.equal(errors.length, 1);

    fs.writeFileSync(path.join(tmpDir, PHONE, 'msg_log.json'), JSON.stringify({ id1: { text: 'a' }, id2: { text: 'b' } }));
    msgLogCache.clear();
    const loaded = engine.loadMsgLog(PHONE);
    assert.equal(Object.keys(loaded).length, 2);
    // Cached: rewriting the file must not change the returned object.
    fs.writeFileSync(path.join(tmpDir, PHONE, 'msg_log.json'), '{"id3":{"text":"c"}}');
    assert.equal(engine.loadMsgLog(PHONE), loaded);
});

test('flushMsgLog persists the cached log and no-ops without a cache entry', () => {
    const { engine, tmpDir, msgLogCache, ensuredDirs, errors } = makeEngine();
    engine.flushMsgLog(PHONE);
    assert.equal(ensuredDirs.length, 0);

    msgLogCache.set(PHONE, { id1: { text: 'a' } });
    engine.flushMsgLog(PHONE);
    assert.deepEqual(ensuredDirs, [path.join(tmpDir, PHONE)]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmpDir, PHONE, 'msg_log.json'), 'utf8')), { id1: { text: 'a' } });
});

// --- scheduleMsgLogSave --------------------------------------------------------

test('scheduleMsgLogSave registers one debounced timer per session', () => {
    const { engine, msgLogSaveTimers } = makeEngine();
    engine.scheduleMsgLogSave(PHONE);
    const timer = msgLogSaveTimers.get(PHONE);
    assert.ok(timer);
    engine.scheduleMsgLogSave(PHONE); // deduped
    assert.equal(msgLogSaveTimers.get(PHONE), timer);
    assert.equal(msgLogSaveTimers.size, 1);
    clearTimeout(timer);
    msgLogSaveTimers.delete(PHONE);
});

// --- logMessage -----------------------------------------------------------------

test('logMessage skips self-sent and id-less messages', () => {
    const { engine, msgLogCache } = makeEngine();
    engine.logMessage(PHONE, 'r@s.whatsapp.net', { key: { id: 'X', fromMe: true } });
    engine.logMessage(PHONE, 'r@s.whatsapp.net', { key: {} });
    assert.equal(msgLogCache.size, 0);
});

test('logMessage records slimmed entries and schedules a save', () => {
    const { engine, msgLogCache, msgLogSaveTimers } = makeEngine();
    engine.logMessage(PHONE, 'r@s.whatsapp.net', {
        key: { id: 'MSG1', participant: 'p@s.whatsapp.net' },
        messageTimestamp: 1700000000,
        message: { conversation: 'hello log', imageMessage: { jpegThumbnail: Buffer.from('x') } }
    });
    const log = msgLogCache.get(PHONE);
    const entry = log.MSG1;
    assert.equal(entry.remoteJid, 'r@s.whatsapp.net');
    assert.equal(entry.participant, 'p@s.whatsapp.net');
    assert.equal(entry.text, 'hello log');
    assert.equal(entry.type, 'conversation');
    assert.equal(entry.ts, 1700000000);
    assert.ok(entry.message);
    assert.ok(msgLogSaveTimers.has(PHONE));
    clearTimeout(msgLogSaveTimers.get(PHONE));
});

test('logMessage evicts the oldest entry past the 800-entry cap', () => {
    const { engine, msgLogCache, msgLogSaveTimers } = makeEngine();
    const seeded = {};
    for (let i = 0; i < 800; i++) seeded[`old${i}`] = { text: 'x' };
    msgLogCache.set(PHONE, seeded);
    engine.logMessage(PHONE, 'r@s.whatsapp.net', { key: { id: 'NEW1' }, message: { conversation: 'fresh' } });
    const log = msgLogCache.get(PHONE);
    assert.equal(Object.keys(log).length, 800);
    assert.equal('old0' in log, false);
    assert.ok('NEW1' in log);
    assert.ok('old799' in log);
    clearTimeout(msgLogSaveTimers.get(PHONE));
});

// --- phrase helpers -------------------------------------------------------------

test('escapeRegExp escapes regex metacharacters', () => {
    const { engine } = makeEngine();
    assert.equal(engine.escapeRegExp('a.b*c'), 'a\\.b\\*c');
    assert.equal(engine.escapeRegExp('(x) [y] {z} | ^ $ ? +'), '\\(x\\) \\[y\\] \\{z\\} \\| \\^ \\$ \\? \\+');
});

test('textHasPhrase matches short phrases on word boundaries and long phrases as substrings', () => {
    const { engine } = makeEngine();
    assert.equal(engine.textHasPhrase('this is bad behaviour', 'bad'), true);
    assert.equal(engine.textHasPhrase('badminton is fun', 'bad'), false);
    assert.equal(engine.textHasPhrase('BADGES for sale', 'bad'), false);
    assert.equal(engine.textHasPhrase('totally different string', ''), false);
    assert.equal(engine.textHasPhrase('', 'bad'), false);
    assert.equal(engine.textHasPhrase('please block this StupidUser now', 'stupiduser'), true);
    assert.equal(engine.textHasPhrase('contains BADWORD inside', 'badword'), true);
});

test('findMatchingPhrase returns the first hit or null', () => {
    const { engine } = makeEngine();
    assert.equal(engine.findMatchingPhrase('what a bad day', ['good', 'bad', 'worse']), 'bad');
    assert.equal(engine.findMatchingPhrase('a lovely day', ['good', 'bad']), null);
    assert.equal(engine.findMatchingPhrase('a lovely day', null), null);
    assert.equal(engine.findMatchingPhrase('a lovely day', []), null);
});

test('findHidetagTrigger recognises default, prefixed, and aliased triggers', () => {
    const { engine } = makeEngine();
    assert.deepEqual(engine.findHidetagTrigger('.hidetag hello team', '.', {}), { body: 'hello team' });
    assert.deepEqual(engine.findHidetagTrigger('.HT shout now', '.', {}), { body: 'shout now' });
    assert.deepEqual(engine.findHidetagTrigger('!hidetag go', '!', {}), { body: 'go' });
    assert.deepEqual(engine.findHidetagTrigger('.h everyone', '.', { h: '.hidetag' }), { body: 'everyone' });
    assert.deepEqual(engine.findHidetagTrigger('msg !tag all', '!', { tag: '.hidetag' }), { body: 'msg all' });
    assert.equal(engine.findHidetagTrigger('nothing here', '.', { h: '.hidetag' }), null);
    assert.deepEqual(engine.findHidetagTrigger('.hidetag', '.', {}), { body: '' });
    assert.equal(engine.findHidetagTrigger(null, null, null), null);
});
