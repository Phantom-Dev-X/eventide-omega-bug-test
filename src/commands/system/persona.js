/**
 * Menu rendering and persona-selection commands for both bot and help voices.
 */
export function createPersonaCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        loadBotConfig,
        saveBotConfig,
        sendRuinMenu,
        sendEclipseMenu,
        sendMenuPoll,
        personaPollKeys,
        helpPersonaPollKeys,
        personaPollQuestion,
        personaPollOptions,
        personaPollIds,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        loadBotConfig,
        saveBotConfig,
        sendRuinMenu,
        sendEclipseMenu,
        sendMenuPoll,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Persona commands require ${name}()`);
        }
    }
    for (const [name, value] of Object.entries({ personaPollKeys, helpPersonaPollKeys })) {
        if (!value || typeof value.get !== 'function' || typeof value.set !== 'function' || typeof value.delete !== 'function') {
            throw new Error(`Persona commands require ${name}`);
        }
    }
    if (typeof personaPollQuestion !== 'string'
        || !Array.isArray(personaPollOptions)
        || !Array.isArray(personaPollIds)) {
        throw new Error('Persona commands require persona poll content');
    }

    function isAuthorized(context) {
        return context.isSenderOwner || isDevNumber(context.senderJid);
    }

    return Object.freeze([
        {
            name: 'menu',
            async execute(context) {
                const { sock, remoteJid, phoneNumber } = context;
                const persona = String(loadBotConfig(phoneNumber).persona || 'eclipse').toLowerCase();
                if (persona === 'ruin') {
                    try {
                        await sendRuinMenu(sock, remoteJid, phoneNumber);
                    } catch (error) {
                        logError('WA-CMD', `${phoneNumber}: Failed sending Ruin menu`, error);
                    }
                    return;
                }
                await sendEclipseMenu(sock, remoteJid, phoneNumber);
            }
        },
        {
            name: 'persona',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, args } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner only.', message);
                    return;
                }
                const value = (args[0] || '').toLowerCase();
                const currentRaw = String(loadBotConfig(phoneNumber).persona || '').trim().toLowerCase();
                const current = ['eclipse', 'ruin'].includes(currentRaw) ? currentRaw : 'UNBOUND';
                if (value === 'poll' || value === 'choose' || value === 'reset') {
                    const config = loadBotConfig(phoneNumber);
                    if (value === 'reset') {
                        config.persona = '';
                        saveBotConfig(phoneNumber, config);
                    }
                    const oldKey = personaPollKeys.get(phoneNumber);
                    personaPollKeys.delete(phoneNumber);
                    if (oldKey?.id) {
                        try {
                            await sock.sendMessage(oldKey.remoteJid || remoteJid, {
                                delete: {
                                    remoteJid: oldKey.remoteJid || remoteJid,
                                    id: oldKey.id,
                                    fromMe: true
                                }
                            });
                        } catch {
                            // Stale poll deletion is best effort.
                        }
                    }
                    await safeWaReply(
                        sock,
                        remoteJid,
                        value === 'reset'
                            ? '🎭 *PERSONA RESET*\n\nYour old binding was cleared.\nChoose a fresh persona below 👇'
                            : `🎭 *PERSONA CHOOSER*\n\nCurrent: *${current.toUpperCase()}*\nChoose below 👇`,
                        message
                    );
                    const pollMessage = await sendMenuPoll(
                        sock,
                        remoteJid,
                        phoneNumber,
                        personaPollQuestion,
                        personaPollOptions,
                        personaPollIds
                    );
                    if (pollMessage?.key) personaPollKeys.set(phoneNumber, pollMessage.key);
                    log(
                        'PERSONA',
                        `${phoneNumber}: persona chooser resent by .persona ${value} (${pollMessage?.key?.id || '?'})`
                    );
                    return;
                }
                if (value !== 'eclipse' && value !== 'ruin') {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *PERSONA* █▓▒░\n\n` +
                            `   ✦ *ACTIVE* :: ${current.toUpperCase()}\n\n` +
                            `   use: .persona poll\n` +
                            `        .persona reset\n` +
                            `        .persona eclipse\n` +
                            `        .persona ruin\n\n` +
                            `   \" eclipse — cinematic.\n     ruin    — clean. \"`
                        ),
                        message
                    );
                    return;
                }
                const config = loadBotConfig(phoneNumber);
                config.persona = value;
                saveBotConfig(phoneNumber, config);
                personaPollKeys.delete(phoneNumber);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *PERSONA* █▓▒░\n\n` +
                        `   ✦ *BOUND* :: ${value.toUpperCase()}\n` +
                        `   ✦ *ACTION* :: IDENTITY_SWAP\n\n` +
                        `   Type .menu to see your\n` +
                        `   new face.`
                    ),
                    message
                );
            }
        },
        {
            name: 'helpconfig',
            aliases: ['helpvoice', 'helpset'],
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, args } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner only.', message);
                    return;
                }
                const value = (args[0] || '').toLowerCase();
                const currentRaw = String(loadBotConfig(phoneNumber).helpPersona || '').trim().toLowerCase();
                const current = ['eclipse', 'ruin'].includes(currentRaw) ? currentRaw : 'UNBOUND';
                if (value !== 'eclipse' && value !== 'ruin') {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `🛎 *HELP PERSONA* 👑\n\n` +
                        `✦ *ACTIVE* :: ${current.toUpperCase()}\n\n` +
                        `use: .helpconfig eclipse\n` +
                        `     .helpconfig ruin\n\n` +
                        `   " eclipse — cinematic oracle.\n     ruin    — friendly support. "`,
                        message
                    );
                    return;
                }
                const config = loadBotConfig(phoneNumber);
                config.helpPersona = value;
                saveBotConfig(phoneNumber, config);
                helpPersonaPollKeys.delete(phoneNumber);
                await safeWaReply(
                    sock,
                    remoteJid,
                    `🛎 *HELP PERSONA BOUND* :: ${value.toUpperCase()}\n\n` +
                    `Type .help <question> to hear\n` +
                    `the new voice.`,
                    message
                );
            }
        }
    ]);
}
