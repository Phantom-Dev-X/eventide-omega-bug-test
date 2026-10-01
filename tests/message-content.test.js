import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageContent } from '../src/whatsapp/message-content.js';

const { getQuotedContext, unwrapMessageContent, extractMessageText } = createMessageContent();

test('returned interface is frozen', () => {
    assert.ok(Object.isFrozen(createMessageContent()));
});

// --- unwrapMessageContent ------------------------------------------------------

test('unwrapMessageContent returns null message and empty chain for falsy input', () => {
    assert.deepEqual(unwrapMessageContent(null), { message: null, wrapperChain: [] });
    assert.deepEqual(unwrapMessageContent(undefined), { message: undefined, wrapperChain: [] });
});

test('unwrapMessageContent passes plain messages through untouched', () => {
    const plain = { conversation: 'hi' };
    const result = unwrapMessageContent(plain);
    assert.equal(result.message, plain);
    assert.deepEqual(result.wrapperChain, []);
});

test('unwrapMessageContent peels each supported wrapper type', () => {
    const leaf = { conversation: 'inner' };
    const cases = [
        ['deviceSentMessage', { deviceSentMessage: { message: leaf } }],
        ['ephemeralMessage', { ephemeralMessage: { message: leaf } }],
        ['viewOnceMessage', { viewOnceMessage: { message: leaf } }],
        ['viewOnceMessageV2', { viewOnceMessageV2: { message: leaf } }],
        ['viewOnceMessageV2Extension', { viewOnceMessageV2Extension: { message: leaf } }],
        ['documentWithCaptionMessage', { documentWithCaptionMessage: { message: leaf } }],
        ['editedMessage', { editedMessage: { message: leaf } }]
    ];
    for (const [label, wrapped] of cases) {
        const result = unwrapMessageContent(wrapped);
        assert.equal(result.message, leaf, label);
        assert.deepEqual(result.wrapperChain, [label], label);
    }
});

test('unwrapMessageContent walks nested wrapper chains in order', () => {
    const leaf = { imageMessage: { caption: 'pic' } };
    const payload = {
        ephemeralMessage: {
            message: {
                viewOnceMessage: {
                    message: {
                        editedMessage: { message: leaf }
                    }
                }
            }
        }
    };
    const result = unwrapMessageContent(payload);
    assert.equal(result.message, leaf);
    assert.deepEqual(result.wrapperChain, ['ephemeralMessage', 'viewOnceMessage', 'editedMessage']);
});

test('unwrapMessageContent stops at the depth cap of 10', () => {
    let payload = { conversation: 'deep leaf' };
    for (let i = 0; i < 15; i++) {
        payload = { viewOnceMessage: { message: payload } };
    }
    const result = unwrapMessageContent(payload);
    assert.equal(result.wrapperChain.length, 10);
    // After 10 unwraps the walker stops wherever it is — still a wrapper, not the leaf.
    assert.ok(result.message.viewOnceMessage);
});

// --- extractMessageText ---------------------------------------------------------

test('extractMessageText handles empty messages', () => {
    const result = extractMessageText(null);
    assert.deepEqual(result, { text: '', topLevelType: 'none', leafType: 'none', wrapperChain: [], source: 'none' });
    const empty = extractMessageText({ message: {} });
    assert.equal(empty.text, '');
    assert.equal(empty.leafType, 'unknown');
    assert.equal(empty.source, 'unhandled');
});

test('extractMessageText reads plain conversation text', () => {
    const result = extractMessageText({ message: { conversation: '  hello there  ' } });
    assert.equal(result.text, '  hello there  ');
    assert.equal(result.topLevelType, 'conversation');
    assert.equal(result.leafType, 'conversation');
    assert.equal(result.source, 'conversation');
    assert.deepEqual(result.wrapperChain, []);
});

