import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createGroupInformationCommands } from '../src/commands/group/information.js';

function createFixture({ owner = false, dev = false, admin = false, participants } = {}) {
    const replies = [];
    const sends = [];
    const calls = [];
    const groupParticipants = participants || [
        { id: '111@s.whatsapp.net', admin: 'admin' },
        { id: '222:4@s.whatsapp.net', admin: null },
        { id: '333@s.whatsapp.net', admin: null }
    ];
    const metadata = {
        subject: 'Test Dominion',
        owner: '222@s.whatsapp.net',
        creation: 1704067200,
        participants: groupParticipants
    };
    const sock = {
        groupMetadata: async jid => {
            calls.push(['groupMetadata', jid]);
            return metadata;
        },
        sendMessage: async (...args) => {
            sends.push(args);
            return { key: { id: 'sent' } };
        }
    };
    const definitions = createGroupInformationCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        normalizeJid: jid => String(jid).replace(':4@', '@'),
        groupChannelLink: 'https://example.test/channel',
        isDevNumber: () => dev,
        isUserGroupAdmin: async (...args) => {
            calls.push(['isUserGroupAdmin', ...args]);
            return admin;
        }
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        sends,
        calls,
        sock,
        context: {
            sock,
            remoteJid: '12345@g.us',
            message: { key: { id: 'command-message' } },
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: []
        }
    };
}

test('all group information commands preserve their group-only restriction', async () => {
    const fixture = createFixture();
    fixture.context.remoteJid = 'chat@s.whatsapp.net';
    for (const command of ['.groupinfo', '.tagall', '.hidetag', '.getvcf']) {
        await fixture.registry.execute(command, fixture.context);
    }
    assert.equal(fixture.replies.length, 4);
    assert.equal(fixture.replies.every(reply => reply.text === '❌ Only works inside a group.'), true);
    assert.equal(fixture.calls.some(call => call[0] === 'groupMetadata'), false);
});

test('groupinfo counts explicit admins and the normalized group owner', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.groupinfo', fixture.context);

    assert.match(fixture.replies[0].text, /NAME\* :: Test Dominion/);
    assert.match(fixture.replies[0].text, /MEMBERS\* :: 3/);
    assert.match(fixture.replies[0].text, /ADMINS\* :: 2/);
    assert.doesNotMatch(fixture.replies[0].text, /CREATED\* :: unknown/);
});

test('tagall preserves visible mention text, participant JIDs, and default text', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.tagall', fixture.context);

    assert.equal(
        fixture.sends[0][1].text,
        'https://example.test/channel\n\n*Attention all*\n\n@111 @222:4 @333'
    );
    assert.deepEqual(fixture.sends[0][1].mentions, [
        '111@s.whatsapp.net',
        '222:4@s.whatsapp.net',
        '333@s.whatsapp.net'
    ]);

    fixture.context.args = ['Meeting', 'now'];
    await fixture.registry.execute('.tagall', fixture.context);
    assert.match(fixture.sends[1][1].text, /\*Meeting now\*/);
});

test('hidetag rejects regular members before loading participant metadata', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.ht', fixture.context);
    assert.equal(fixture.replies[0].text, '⛔ Group Admin only.');
    assert.equal(fixture.calls.filter(call => call[0] === 'groupMetadata').length, 0);
});

test('hidetag permits group admins, owners, and developers with silent fallback text', async () => {
    for (const permissions of [{ admin: true }, { owner: true }, { dev: true }]) {
        const fixture = createFixture(permissions);
        await fixture.registry.execute('.hidetag', fixture.context);
        assert.equal(fixture.sends[0][1].text, '‎');
        assert.equal(fixture.sends[0][1].mentions.length, 3);
    }

    const fixture = createFixture({ owner: true });
    fixture.context.args = ['Hidden', 'notice'];
    await fixture.registry.execute('.hidetag', fixture.context);
    assert.equal(fixture.sends[0][1].text, 'Hidden notice');
});

test('getvcf exports at most 200 contacts while naming the full member count', async () => {
    const participants = Array.from({ length: 205 }, (_, index) => ({
        id: `${2348000000000 + index}@s.whatsapp.net`,
        admin: null
    }));
    const fixture = createFixture({ participants });
    await fixture.registry.execute('.getvcf', fixture.context);

    const content = fixture.sends[0][1];
    assert.equal(content.mimetype, 'text/x-vcard');
    assert.equal(content.fileName, 'members_205.vcf');
    const text = content.document.toString('utf8');
    assert.equal((text.match(/BEGIN:VCARD/g) || []).length, 200);
    assert.match(text, /TEL;TYPE=CELL:\+2348000000000/);
});

test('metadata and send failures preserve the command error reply', async () => {
    const fixture = createFixture();
    fixture.sock.groupMetadata = async () => { throw new Error('metadata unavailable'); };
    await fixture.registry.execute('.groupinfo', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ metadata unavailable');
});

test('group information module registers four commands and hidetag alias', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.getvcf', '.groupinfo', '.hidetag', '.tagall']);
    assert.equal(fixture.registry.has('.ht'), true);
});
