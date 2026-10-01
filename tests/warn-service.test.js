import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createWarnService } from '../src/moderation/warn-service.js';

// Minimal but faithful stand-in for the real normalizeWarnConfig shape used
// by index.js's loadBotConfig (defaults + per-group coercion).
function normalizeWarnConfig(parsed) {
    const groups = {};
    const rawGroups = parsed?.warn?.groups;
    if (rawGroups && typeof rawGroups === 'object') {
        for (const [jid, g] of Object.entries(rawGroups)) {
            if (!jid || !g || typeof g !== 'object') continue;
            const max = parseInt(g.maxWarns, 10);
            groups[jid] = {
                enabled: !!g.enabled,
                maxWarns: Number.isFinite(max) ? Math.max(0, max) : 3,
                action: g.action === 'none' ? 'none' : 'kick',
                phrases: Array.isArray(g.phrases) ? g.phrases.map(s => String(s).trim()).filter(Boolean) : [],
                deleteOffending: g.deleteOffending !== false
            };
        }
    }
    return { groups };
}

function normalizeJid(jid) {
    if (!jid) return jid;
    return String(jid).replace(/:\d+(?=@)/, '');
}

function createFixture() {
    const authDirRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eventide-warn-test-'));
    const configStore = new Map();
    const sent = [];
    const groupUpdates = [];
    const logs = [];
    const errorLogs = [];

    const sock = {
        async sendMessage(jid, payload) {
            sent.push({ jid, payload });
            return { key: { id: `msg-${sent.length}` } };
        },
        async groupParticipantsUpdate(groupJid, participants, action) {
            groupUpdates.push({ groupJid, participants, action });
        }
    };

    const warn = createWarnService({
        authDirRoot,
        loadBotConfig: phoneNumber => configStore.get(phoneNumber) || {},
        saveBotConfig: (phoneNumber, cfg) => configStore.set(phoneNumber, cfg),
        normalizeWarnConfig,
        ensureDir: dirPath => fs.mkdirSync(dirPath, { recursive: true }),
        jidNormalizedUser: normalizeJid,
        buildOmegaTerminal: body => `[TERMINAL]\n${body}`,
        log: (...args) => logs.push(args),
        logError: (...args) => errorLogs.push(args)
    });

    return { warn, sock, authDirRoot, configStore, sent, groupUpdates, logs, errorLogs };
}

function cleanup(authDirRoot) {
    fs.rmSync(authDirRoot, { recursive: true, force: true });
}

test('constructor requires every function dependency', () => {
    assert.throws(() => createWarnService({}), /require/);
});

test('constructor requires authDirRoot', () => {
    assert.throws(() => createWarnService({
        loadBotConfig: () => ({}),
        saveBotConfig: () => {},
        normalizeWarnConfig: p => p,
        ensureDir: () => {},
        jidNormalizedUser: j => j,
        buildOmegaTerminal: b => b,
        log: () => {},
        logError: () => {}
    }), /authDirRoot/);
});

test('getWarnState/saveWarnState round-trip through the injected config store', () => {
    const { warn, authDirRoot } = createFixture();
    try {
        assert.deepEqual(warn.getWarnState('234801').groups, {});
        warn.saveWarnState('234801', { groups: { '1@g.us': { enabled: true, maxWarns: 5, action: 'kick', phrases: ['spam'], deleteOffending: true } } });
        const state = warn.getWarnState('234801');
        assert.equal(state.groups['1@g.us'].maxWarns, 5);
        assert.deepEqual(state.groups['1@g.us'].phrases, ['spam']);
    } finally { cleanup(authDirRoot); }
});

