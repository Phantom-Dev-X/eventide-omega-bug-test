/**
 * .gcstatus — post a text as the GROUP STATUS (Squichy gcstatus recipe).
 *
 * Run inside the target group: .gcstatus <text> — the bot posts the text as
 * the group's status. Every member sees it in the status tray / group status
 * album and gets the mention ping (Squichy dresses the send with
 * contextInfo.isGroupStatus + a mention of every member, which is what makes
 * clients render it into the group status view).
 */
export function createGroupStatusCommands(deps) {
    const { safeWaReply, isDevNumber } = deps || {};

    for (const [name, value] of Object.entries({ safeWaReply, isDevNumber })) {
        if (typeof value !== 'function') {
            throw new Error(`Group status commands require ${name}()`);
        }
    }

    return Object.freeze([
        {
            name: 'gcstatus',
            async execute(context) {
                const { sock, remoteJid, message, args, senderJid, isSenderOwner } = context;

                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Only works inside a group.\n\nUsage: .gcstatus <text> — posts the text as the group status.',
                        message
                    );
                    return;
                }
                if (!isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/dev only.', message);
                    return;
                }

                const text = (args || []).join(' ').trim();
                if (!text) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '📡 *GROUP STATUS*\n\nUsage: .gcstatus <text>\n\nPosts the text as the group status — members see it in the status tray + group status album.\n\nExample: .gcstatus Hello world',
                        message
                    );
                    return;
                }

                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    const participants = (metadata?.participants || []).map(p => p.id).filter(Boolean);
                    if (!participants.length) throw new Error('could not read the group member list');

                    // Squichy gcstatus recipe, verbatim dressing: the
                    // isGroupStatus marker + every-member mentions make clients
                    // file the message into the group status album.
                    await sock.sendMessage(
                        remoteJid,
                        {
                            text,
                            contextInfo: {
                                mentionedJid: participants,
                                isGroupStatus: true
                            }
                        },
                        {
                            backgroundColor: '#000000',
                            statusJidList: participants
                        }
                    );
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `✅ Text uploaded to group status (${participants.length} members).`,
                        message
                    );
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ ${error?.message || error}`, message);
                }
            }
        }
    ]);
}
