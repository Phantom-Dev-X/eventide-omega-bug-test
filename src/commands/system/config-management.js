/**
 * Profile-picture, settings inspection, and factory-reset commands.
 */
export function createConfigManagementCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        downloadMediaMessage,
        createSilentLogger,
        getAntideleteState,
        loadBotMode,
        splitApiKeys,
        defaultBotConfig,
        saveBotConfig,
        logError,
        cloneConfig = value => structuredClone(value)
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        downloadMediaMessage,
        createSilentLogger,
        getAntideleteState,
        loadBotMode,
        splitApiKeys,
        saveBotConfig,
        logError,
        cloneConfig
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Config management commands require ${name}()`);
        }
    }
    if (!defaultBotConfig || typeof defaultBotConfig !== 'object') {
        throw new Error('Config management commands require defaultBotConfig');
    }

    function isAuthorized(context) {
        return context.isSenderOwner || isDevNumber(context.senderJid);
    }

    return Object.freeze([
        {
            name: 'setpp',
            async execute(context) {
                const { sock, remoteJid, message } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const image = quoted?.imageMessage || quoted?.stickerMessage;
                if (!image) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Reply to an image with .setpp to change the profile picture.',
                        message
                    );
                    return;
                }
                try {
                    const media = await downloadMediaMessage(
                        { message: { imageMessage: image } },
                        'buffer',
                        {},
                        { logger: createSilentLogger() }
                    );
                    await sock.updateProfilePicture(sock.user?.id, media);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *AVATAR_SWAPPED* █▓▒░\n\n` +
                            `   ✦ *ACTION* :: PROFILE_PIC_SET\n` +
                            `   ✦ *STATUS* :: ACCOUNT_UPDATED\n\n` +
                            `   " The face of the vessel\n     is rewritten. "`
                        ),
                        message
                    );
                } catch (error) {
                    logError('CONFIG', 'setpp failed', error);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Could not set profile pic. Error: ${error?.message}`,
                        message
                    );
                }
            }
        },
        {
            name: 'settings',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, botConfig, prefix } = context;
                const aliases = Object.keys(botConfig.aliases || {});
                const antidelete = getAntideleteState(phoneNumber);
                const autoreact = botConfig.autoreact || {};
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CONFIG_MATRIX* █▓▒░\n\n` +
                        `   ✦ *PREFIX* :: ${prefix}\n` +
                        `   ✦ *MODE* :: ${loadBotMode(phoneNumber) === 'owner' ? 'OWNER_ONLY' : 'PUBLIC'}\n` +
                        `   ✦ *ALIASES* :: ${aliases.length}\n` +
                        `   ✦ *AUTOREACT* :: ${autoreact.enabled ? 'ON' : 'OFF'}\n` +
                        `   ✦ *ANTIDELETE* :: ${antidelete.enabled ? 'ON' : 'OFF'}\n` +
                        `   ✦ *AD_ENDS* :: G${(antidelete.endpoints?.groups || []).length}/C${(antidelete.endpoints?.channels || []).length}/P${(antidelete.endpoints?.contacts || []).length}\n` +
                        `   ✦ *NAME* :: ${botConfig.name || '(account default)'}\n` +
                        `   ✦ *BIO* :: ${botConfig.bio || '(account default)'}\n` +
                        `   ✦ *PLUGIN KEYS* :: ${splitApiKeys(botConfig.geminiApiKey).length}\n` +
                        `   " You are the architect\n     of these settings. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'reset',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                const resetConfig = cloneConfig(defaultBotConfig);
                resetConfig.bootDmSent = true;
                saveBotConfig(phoneNumber, resetConfig);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CONFIG_WIPED* █▓▒░\n\n` +
                        `   ✦ *PREFIX* :: .\n` +
                        `   ✦ *ALIASES* :: 0\n` +
                        `   ✦ *STATUS* :: FACTORY_RESET\n\n` +
                        `   " The machine forgets\n     your shaping. It is\n     pristine once more. "`
                    ),
                    message
                );
            }
        }
    ]);
}
