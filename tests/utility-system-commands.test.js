import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createUtilitySystemCommands } from '../src/commands/system/utilities.js';

function createSharpMock(calls) {
    return (buffer, options) => {
        calls.push(['sharp', buffer, options]);
        const pipeline = {
            resize: (...args) => {
                calls.push(['resize', ...args]);
                return pipeline;
            },
            webp: () => {
                calls.push(['webp']);
                return pipeline;
            },
            png: () => {
                calls.push(['png']);
                return pipeline;
            },
            toBuffer: async () => Buffer.from(calls.some(call => call[0] === 'png') ? 'png-output' : 'webp-output')
        };
        return pipeline;
    };
}

function createFixture({ sharpAvailable = true, qrAvailable = true } = {}) {
    const replies = [];
    const sends = [];
    const calls = [];
    const sharp = createSharpMock(calls);
    const qrcode = {
        toBuffer: async (...args) => {
            calls.push(['qr', ...args]);
            return Buffer.from('qr-output');
        }
    };
    const sock = {
        sendMessage: async (...args) => {
            sends.push(args);
            return { key: { id: 'sent' } };
        }
    };
    const definitions = createUtilitySystemCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        loadSharp: () => sharpAvailable ? sharp : null,
        loadQrcode: () => qrAvailable ? qrcode : null,
        downloadMediaMessage: async (...args) => {
            calls.push(['download', ...args]);
            return Buffer.from('downloaded');
        },
        createSilentLogger: () => ({ level: 'silent' }),
        groupChannelLink: 'https://example.test/channel',
        logError: (...args) => calls.push(['error', ...args])
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
            args: []
        }
    };
}

function quotedContext(fixture, quotedMessage) {
    fixture.context.message.message = {
        extendedTextMessage: { contextInfo: { quotedMessage } }
    };
    return fixture.context;
}

test('sticker requires a quoted image or video', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.sticker', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Reply to an image/video with .sticker to make a sticker.');
    assert.equal(fixture.sends.length, 0);
});

test('sticker converts a quoted image to a 512px webp', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.sticker', quotedContext(fixture, { imageMessage: { id: 'image' } }));

    assert.equal(fixture.calls.some(call => call[0] === 'download'), true);
    assert.equal(fixture.calls.some(call => call[0] === 'resize' && call[1] === 512 && call[2] === 512), true);
    assert.equal(fixture.calls.some(call => call[0] === 'webp'), true);
    assert.deepEqual(fixture.sends[0][1].sticker, Buffer.from('webp-output'));
});

test('animated sticker conversion preserves the animated sharp option', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.sticker', quotedContext(fixture, { videoMessage: { id: 'video' } }));
    assert.equal(
        fixture.calls.some(call => call[0] === 'sharp' && call[2]?.animated === true),
        true
    );
});

test('sticker and toimg preserve unavailable-host responses', async () => {
    const fixture = createFixture({ sharpAvailable: false });
    await fixture.registry.execute('.sticker', quotedContext(fixture, { imageMessage: {} }));
    await fixture.registry.execute('.toimg', quotedContext(fixture, { stickerMessage: {} }));
    assert.deepEqual(
        fixture.replies.map(reply => reply.text),
        [
            '❌ Sticker processing unavailable on this host.',
            '❌ Image processing unavailable on this host.'
        ]
    );
});

test('toimg converts a quoted sticker to png', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.toimg', quotedContext(fixture, { stickerMessage: { id: 'sticker' } }));
    assert.equal(fixture.calls.some(call => call[0] === 'png'), true);
    assert.deepEqual(fixture.sends[0][1].image, Buffer.from('png-output'));
});

test('QR generation preserves dimensions, caption, and quoted message', async () => {
    const fixture = createFixture();
    fixture.context.args = ['https://example.test', 'path'];
    await fixture.registry.execute('.qr', fixture.context);

    assert.deepEqual(fixture.calls.find(call => call[0] === 'qr').slice(1), [
        'https://example.test path',
        { width: 512, margin: 1 }
    ]);
    assert.equal(fixture.sends[0][1].caption, 'https://example.test/channel\n\n*QR GENERATED*');
    assert.equal(fixture.sends[0][2].quoted, fixture.context.message);
});

test('QR reports missing input and unavailable generation separately', async () => {
    const fixture = createFixture({ qrAvailable: false });
    await fixture.registry.execute('.qr', fixture.context);
    fixture.context.args = ['payload'];
    await fixture.registry.execute('.qr', fixture.context);
    assert.deepEqual(
        fixture.replies.map(reply => reply.text),
        ['❌ use: .qr <text-or-url>', '❌ QR generation unavailable on this host.']
    );
});

test('calculator preserves arithmetic output and invalid-expression response', async () => {
    const fixture = createFixture();
    fixture.context.args = ['5', '+', '3', '*', '2'];
    await fixture.registry.execute('.calc', fixture.context);
    assert.match(fixture.replies[0].text, /RESULT\* :: 11/);

    fixture.context.args = ['('];
    await fixture.registry.execute('.calc', fixture.context);
    assert.equal(fixture.replies[1].text, '❌ Invalid expression.');
});

test('base64 encodes and decodes while preserving usage validation', async () => {
    const fixture = createFixture();
    fixture.context.args = ['enc', 'hello', 'world'];
    await fixture.registry.execute('.base64', fixture.context);
    assert.match(fixture.replies[0].text, /aGVsbG8gd29ybGQ=/);

    fixture.context.args = ['dec', 'aGVsbG8='];
    await fixture.registry.execute('.base64', fixture.context);
    assert.match(fixture.replies[1].text, /OUTPUT\* :: hello/);

    fixture.context.args = ['bad', 'data'];
    await fixture.registry.execute('.base64', fixture.context);
    assert.equal(fixture.replies[2].text, '❌ use: .base64 enc <text>  |  .base64 dec <base64>');
});

test('utility command group registers five commands', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.base64', '.calc', '.qr', '.sticker', '.toimg']);
});
