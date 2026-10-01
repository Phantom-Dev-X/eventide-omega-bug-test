import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { createBasicHelpers } from '../src/core/basic-helpers.js';

const require = createRequire(import.meta.url);

function makeEngine(overrides = {}) {
    const errors = [];
    const quotedResults = [];
    const engine = createBasicHelpers({
        logError: (...a) => errors.push(a),
        getQuotedContext: (msg) => {
            quotedResults.push(msg);
            return msg?.__quoted ?? null;
        },
        unwrapMessageContent: (message) => message?.__unwrapped ?? {},
        jidNormalizedUser: (jid) => `norm:${jid}`,
        ...overrides
    });
    return { engine, errors, quotedResults };
}

// --- constructor guards ---------------------------------------------------

test('createBasicHelpers throws when logError is missing', () => {
    assert.throws(() => createBasicHelpers({
        getQuotedContext: () => {}, unwrapMessageContent: () => {}, jidNormalizedUser: () => {}
    }), /logError/);
});

test('createBasicHelpers throws when getQuotedContext is missing', () => {
    assert.throws(() => createBasicHelpers({
        logError: () => {}, unwrapMessageContent: () => {}, jidNormalizedUser: () => {}
    }), /getQuotedContext/);
});

test('createBasicHelpers throws when unwrapMessageContent is missing', () => {
    assert.throws(() => createBasicHelpers({
        logError: () => {}, getQuotedContext: () => {}, jidNormalizedUser: () => {}
    }), /unwrapMessageContent/);
});

test('createBasicHelpers throws when jidNormalizedUser is missing', () => {
    assert.throws(() => createBasicHelpers({
        logError: () => {}, getQuotedContext: () => {}, unwrapMessageContent: () => {}
    }), /jidNormalizedUser/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- ensureDir / safeRm ------------------------------------------------------

test('ensureDir creates a missing directory and is idempotent', () => {
    const { engine } = makeEngine();
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'basichelpers-')), 'a', 'b');
    engine.ensureDir(dir);
    assert.ok(fs.statSync(dir).isDirectory());
    engine.ensureDir(dir);
    assert.ok(fs.statSync(dir).isDirectory());
});

test('safeRm removes files and directories recursively', () => {
    const { engine } = makeEngine();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'basichelpers-rm-'));
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'f.txt'), 'x');
    fs.writeFileSync(path.join(root, 'top.txt'), 'y');
    engine.safeRm(path.join(root, 'sub', 'f.txt'));
    assert.equal(fs.existsSync(path.join(root, 'sub', 'f.txt')), false);
    engine.safeRm(path.join(root, 'sub'));
    assert.equal(fs.existsSync(path.join(root, 'sub')), false);
    assert.equal(fs.existsSync(path.join(root, 'top.txt')), true);
});

test('safeRm logs and swallows fs.rmSync failures', () => {
    const { engine, errors } = makeEngine();
    const original = fs.rmSync;
    fs.rmSync = () => { throw new Error('EBUSY'); };
    try {
        engine.safeRm('/definitely/not/real');
    } finally {
        fs.rmSync = original;
    }
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], 'FS');
});

// --- trimForLog --------------------------------------------------------------

test('trimForLog truncates long values and keeps short ones', () => {
    const { engine } = makeEngine();
    assert.equal(engine.trimForLog('short'), 'short');
    const long = 'a'.repeat(300);
    const trimmed = engine.trimForLog(long);
    assert.equal(trimmed.length, 201);
    assert.ok(trimmed.endsWith('…'));
    assert.equal(engine.trimForLog(long, 10), 'aaaaaaaaaa…');
    assert.equal(engine.trimForLog(undefined), '');
    assert.equal(engine.trimForLog(null), '');
});

// --- asNumber ----------------------------------------------------------------

test('asNumber coerces numbers, bigints, strings, and Long-like objects', () => {
    const { engine } = makeEngine();
    assert.equal(engine.asNumber(42), 42);
    assert.equal(engine.asNumber(BigInt(7)), 7);
    assert.equal(engine.asNumber('15.5'), 15.5);
    assert.equal(engine.asNumber({ toNumber: () => 99 }), 99);
    assert.equal(engine.asNumber({ low: 12 }), 12);
});

test('asNumber returns null for non-numeric input', () => {
    const { engine } = makeEngine();
    assert.equal(engine.asNumber('nope'), null);
    assert.equal(engine.asNumber({ toNumber: () => { throw new Error('boom'); } }), null);
    assert.equal(engine.asNumber({}), null);
    assert.equal(engine.asNumber(null), null);
    assert.equal(engine.asNumber(undefined), null);
});

// --- formatUptime / runtimeUptime ---------------------------------------------

test('formatUptime renders hours, minutes and seconds with clamping', () => {
    const { engine } = makeEngine();
    assert.equal(engine.formatUptime(0), '0h 0m 0s');
    assert.equal(engine.formatUptime(3661), '1h 1m 1s');
    assert.equal(engine.formatUptime(90061), '25h 1m 1s');
    assert.equal(engine.formatUptime(-5), '0h 0m 0s');
    assert.equal(engine.formatUptime(undefined), '0h 0m 0s');
});

test('runtimeUptime matches the live process uptime format', () => {
    const { engine } = makeEngine();
    assert.match(engine.runtimeUptime(), /^\d+h \d+m \d+s$/);
});

// --- buildOmegaTerminal ---------------------------------------------------------

