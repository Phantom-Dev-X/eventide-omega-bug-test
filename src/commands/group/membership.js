/**
 * Group membership and invite-link operations. Authorization intentionally
 * matches the legacy handlers: each command performs only its original admin
 * checks, including commands that historically did not require bot-admin.
 */
export function createGroupMembershipCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        isParticipantAdmin,
        normalizeJid,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        isParticipantAdmin,
        normalizeJid,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Group membership commands require ${name}()`);
        }
    }

    return Object.freeze([
        {
            name: 'join',
            async execute(context) {
                const { sock, remoteJid, message, args } = context;
                const link = args[0];
                if (!link) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Please provide a valid WhatsApp group invite link.\n\n*Example*: .join https://chat.whatsapp.com/L2mX...',
                        message
                    );
                    return;
                }
                try {
                    const code = link.split('chat.whatsapp.com/')[1];
                    if (!code) {
                        await safeWaReply(sock, remoteJid, '❌ Invalid group invite link format.', message);
                        return;
                    }
                    await sock.groupAcceptInvite(code);
                    await safeWaReply(sock, remoteJid, '✅ Successfully requested/joined the group!', message);
                } catch (error) {
                    logError('GROUP-JOIN', 'Failed to join group', error);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Failed to join group. Error: ${error.message || error}`,
                        message
                    );
                }
            }
        },
        {
            name: 'add',
            async execute(context) {
                const { sock, remoteJid, message, senderJid, args } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ This command can only be used inside groups.', message);
                    return;
                }
                const targetNumber = args[0]?.replace(/\D/g, '');
                if (!targetNumber) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Please provide a valid phone number with country code.\n\n*Example*: .add 2348012345678',
                        message
                    );
                    return;
                }
                const targetJid = `${targetNumber}@s.whatsapp.net`;
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    const senderAdmin = isParticipantAdmin(metadata, senderJid);
                    const botAdmin = isParticipantAdmin(metadata, sock.user.id);
                    if (!senderAdmin) {
                        await safeWaReply(sock, remoteJid, '⛔ You must be a Group Admin to use this command.', message);
                        return;
                    }
                    if (!botAdmin) {
                        await safeWaReply(sock, remoteJid, '⚠️ I need Admin permissions in this group to add members.', message);
                        return;
                    }
                    await sock.groupParticipantsUpdate(remoteJid, [targetJid], 'add');
                    await safeWaReply(sock, remoteJid, `✅ Successfully added @${targetNumber} to the group!`, message);
                } catch (error) {
                    logError('GROUP-ADD', 'Failed to add participant', error);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Failed to add member. Error: ${error.message || error}`,
                        message
                    );
                }
            }
        },
        {
            name: 'kick',
            async execute(context) {
                const { sock, remoteJid, message, senderJid, args } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ This command can only be used inside groups.', message);
                    return;
                }
                let targetJid = null;
                let targetNumber = null;
                const quotedParticipant = message.message?.extendedTextMessage?.contextInfo?.participant;
                if (quotedParticipant) {
                    targetJid = normalizeJid(quotedParticipant);
                    targetNumber = targetJid.split('@')[0];
                }
                const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!targetJid && mentionedJid) {
                    targetJid = normalizeJid(mentionedJid);
                    targetNumber = targetJid.split('@')[0];
                }
                if (!targetJid && args[0]) {
                    const number = args[0].replace(/\D/g, '');
                    if (number.length >= 10) {
                        targetJid = `${number}@s.whatsapp.net`;
                        targetNumber = number;
                    }
                }
                if (!targetJid) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Please reply to a message, mention (@user) or provide a phone number with country code.\n\n*Example*: .kick @user\n*Example*: .kick 2348012345678',
                        message
                    );
                    return;
                }
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    const senderAdmin = isParticipantAdmin(metadata, senderJid);
                    const botAdmin = isParticipantAdmin(metadata, sock.user.id);
                    if (!senderAdmin) {
                        await safeWaReply(sock, remoteJid, '⛔ You must be a Group Admin to kick members.', message);
                        return;
                    }
                    if (!botAdmin) {
                        await safeWaReply(sock, remoteJid, '⚠️ I need Admin permissions in this group to kick members.', message);
                        return;
                    }
                    await sock.groupParticipantsUpdate(remoteJid, [targetJid], 'remove');
                    await safeWaReply(sock, remoteJid, `👢 Successfully kicked @${targetNumber} from the group!`, message);
                } catch (error) {
                    logError('GROUP-KICK', 'Failed to kick participant', error);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Failed to kick member. Error: ${error.message || error}`,
                        message
                    );
                }
            }
        },
        {
            name: 'link',
            async execute(context) {
                const { sock, remoteJid, message, senderJid } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ This command can only be used inside groups.', message);
                    return;
                }
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    const senderAdmin = isParticipantAdmin(metadata, senderJid);
                    const botAdmin = isParticipantAdmin(metadata, sock.user.id);
                    if (!senderAdmin) {
                        await safeWaReply(sock, remoteJid, '⛔ You must be a Group Admin to fetch the group link.', message);
                        return;
                    }
                    if (!botAdmin) {
                        await safeWaReply(sock, remoteJid, '⚠️ I need Admin permissions in this group to fetch the invite link.', message);
                        return;
                    }
                    const code = await sock.groupInviteCode(remoteJid);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `🔗 *Group Invite Link*:\n\nhttps://chat.whatsapp.com/${code}`,
                        message
                    );
                } catch (error) {
                    logError('GROUP-LINK', 'Failed to fetch invite link', error);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Failed to fetch invite link. Error: ${error.message || error}`,
                        message
                    );
                }
            }
        },
        {
            name: 'revoke',
            async execute(context) {
                const { sock, remoteJid, message, senderJid } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
                    return;
                }
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    const senderAdmin = isParticipantAdmin(metadata, senderJid);
                    if (!senderAdmin) {
                        await safeWaReply(sock, remoteJid, '⛔ You must be a Group Admin.', message);
                        return;
                    }
                    await sock.groupRevokeInvite(remoteJid);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ╾━━━ BOND_SEVERED ━━━╼\n\n` +
                            `   🔗 *OLD LINK* → DEAD\n` +
                            `   🔒 *NEW LINK* → GENERATED\n\n` +
                            `   " The old path is closed. "`
                        ),
                        message
                    );
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ ${error?.message || error}`, message);
                }
            }
        },
        {
            name: 'promote',
            async execute(context) {
                await executeRankChange(context, 'promote');
            }
        },
        {
            name: 'demote',
            async execute(context) {
                await executeRankChange(context, 'demote');
            }
        }
    ]);

    async function executeRankChange(context, action) {
        const { sock, remoteJid, message, senderJid, args } = context;
        if (!remoteJid.endsWith('@g.us')) {
            await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
            return;
        }
        const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
            || (args[0] ? `${args[0].replace(/\D/g, '')}@s.whatsapp.net` : null);
        if (!target) {
            await safeWaReply(
                sock,
                remoteJid,
                `❌ Mention or provide a number. Example: .${action} @user`,
                message
            );
            return;
        }
        try {
            const metadata = await sock.groupMetadata(remoteJid);
            const senderAdmin = isParticipantAdmin(metadata, senderJid);
            if (!senderAdmin) {
                await safeWaReply(sock, remoteJid, '⛔ You must be a Group Admin.', message);
                return;
            }
            await sock.groupParticipantsUpdate(remoteJid, [target], action);
            const isPromote = action === 'promote';
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal(
                    `      ◢◤ *RANK_RECALIBRATION* ◢◤\n\n` +
                    `      📊 *OLD* : ${isPromote ? 'MEMBER' : 'ADMINISTRATOR'}\n` +
                    `      ${isPromote ? '📈' : '📉'} *NEW* : ${isPromote ? 'ADMINISTRATOR' : 'MEMBER'}\n\n` +
                    `   " Power is ${isPromote ? 'granted' : 'reclaimed'}. "`
                ),
                message
            );
        } catch (error) {
            await safeWaReply(sock, remoteJid, `❌ ${error?.message || error}`, message);
        }
    }
}
