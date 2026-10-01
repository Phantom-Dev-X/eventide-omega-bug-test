// 🧩 Message-content decoders — the pure message-shape utilities shared
// by the basic helpers, the message pipeline/middleware, and command handlers:
// `unwrapMessageContent` peels WhatsApp's wrapper messages (deviceSent /
// ephemeral / viewOnce (V1/V2/V2Extension) / documentWithCaption / edited)
// down to the leaf content and reports the wrapper chain it walked,
// `extractMessageText` pulls the human-visible text/caption/button-selection
// out of a message together with a `source` tag, and `getQuotedContext`
// resolves the contextInfo of the quoted/replied-to message. Extracted from
// index.js unchanged; the three functions form a closed set with no external
// dependencies, so the factory takes none.
export function createMessageContent() {
    function unwrapMessageContent(message) {
        let current = message;
        const wrapperChain = [];

        for (let depth = 0; current && depth < 10; depth += 1) {
            if (current.deviceSentMessage?.message) {
                wrapperChain.push('deviceSentMessage');
                current = current.deviceSentMessage.message;
                continue;
            }
            if (current.ephemeralMessage?.message) {
                wrapperChain.push('ephemeralMessage');
                current = current.ephemeralMessage.message;
                continue;
            }
            if (current.viewOnceMessage?.message) {
                wrapperChain.push('viewOnceMessage');
                current = current.viewOnceMessage.message;
                continue;
            }
            if (current.viewOnceMessageV2?.message) {
                wrapperChain.push('viewOnceMessageV2');
                current = current.viewOnceMessageV2.message;
                continue;
            }
            if (current.viewOnceMessageV2Extension?.message) {
                wrapperChain.push('viewOnceMessageV2Extension');
                current = current.viewOnceMessageV2Extension.message;
                continue;
            }
            if (current.documentWithCaptionMessage?.message) {
                wrapperChain.push('documentWithCaptionMessage');
                current = current.documentWithCaptionMessage.message;
                continue;
            }
            if (current.editedMessage?.message) {
                wrapperChain.push('editedMessage');
                current = current.editedMessage.message;
                continue;
            }
            break;
        }

        return { message: current, wrapperChain };
    }

    function extractMessageText(msg) {
        const topLevelType = msg?.message ? Object.keys(msg.message)[0] : 'none';
        const { message, wrapperChain } = unwrapMessageContent(msg?.message);
        const leafType = message ? (Object.keys(message)[0] || 'unknown') : 'none';

        if (!message) {
            return {
                text: '',
                topLevelType,
                leafType,
                wrapperChain,
                source: 'none'
            };
        }

        const candidates = [
            ['conversation', message.conversation],
            ['extendedTextMessage.text', message.extendedTextMessage?.text],
            ['imageMessage.caption', message.imageMessage?.caption],
            ['videoMessage.caption', message.videoMessage?.caption],
            ['documentMessage.caption', message.documentMessage?.caption],
            ['buttonsResponseMessage.selectedButtonId', message.buttonsResponseMessage?.selectedButtonId],
            ['buttonsResponseMessage.selectedDisplayText', message.buttonsResponseMessage?.selectedDisplayText],
            ['listResponseMessage.title', message.listResponseMessage?.title],
            ['templateButtonReplyMessage.selectedId', message.templateButtonReplyMessage?.selectedId],
            ['templateButtonReplyMessage.selectedDisplayText', message.templateButtonReplyMessage?.selectedDisplayText]
        ];

        for (const [source, value] of candidates) {
            if (typeof value === 'string' && value.trim()) {
                return {
                    text: value,
                    topLevelType,
                    leafType,
                    wrapperChain,
                    source
                };
            }
        }

        return {
            text: '',
            topLevelType,
            leafType,
            wrapperChain,
            source: 'unhandled'
        };
    }

    function getQuotedContext(msg) {
        const unwrapped = unwrapMessageContent(msg?.message).message || {};
        return unwrapped.extendedTextMessage?.contextInfo
            || unwrapped.imageMessage?.contextInfo
            || unwrapped.videoMessage?.contextInfo
            || unwrapped.buttonsResponseMessage?.contextInfo
            || msg.message?.extendedTextMessage?.contextInfo
            || null;
    }

    return Object.freeze({
        getQuotedContext,
        unwrapMessageContent,
        extractMessageText
    });
}
