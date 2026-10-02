// 🗳️ Poll & menu service — brute-force poll-vote decryption plus the
// menu poll/banner senders, extracted from index.js unchanged.
// `decryptVoteOption` tries every creator/voter JID combination (PN + LID)
// against the encrypted vote and maps the selected option hash back to an
// index. `handlePollVote` (messages.update path) and
// `handlePollUpdateMessage` (raw pollUpdateMessage upserts — Baileys 7 rc13
// has vote decryption commented out) decrypt manual votes, enforce the same
// voting-rights gate as everything else (owner > sudo > game polls), and
// de-duplicate repeated selections via lastPollVotes.
// `sendMenuPoll` builds the widely-compatible V1 poll envelope directly
// (proto.Message.create + generateWAMessageFromContent + relayMessage — the
// fork's V3 generator was silently dropped by the server) and caches the
// secret/options/ids in poll_cache.json. `sendMenuBanner` sends a menu banner
// image with formatted caption (text fallback on failure);
// `recordMenuMessage`/`deleteMenuMessages` track sent menu messages per
// poll+voter so a vote change can clean them up; `buildBugMenuText` renders
// the shared bug menu.
//
// The bug-menu builder receives the current access mode explicitly. This keeps
// it independent of the old monolithic index.js scope and safe for every caller.

// Conventions: crypto is imported directly; log/logError, the Baileys surface
// (jidNormalizedUser/decryptPollVote/proto/generateWAMessageFromContent), the
// config-store loaders, canVoteOnPoll, trimForLog, formatForWhatsApp,
// flashPresenceOnline, and the shared lastPollVotes/menuReplyMessages Maps
// (src/core/state.js) are injected.
import crypto from 'crypto';

