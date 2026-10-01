/**
 * Group protection toggles and antidelete configuration entry point. Group
 * target resolution and persistence are injected to keep network behavior
 * testable without changing the legacy authorization flow.
 */
export function createGroupProtectionCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        resolveAndJoinTarget,
        isParticipantAdmin,
        isDevNumber,
        saveBotConfig,
        getAntideleteState,
        saveAntideleteState,
        autoreactSessions,
        antiConfigSessions,
        sendMenuPoll
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        resolveAndJoinTarget,
        isParticipantAdmin,
        isDevNumber,
        saveBotConfig,
        getAntideleteState,
        saveAntideleteState,
        sendMenuPoll
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Group protection commands require ${name}()`);
        }
    }
    for (const [name, value] of Object.entries({ autoreactSessions, antiConfigSessions })) {
        if (!value || typeof value.set !== 'function' || typeof value.delete !== 'function') {
            throw new Error(`Group protection commands require ${name}`);
        }
    }

    return Object.freeze([
        {
            name: 'antilink',
            async execute(context) {
                await executeAntiToggle(context, 'antilink');
            }
        },
        {
            name: 'antimention',
            async execute(context) {
                await executeAntiToggle(context, 'antimention');
            }
        },
        {
            name: 'antiforward',
            async execute(context) {
                await executeAntiToggle(context, 'antiforward');
            }
        },
        {
            name: 'antidelete',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, senderJid, args } = context;
                if (!context.isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                const state = getAntideleteState(phoneNumber);
                const value = args[0]?.toLowerCase();
                if (value !== 'on' && value !== 'off') {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *ANTIDELETE* █▓▒░\n\n` +
                            `   ✦ *STATE* :: ${state.enabled ? 'ON' : 'OFF'}\n` +
                            `   ✦ *GROUPS* :: ${(state.endpoints?.groups || []).length}\n` +
                            `   ✦ *CHANNELS* :: ${(state.endpoints?.channels || []).length}\n` +
                            `   ✦ *CONTACTS* :: ${(state.endpoints?.contacts || []).length}\n\n` +
                            `   use: .antidelete on | .antidelete off\n\n` +
                            `   " Configure who is watched\n     via .antideleteconfig "`
                        ),
                        message
                    );
                    return;
                }
                state.enabled = value === 'on';
                saveAntideleteState(phoneNumber, state);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *DELETE_WARD* █▓▒░\n\n` +
                        `   ✦ *STATE* :: ${value === 'on' ? 'ON' : 'OFF'}\n` +
                        `   ✦ *ACTION* :: ${value === 'on' ? 'WATCH_ENABLED' : 'WATCH_DISABLED'}\n\n` +
                        `   " Deleted messages will be\n     forwarded to the owner DM. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'antideleteconfig',
            aliases: ['antideletecfg'],
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, senderJid } = context;
                if (!context.isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                const state = getAntideleteState(phoneNumber);
                autoreactSessions.delete(phoneNumber);
                antiConfigSessions.set(phoneNumber, { step: 'add_or_delete' });
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *ANTIDELETE_CONFIG_MATRIX* █▓▒░\n\n` +
                        `   ✦ *STATE* :: ${state.enabled ? 'ON' : 'OFF'}\n` +
                        `   ✦ *GROUPS* :: ${(state.endpoints?.groups || []).length}\n` +
                        `   ✦ *CHANNELS* :: ${(state.endpoints?.channels || []).length}\n` +
                        `   ✦ *CONTACTS* :: ${(state.endpoints?.contacts || []).length}\n\n` +
                        `   Choose what to do below.`
                    ),
                    message
                );
                await sendMenuPoll(
                    sock,
                    remoteJid,
                    phoneNumber,
                    '✦ ANTIDELETE MATRIX ✦',
                    ['➕ Add Endpoint', '🗑️ Delete Endpoint'],
                    ['ad_add', 'ad_delete']
                );
            }
        }
    ]);

    async function executeAntiToggle(context, protection) {
        const { sock, remoteJid, message, phoneNumber, senderJid, args, botConfig } = context;
        const value = args[0]?.toLowerCase();
        if (value !== 'on' && value !== 'off') {
            await safeWaReply(
                sock,
                remoteJid,
                `❌ use: .${protection} on | .${protection} off\n   or .${protection} on <group invite/id>`,
                message
            );
            return;
        }
        let target = remoteJid;
        let targetName = remoteJid;
        const extra = String(args.slice(1).join(' ') || '').trim();
        if (extra) {
            const resolved = await resolveAndJoinTarget(sock, extra);
            if (!resolved.ok) {
                await safeWaReply(sock, remoteJid, `❌ ${resolved.error}`, message);
                return;
            }
            if (resolved.kind !== 'group') {
                await safeWaReply(
                    sock,
                    remoteJid,
                    '❌ That ward only applies to groups. Send a group invite.',
                    message
                );
                return;
            }
            target = resolved.jid;
            targetName = resolved.name || resolved.jid;
        } else if (!remoteJid.endsWith('@g.us')) {
            await safeWaReply(
                sock,
                remoteJid,
                `❌ Use this inside a group, or: .${protection} on <invite link>`,
                message
            );
            return;
        }
        if (target.endsWith('@g.us')) {
            try {
                const metadata = await sock.groupMetadata(target);
                targetName = metadata.subject || targetName;
                const senderAdmin = isParticipantAdmin(metadata, senderJid);
                if (!senderAdmin && !context.isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(sock, remoteJid, '⛔ You must be a Group Admin.', message);
                    return;
                }
            } catch {
                // Preserve legacy best-effort metadata lookup.
            }
        }
        botConfig.anti = botConfig.anti || {};
        botConfig.anti[protection] = botConfig.anti[protection] || {};
        botConfig.anti[protection][target] = value;
        saveBotConfig(phoneNumber, botConfig);
        const label = protection === 'antilink'
            ? 'LINK_WARD'
            : protection === 'antimention'
                ? 'MENTION_WARD'
                : protection === 'antiforward'
                    ? 'FORWARD_WARD'
                    : 'DELETE_WARD';
        await safeWaReply(
            sock,
            remoteJid,
            buildOmegaTerminal(
                `   ░▒▓█ *${label}* █▓▒░\n\n` +
                `   ✦ *STATE* :: ${value === 'on' ? 'ACTIVE' : 'OFF'}\n` +
                `   ✦ *GROUP* :: ${targetName}\n\n` +
                `   " The ward ${value === 'on' ? 'rises' : 'falls'}. "`
            ),
            message
        );
    }
}