test('extractMessageText unwraps wrappers and reports the chain and leaf type', () => {
    const msg = {
        message: {
            viewOnceMessage: {
                message: { extendedTextMessage: { text: 'wrapped text' } }
            }
        }
    };
    const result = extractMessageText(msg);
    assert.equal(result.text, 'wrapped text');
    assert.equal(result.topLevelType, 'viewOnceMessage');
    assert.equal(result.leafType, 'extendedTextMessage');
    assert.equal(result.source, 'extendedTextMessage.text');
    assert.deepEqual(result.wrapperChain, ['viewOnceMessage']);
});

test('extractMessageText picks the first non-empty candidate in order', () => {
    const blankThenCaption = extractMessageText({
        message: { conversation: '   ', imageMessage: { caption: 'the caption' } }
    });
    assert.equal(blankThenCaption.text, 'the caption');
    assert.equal(blankThenCaption.source, 'imageMessage.caption');

    const buttonReply = extractMessageText({
        message: { buttonsResponseMessage: { selectedButtonId: 'btn-1', selectedDisplayText: 'Shown' } }
    });
    assert.equal(buttonReply.text, 'btn-1');
    assert.equal(buttonReply.source, 'buttonsResponseMessage.selectedButtonId');

    const templateReply = extractMessageText({
        message: { templateButtonReplyMessage: { selectedId: 'tpl-9', selectedDisplayText: 'Shown' } }
    });
    assert.equal(templateReply.text, 'tpl-9');
    assert.equal(templateReply.source, 'templateButtonReplyMessage.selectedId');

    const listReply = extractMessageText({
        message: { listResponseMessage: { title: 'List Title' } }
    });
    assert.equal(listReply.text, 'List Title');
    assert.equal(listReply.source, 'listResponseMessage.title');

    const docCaption = extractMessageText({
        message: { documentMessage: { caption: 'doc caption' } }
    });
    assert.equal(docCaption.source, 'documentMessage.caption');

    const videoCaption = extractMessageText({
        message: { videoMessage: { caption: 'vid caption' } }
    });
    assert.equal(videoCaption.source, 'videoMessage.caption');
});

test('extractMessageText returns source unhandled when no candidate matches', () => {
    const result = extractMessageText({ message: { stickerMessage: { url: 'x' } } });
    assert.equal(result.text, '');
    assert.equal(result.source, 'unhandled');
    assert.equal(result.leafType, 'stickerMessage');
});

// --- getQuotedContext ---------------------------------------------------------------

test('getQuotedContext reads contextInfo from the unwrapped message', () => {
    const ctx = { participant: '2348000000000@s.whatsapp.net' };
    const fromExtended = getQuotedContext({ message: { extendedTextMessage: { contextInfo: ctx } } });
    assert.equal(fromExtended, ctx);
    const fromImage = getQuotedContext({ message: { imageMessage: { contextInfo: ctx } } });
    assert.equal(fromImage, ctx);
    const fromVideo = getQuotedContext({ message: { videoMessage: { contextInfo: ctx } } });
    assert.equal(fromVideo, ctx);
    const fromButtons = getQuotedContext({ message: { buttonsResponseMessage: { contextInfo: ctx } } });
    assert.equal(fromButtons, ctx);
});

test('getQuotedContext sees through wrapper messages', () => {
    const ctx = { participant: '2348111111111@s.whatsapp.net' };
    const msg = {
        message: {
            ephemeralMessage: {
                message: { extendedTextMessage: { contextInfo: ctx } }
            }
        }
    };
    assert.equal(getQuotedContext(msg), ctx);
});

test('getQuotedContext falls back to the top-level contextInfo and returns null when absent', () => {
    const ctx = { participant: '2348222222222@s.whatsapp.net' };
    const msg = {
        message: {
            viewOnceMessage: { message: { imageMessage: {} } },
            extendedTextMessage: { contextInfo: ctx }
        }
    };
    assert.equal(getQuotedContext(msg), ctx);
    assert.equal(getQuotedContext({ message: { conversation: 'plain' } }), null);
    assert.equal(getQuotedContext({}), null);
});
