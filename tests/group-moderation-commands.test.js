import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createGroupModerationCommands } from '../src/commands/group/moderation.js';

function createFixture({ owner = false, dev = false, admin = true, target = '2348000000002:3@s.whatsapp.net' } = {}) {
    const replies = [];
    const calls = [];
    const mutedUsers = new Map();
    const metadata = { admin };
    const sock = {
        groupMetadata: async jid => {
            calls.push(['groupMetadata', jid]);
            return metadata;
        },
        groupSettingUpdate: async (...args) => calls.push(['groupSettingUpdate', ...args])
    };
    const definitions = createGroupModerationCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        resolveTargetJid: (...args) => {
            calls.push(['resolveTargetJid', ...args]);
            return target;
        },
        normalizeJid: jid => String(jid).replace(':3@', '@'),
        isParticipantAdmin: group => group.admin,
        isDevNumber: () => dev,
        mutedUsers,
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['logError', ...args])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        mutedUsers,
        sock,
        context: {
            sock,
            remoteJid: '12345@g.us',
            message: { key: { id: 'command-message' } },
            phoneNumber: '2348000000001',
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: []
        }
    };
}

test('mute and unmute preserve group-only and target validation', async () => {
    const groupOnly = createFixture();
    groupOnly.context.remoteJid = 'chat@s.whatsapp.net';
    await groupOnly.registry.execute('.mute', groupOnly.context);
    await groupOnly.registry.execute('.unmute', groupOnly.context);
    assert.equal(groupOnly.replies.every(reply => reply.text === '❌ Only works inside a group.'), true);

    const noTarget = createFixture({ target: null });
    await noTarget.registry.execute('.mute', noTarget.context);
    await noTarget.registry.execute('.unmute', noTarget.context);
    assert.match(noTarget.replies[0].text, /Example: \.mute @user/);
    assert.match(noTarget.replies[1].text, /Example: \.unmute @user/);
    assert.equal(noTarget.calls.some(call => call[0] === 'groupMetadata'), false);
});

test('mute and unmute require the sender to be a group administrator', async () => {
    const fixture = createFixture({ admin: false, owner: true, dev: true });
    await fixture.registry.execute('.mute', fixture.context);
    await fixture.registry.execute('.unmute', fixture.context);
    assert.equal(fixture.replies.every(reply => reply.text === '⛔ You must be a Group Admin.'), true);
    assert.equal(fixture.mutedUsers.size, 0);
});

test('mute stores a normalized target and unmute removes it', async () => {
    const fixture = createFixture();
    const key = '2348000000001:12345@g.us';
    await fixture.registry.execute('.mute', fixture.context);
    assert.deepEqual([...fixture.mutedUsers.get(key)], ['2348000000002@s.whatsapp.net']);
    assert.match(fixture.replies[0].text, /VOCAL_SEAL/);
    assert.match(fixture.replies[0].text, /TARGET\* :: \+2348000000002:3/);

    await fixture.registry.execute('.unmute', fixture.context);
    assert.deepEqual([...fixture.mutedUsers.get(key)], []);
    assert.match(fixture.replies[1].text, /VOCAL_RELEASE/);
});

test('listmuted shows empty and populated session-scoped registries', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.listmuted', fixture.context);
    assert.match(fixture.replies[0].text, /MUTED\* :: 0/);
    assert.match(fixture.replies[0].text, /none muted/);

    fixture.mutedUsers.set('2348000000001:12345@g.us', new Set([
        '2348000000002@s.whatsapp.net',
        '2348000000003@s.whatsapp.net'
    ]));
    await fixture.registry.execute('.listmuted', fixture.context);
    assert.match(fixture.replies[1].text, /MUTED\* :: 2/);
    assert.match(fixture.replies[1].text, /\+2348000000002/);
});

test('lock and unlock preserve their distinct group-only response', async () => {
    const fixture = createFixture();
    fixture.context.remoteJid = 'chat@s.whatsapp.net';
    await fixture.registry.execute('.lock', fixture.context);
    await fixture.registry.execute('.unlockgc', fixture.context);
    assert.equal(fixture.replies.every(reply => reply.text === '❌ Groups only.'), true);
});

test('lock controls permit group admins, owners, or developers', async () => {
    for (const permissions of [{ admin: true }, { admin: false, owner: true }, { admin: false, dev: true }]) {
        const fixture = createFixture(permissions);
        await fixture.registry.execute('.lockgc', fixture.context);
        await fixture.registry.execute('.unlock', fixture.context);
        assert.deepEqual(
            fixture.calls.filter(call => call[0] === 'groupSettingUpdate'),
            [
                ['groupSettingUpdate', '12345@g.us', 'announcement'],
                ['groupSettingUpdate', '12345@g.us', 'not_announcement']
            ]
        );
        assert.match(fixture.replies[0].text, /GROUP LOCKED/);
        assert.match(fixture.replies[1].text, /GROUP UNLOCKED/);
        assert.equal(fixture.calls.filter(call => call[0] === 'log').length, 2);
    }
});

test('lock controls reject regular members and report socket failures', async () => {
    const denied = createFixture({ admin: false });
    await denied.registry.execute('.lock', denied.context);
    assert.equal(denied.replies[0].text, '⛔ You must be a Group Admin.');
    assert.equal(denied.calls.some(call => call[0] === 'groupSettingUpdate'), false);

    const failed = createFixture();
    failed.sock.groupSettingUpdate = async () => { throw new Error('permission denied'); };
    await failed.registry.execute('.unlock', failed.context);
    assert.equal(failed.replies[0].text, '❌ Failed: permission denied');
    assert.equal(failed.calls.some(call => call[0] === 'logError'), true);
});

test('group moderation module registers five commands and lock aliases', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.listmuted', '.lock', '.mute', '.unlock', '.unmute']);
    assert.equal(fixture.registry.has('.lockgc'), true);
    assert.equal(fixture.registry.has('.unlockgc'), true);
});
