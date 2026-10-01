/**
 * Group information and broadcast utilities. These commands intentionally
 * preserve their existing visibility and authorization rules.
 */
export function createGroupInformationCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        normalizeJid,
        groupChannelLink,
        isDevNumber,
        isUserGroupAdmin
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        normalizeJid,
        isDevNumber,
        isUserGroupAdmin
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Group information commands require ${name}()`);
        }
    }
    if (typeof groupChannelLink !== 'string') {
        throw new Error('Group information commands require groupChannelLink');
    }

    function isGroup(remoteJid) {
        return remoteJid.endsWith('@g.us');
    }

    async function requireGroup(context) {
        if (isGroup(context.remoteJid)) return true;
        await safeWaReply(
            context.sock,
            context.remoteJid,
            '❌ Only works inside a group.',
            context.message
        );
        return false;
    }

    return Object.freeze([
        {
            name: 'groupinfo',
            async execute(context) {
                const { sock, remoteJid, message } = context;
                if (!await requireGroup(context)) return;
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    const adminCount = metadata.participants.filter(participant =>
                        participant.admin
                        || (metadata.owner
                            && normalizeJid(participant.id) === normalizeJid(metadata.owner))
                    ).length;
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *DOMINION_INFO* █▓▒░\n\n` +
                            `   ✦ *NAME* :: ${metadata.subject}\n` +
                            `   ✦ *MEMBERS* :: ${metadata.participants.length}\n` +
                            `   ✦ *ADMINS* :: ${adminCount}\n` +
                            `   ✦ *CREATED* :: ${metadata.creation ? new Date(metadata.creation * 1000).toLocaleDateString() : 'unknown'}\n\n` +
                            `   " Every domain has\n     its own truth. "`
                        ),
                        message
                    );
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ ${error?.message || error}`, message);
                }
            }
        },
        {
            name: 'tagall',
            async execute(context) {
                const { sock, remoteJid, message, args } = context;
                if (!await requireGroup(context)) return;
                const tagText = args.join(' ').trim() || 'Attention all';
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    const participantJids = metadata.participants.map(participant => participant.id);
                    const visibleMentions = participantJids.map(jid => `@${jid.split('@')[0]}`);
                    await sock.sendMessage(remoteJid, {
                        text: `${groupChannelLink}\n\n*${tagText}*\n\n${visibleMentions.join(' ')}`,
                        mentions: participantJids
                    });
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ ${error?.message || error}`, message);
                }
            }
        },
        {
            name: 'hidetag',
            aliases: ['ht'],
            async execute(context) {
                const { sock, remoteJid, message, senderJid, args } = context;
                if (!await requireGroup(context)) return;
                try {
                    const senderAdmin = context.isSenderOwner
                        || isDevNumber(senderJid)
                        || await isUserGroupAdmin(sock, remoteJid, senderJid);
                    if (!senderAdmin) {
                        await safeWaReply(sock, remoteJid, '⛔ Group Admin only.', message);
                        return;
                    }
                    const metadata = await sock.groupMetadata(remoteJid);
                    const participantJids = metadata.participants.map(participant => participant.id);
                    await sock.sendMessage(remoteJid, {
                        text: args.join(' ').trim() || '‎',
                        mentions: participantJids
                    });
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ ${error?.message || error}`, message);
                }
            }
        },
        {
            name: 'getvcf',
            async execute(context) {
                const { sock, remoteJid, message } = context;
                if (!await requireGroup(context)) return;
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    const members = metadata.participants.map(participant => participant.id);
                    let vcard = '';
                    let index = 1;
                    for (const jid of members) {
                        const number = jid.split('@')[0];
                        vcard += `BEGIN:VCARD\nVERSION:3.0\nFN:${number}\nN:${number};;;\nTEL;TYPE=CELL:+${number}\nEND:VCARD\n`;
                        index++;
                        if (index > 200) break;
                    }
                    await sock.sendMessage(remoteJid, {
                        document: Buffer.from(vcard, 'utf8'),
                        mimetype: 'text/x-vcard',
                        fileName: `members_${members.length}.vcf`
                    });
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ ${error?.message || error}`, message);
                }
            }
        }
    ]);
}
