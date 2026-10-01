/**
 * Persistent elevated-user management for owner-mode command access.
 */
export function createSudoCommands(deps) {
    const {
        safeWaReply,
        isDevNumber,
        loadBotConfig,
        saveBotConfig,
        getQuotedContext,
        normalizeDigits,
        normalizeJid
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        isDevNumber,
        loadBotConfig,
        saveBotConfig,
        getQuotedContext,
        normalizeDigits,
        normalizeJid
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Sudo commands require ${name}()`);
        }
    }

    function resolveSudoTarget(message, argument) {
        const quoted = getQuotedContext(message);
        const quotedSender = quoted?.participant || quoted?.remoteJid || '';
        if (quotedSender) return quotedSender;
        const digits = normalizeDigits(argument || '');
        if (digits.length >= 7) return digits;
        const mentioned = Array.isArray(quoted?.mentionedJid) ? quoted.mentionedJid[0] : null;
        return mentioned ? normalizeJid(mentioned) : null;
    }

    function isAuthorized(context) {
        return context.isSenderOwner || isDevNumber(context.senderJid);
    }

    async function executeMutation(context, adding) {
        const { sock, remoteJid, message, phoneNumber, args } = context;
        const config = loadNormalizedConfig(phoneNumber);
        const target = resolveSudoTarget(message, args[0] || '');
        if (!target) {
            await safeWaReply(
                sock,
                remoteJid,
                `🛡 *SUDO* 👑\n\n` +
                `reply to their message, or send:\n` +
                `.${adding ? 'addsudo' : 'delsudo'} 234xxxxxxxxx\n` +
                `.${adding ? 'addsudo' : 'delsudo'} @mention`,
                message
            );
            return;
        }
        const digits = normalizeDigits(target);
        if (!digits || digits.length < 7) {
            await safeWaReply(sock, remoteJid, '❌ Could not resolve that target.', message);
            return;
        }
        if (adding) {
            if (!config.sudos.includes(digits)) config.sudos.push(digits);
            saveBotConfig(phoneNumber, config);
            await safeWaReply(
                sock,
                remoteJid,
                `🛡 *SUDO GRANTED* :: ${digits}\n\n` +
                `they can now command the bot\n` +
                `even in owner mode.\n\n` +
                `   " the void obeys the chosen. "`,
                message
            );
            return;
        }
        const before = config.sudos.length;
        config.sudos = config.sudos.filter(sudo => sudo !== digits);
        saveBotConfig(phoneNumber, config);
        await safeWaReply(
            sock,
            remoteJid,
            before === config.sudos.length
                ? `🛡 *SUDO* :: ${digits} wasn't in the list.`
                : `🛡 *SUDO REVOKED* :: ${digits}\n\n   their pass is void now.`,
            message
        );
    }

    function loadNormalizedConfig(phoneNumber) {
        const config = loadBotConfig(phoneNumber);
        config.sudos = Array.isArray(config.sudos)
            ? config.sudos.map(sudo => normalizeDigits(sudo)).filter(Boolean)
            : [];
        return config;
    }

    return Object.freeze([
        {
            name: 'addsudo',
            async execute(context) {
                if (!isAuthorized(context)) {
                    await safeWaReply(
                        context.sock,
                        context.remoteJid,
                        '❌ Owner/Dev only.',
                        context.message
                    );
                    return;
                }
                await executeMutation(context, true);
            }
        },
        {
            name: 'delsudo',
            aliases: ['removesudo'],
            async execute(context) {
                if (!isAuthorized(context)) {
                    await safeWaReply(
                        context.sock,
                        context.remoteJid,
                        '❌ Owner/Dev only.',
                        context.message
                    );
                    return;
                }
                await executeMutation(context, false);
            }
        },
        {
            name: 'sudos',
            aliases: ['listsudos'],
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                const config = loadNormalizedConfig(phoneNumber);
                await safeWaReply(
                    sock,
                    remoteJid,
                    `🛡 *SUDO LIST* 👑\n\n` +
                    (config.sudos.length
                        ? config.sudos.map((sudo, index) => `   [${index + 1}] ${sudo}`).join('\n')
                        : `   _no sudoes yet_`) +
                    `\n\n   add: .addsudo <reply|number|@mention>\n` +
                    `   del: .delsudo <reply|number|@mention>`,
                    message
                );
            }
        }
    ]);
}
