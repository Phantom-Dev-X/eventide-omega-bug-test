import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createAccountToolCommands } from '../src/commands/system/account-tools.js';

function createFixture({ owner = false, dev = false, media, target = '2348000000002@s.whatsapp.net' } = {}) {
    const replies = [];
    const sends = [];
    const calls = [];
    const sock = {
        profilePictureUrl: async (...args) => {
            calls.push(['profilePictureUrl', ...args]);
            return 'https://example.test/picture.jpg';
        },
        groupMetadata: async jid => {
            calls.push(['groupMetadata', jid]);
            return { subject: 'Test Group' };
        },
        sendMessage: async (...args) => {
            sends.push(args);
            return { key: { id: 'sent' } };
        },
        updateBlockStatus: async (...args) => calls.push(['updateBlockStatus', ...args])
    };
    const definitions = createAccountToolCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        normalizeJid: jid => String(jid).replace(':3@', '@'),
        fetchBuffer: async url => {
            calls.push(['fetchBuffer', url]);
            return Buffer.from('picture');
        },
        groupChannelLink: 'https://example.test/channel',
        downloadQuotedMedia: async (...args) => {
            calls.push(['downloadQuotedMedia', ...args]);
            return media || { isViewOnce: false };
        },
        resolveTargetJid: (...args) => {
            calls.push(['resolveTargetJid', ...args]);
            return target;
        },
        isDevNumber: () => dev,
        logError: (...args) => calls.push(['logError', ...args])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        sends,
        calls,
        sock,
        context: {
            sock,
            remoteJid: 'chat@s.whatsapp.net',
            message: { key: { id: 'command-message' }, message: {} },
            senderJid: '2348000000001:3@s.whatsapp.net',
            isSenderOwner: owner,
            args: []
        }
    };
}

test('gpp aliases resolve quoted participants before mentions and arguments', async () => {
    const fixture = createFixture();
    fixture.context.message.message = {
        extendedTextMessage: {
            contextInfo: {
                participant: '2348000000009:3@s.whatsapp.net',
                mentionedJid: ['2348000000008@s.whatsapp.net']
            }
        }
    };
    fixture.context.args = ['2348000000007'];
    await fixture.registry.execute('.getpp', fixture.context);

    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'profilePictureUrl').slice(1),
        ['2348000000009@s.whatsapp.net', 'image']
    );
    assert.deepEqual(fixture.sends[0][1].image, Buffer.from('picture'));
    assert.match(fixture.sends[0][1].caption, /TARGET\* : \+2348000000009/);
});

test('gpp falls back to the sender and reports picture lookup failures', async () => {
    const fixture = createFixture();
    fixture.sock.profilePictureUrl = async () => { throw new Error('private'); };
    await fixture.registry.execute('.pfp', fixture.context);
    assert.match(fixture.replies[0].text, /privacy settings/);
    assert.match(fixture.replies[0].text, /private/);
});

test('ggpp is group-only and sends the group picture with its subject', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.ggpp', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Only works inside a group.');

    fixture.context.remoteJid = '12345@g.us';
    await fixture.registry.execute('.grouppic', fixture.context);
    assert.match(fixture.sends[0][1].caption, /GROUP\* : Test Group/);
    assert.deepEqual(fixture.sends[0][1].image, Buffer.from('picture'));
});

test('view-once aliases reject unauthorized callers before downloading media', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.viewonce', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Owner/Dev only.');
    assert.equal(fixture.calls.some(call => call[0] === 'downloadQuotedMedia'), false);
});

test('view-once rejects ordinary quoted media', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.vv', fixture.context);
    assert.match(fixture.replies[0].text, /That is not a view-once/);
    assert.equal(fixture.sends.length, 0);
});

test('view-once restores image, audio, sticker, and document payload fields', async t => {
    const cases = [
        {
            name: 'image',
            media: { isViewOnce: true, type: 'imageMessage', buffer: Buffer.from('i'), node: { caption: 'photo' } },
            expected: { image: Buffer.from('i'), caption: 'photo' }
        },
        {
            name: 'audio',
            media: { isViewOnce: true, type: 'audioMessage', buffer: Buffer.from('a'), node: { ptt: true, mimetype: 'audio/ogg' } },
            expected: { audio: Buffer.from('a'), ptt: true, mimetype: 'audio/ogg' }
        },
        {
            name: 'sticker',
            media: { isViewOnce: true, type: 'stickerMessage', buffer: Buffer.from('s'), node: {} },
            expected: { sticker: Buffer.from('s') }
        },
        {
            name: 'document fallback',
            media: { isViewOnce: true, type: 'documentMessage', buffer: Buffer.from('d'), node: {} },
            expected: { document: Buffer.from('d'), mimetype: 'application/octet-stream', fileName: 'viewonce' }
        }
    ];

    for (const entry of cases) {
        await t.test(entry.name, async () => {
            const fixture = createFixture({ dev: true, media: entry.media });
            await fixture.registry.execute('.vv', fixture.context);
            assert.deepEqual(fixture.sends[0][1], entry.expected);
        });
    }
});

test('block and unblock reject unauthorized callers without resolving targets', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.block', fixture.context);
    await fixture.registry.execute('.unblock', fixture.context);
    assert.deepEqual(fixture.replies.map(reply => reply.text), ['❌ Owner/Dev only.', '❌ Owner/Dev only.']);
    assert.equal(fixture.calls.some(call => call[0] === 'resolveTargetJid'), false);
});

test('block and unblock preserve target JIDs and socket actions', async () => {
    const fixture = createFixture({ owner: true, target: '2348000000002:9@s.whatsapp.net' });
    await fixture.registry.execute('.block', fixture.context);
    await fixture.registry.execute('.unblock', fixture.context);

    assert.deepEqual(
        fixture.calls.filter(call => call[0] === 'updateBlockStatus'),
        [
            ['updateBlockStatus', '2348000000002:9@s.whatsapp.net', 'block'],
            ['updateBlockStatus', '2348000000002:9@s.whatsapp.net', 'unblock']
        ]
    );
    assert.match(fixture.replies[0].text, /STATE\* :: BLOCKED/);
    assert.match(fixture.replies[1].text, /STATE\* :: UNBLOCKED/);
});

test('block and unblock preserve distinct missing-target guidance', async () => {
    const fixture = createFixture({ dev: true, target: null });
    await fixture.registry.execute('.block', fixture.context);
    await fixture.registry.execute('.unblock', fixture.context);
    assert.match(fixture.replies[0].text, /Example: \.block/);
    assert.match(fixture.replies[1].text, /Example: \.unblock/);
});

test('account tool group registers five primary commands and four aliases', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.block', '.ggpp', '.gpp', '.unblock', '.vv']);
    for (const alias of ['.getpp', '.pfp', '.grouppic', '.viewonce']) {
        assert.equal(fixture.registry.has(alias), true);
    }
});
