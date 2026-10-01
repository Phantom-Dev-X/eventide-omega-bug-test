/**
 * Interactive configuration entry points shared by greeting, autoreact, and
 * cancellation flows. Session Maps and persistence are injected for tests.
 */
export function createConfigurationCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        saveBotConfig,
        welcomeGoodbyeSessions,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        sendMenuPoll
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        saveBotConfig,
        sendMenuPoll
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Configuration commands require ${name}()`);
        }
    }
    for (const [name, value] of Object.entries({
        welcomeGoodbyeSessions,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions
    })) {
        if (!value
            || typeof value.has !== 'function'
            || typeof value.set !== 'function'
            || typeof value.delete !== 'function') {
            throw new Error(`Configuration commands require ${name}`);
        }
    }

    const greetingCommands = ['welcome', 'goodbye', 'greet'].map(name => ({
        name,
        async execute(context) {
            await executeGreeting(context, name);
        }
    }));

    return Object.freeze([
        ...greetingCommands,
        {
            name: 'autoreact',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, args, botConfig } = context;
                if (!context.isSenderOwner) {
                    await safeWaReply(sock, remoteJid, '❌ Owner only.', message);
                    return;
                }
                const value = args[0]?.toLowerCase();
                if (value !== 'on' && value !== 'off') {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *AUTOREACT* █▓▒░\n\n` +
                            `   ✦ *STATE* :: ${botConfig.autoreact?.enabled ? 'ON' : 'OFF'}\n\n` +
                            `   use: .autoreact on | .autoreact off\n\n` +
                            `   " Configure who gets\n     reacted via .autoreactconfig "`
                        ),
                        message
                    );
                    return;
                }
                botConfig.autoreact = botConfig.autoreact || {
                    enabled: false,
                    endpoints: { groups: [], channels: [], contacts: [] }
                };
                botConfig.autoreact.enabled = value === 'on';
                saveBotConfig(phoneNumber, botConfig);
                const warning = value === 'on'
                    ? `\n\n   ⚠️ *WARNING* : Auto-reacting to\n   every message can look bot-like\n   and may risk your account being\n   flagged/banned. Toggle off anytime\n   with .autoreact off.`
                    : '';
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *AUTOREACT* █▓▒░\n\n` +
                        `   ✦ *STATE* :: ${value === 'on' ? 'ON' : 'OFF'}\n` +
                        `   ✦ *ACTION* :: ${value === 'on' ? 'REACT_ENABLED' : 'REACT_DISABLED'}${warning}\n\n` +
                        `   " The void ${value === 'on' ? 'responds' : 'falls silent'}. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'autoreactconfig',
            aliases: ['autoreact config'],
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, botConfig } = context;
                if (!context.isSenderOwner) {
                    await safeWaReply(sock, remoteJid, '❌ Owner only.', message);
                    return;
                }
                const config = botConfig.autoreact || {
                    enabled: false,
                    endpoints: { groups: [], channels: [], contacts: [] }
                };
                antiConfigSessions.delete(phoneNumber);
                autoreactSessions.set(phoneNumber, { step: 'add_or_delete' });
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *AUTOREACT_CONFIG_MATRIX* █▓▒░\n\n` +
                        `   ✦ *STATE* :: ${config.enabled ? 'ON' : 'OFF'}\n` +
                        `   ✦ *GROUPS* :: ${(config.endpoints?.groups || []).length}\n` +
                        `   ✦ *CHANNELS* :: ${(config.endpoints?.channels || []).length}\n` +
                        `   ✦ *CONTACTS* :: ${(config.endpoints?.contacts || []).length}\n\n` +
                        `   Choose what to do below.`
                    ),
                    message
                );
                await sendMenuPoll(
                    sock,
                    remoteJid,
                    phoneNumber,
                    '✦ AUTOREACT MATRIX ✦',
                    ['➕ Add Endpoint', '🗑️ Delete Endpoint'],
                    ['ar_add', 'ar_delete']
                );
            }
        },
        {
            name: 'cancel',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber } = context;
                const hadSession = antiConfigSessions.has(phoneNumber)
                    || autoreactSessions.has(phoneNumber)
                    || welcomeGoodbyeSessions.has(phoneNumber)
                    || warnConfigSessions.has(phoneNumber);
                antiConfigSessions.delete(phoneNumber);
                autoreactSessions.delete(phoneNumber);
                welcomeGoodbyeSessions.delete(phoneNumber);
                warnConfigSessions.delete(phoneNumber);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        hadSession
                            ? `   ✦ *CANCELLED* :: no changes made.`
                            : `   ✦ *IDLE* :: nothing to cancel.`
                    ),
                    message
                );
            }
        }
    ]);

    async function executeGreeting(context, commandName) {
        const { sock, remoteJid, message, phoneNumber, senderJid } = context;
        if (!context.isSenderOwner && !isDevNumber(senderJid)) {
            await safeWaReply(sock, remoteJid, '❌ Owner only.', message);
            return;
        }
        if (!remoteJid.endsWith('@g.us')) {
            await safeWaReply(sock, remoteJid, '❌ Only works inside a group.', message);
            return;
        }
        const greetingType = commandName === 'welcome'
            ? 'welcome'
            : commandName === 'goodbye'
                ? 'goodbye'
                : null;
        if (greetingType) {
            welcomeGoodbyeSessions.set(phoneNumber, {
                step: 'action',
                type: greetingType,
                group: remoteJid
            });
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal(
                    `   ░▒▓█ *THRESHOLD_MATRIX* █▓▒░\n\n` +
                    `   Configure the ${greetingType}\n` +
                    `   message for this group.`
                )
            );
            await sendMenuPoll(
                sock,
                remoteJid,
                phoneNumber,
                greetingType === 'welcome' ? '✦ WELCOME MATRIX ✦' : '✦ GOODBYE MATRIX ✦',
                ['📝 Custom Message', '🎯 Default Message', '🚫 Disable'],
                greetingType === 'welcome'
                    ? ['wg_wel_custom', 'wg_wel_default', 'wg_wel_off']
                    : ['wg_gb_custom', 'wg_gb_default', 'wg_gb_off']
            );
            return;
        }
        welcomeGoodbyeSessions.set(phoneNumber, { step: 'action', group: remoteJid });
        await safeWaReply(
            sock,
            remoteJid,
            buildOmegaTerminal(
                `   ░▒▓█ *THRESHOLD_MATRIX* █▓▒░\n\n` +
                `   Which greeting do you want\n` +
                `   to configure?`
            )
        );
        await sendMenuPoll(
            sock,
            remoteJid,
            phoneNumber,
            '✦ GREETING MATRIX ✦',
            ['👋 Set Welcome', '👋 Set Goodbye'],
            ['greet_welcome', 'greet_goodbye']
        );
    }
}
