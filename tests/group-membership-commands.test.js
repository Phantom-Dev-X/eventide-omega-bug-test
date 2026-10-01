import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createGroupMembershipCommands } from '../src/commands/group/membership.js';

function createFixture({ senderAdmin = true, botAdmin = true } = {}) {
    const replies = [];
    const calls = [];
    const metadata = {
        admins: new Set([
            ...(senderAdmin ? ['sender@s.whatsapp.net'] : []),
            ...(botAdmin ? ['bot@s.whatsapp.net'] : [])
        ])
    };
    const sock = {
        user: { id: 'bot@s.whatsapp.net' },
        groupAcceptInvite: async code => calls.push(['acceptInvite', code]),
        groupMetadata: async jid => {
            calls.push(['metadata', jid]);
            return metadata;
        },
        groupParticipantsUpdate: async (...args) => calls.push(['participantsUpdate', ...args]),
        groupInviteCode: async jid => {
            calls.push(['inviteCode', jid]);
            return 'INVITE123';
        },
        groupRevokeInvite: async jid => calls.push(['revokeInvite', jid])
    };
    const definitions = createGroupMembershipCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        isParticipantAdmin: (group, jid) => group.admins.has(jid),
        normalizeJid: jid => String(jid).replace(':4@', '@'),
        logError: (...args) => calls.push(['logError', ...args])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        sock,
        context: {
            sock,
            remoteJid: '12345@g.us',
            message: { key: { id: 'command-message' }, message: {} },
            senderJid: 'sender@s.whatsapp.net',
            args: []
        }
    };
}

test('join validates links and passes the extracted invite code to WhatsApp', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.join', fixture.context);
    assert.match(fixture.replies[0].text, /Please provide a valid/);

    fixture.context.args = ['https://invalid.test/INVITE123'];
    await fixture.registry.execute('.join', fixture.context);
    assert.equal(fixture.replies[1].text, '❌ Invalid group invite link format.');

    fixture.context.args = ['https://chat.whatsapp.com/INVITE123'];
    await fixture.registry.execute('.join', fixture.context);
    assert.deepEqual(fixture.calls.find(call => call[0] === 'acceptInvite'), ['acceptInvite', 'INVITE123']);
    assert.equal(fixture.replies[2].text, '✅ Successfully requested/joined the group!');
});

test('add remains group-only and validates a target number before metadata lookup', async () => {
    const fixture = createFixture();
    fixture.context.remoteJid = 'chat@s.whatsapp.net';
    await fixture.registry.execute('.add', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ This command can only be used inside groups.');

    fixture.context.remoteJid = '12345@g.us';
    await fixture.registry.execute('.add', fixture.context);
    assert.match(fixture.replies[1].text, /provide a valid phone number/);
    assert.equal(fixture.calls.some(call => call[0] === 'metadata'), false);
});

test('add checks sender and bot admin status before adding a member', async () => {
    const noSenderAdmin = createFixture({ senderAdmin: false });
    noSenderAdmin.context.args = ['+234 801 234 5678'];
    await noSenderAdmin.registry.execute('.add', noSenderAdmin.context);
    assert.match(noSenderAdmin.replies[0].text, /You must be a Group Admin/);

    const noBotAdmin = createFixture({ botAdmin: false });
    noBotAdmin.context.args = ['2348012345678'];
    await noBotAdmin.registry.execute('.add', noBotAdmin.context);
    assert.match(noBotAdmin.replies[0].text, /I need Admin permissions/);

    const fixture = createFixture();
    fixture.context.args = ['+234 801 234 5678'];
    await fixture.registry.execute('.add', fixture.context);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'participantsUpdate'),
        ['participantsUpdate', '12345@g.us', ['2348012345678@s.whatsapp.net'], 'add']
    );
});