test('ensureWarnGroup applies defaults and merges overrides without clobbering existing fields', () => {
    const { warn, authDirRoot } = createFixture();
    try {
        const first = warn.ensureWarnGroup('234801', '1@g.us', { maxWarns: 4 });
        assert.deepEqual(first, { enabled: true, maxWarns: 4, action: 'kick', phrases: [], deleteOffending: true });

        const second = warn.ensureWarnGroup('234801', '1@g.us', { enabled: false });
        assert.equal(second.enabled, false);
        assert.equal(second.maxWarns, 4, 'previously set maxWarns should survive a partial update');
    } finally { cleanup(authDirRoot); }
});

test('loadWarnLog/saveWarnLog persist JSON to warn_log.json under the phone number directory', () => {
    const { warn, authDirRoot } = createFixture();
    try {
        assert.deepEqual(warn.loadWarnLog('234801'), {});
        warn.saveWarnLog('234801', { '1@g.us': { '2@s.whatsapp.net': { count: 2, history: [] } } });

        const filePath = path.join(authDirRoot, '234801', 'warn_log.json');
        assert.ok(fs.existsSync(filePath));
        const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.equal(onDisk['1@g.us']['2@s.whatsapp.net'].count, 2);

        const reloaded = warn.loadWarnLog('234801');
        assert.equal(reloaded['1@g.us']['2@s.whatsapp.net'].count, 2);
    } finally { cleanup(authDirRoot); }
});

test('getUserWarns/setUserWarns: defaults, persistence, deletion at count<=0, and history capped at 12', () => {
    const { warn, authDirRoot } = createFixture();
    try {
        assert.deepEqual(warn.getUserWarns('234801', '1@g.us', '2@s.whatsapp.net'), { count: 0, history: [] });

        const longHistory = Array.from({ length: 15 }, (_, i) => ({ reason: `r${i}`, by: 'x', at: i, auto: false }));
        warn.setUserWarns('234801', '1@g.us', '2@s.whatsapp.net', { count: 3, history: longHistory });
        const rec = warn.getUserWarns('234801', '1@g.us', '2@s.whatsapp.net');
        assert.equal(rec.count, 3);
        assert.equal(rec.history.length, 12, 'history should be capped at the last 12 entries');
        assert.equal(rec.history[rec.history.length - 1].reason, 'r14');

        warn.setUserWarns('234801', '1@g.us', '2@s.whatsapp.net', { count: 0, history: [] });
        assert.deepEqual(warn.getUserWarns('234801', '1@g.us', '2@s.whatsapp.net'), { count: 0, history: [] });
    } finally { cleanup(authDirRoot); }
});

test('listGroupWarns filters zero-count users and sorts by strike count descending', () => {
    const { warn, authDirRoot } = createFixture();
    try {
        warn.setUserWarns('234801', '1@g.us', 'a@s.whatsapp.net', { count: 1, history: [] });
        warn.setUserWarns('234801', '1@g.us', 'b@s.whatsapp.net', { count: 3, history: [] });
        warn.setUserWarns('234801', '1@g.us', 'c@s.whatsapp.net', { count: 0, history: [] });

        const rows = warn.listGroupWarns('234801', '1@g.us');
        assert.deepEqual(rows.map(([jid]) => jid), ['b@s.whatsapp.net', 'a@s.whatsapp.net']);
    } finally { cleanup(authDirRoot); }
});

test('applyWarn increments strikes, mentions the target, and does not kick below the limit', async () => {
    const { warn, sock, sent, groupUpdates, authDirRoot } = createFixture();
    try {
        warn.ensureWarnGroup('234801', '1@g.us', { maxWarns: 3 });
        await warn.applyWarn(sock, '234801', {
            groupJid: '1@g.us', targetJid: '2@s.whatsapp.net', byJid: '9@s.whatsapp.net', reason: 'rude', auto: false
        });

        assert.equal(groupUpdates.length, 0, 'should not kick on strike 1 of 3');
        const warnMsg = sent.find(m => m.payload.text.includes('WARN_MARK'));
        assert.ok(warnMsg);
        assert.deepEqual(warnMsg.payload.mentions, ['2@s.whatsapp.net']);
        assert.match(warnMsg.payload.text, /1\/3/);

        const rec = warn.getUserWarns('234801', '1@g.us', '2@s.whatsapp.net');
        assert.equal(rec.count, 1);
        assert.equal(rec.history[0].reason, 'rude');
    } finally { cleanup(authDirRoot); }
});

