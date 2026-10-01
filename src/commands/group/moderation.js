/**
 * Group voice controls: per-member muting and whole-group announcement mode.
 * Permission checks deliberately preserve each legacy command's behavior.
 */
export function createGroupModerationCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        resolveTargetJid,
        normalizeJid,
        isParticipantAdmin,
        isDevNumber,
        mutedUsers,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        resolveTargetJid,
        normalizeJid,
        isParticipantAdmin,
        isDevNumber,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Group moderation commands require ${name}()`);
        }
    }
    if (!mutedUsers || typeof mutedUsers.get !== 'function' || typeof mutedUsers.set !== 'function') {
        throw new Error('Group moderation commands require mutedUsers');
    }

    function muteKey(phoneNumber, remoteJid) {
        return `${phoneNumber}:${remoteJid}`;
    }

    return Object.freeze([
        {
            name: 'mute',
            async execute(context) {
                await updateMemberMute(context, true);
            }
        },
        {
            name: 'unmute',
            async execute(context) {
                await updateMemberMute(context, false);
            }
        },
        {
            name: 'lock',
            aliases: ['lockgc'],
            async execute(context) {
                await updateGroupLock(context, true);
            }
        },
        {
            name: 'unlock',
            aliases: ['unlockgc'],
            async execute(context) {
                await updateGroupLock(context, false);
            }
        },
        {
            name: 'listmuted',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
                    return;
                }
                const users = mutedUsers.get(muteKey(phoneNumber, remoteJid)) || new Set();
                const list = users.size
                    ? [...users].map(jid => `   • +${jid.split('@')[0]}`).join('\n')
                    : '   • _none muted_';
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *SILENCE_REGISTRY* █▓▒░\n\n` +
                        `   ✦ *MUTED* :: ${users.size}\n\n` +
                        `${list}\n\n` +
                        `   " The silenced remember. "`
                    ),
                    message
                );
            }
        }
    ]);

    async function updateMemberMute(context, muting) {
        const { sock, remoteJid, message, phoneNumber, senderJid, args } = context;
        if (!remoteJid.endsWith('@g.us')) {
            await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
            return;
        }
        const target = resolveTargetJid(message, args);
        if (!target) {
            await safeWaReply(
                sock,
                remoteJid,
                `❌ Reply to a message, @mention, or provide a number.\nExample: .${muting ? 'mute' : 'unmute'} @user`,
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
            const key = muteKey(phoneNumber, remoteJid);
            const users = mutedUsers.get(key) || new Set();
            if (muting) users.add(normalizeJid(target));
            else users.delete(normalizeJid(target));
            mutedUsers.set(key, users);
            const number = target.split('@')[0];
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal(
                    muting
                        ? `   ░▒▓█ *VOCAL_SEAL* █▓▒░\n\n` +
                          `   ✦ *TARGET* :: +${number}\n` +
                          `   ✦ *STATE* :: MUTED\n\n` +
                          `   " Their voice is\n     bound in silence. "`
                        : `   ░▒▓█ *VOCAL_RELEASE* █▓▒░\n\n` +
                          `   ✦ *TARGET* :: +${number}\n` +
                          `   ✦ *STATE* :: UNMUTED\n\n` +
                          `   " Their voice is\n     returned. "`
                ),
                message
            );
        } catch (error) {
            await safeWaReply(sock, remoteJid, `❌ ${error?.message || error}`, message);
        }
    }

    async function updateGroupLock(context, locking) {
        const { sock, remoteJid, message, phoneNumber, senderJid } = context;
        if (!remoteJid.endsWith('@g.us')) {
            await safeWaReply(sock, remoteJid, '❌ Groups only.', message);
            return;
        }
        try {
            const metadata = await sock.groupMetadata(remoteJid);
            const senderAdmin = isParticipantAdmin(metadata, senderJid)
                || context.isSenderOwner
                || isDevNumber(senderJid);
            if (!senderAdmin) {
                await safeWaReply(sock, remoteJid, '⛔ You must be a Group Admin.', message);
                return;
            }
            await sock.groupSettingUpdate(remoteJid, locking ? 'announcement' : 'not_announcement');
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal(
                    locking
                        ? `   ░▒▓█ *GROUP LOCKED* █▓▒░\n\n` +
                          `   ✦ *STATE* :: ADMINS_ONLY\n` +
                          `   ✦ *ACTION* :: VOICE_SEAL\n\n` +
                          `   Only admins can send\n` +
                          `   messages now.\n\n` +
                          `   " the gates close.\n     only the chosen speak. "`
                        : `   ░▒▓█ *GROUP UNLOCKED* █▓▒░\n\n` +
                          `   ✦ *STATE* :: OPEN_FLOOR\n` +
                          `   ✦ *ACTION* :: VOICE_RELEASE\n\n` +
                          `   Everyone can send\n` +
                          `   messages again.\n\n` +
                          `   " the gates open.\n     the void listens to all. "`
                ),
                message
            );
            log(
                'GROUP',
                `${phoneNumber}: group ${locking ? 'LOCKED' : 'UNLOCKED'} by ${senderJid} in ${remoteJid}`
            );
        } catch (error) {
            logError('GROUP', `${phoneNumber}: group lock toggle failed`, error);
            await safeWaReply(sock, remoteJid, `❌ Failed: ${error?.message || error}`, message);
        }
    }
}
