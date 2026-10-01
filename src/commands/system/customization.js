/**
 * Command-prefix, alias, and host identity customization commands.
 */
export function createCustomizationCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        saveBotConfig
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        saveBotConfig
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Customization commands require ${name}()`);
        }
    }

    function isAuthorized(context) {
        return context.isSenderOwner || isDevNumber(context.senderJid);
    }

    async function denyUnauthorized(context) {
        if (isAuthorized(context)) return false;
        await safeWaReply(
            context.sock,
            context.remoteJid,
            '❌ Owner/Dev only.',
            context.message
        );
        return true;
    }

    return Object.freeze([
        {
            name: 'setprefix',
            aliases: ['changeprefix'],
            async execute(context) {
                if (await denyUnauthorized(context)) return;
                const { sock, remoteJid, message, phoneNumber, args, botConfig, prefix } = context;
                const nextPrefix = args[0];
                if (!nextPrefix || nextPrefix.length > 2) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Provide a 1-character prefix.\n\nuse: .setprefix !   (or .setprefix . to reset)',
                        message
                    );
                    return;
                }
                botConfig.prefix = nextPrefix;
                saveBotConfig(phoneNumber, botConfig);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *PREFIX_CALIBRATION* █▓▒░\n\n` +
                        `   ✦ *OLD* :: ${prefix}\n` +
                        `   ✦ *NEW* :: "${nextPrefix}"\n` +
                        `   🔄 *APPLIED* :: IMMEDIATELY\n\n` +
                        `   " The sigil is rewritten.\n     Command now bends to\n     your tongue. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'setalias',
            async execute(context) {
                if (await denyUnauthorized(context)) return;
                const { sock, remoteJid, message, phoneNumber, args, botConfig, prefix } = context;
                const trigger = (args[0] || '').replace(/^\./, '').toLowerCase();
                const target = (args[1] || '').toLowerCase();
                if (!trigger || !target.startsWith('.')) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ use: .setalias <trigger> <command>\n\nExample: .setalias p .ping',
                        message
                    );
                    return;
                }
                botConfig.aliases = botConfig.aliases || {};
                botConfig.aliases[trigger] = target;
                saveBotConfig(phoneNumber, botConfig);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *ALIAS_FORGED* █▓▒░\n\n` +
                        `   ✦ *TRIGGER* :: ${prefix}${trigger}\n` +
                        `   ✦ *CASTS* :: ${target}\n\n` +
                        `   " A new name is bound.\n     Speak it and the void\n     answers. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'delalias',
            async execute(context) {
                if (await denyUnauthorized(context)) return;
                const { sock, remoteJid, message, phoneNumber, args, botConfig, prefix } = context;
                const trigger = (args[0] || '').replace(/^\./, '').toLowerCase();
                if (!trigger || !(botConfig.aliases || {})[trigger]) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ No alias named "${trigger}". Use .aliases to see them.`,
                        message
                    );
                    return;
                }
                delete botConfig.aliases[trigger];
                saveBotConfig(phoneNumber, botConfig);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *ALIAS_SEVERED* █▓▒░\n\n` +
                        `   ✦ *TRIGGER* :: ${prefix}${trigger}\n` +
                        `   ✦ *STATUS* :: UNBOUND\n\n` +
                        `   " The name returns to\n     the silence. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'aliases',
            async execute(context) {
                const { sock, remoteJid, message, botConfig, prefix } = context;
                const aliases = botConfig.aliases || {};
                const keys = Object.keys(aliases);
                const list = keys.length
                    ? keys.map(key => `   • ${prefix}${key}  →  ${aliases[key]}`).join('\n')
                    : '   • _none bound_';
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *ALIAS_REGISTRY* █▓▒░\n\n` +
                        `   🔢 *COUNT* :: ${keys.length}\n\n` +
                        `${list}\n\n` +
                        `   " Names are power.\n     Guard them well. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'setname',
            async execute(context) {
                if (await denyUnauthorized(context)) return;
                const { sock, remoteJid, message, phoneNumber, args, botConfig } = context;
                const name = args.join(' ').trim();
                if (!name) {
                    await safeWaReply(sock, remoteJid, '❌ use: .setname <name>', message);
                    return;
                }
                try {
                    await sock.updateProfileName(name);
                    botConfig.name = name;
                    saveBotConfig(phoneNumber, botConfig);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *IDENTITY_ALIGNED* █▓▒░\n\n` +
                            `   ✦ *NAME* :: ${name}\n` +
                            `   ✦ *STATUS* :: ACCOUNT_RENAMED\n\n` +
                            `   " The vessel wears a\n     new name in the void. "`
                        ),
                        message
                    );
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ Could not set name. Error: ${error?.message}`, message);
                }
            }
        },
        {
            name: 'setbio',
            aliases: ['setstatus'],
            async execute(context) {
                if (await denyUnauthorized(context)) return;
                const { sock, remoteJid, message, phoneNumber, args, botConfig } = context;
                const bio = args.join(' ').trim();
                if (!bio) {
                    await safeWaReply(sock, remoteJid, '❌ use: .setbio <text>', message);
                    return;
                }
                try {
                    await sock.updateProfileStatus(bio);
                    botConfig.bio = bio;
                    saveBotConfig(phoneNumber, botConfig);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *BIO_INSCRIBED* █▓▒░\n\n` +
                            `   ✦ *ABOUT* :: ${bio}\n` +
                            `   ✦ *STATUS* :: ACCOUNT_UPDATED\n\n` +
                            `   " The void now reads\n     what you will it to say. "`
                        ),
                        message
                    );
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ Could not set bio. Error: ${error?.message}`, message);
                }
            }
        }
    ]);
}