test('applyWarn kicks and resets the strike count once maxWarns is reached', async () => {
    const { warn, sock, sent, groupUpdates, authDirRoot } = createFixture();
    try {
        warn.ensureWarnGroup('234801', '1@g.us', { maxWarns: 2 });
        await warn.applyWarn(sock, '234801', { groupJid: '1@g.us', targetJid: '2@s.whatsapp.net', byJid: '9@s.whatsapp.net', reason: 'first', auto: false });
        await warn.applyWarn(sock, '234801', { groupJid: '1@g.us', targetJid: '2@s.whatsapp.net', byJid: '9@s.whatsapp.net', reason: 'second', auto: false });

        assert.equal(groupUpdates.length, 1);
        assert.deepEqual(groupUpdates[0], { groupJid: '1@g.us', participants: ['2@s.whatsapp.net'], action: 'remove' });
        assert.ok(sent.some(m => m.payload.text.includes('WARN_LIMIT')));

        const rec = warn.getUserWarns('234801', '1@g.us', '2@s.whatsapp.net');
        assert.equal(rec.count, 0, 'strike count resets to 0 after a kick');
    } finally { cleanup(authDirRoot); }
});

test('applyWarn with action "none" never kicks no matter how many strikes accrue', async () => {
    const { warn, sock, groupUpdates, authDirRoot } = createFixture();
    try {
        warn.ensureWarnGroup('234801', '1@g.us', { maxWarns: 1, action: 'none' });
        await warn.applyWarn(sock, '234801', { groupJid: '1@g.us', targetJid: '2@s.whatsapp.net', byJid: '9@s.whatsapp.net', reason: 'x', auto: false });
        await warn.applyWarn(sock, '234801', { groupJid: '1@g.us', targetJid: '2@s.whatsapp.net', byJid: '9@s.whatsapp.net', reason: 'y', auto: false });
        assert.equal(groupUpdates.length, 0);
    } finally { cleanup(authDirRoot); }
});

test('applyWarn auto-deletes the offending message first when deleteOffending is set', async () => {
    const { warn, sock, sent, authDirRoot } = createFixture();
    try {
        warn.ensureWarnGroup('234801', '1@g.us', { maxWarns: 3, deleteOffending: true });
        await warn.applyWarn(sock, '234801', {
            groupJid: '1@g.us', targetJid: '2@s.whatsapp.net', reason: 'forbidden phrase', auto: true,
            originalMsg: { key: { id: 'msg-to-delete', participant: '2@s.whatsapp.net' } }
        });
        const deleteCall = sent.find(m => m.payload.delete);
        assert.ok(deleteCall, 'expected a delete-content send for the offending message');
        assert.equal(deleteCall.payload.delete.id, 'msg-to-delete');
    } finally { cleanup(authDirRoot); }
});

test('applyWarn ignores non-group targets and missing jids', async () => {
    const { warn, sock, sent, authDirRoot } = createFixture();
    try {
        await warn.applyWarn(sock, '234801', { groupJid: '1@s.whatsapp.net', targetJid: '2@s.whatsapp.net', auto: false });
        await warn.applyWarn(sock, '234801', { groupJid: '1@g.us', targetJid: '', auto: false });
        assert.equal(sent.length, 0);
    } finally { cleanup(authDirRoot); }
});

test('interface is frozen', () => {
    const { warn, authDirRoot } = createFixture();
    try {
        assert.throws(() => { warn.getWarnState = () => {}; }, TypeError);
    } finally { cleanup(authDirRoot); }
});
