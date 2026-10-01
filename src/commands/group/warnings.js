/**
 * Group warning ledger and configuration entry points. Persistence and menu
 * boundaries are injected so warning mutations can be tested independently.
 */
export function createGroupWarningCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        isUserGroupAdmin,
        resolveTargetJid,
        normalizeJid,
        ensureWarnGroup,
        applyWarn,
        getUserWarns,
        setUserWarns,
        listGroupWarns,
        getWarnState,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        sendMenuPoll
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        isUserGroupAdmin,
        resolveTargetJid,
        normalizeJid,
        ensureWarnGroup,
        applyWarn,
        getUserWarns,
        setUserWarns,
        listGroupWarns,
        getWarnState,
        sendMenuPoll
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Group warning commands require ${name}()`);
        }
    }
    for (const [name, value] of Object.entries({
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions
    })) {
        if (!value || typeof value.get !== 'function' || typeof value.set !== 'function' || typeof value.delete !== 'function') {
            throw new Error(`Group warning commands require ${name}`);
        }
    }

    async function isAuthorizedAdmin(context) {
        return context.isSenderOwner
            || isDevNumber(context.senderJid)
            || await isUserGroupAdmin(context.sock, context.remoteJid, context.senderJid);
    }

    return Object.freeze([
        {
            name: 'warn',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, senderJid, args } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
                    return;
                }
                if (!await isAuthorizedAdmin(context)) {
                    await safeWaReply(sock, remoteJid, '⛔ Group Admin only.', message);
                    return;
                }
                const target = resolveTargetJid(message, args);
                if (!target) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Reply to their message, @mention them, or pass a number.\nExample: .warn spamming',
                        message
                    );
                    return;
                }
                if (await isUserGroupAdmin(sock, remoteJid, target) || isDevNumber(target)) {
                    await safeWaReply(sock, remoteJid, '❌ You cannot warn an admin.', message);
                    return;
                }
                const reason = args
                    .filter(argument => !argument.startsWith('@')
                        && !/^\d{7,}$/.test(argument.replace(/\D/g, '') === argument ? argument : ''))
                    .join(' ')
                    .trim()
                    || args.join(' ').replace(/@\S+/g, '').replace(/\d{7,}/g, '').trim()
                    || 'manual';
                ensureWarnGroup(phoneNumber, remoteJid);
                await applyWarn(sock, phoneNumber, {
                    groupJid: remoteJid,
                    targetJid: target,
                    byJid: senderJid,
                    reason,
                    auto: false,
                    originalMsg: null
                });
            }
        },
        {
            name: 'unwarn',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, args } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
                    return;
                }
                if (!await isAuthorizedAdmin(context)) {
                    await safeWaReply(sock, remoteJid, '⛔ Group Admin only.', message);
                    return;
                }
                const target = resolveTargetJid(message, args);
                if (!target) {
                    await safeWaReply(sock, remoteJid, '❌ Reply / @mention / number. Example: .unwarn @user', message);
                    return;
                }
                const normalizedTarget = normalizeJid(target);
                const record = getUserWarns(phoneNumber, remoteJid, normalizedTarget);
                record.count = Math.max(0, (record.count || 0) - 1);
                if (record.history?.length) record.history.pop();
                setUserWarns(phoneNumber, remoteJid, normalizedTarget, record);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *WARN_LIFTED* █▓▒░\n\n` +
                        `   ✦ *TARGET* :: +${target.split('@')[0]}\n` +
                        `   ✦ *STRIKES* :: ${record.count}\n\n` +
                        `   " One mark fades. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'warns',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, args } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
                    return;
                }
                const target = resolveTargetJid(message, args);
                if (target) {
                    const record = getUserWarns(phoneNumber, remoteJid, normalizeJid(target));
                    const history = (record.history || [])
                        .slice(-5)
                        .map(entry => `   • ${entry.reason} (${entry.auto ? 'auto' : 'manual'})`)
                        .join('\n') || '   • _clean record_';
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *WARN_DOSSIER* █▓▒░\n\n` +
                            `   ✦ *TARGET* :: +${target.split('@')[0]}\n` +
                            `   ✦ *STRIKES* :: ${record.count || 0}\n\n${history}`
                        ),
                        message
                    );
                    return;
                }
                const rows = listGroupWarns(phoneNumber, remoteJid);
                const list = rows.length
                    ? rows.slice(0, 15).map(([jid, record], index) =>
                        `   [${index + 1}] +${jid.split('@')[0]}  —  ${record.count}`).join('\n')
                    : '   • _no marks in this group_';
                const groupConfig = getWarnState(phoneNumber).groups[remoteJid];
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *WARN_LEDGER* █▓▒░\n\n` +
                        `   ✦ *POLICY* :: ${groupConfig ? (groupConfig.enabled ? 'ARMED' : 'IDLE') : 'DEFAULT'}\n` +
                        `   ✦ *MAX* :: ${groupConfig?.maxWarns === 0 ? '∞' : (groupConfig?.maxWarns || 3)}\n` +
                        `   ✦ *ACTION* :: ${(groupConfig?.action || 'kick').toUpperCase()}\n\n${list}`
                    ),
                    message
                );
            }
        },
        {
            name: 'warnreset',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, args } = context;
                if (!remoteJid.endsWith('@g.us')) {
                    await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
                    return;
                }
                if (!await isAuthorizedAdmin(context)) {
                    await safeWaReply(sock, remoteJid, '⛔ Group Admin only.', message);
                    return;
                }
                const target = resolveTargetJid(message, args);
                if (!target) {
                    await safeWaReply(sock, remoteJid, '❌ Reply / @mention / number to wipe their strikes.', message);
                    return;
                }
                setUserWarns(phoneNumber, remoteJid, normalizeJid(target), { count: 0, history: [] });
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *RECORD_WIPED* █▓▒░\n\n` +
                        `   ✦ *TARGET* :: +${target.split('@')[0]}\n` +
                        `   ✦ *STRIKES* :: 0\n\n` +
                        `   " The slate is clean. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'warnconfig',
            aliases: ['warncfg'],
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, senderJid } = context;
                if (!context.isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                const warningState = getWarnState(phoneNumber);
                const count = Object.keys(warningState.groups || {}).length;
                autoreactSessions.delete(phoneNumber);
                antiConfigSessions.delete(phoneNumber);
                warnConfigSessions.set(phoneNumber, { step: 'root' });
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *WARN_CONFIG_MATRIX* █▓▒░\n\n` +
                        `   ✦ *GROUPS* :: ${count}\n` +
                        `   ✦ *DEFAULT* :: 3 strikes → kick\n\n` +
                        `   Add a group, shape its law,\n` +
                        `   or remove it from the ward.`
                    ),
                    message
                );
                await sendMenuPoll(
                    sock,
                    remoteJid,
                    phoneNumber,
                    '✦ WARN MATRIX ✦',
                    ['➕ Add Group', '⚙️ Configure Group', '🗑️ Remove Group'],
                    ['wn_add', 'wn_cfg', 'wn_remove']
                );
            }
        }
    ]);
}
