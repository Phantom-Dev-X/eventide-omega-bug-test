import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createGroupProtectionCommands } from '../src/commands/group/protections.js';

function createFixture({ owner = false, dev = false, admin = true, resolution } = {}) {
    const replies = [];
    const calls = [];
    const autoreactSessions = new Map([['2348000000001', { step: 'old' }]]);
    const antiConfigSessions = new Map();
    const antideleteState = {
        enabled: false,
        endpoints: {
            groups: ['one@g.us'],
            channels: ['one@newsletter'],
            contacts: ['one@s.whatsapp.net']
        }
    };
    const botConfig = {};
    const sock = {
        groupMetadata: async jid => {
            calls.push(['groupMetadata', jid]);
            return { subject: 'Protected Group', admin };
        }
    };
    const definitions = createGroupProtectionCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        resolveAndJoinTarget: async (...args) => {
            calls.push(['resolveAndJoinTarget', ...args]);
            return resolution || { ok: true, kind: 'group', jid: 'remote@g.us', name: 'Remote Group' };
        },
        isParticipantAdmin: metadata => metadata.admin,
        isDevNumber: () => dev,
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args]),
        getAntideleteState: () => antideleteState,
        saveAntideleteState: (...args) => calls.push(['saveAntideleteState', ...args]),
        autoreactSessions,
        antiConfigSessions,
        sendMenuPoll: async (...args) => calls.push(['sendMenuPoll', ...args])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        autoreactSessions,
        antiConfigSessions,
        antideleteState,
        botConfig,
        sock,
        context: {
            sock,
            remoteJid: '12345@g.us',
            message: { key: { id: 'command-message' } },
            phoneNumber: '2348000000001',
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: [],
            botConfig
        }
    };
}

test('anti toggles preserve usage guidance and group targeting requirements', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.antilink', fixture.context);
    assert.match(fixture.replies[0].text, /use: \.antilink on/);

    fixture.context.remoteJid = 'chat@s.whatsapp.net';
    fixture.context.args = ['on'];
    await fixture.registry.execute('.antimention', fixture.context);
    assert.match(fixture.replies[1].text, /Use this inside a group/);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
});

test('anti toggles handle failed and non-group external target resolution', async () => {
    const failed = createFixture({ resolution: { ok: false, error: 'invite expired' } });
    failed.context.args = ['on', 'https://chat.whatsapp.com/old'];
    await failed.registry.execute('.antiforward', failed.context);
    assert.equal(failed.replies[0].text, '❌ invite expired');

    const contact = createFixture({ resolution: { ok: true, kind: 'contact', jid: 'user@s.whatsapp.net' } });
    contact.context.args = ['on', '2348000000002'];
    await contact.registry.execute('.antilink', contact.context);
    assert.match(contact.replies[0].text, /only applies to groups/);
});

test('anti toggles require an administrator unless caller is owner or developer', async () => {
    const denied = createFixture({ admin: false });
    denied.context.args = ['on'];
    await denied.registry.execute('.antilink', denied.context);
    assert.equal(denied.replies[0].text, '⛔ You must be a Group Admin.');

    for (const permissions of [{ admin: false, owner: true }, { admin: false, dev: true }]) {
        const fixture = createFixture(permissions);
        fixture.context.args = ['on'];
        await fixture.registry.execute('.antilink', fixture.context);
        assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
    }
});

test('anti toggles persist each protection and preserve its output label', async () => {
    const expected = [
        ['.antilink', 'antilink', 'LINK_WARD'],
        ['.antimention', 'antimention', 'MENTION_WARD'],
        ['.antiforward', 'antiforward', 'FORWARD_WARD']
    ];
    for (const [command, key, label] of expected) {
        const fixture = createFixture();
        fixture.context.args = ['off'];
        await fixture.registry.execute(command, fixture.context);
        assert.equal(fixture.botConfig.anti[key]['12345@g.us'], 'off');
        assert.match(fixture.replies[0].text, new RegExp(label));
        assert.match(fixture.replies[0].text, /GROUP\* :: Protected Group/);
    }
});

test('external anti targets preserve resolved group identity and joined JID', async () => {
    const fixture = createFixture();
    fixture.context.args = ['on', 'group', 'invite'];
    await fixture.registry.execute('.antilink', fixture.context);
    assert.equal(fixture.botConfig.anti.antilink['remote@g.us'], 'on');
    assert.match(fixture.replies[0].text, /GROUP\* :: Protected Group/);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'resolveAndJoinTarget').slice(2),
        ['group invite']
    );
});

test('metadata lookup failure remains best effort and still persists protection state', async () => {
    const fixture = createFixture({ admin: false });
    fixture.sock.groupMetadata = async () => { throw new Error('metadata unavailable'); };
    fixture.context.args = ['on'];
    await fixture.registry.execute('.antilink', fixture.context);
    assert.equal(fixture.botConfig.anti.antilink['12345@g.us'], 'on');
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
});

test('antidelete is owner/dev-only and reports current configuration without mutation', async () => {
    const denied = createFixture();
    await denied.registry.execute('.antidelete', denied.context);
    assert.equal(denied.replies[0].text, '❌ Owner/Dev only.');

    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.antidelete', fixture.context);
    assert.match(fixture.replies[0].text, /STATE\* :: OFF/);
    assert.match(fixture.replies[0].text, /GROUPS\* :: 1/);
    assert.equal(fixture.calls.some(call => call[0] === 'saveAntideleteState'), false);
});

test('antidelete toggles state and persists it', async () => {
    const fixture = createFixture({ dev: true });
    fixture.context.args = ['ON'];
    await fixture.registry.execute('.antidelete', fixture.context);
    assert.equal(fixture.antideleteState.enabled, true);
    assert.equal(fixture.calls.some(call => call[0] === 'saveAntideleteState'), true);
    assert.match(fixture.replies[0].text, /WATCH_ENABLED/);

    fixture.context.args = ['off'];
    await fixture.registry.execute('.antidelete', fixture.context);
    assert.equal(fixture.antideleteState.enabled, false);
    assert.match(fixture.replies[1].text, /WATCH_DISABLED/);
});

test('antidelete config alias resets competing flow and opens the endpoint poll', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.antideletecfg', fixture.context);
    assert.equal(fixture.autoreactSessions.has('2348000000001'), false);
    assert.deepEqual(fixture.antiConfigSessions.get('2348000000001'), { step: 'add_or_delete' });
    assert.match(fixture.replies[0].text, /ANTIDELETE_CONFIG_MATRIX/);
    const poll = fixture.calls.find(call => call[0] === 'sendMenuPoll');
    assert.deepEqual(poll.slice(-2), [
        ['➕ Add Endpoint', '🗑️ Delete Endpoint'],
        ['ad_add', 'ad_delete']
    ]);
});

test('group protection module registers five commands and config alias', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), [
        '.antidelete',
        '.antideleteconfig',
        '.antiforward',
        '.antilink',
        '.antimention'
    ]);
    assert.equal(fixture.registry.has('.antideletecfg'), true);
});