export function createPollMenuService(deps) {
    for (const name of ['log', 'logError', 'jidNormalizedUser', 'decryptPollVote', 'loadPollCache', 'savePollCache', 'trimForLog', 'generateWAMessageFromContent', 'formatForWhatsApp', 'flashPresenceOnline', 'canVoteOnPoll']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createPollMenuService: missing required dependency: ${name}`);
        }
    }
    if (!deps?.proto || typeof deps.proto !== 'object') {
        throw new Error('createPollMenuService: missing required dependency: proto');
    }
    if (!(deps?.lastPollVotes instanceof Map) || !(deps?.menuReplyMessages instanceof Map)) {
        throw new Error('createPollMenuService: missing required dependency: lastPollVotes/menuReplyMessages (Map)');
    }
    const { log, logError, jidNormalizedUser, decryptPollVote, loadPollCache, savePollCache, trimForLog, proto, generateWAMessageFromContent, formatForWhatsApp, flashPresenceOnline, canVoteOnPoll, lastPollVotes, menuReplyMessages } = deps;

    // ──────────────────────────────────────────────
    // 🔐 BRUTE-FORCE POLL DECRYPTION
    // ──────────────────────────────────────────────

    // Try to decrypt an encrypted poll vote against a set of creator/voter JID
    // candidates (PN + LID) and, if it matches, return the selected option index.
    function decryptVoteOption(secretHex, options, pollMsgId, creatorJids, voterJids, encVote) {
        const secretBuf = Buffer.from(secretHex, 'hex');
        for (const creator of creatorJids) {
            for (const voter of voterJids) {
                try {
                    const d = decryptPollVote(encVote, {
                        pollEncKey: secretBuf,
                        pollCreatorJid: creator,
                        pollMsgId,
                        voterJid: voter,
                    });
                    if (d?.selectedOptions?.length) {
                        const hash = Buffer.from(d.selectedOptions[0]).toString('hex');
                        const idx = options.findIndex(
                            (o) => crypto.createHash('sha256').update(Buffer.from(o)).digest('hex') === hash
                        );
                        if (idx >= 0) return idx;
                    }
                } catch (_) { /* wrong combo */ }
            }
        }
        return -1;
    }

    // Handles a decrypted vote arriving via a `messages.update` `pollUpdates` event.
    // (Some Baileys builds emit this; harmless if it never fires.)
    function handlePollVote(sock, phoneNumber, key, pollUpdates) {
        const cache = loadPollCache(phoneNumber);
        const cached = cache.get(key.id);
        if (!cached) return null;

        const mePN  = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';
        const rawLID = sock.user?.lid || sock.authState?.creds?.me?.lid || '';
        const meLID = rawLID ? jidNormalizedUser(rawLID) : '';

        const creators = [...new Set([meLID, mePN].filter(Boolean))];
        const keyJid = jidNormalizedUser(key.participant || key.remoteJid || '');
        if (keyJid) creators.push(keyJid);

        const voters = [];
        if (key.fromMe) { 
            voters.push(mePN, meLID); 
        } else if (key.participant) {
            voters.push(jidNormalizedUser(key.participant));
        } else {
            voters.push(jidNormalizedUser(key.remoteJid));
        }
        const uniqVoters = [...new Set(voters.filter(Boolean))];

        // 🛡️ same voting rights as the pollUpdateMessage path
        const ownerJids = [...new Set([mePN, meLID].filter(Boolean))];
        if (!canVoteOnPoll(phoneNumber, uniqVoters, Array.isArray(cached.ids) ? cached.ids : [], ownerJids)) {
            return null;
        }

        for (const update of pollUpdates) {
            if (!update?.vote) continue;
            const idx = decryptVoteOption(cached.secretHex, cached.options, key.id, creators, uniqVoters, update.vote);
            if (idx >= 0 && cached.ids && cached.ids[idx]) return cached.ids[idx];
        }
        return null;
    }

    // In Baileys 7.0.0-rc13 the built-in poll vote decryption is commented out, so
    // votes arrive as raw `pollUpdateMessage` upserts (NOT via `messages.update`).
    // This decrypts them manually and returns the selected menu id (or null).
    function handlePollUpdateMessage(sock, phoneNumber, msg) {
        const content = msg?.message?.pollUpdateMessage;
        if (!content) return null;

        const creationKey = content.pollCreationMessageKey;
        if (!creationKey?.id) return null;

        const pollId = creationKey.id;

        const cache = loadPollCache(phoneNumber);
        const cached = cache.get(pollId);
        if (!cached) {
            log('POLL', `${phoneNumber}: poll update for unknown poll ${pollId}`);
            return null;
        }

        const encVote = content.vote;
        if (!encVote) return null;

        const mePN  = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';
        const rawLID = sock.user?.lid || sock.authState?.creds?.me?.lid || '';
        const meLID = rawLID ? jidNormalizedUser(rawLID) : '';

        // Poll creator = author of the poll creation message (LID + PN combos)
        const creators = [...new Set([meLID, mePN].filter(Boolean))];
        const ckeyJid = jidNormalizedUser(creationKey.participant || creationKey.remoteJid || '');
        if (ckeyJid) creators.push(ckeyJid);

        // Voter = author of the poll update message (LID + PN combos)
        const voters = [];
        if (msg.key?.fromMe) {
            voters.push(mePN, meLID);
        } else if (msg.key?.participant) {
            voters.push(jidNormalizedUser(msg.key.participant));
        } else {
            voters.push(jidNormalizedUser(msg.key.remoteJid));
        }
        const uniqVoters = [...new Set(voters.filter(Boolean))];

        // 🛡️ POLL VOTING RIGHTS: owner votes on everything; sudoes vote on
        // menu/game polls (they can navigate the bot) but NEVER on bot-self
        // config polls (persona/helpconfig/autoreact/antidelete/warn setups);
        // everyone else only votes on game/ttt polls.
        const ownerJids = [...new Set([mePN, meLID].filter(Boolean))];
        if (!canVoteOnPoll(phoneNumber, uniqVoters, Array.isArray(cached.ids) ? cached.ids : [], ownerJids)) {
            log('POLL', `${phoneNumber}: ignored non-owner poll vote (voter=[${uniqVoters.join(',')}])`);
            return null;
        }

        const idx = decryptVoteOption(cached.secretHex, cached.options, pollId, creators, uniqVoters, encVote);
        if (idx >= 0 && cached.ids && cached.ids[idx]) {
            const optionId = cached.ids[idx];
            // Only reply when the voter actually changes their selection (or votes a
            // new option), so re-selecting the same option doesn't re-trigger.
            const voterJid = uniqVoters[0] || 'me';
            const voteKey = `${pollId}:${voterJid}`;
            if (lastPollVotes.get(voteKey) === optionId) {
                log('POLL', `${phoneNumber}: duplicate vote on ${optionId} ignored for ${voteKey}`);
                return null;
            }
            lastPollVotes.set(voteKey, optionId);
            return { optionId, pollId, voterJid };
        }
        log('POLL', `${phoneNumber}: decrypt failed for poll ${pollId} (creators=[${creators.join(',')}] voters=[${uniqVoters.join(',')}])`);
        return null;
    }

    // Sends a native WhatsApp poll and stores its decryption details in cache.
    // Used for the main .menu poll and the "Choose Your Domain" sub-poll.
    async function sendMenuPoll(sock, remoteJid, phoneNumber, question, options, ids) {
        if (sock?._eventidePhone) flashPresenceOnline(sock, sock._eventidePhone);

        const pollOptions = Array.isArray(options) ? options.map(v => String(v || '').trim()).filter(Boolean) : [];
        const pollIds = Array.isArray(ids) ? ids : [];
        if (!remoteJid || remoteJid === 'unknown') throw new Error('Poll destination is missing.');
        if (!String(question || '').trim()) throw new Error('Poll question is empty.');
        if (pollOptions.length < 2 || pollOptions.length > 12) {
            throw new Error(`A WhatsApp poll needs 2–12 options; received ${pollOptions.length}.`);
        }
        if (pollIds.length !== pollOptions.length) {
            throw new Error(`Poll option/id mismatch (${pollOptions.length} options, ${pollIds.length} ids).`);
        }

        const secret = crypto.randomBytes(32);
        log('POLL-SEND', `${phoneNumber}: sending poll to ${remoteJid} | options=${pollOptions.length} | question=${JSON.stringify(trimForLog(question, 80))}`);

        // xzcbailz's high-level `{ poll: ... }` generator produces V3. Runtime
        // logs proved that V3 was built and relayed to the self-chat LID, yet the
        // server never acknowledged/rendered it. Build the widely-compatible V1
        // poll envelope directly instead. relayMessage() still handles encryption,
        // message type="poll", and the single required polltype=creation meta node.
        const pollContent = proto.Message.create({
            messageContextInfo: { messageSecret: secret },
            pollCreationMessage: {
                name: String(question),
                options: pollOptions.map(optionName => ({ optionName })),
                selectableOptionsCount: 1
            }
        });
        const pollMsg = generateWAMessageFromContent(remoteJid, pollContent, {
            userJid: sock.user?.id
        });
        if (!pollMsg?.key?.id || !pollMsg?.message?.pollCreationMessage) {
            throw new Error('Could not generate the V1 poll envelope.');
        }

        await sock.relayMessage(remoteJid, pollMsg.message, {
            messageId: pollMsg.key.id
        });
        log('POLL-SEND', `${phoneNumber}: poll relayed | id=${pollMsg.key.id} | type=pollCreationMessage(V1) | jid=${remoteJid}`);

        const actualSecret =
            pollMsg?.message?.messageContextInfo?.messageSecret ||
            pollMsg?.messageContextInfo?.messageSecret ||
            secret;

        const cache = loadPollCache(phoneNumber);
        cache.set(pollMsg.key.id, {
            secretHex: actualSecret.toString('hex'),
            options: pollOptions,
            ids: pollIds,
            fullMessage: pollMsg.message || null
        });
        savePollCache(phoneNumber, cache);

        return pollMsg;
    }

    // Routes a decrypted poll vote to the correct menu flow.
    // Sends the matching menu banner image with the menu text as its caption.
    async function sendMenuBanner(sock, remoteJid, imagePath, caption) {
        if (sock?._eventidePhone) flashPresenceOnline(sock, sock._eventidePhone);
        try {
            const sent = await sock.sendMessage(remoteJid, {
                image: { url: imagePath },
                caption: formatForWhatsApp(caption)
                // contextInfo: channelContextInfo() // (commented: externalAdReply caused "no proper viewing app" error)
            });
            return sent?.key || null;
        } catch (err) {
            logError('WA-BANNER', `Failed to send banner for ${remoteJid}`, err);
            // Fall back to sending the caption as a plain text reply.
            try {
                const sent = await sock.sendMessage(remoteJid, { text: formatForWhatsApp(caption) });
                return sent?.key || null;
            } catch (_) { return null; }
        }
    }


    // Records a sent menu message key so it can be deleted when the vote changes.
    function recordMenuMessage(replyKey, msgKey) {
        if (!msgKey?.id) return;
        const arr = menuReplyMessages.get(replyKey) || [];
        arr.push(msgKey);
        menuReplyMessages.set(replyKey, arr);
    }

    // Deletes every previously-sent menu message for a poll+voter on a vote change.
    async function deleteMenuMessages(sock, replyKey) {
        const messages = menuReplyMessages.get(replyKey) || [];
        for (const key of messages) {
            try {
                await sock.sendMessage(key.remoteJid, { delete: key });
            } catch (err) {
                logError('WA-DEL', `Failed to delete menu message ${key?.id}`, err);
            }
        }
        menuReplyMessages.delete(replyKey);
    }

    // 🧪 Shared bug-menu text builder — used by BOTH the .bugmenu command and the
    // menu-poll "BUG MENU" vote, so they always send the exact same reply.
    function buildBugMenuText(prefix = '.', currentMode = 'public') {
        const date = new Date();
        const uptimeSeconds = Math.floor(process.uptime());
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;
        const menuText = [
                '╭┈〔 *𝙸𝙽𝙵𝙾 𝙱𝙾𝚃* 〕',
                '┆𖤍╭────↯',
                `┃𖤍│➣ *𝙿𝚁𝙴𝙵𝙸𝚇:* ${prefix}`,
                `┃𖤍│➣ *𝙳𝙰𝚃𝙴:* ${date.toLocaleDateString('en-GB')}`,
                `┃𖤍│➣ *ᴜᴘᴛɪᴍᴇ*: ${hours}h ${minutes}m ${seconds}s`,
                `┃𖤍│➣ *𝚁𝚄𝙽𝚃𝙸𝙼𝙴:* ${process.version}`,
                `┃𖤍│➣ *𝙼𝙾𝙳𝙴:* ${currentMode}`,
                '┆𖤍╰────↯',
                '╰┄┄┄┄┄┄┄┄┄┄┄┄┄〩',
                '',
                '╭┈〔 *Eventides-omega-𝙱𝚄𝙶 menu* 〕',
                '┆𖤍╭────↯',
                '┃𖤍│ ᖫ *𝙰𝙽𝙳𝚁𝙾𝙸𝙳* ᖭ',
                '┃𖤍│ ╰━➤ *`𝙲𝚁𝙰𝚂𝙷`*',
                '┃𖤍│➣ *.𝗰𝗿𝗮𝘀𝗵-𝗵𝗮𝗿𝗱* <num>',
                '┃𖤍│➣ *.𝗳𝗿𝘇-𝗼𝗼𝗺* <num>',
                '┃𖤍│',
                '┃𖤍│ ᖫ *𝙸𝙾𝚂* ᖭ',
                '┃𖤍│      ╰━➤ *`𝙲𝚁𝙰𝚂𝙷 / 𝙵𝚁𝙴𝙴𝚉𝙴`*',
                '┃𖤍│➣ *.𝗰𝗿𝗮𝘀𝗵-𝗶𝗼𝘀* <num>',
                '┃𖤍│➣ *.𝗰𝗿𝗮𝘀𝗵-𝗶𝗼𝘀𝗱* <num>',
                '┃𖤍│➣ *.𝗳𝗿𝘇-𝗶𝗼𝘀* <num> ',
                '┃𖤍│➣ *.𝗶𝗼𝘀-𝘇𝗸* <num> — ×60 loc/mention bomb',
                '┃𖤍│',
                '┃𖤍│ ᖫ *𝙷𝚈𝙱𝚁𝙸𝙳 𝙽𝚄𝙺𝙴* ᖭ',
                '┃𖤍│      ╰━➤ *`𝙵𝚅𝙲𝙺𝙱𝙸𝚃𝙲𝙷`*',
                '┃𖤍│➣ *.𝗮𝗻𝗱𝗿𝗼-𝗻𝘂𝗸𝗲* <num> [rounds] — ×10 per round',
                '┃𖤍│',
                '┃𖤍│ ᖫ *𝙶𝚁𝙾𝚄𝙿* ᖭ',
                '┃𖤍│      ╰━➤ *`𝙲𝚁𝙰𝚂𝙷𝙲𝙻𝙸𝙲𝙺`*',
                '┃𖤍│➣ *.𝗴𝗯* yes — in group ×10',
                '┃𖤍│➣ *.𝗴𝗯* <invite link> — group ×10',
                '┃𖤍│➣ *.𝗴𝗯-𝗵𝗮𝗿𝗱* <link> — group app-level ×10',
                '┆𖤍╰────↯',
                '╰┄┄┄┄┄┄┄┄┄┄┄┄┄〩',
                '',
                '> please dont spam to aviod bans, i didnt say dont use, just type the name of the command you wanna use and youll see how to use it',
                `Main menu: ${prefix}menu`
            ].join('\n');
        return menuText;
    }

    return Object.freeze({
        decryptVoteOption,
        handlePollVote,
        handlePollUpdateMessage,
        sendMenuPoll,
        sendMenuBanner,
        recordMenuMessage,
        deleteMenuMessages,
        buildBugMenuText
    });
}