test('kick preserves quoted-participant priority and admin requirements', async () => {
    const fixture = createFixture();
    fixture.context.message.message = {
        extendedTextMessage: {
            contextInfo: {
                participant: '2348000000001:4@s.whatsapp.net',
                mentionedJid: ['2348000000002@s.whatsapp.net']
            }
        }
    };
    fixture.context.args = ['2348000000003'];
    await fixture.registry.execute('.kick', fixture.context);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'participantsUpdate'),
        ['participantsUpdate', '12345@g.us', ['2348000000001@s.whatsapp.net'], 'remove']
    );
    assert.match(fixture.replies[0].text, /kicked @2348000000001/);
});

test('kick rejects missing targets without fetching group metadata', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.kick', fixture.context);
    assert.match(fixture.replies[0].text, /Please reply to a message/);
    assert.equal(fixture.calls.some(call => call[0] === 'metadata'), false);
});

test('link requires sender and bot admin before returning the invite URL', async () => {
    const noSenderAdmin = createFixture({ senderAdmin: false });
    await noSenderAdmin.registry.execute('.link', noSenderAdmin.context);
    assert.match(noSenderAdmin.replies[0].text, /must be a Group Admin/);

    const noBotAdmin = createFixture({ botAdmin: false });
    await noBotAdmin.registry.execute('.link', noBotAdmin.context);
    assert.match(noBotAdmin.replies[0].text, /I need Admin permissions/);

    const fixture = createFixture();
    await fixture.registry.execute('.link', fixture.context);
    assert.match(fixture.replies[0].text, /https:\/\/chat\.whatsapp\.com\/INVITE123/);
});

test('revoke preserves its sender-admin check and invite reset action', async () => {
    const denied = createFixture({ senderAdmin: false });
    await denied.registry.execute('.revoke', denied.context);
    assert.equal(denied.replies[0].text, '⛔ You must be a Group Admin.');

    const fixture = createFixture({ botAdmin: false });
    await fixture.registry.execute('.revoke', fixture.context);
    assert.deepEqual(fixture.calls.find(call => call[0] === 'revokeInvite'), ['revokeInvite', '12345@g.us']);
    assert.match(fixture.replies[0].text, /BOND_SEVERED/);
});

test('promote and demote use mentions first and preserve rank responses', async () => {
    const fixture = createFixture();
    fixture.context.message.message = {
        extendedTextMessage: { contextInfo: { mentionedJid: ['2348000000008@s.whatsapp.net'] } }
    };
    fixture.context.args = ['2348000000009'];
    await fixture.registry.execute('.promote', fixture.context);
    await fixture.registry.execute('.demote', fixture.context);

    assert.deepEqual(
        fixture.calls.filter(call => call[0] === 'participantsUpdate'),
        [
            ['participantsUpdate', '12345@g.us', ['2348000000008@s.whatsapp.net'], 'promote'],
            ['participantsUpdate', '12345@g.us', ['2348000000008@s.whatsapp.net'], 'demote']
        ]
    );
    assert.match(fixture.replies[0].text, /NEW\* : ADMINISTRATOR/);
    assert.match(fixture.replies[1].text, /NEW\* : MEMBER/);
});

test('promote and demote retain group, target, and sender-admin validation', async () => {
    const fixture = createFixture({ senderAdmin: false });
    fixture.context.remoteJid = 'chat@s.whatsapp.net';
    await fixture.registry.execute('.promote', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Only works inside a group.');

    fixture.context.remoteJid = '12345@g.us';
    await fixture.registry.execute('.demote', fixture.context);
    assert.match(fixture.replies[1].text, /Mention or provide a number/);

    fixture.context.args = ['2348000000009'];
    await fixture.registry.execute('.promote', fixture.context);
    assert.equal(fixture.replies[2].text, '⛔ You must be a Group Admin.');
});

test('group membership module registers seven commands', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), [
        '.add',
        '.demote',
        '.join',
        '.kick',
        '.link',
        '.promote',
        '.revoke'
    ]);
});
