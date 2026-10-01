/**
 * Account-facing media retrieval and contact controls. Network, media, target
 * resolution, and authorization helpers are injected for isolated testing.
 */
export function createAccountToolCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        normalizeJid,
        fetchBuffer,
        groupChannelLink,
        downloadQuotedMedia,
        resolveTargetJid,
        isDevNumber,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        normalizeJid,
        fetchBuffer,
        downloadQuotedMedia,
        resolveTargetJid,
        isDevNumber,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Account tool commands require ${name}()`);
        }
    }
    if (typeof groupChannelLink !== 'string') {
        throw new Error('Account tool commands require groupChannelLink');
    }

    function isAuthorized(context) {
        return context.isSenderOwner || isDevNumber(context.senderJid);
    }

    return Object.freeze([
        {
            name: 'gpp',
            aliases: ['getpp', 'pfp'],
            async execute(context) {
                const { sock, remoteJid, message, senderJid, args } = context;
                let target = null;
                const quotedParticipant = message.message?.extendedTextMessage?.contextInfo?.participant;
                if (quotedParticipant) target = normalizeJid(quotedParticipant);
                else {
                    const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (mentionedJid) target = normalizeJid(mentionedJid);
                }
                if (!target && args[0]) {
                    const digits = args[0].replace(/\D/g, '');
                    if (digits.length >= 7) target = `${digits}@s.whatsapp.net`;
                }
                if (!target) target = normalizeJid(senderJid);

                try {
                    const pictureUrl = await sock.profilePictureUrl(target, 'image');
                    const picture = await fetchBuffer(pictureUrl);
                    const number = target.split('@')[0];
                    const caption = `${groupChannelLink}\n\n` + buildOmegaTerminal(
                        `   ░▒▓█ *VISUAL_EXTRACT* █▓▒░\n\n` +
                        `   [ 👁️ ] *TARGET* : +${number}\n` +
                        `   [ 📸 ] *ACTION* : PROFILE_PIC_PULL\n` +
                        `   [ ✅ ] *RESULT* : ACQUIRED\n\n` +
                        `   " *No face is hidden*\n     *from the all-seeing eye.* "`
                    );
                    await sock.sendMessage(remoteJid, { image: picture, caption }, { quoted: message });
                } catch (error) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Could not fetch profile picture. They may have privacy settings on, or the number is invalid.\n\nError: ${error?.message}`,
                        message
                    );
                }
            }
        },
        {
            name: 'ggpp',
            aliases: ['grouppic'],
            async execute(context) {
                const { sock, remoteJid, message } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
                    return;
                }
                try {
                    const pictureUrl = await sock.profilePictureUrl(remoteJid, 'image');
                    const picture = await fetchBuffer(pictureUrl);
                    let groupName = remoteJid;
                    try {
                        const metadata = await sock.groupMetadata(remoteJid);
                        groupName = metadata.subject;
                    } catch {
                        // The JID remains the fallback group label.
                    }
                    const caption = `${groupChannelLink}\n\n` + buildOmegaTerminal(
                        `   ░▒▓█ *GROUP_VISUAL_EXTRACT* █▓▒░\n\n` +
                        `   [ 👁️ ] *GROUP* : ${groupName}\n` +
                        `   [ 📸 ] *ACTION* : GROUP_PIC_PULL\n` +
                        `   [ ✅ ] *RESULT* : ACQUIRED\n\n` +
                        `   " *Every domain has a face.*\n     *This one belongs to us.* "`
                    );
                    await sock.sendMessage(remoteJid, { image: picture, caption }, { quoted: message });
                } catch (error) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Could not fetch group picture. The group may not have one set.\n\nError: ${error?.message}`,
                        message
                    );
                }
            }
        },
        {
            name: 'vv',
            aliases: ['viewonce'],
            async execute(context) {
                const { sock, remoteJid, message } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                try {
                    const media = await downloadQuotedMedia(sock, message);
                    if (!media.isViewOnce) {
                        await safeWaReply(
                            sock,
                            remoteJid,
                            '❌ That is not a view-once. Reply to a *view-once* photo/video/voice with .vv',
                            message
                        );
                        return;
                    }
                    const content = {};
                    if (media.type === 'imageMessage') {
                        content.image = media.buffer;
                        content.caption = media.node?.caption || '';
                    } else if (media.type === 'videoMessage') {
                        content.video = media.buffer;
                        content.caption = media.node?.caption || '';
                    } else if (media.type === 'audioMessage') {
                        content.audio = media.buffer;
                        content.ptt = !!media.node?.ptt;
                        content.mimetype = media.node?.mimetype || 'audio/mp4';
                    } else if (media.type === 'stickerMessage') {
                        content.sticker = media.buffer;
                    } else {
                        content.document = media.buffer;
                        content.mimetype = media.node?.mimetype || 'application/octet-stream';
                        content.fileName = media.node?.fileName || 'viewonce';
                    }
                    await sock.sendMessage(remoteJid, content, { quoted: message });
                } catch (error) {
                    logError('VV', 'viewonce failed', error);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Could not unlock that view-once.\n${error?.message || error}`,
                        message
                    );
                }
            }
        },
        {
            name: 'block',
            async execute(context) {
                const { sock, remoteJid, message, args } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                const target = resolveTargetJid(message, args);
                if (!target) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Reply to a message, @mention, or provide a number.\nExample: .block @user  |  .block 23480...',
                        message
                    );
                    return;
                }
                const number = target.split('@')[0];
                try {
                    await sock.updateBlockStatus(target, 'block');
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *BLOCK_CAST* █▓▒░\n\n` +
                            `   ✦ *TARGET* :: +${number}\n` +
                            `   ✦ *STATE* :: BLOCKED\n\n` +
                            `   " They are cast from\n     the inner circle. "`
                        ),
                        message
                    );
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ Could not block. Error: ${error?.message}`, message);
                }
            }
        },
        {
            name: 'unblock',
            async execute(context) {
                const { sock, remoteJid, message, args } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                const target = resolveTargetJid(message, args);
                if (!target) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Reply to a message, @mention, or provide a number.\nExample: .unblock @user  |  .unblock 23480...',
                        message
                    );
                    return;
                }
                const number = target.split('@')[0];
                try {
                    await sock.updateBlockStatus(`${number}@s.whatsapp.net`, 'unblock');
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *BLOCK_LIFTED* █▓▒░\n\n` +
                            `   ✦ *TARGET* :: ${number}\n` +
                            `   ✦ *STATE* :: UNBLOCKED\n\n` +
                            `   " They may return\n     to the circle. "`
                        ),
                        message
                    );
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ Could not unblock. Error: ${error?.message}`, message);
                }
            }
        }
    ]);
}
