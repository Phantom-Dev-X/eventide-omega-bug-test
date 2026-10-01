/**
 * Per-session Gemini key-pool management. Keys are never logged and only
 * masked representations are included in replies.
 */
export function createPluginKeyCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        loadBotConfig,
        saveBotConfig,
        splitApiKeys,
        maskApiKey,
        isValidGeminiKey
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        loadBotConfig,
        saveBotConfig,
        splitApiKeys,
        maskApiKey,
        isValidGeminiKey
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Plugin key commands require ${name}()`);
        }
    }

    return Object.freeze([
        {
            name: 'pluginkey',
            aliases: ['plugin'],
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, senderJid, args } = context;
                if (!context.isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Owner/Dev only. Only the paired bot owner can set their own key.',
                        message
                    );
                    return;
                }
                const argument = args.join(' ').trim();
                const config = loadBotConfig(phoneNumber);
                if (!argument) {
                    const keys = splitApiKeys(config.geminiApiKey);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *PLUGIN_KEY_STATUS* █▓▒░\n\n` +
                            `   ✦ *KEYS* :: ${keys.length}\n` +
                            (keys.length
                                ? `   ${keys.map((key, index) => `[${index + 1}] ${maskApiKey(key)}`).join('\n   ')}\n`
                                : `   ✦ *KEY* :: NOT_SET\n`) +
                            `   ✦ *ROUTING* :: ${keys.length ? 'YOUR_GEMINI_KEYS' : 'OWNER_DEFAULT_CHAIN'}\n` +
                            `   ✦ *ISOLATION* :: your session only\n\n` +
                            `   Add key: *.pluginkey <key>*\n` +
                            `   Replace: *.pluginkey set keyA,keyB*\n` +
                            `   Remove: *.pluginkey off*\n\n` +
                            `   " Your mind, your keys. "`
                        ),
                        message
                    );
                    return;
                }
                if (argument.toLowerCase() === 'off' || argument.toLowerCase() === 'remove') {
                    config.geminiApiKey = '';
                    saveBotConfig(phoneNumber, config);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *PLUGIN_KEY_SEVERED* █▓▒░\n\n` +
                            `   ✦ *STATUS* :: REMOVED\n` +
                            `   ✦ *ROUTING* :: OWNER_DEFAULT_CHAIN\n\n` +
                            `   " The key returns to silence. "`
                        ),
                        message
                    );
                    return;
                }
                const setMode = /^set\s+/i.test(argument);
                const argumentBody = setMode ? argument.replace(/^set\s+/i, '').trim() : argument;
                const incoming = splitApiKeys(argumentBody);
                const invalid = incoming.filter(key => !isValidGeminiKey(key));
                if (!incoming.length || invalid.length) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ That does not look like a valid Gemini API key list.\n\nGemini keys usually start with *AIza* or *AQ.* — grab one free at:\nhttps://aistudio.google.com/apikey\n\nThen: *.pluginkey <key1,key2,key3>* (comma-separated, no spaces needed)\n*.pluginkey set <keys>* replaces your current keys`,
                        message
                    );
                    return;
                }
                const existing = splitApiKeys(config.geminiApiKey);
                const merged = setMode ? incoming : [...existing, ...incoming];
                const finalKeys = [...new Set(merged)];
                const added = finalKeys.length - existing.length;
                config.geminiApiKey = finalKeys.join(',');
                saveBotConfig(phoneNumber, config);
                const modeLabel = setMode ? 'RESET' : (added > 0 ? 'EXTENDED' : 'ALREADY_BOUND');
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *PLUGIN_KEYS_${modeLabel}* █▓▒░\n\n` +
                        `   ✦ *TOTAL* :: ${finalKeys.length}\n` +
                        `   ✦ *ADDED* :: ${setMode ? '-' : added}\n` +
                        `   ${finalKeys.map((key, index) => `[${index + 1}] ${maskApiKey(key)}`).join('\n   ')}\n` +
                        `   ✦ *ROUTING* :: YOUR_GEMINI_KEYS\n` +
                        `   ✦ *ORDER* :: A → B → C (first success wins)\n` +
                        `   ✦ *FALLBACK* :: general .env keys only if ALL yours fail\n` +
                        `   ✦ *SCOPE* :: your session only — other users keep their own\n\n` +
                        `   " The oracle now speaks\n     through your own flames. "`
                    ),
                    message
                );
            }
        }
    ]);
}
