import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createGroupWarningCommands } from '../src/commands/group/warnings.js';

function createFixture({ owner = false, dev = false, senderAdmin = false, targetAdmin = false, target = '2348000000002@s.whatsapp.net' } = {}) {
    const replies = [];
    const calls = [];
    const records = new Map();
    const autoreactSessions = new Map([['2348000000001', { step: 'old' }]]);
    const antiConfigSessions = new Map([['2348000000001', { step: 'old' }]]);
    const warnConfigSessions = new Map();
    const warningState = {
        groups: {
            '12345@g.us': { enabled: true, maxWarns: 4, action: 'kick' },
            '67890@g.us': { enabled: false, maxWarns: 0, action: 'mute' }
        }
    };
    const sock = {};
    const definitions = createGroupWarningCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        isDevNumber: jid => dev || jid === 'developer@s.whatsapp.net',
        isUserGroupAdmin: async (_sock, _group, jid) => {
            calls.push(['isUserGroupAdmin', jid]);
            return jid === 'sender@s.whatsapp.net' ? senderAdmin : targetAdmin;
        },
        resolveTargetJid: (...args) => {
            calls.push(['resolveTargetJid', ...args]);
            return target;
        },
        normalizeJid: jid => String(jid).replace(':3@', '@'),
        ensureWarnGroup: (...args) => calls.push(['ensureWarnGroup', ...args]),
        applyWarn: async (...args) => calls.push(['applyWarn', ...args]),
        getUserWarns: (_phone, _group, jid) => records.get(jid) || { count: 0, history: [] },
        setUserWarns: (_phone, _group, jid, record) => {
            records.set(jid, record);
            calls.push(['setUserWarns', jid, record]);
        },
        listGroupWarns: () => [...records.entries()],
        getWarnState: () => warningState,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        sendMenuPoll: async (...args) => calls.push(['sendMenuPoll', ...args])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        records,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        sock,
        context: {
            sock,
            remoteJid: '12345@g.us',
            message: { key: { id: 'command-message' }, message: {} },
            phoneNumber: '2348000000001',
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: []
        }
    };
}

test('warning mutations remain group-only and admin-gated', async () => {
    const fixture = createFixture();
    fixture.context.remoteJid = 'chat@s.whatsapp.net';
    for (const command of ['.warn', '.unwarn', '.warnreset']) {
        await fixture.registry.execute(command, fixture.context);
    }
    assert.equal(fixture.replies.every(reply => reply.text === '❌ Only works inside a group.'), true);

    fixture.context.remoteJid = '12345@g.us';
    fixture.replies.length = 0;
    for (const command of ['.warn', '.unwarn', '.warnreset']) {
        await fixture.registry.execute(command, fixture.context);
    }
    assert.equal(fixture.replies.every(reply => reply.text === '⛔ Group Admin only.'), true);
});

test('warn rejects administrator and developer targets', async () => {
    const adminTarget = createFixture({ senderAdmin: true, targetAdmin: true });
    await adminTarget.registry.execute('.warn', adminTarget.context);
    assert.equal(adminTarget.replies[0].text, '❌ You cannot warn an admin.');

    const devTarget = createFixture({ owner: true, target: 'developer@s.whatsapp.net' });
    await devTarget.registry.execute('.warn', devTarget.context);
    assert.equal(devTarget.replies[0].text, '❌ You cannot warn an admin.');
});

test('warn preserves reason parsing and applyWarn payload', async () => {
    const fixture = createFixture({ owner: true });
    fixture.context.args = ['@user', 'repeated', 'spam'];
    await fixture.registry.execute('.warn', fixture.context);

    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'ensureWarnGroup'),
        ['ensureWarnGroup', '2348000000001', '12345@g.us']
    );
    assert.deepEqual(fixture.calls.find(call => call[0] === 'applyWarn').slice(3), [{
        groupJid: '12345@g.us',
        targetJid: '2348000000002@s.whatsapp.net',
        byJid: 'sender@s.whatsapp.net',
        reason: 'repeated spam',
        auto: false,
        originalMsg: null
    }]);
});

test('unwarn decrements safely and removes the latest history entry', async () => {
    const fixture = createFixture({ dev: true, target: '2348000000002:3@s.whatsapp.net' });
    fixture.records.set('2348000000002@s.whatsapp.net', {
        count: 2,
        history: [{ reason: 'one' }, { reason: 'two' }]
    });
    await fixture.registry.execute('.unwarn', fixture.context);

    assert.deepEqual(fixture.records.get('2348000000002@s.whatsapp.net'), {
        count: 1,
        history: [{ reason: 'one' }]
    });
    assert.match(fixture.replies[0].text, /STRIKES\* :: 1/);
});

test('warns renders a target dossier with the five latest history rows', async () => {
    const fixture = createFixture();
    fixture.records.set('2348000000002@s.whatsapp.net', {
        count: 6,
        history: Array.from({ length: 6 }, (_, index) => ({ reason: `reason-${index + 1}`, auto: index % 2 === 0 }))
    });
    await fixture.registry.execute('.warns', fixture.context);

    assert.doesNotMatch(fixture.replies[0].text, /reason-1/);
    assert.match(fixture.replies[0].text, /reason-6/);
    assert.match(fixture.replies[0].text, /STRIKES\* :: 6/);
});

test('warns renders the group ledger when no target resolves', async () => {
    const fixture = createFixture({ target: null });
    fixture.records.set('2348000000005@s.whatsapp.net', { count: 2, history: [] });
    await fixture.registry.execute('.warns', fixture.context);

    assert.match(fixture.replies[0].text, /POLICY\* :: ARMED/);
    assert.match(fixture.replies[0].text, /MAX\* :: 4/);
    assert.match(fixture.replies[0].text, /\+2348000000005  —  2/);
});

test('warnreset replaces the normalized target record with a clean record', async () => {
    const fixture = createFixture({ senderAdmin: true, target: '2348000000002:3@s.whatsapp.net' });
    await fixture.registry.execute('.warnreset', fixture.context);
    assert.deepEqual(fixture.records.get('2348000000002@s.whatsapp.net'), { count: 0, history: [] });
    assert.match(fixture.replies[0].text, /RECORD_WIPED/);
});

test('warnconfig is owner/dev-only and initializes the warning menu session', async () => {
    const denied = createFixture();
    await denied.registry.execute('.warncfg', denied.context);
    assert.equal(denied.replies[0].text, '❌ Owner/Dev only.');
    assert.equal(denied.warnConfigSessions.size, 0);

    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.warnconfig', fixture.context);
    assert.equal(fixture.autoreactSessions.has('2348000000001'), false);
    assert.equal(fixture.antiConfigSessions.has('2348000000001'), false);
    assert.deepEqual(fixture.warnConfigSessions.get('2348000000001'), { step: 'root' });
    assert.match(fixture.replies[0].text, /GROUPS\* :: 2/);
    const poll = fixture.calls.find(call => call[0] === 'sendMenuPoll');
    assert.deepEqual(poll.slice(-2), [
        ['➕ Add Group', '⚙️ Configure Group', '🗑️ Remove Group'],
        ['wn_add', 'wn_cfg', 'wn_remove']
    ]);
});

test('group warning module registers five commands and its config alias', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.unwarn', '.warn', '.warnconfig', '.warnreset', '.warns']);
    assert.equal(fixture.registry.has('.warncfg'), true);
});