test('buildOmegaTerminal wraps the body in the EVENTIDE OMEGA banner', () => {
    const { engine } = makeEngine();
    const out = engine.buildOmegaTerminal('PANEL READY');
    assert.ok(out.startsWith('╔════════╦════════╗'));
    assert.ok(out.includes('EVENTIDE OMEGA'));
    assert.ok(out.includes('TERMINAL ACCESS'));
    assert.ok(out.includes('\n\nPANEL READY\n\n'));
    assert.ok(out.endsWith('— *EVENTIDE OMEGA* · 👁'));
});

// --- resolveTargetJid ------------------------------------------------------------

test('resolveTargetJid prefers the quoted participant', () => {
    const { engine } = makeEngine();
    const msg = { __quoted: { participant: '2348011111111:7@s.whatsapp.net' } };
    assert.equal(engine.resolveTargetJid(msg, []), 'norm:2348011111111:7@s.whatsapp.net');
});

test('resolveTargetJid uses the first @mention from the quoted context', () => {
    const { engine } = makeEngine();
    const msg = { __quoted: { mentionedJid: ['2348022222222@s.whatsapp.net', 'x@s.whatsapp.net'] } };
    assert.equal(engine.resolveTargetJid(msg, []), 'norm:2348022222222@s.whatsapp.net');
});

test('resolveTargetJid falls back to extendedText contextInfo then raw digits', () => {
    const { engine } = makeEngine();
    const msg = { message: { extendedTextMessage: { contextInfo: { participant: '2348033333333@s.whatsapp.net' } } } };
    assert.equal(engine.resolveTargetJid(msg, []), 'norm:2348033333333@s.whatsapp.net');
    assert.equal(engine.resolveTargetJid({}, ['@user', '2348044444444']), '2348044444444@s.whatsapp.net');
});

test('resolveTargetJid returns null when nothing resolves', () => {
    const { engine } = makeEngine();
    assert.equal(engine.resolveTargetJid({}, ['@user', '123']), null);
    assert.equal(engine.resolveTargetJid({}, null), null);
});

// --- extractQuotedPlainText --------------------------------------------------------

test('extractQuotedPlainText reads through the unwrapped quoted message', () => {
    const { engine } = makeEngine();
    const mk = (inner) => ({
        __quoted: { quotedMessage: { __unwrapped: { message: inner } } }
    });
    assert.equal(engine.extractQuotedPlainText(mk({ conversation: '  hello  ' })), 'hello');
    assert.equal(engine.extractQuotedPlainText(mk({ extendedTextMessage: { text: 'ext' } })), 'ext');
    assert.equal(engine.extractQuotedPlainText(mk({ imageMessage: { caption: 'cap' } })), 'cap');
    assert.equal(engine.extractQuotedPlainText(mk({ videoMessage: { caption: 'vid' } })), 'vid');
    assert.equal(engine.extractQuotedPlainText(mk({ documentMessage: { caption: 'doc' } })), 'doc');
});

test('extractQuotedPlainText falls back to the raw quoted message and empty string', () => {
    const { engine } = makeEngine();
    const msg = { __quoted: { quotedMessage: { __unwrapped: {}, extendedTextMessage: { text: 'raw' } } } };
    assert.equal(engine.extractQuotedPlainText(msg), 'raw');
    assert.equal(engine.extractQuotedPlainText({ __quoted: {} }), '');
    assert.equal(engine.extractQuotedPlainText({}), '');
});

// --- fetchBuffer ---------------------------------------------------------------------

function mockRes(statusCode) {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.resume = () => {};
    return res;
}

test('fetchBuffer resolves with the concatenated body', async () => {
    const { engine } = makeEngine();
    const original = https.get;
    https.get = (url, cb) => {
        const res = mockRes(200);
        const req = new EventEmitter();
        req.setTimeout = () => {};
        cb(res);
        queueMicrotask(() => {
            res.emit('data', Buffer.from('hello '));
            res.emit('data', Buffer.from('world'));
            res.emit('end');
        });
        return req;
    };
    try {
        const buf = await engine.fetchBuffer('https://example.com/pic.jpg');
        assert.deepEqual(buf, Buffer.from('hello world'));
    } finally {
        https.get = original;
    }
});

test('fetchBuffer rejects on non-2xx status', async () => {
    const { engine } = makeEngine();
    const original = https.get;
    https.get = (url, cb) => {
        const res = mockRes(404);
        const req = new EventEmitter();
        req.setTimeout = () => {};
        cb(res);
        return req;
    };
    try {
        await assert.rejects(() => engine.fetchBuffer('https://example.com/x'), /HTTP 404/);
    } finally {
        https.get = original;
    }
});

test('fetchBuffer rejects on request error', async () => {
    const { engine } = makeEngine();
    const original = https.get;
    https.get = (url, cb) => {
        const res = mockRes(200);
        const req = new EventEmitter();
        req.setTimeout = () => {};
        cb(res);
        queueMicrotask(() => req.emit('error', new Error('ECONNRESET')));
        return req;
    };
    try {
        await assert.rejects(() => engine.fetchBuffer('https://example.com/x'), /ECONNRESET/);
    } finally {
        https.get = original;
    }
});

// --- loadSharp / loadQrcode ------------------------------------------------------------

test('loadSharp and loadQrcode lazily resolve or degrade to null without throwing', async () => {
    const { engine } = makeEngine();
    const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const localRequire = createRequire(path.join(here, 'package.json'));
    let sharp = null;
    let qrcode = null;
    try { sharp = localRequire('sharp'); } catch (_) { /* optional dep */ }
    try { qrcode = localRequire('qrcode'); } catch (_) { /* optional dep */ }
    assert.equal(engine.loadSharp(), sharp);
    assert.equal(engine.loadQrcode(), qrcode);
    void require;
});
