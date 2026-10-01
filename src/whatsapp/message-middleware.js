const AUTOREACT_EMOJIS = Object.freeze(['🔥', '⚡', '✨', '👁️', '🌑', '✅', '❤️', '🙌']);
const MESSAGE_CACHE_LIMIT = 300;
const MESSAGE_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Runs cross-cutting message middleware before conversational and command
 * dispatch: caching, moderation, command acknowledgement, and auto-reactions.
 */
export function createMessageMiddleware(deps) {
    const {
        verboseLogs = false,
        recentMessages,
        mutedUsers,
        slimProto,
        logMessage,
        normalizeJid,
        maskApiKey,
        trimForLog,
        loadBotConfig,
        loadBotMode,
        isDevNumber,
        isSudo,
        now = Date.now,
        random = Math.random,
        log,
        logError
    } = deps || {};

    if (!recentMessages || !mutedUsers) {
        throw new Error('Message middleware requires recentMessages and mutedUsers');
    }
    for (const [name, value] of Object.entries({
        slimProto,
        logMessage,
        normalizeJid,
        maskApiKey,
        trimForLog,
        loadBotConfig,
        loadBotMode,
        isDevNumber,
        isSudo,
        now,
        random,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Message middleware requires ${name}()`);
        }
    }

    async function runMessageMiddleware(context) {
        cacheMessage(context);
        if (await enforceMute(context)) return false;
        logParseResult(context);
        await acknowledgeCommand(context);
        if (await enforceGroupModeration(context)) return false;
        await runAutoReact(context);

        if (context.remoteJid.endsWith('@newsletter')) {
            if (verboseLogs) {
                log(
                    'WA-MSG',
                    `${context.phoneNumber}: channel post ${context.messageId} — command flow skipped`
                );
            }
            return false;
        }

        return true;
    }

    function cacheMessage({ phoneNumber, remoteJid, messageId, message }) {
        try {
            recentMessages.set(`${phoneNumber}:${remoteJid}:${messageId}`, {
                key: message.key,
                message: slimProto(message.message),
                messageTimestamp: message.messageTimestamp,
                pushName: message.pushName,
                _cachedAt: now()
            });

            if (recentMessages.size > MESSAGE_CACHE_LIMIT) {
                const timestamp = now();
                for (const [key, cached] of recentMessages) {
                    if (timestamp - (cached._cachedAt || 0) > MESSAGE_CACHE_TTL_MS) {
                        recentMessages.delete(key);
                    }
                }
                if (recentMessages.size > MESSAGE_CACHE_LIMIT) {
                    const firstKey = recentMessages.keys().next().value;
                    if (firstKey) recentMessages.delete(firstKey);
                }
            }

            logMessage(phoneNumber, remoteJid, message);
        } catch {
            // Caching must never interrupt message handling.
        }
    }

    async function enforceMute({
        sock,
        phoneNumber,
        remoteJid,
        messageId,
        participant,
        fromMe
    }) {
        try {
            if (remoteJid.endsWith('@g.us') && !fromMe) {
                const muted = mutedUsers.get(`${phoneNumber}:${remoteJid}`);
                if (muted && muted.has(normalizeJid(participant))) {
                    await sock.sendMessage(remoteJid, {
                        delete: { remoteJid, id: messageId, participant }
                    }).catch(() => {});
                    log('MUTE', `${phoneNumber}: deleted muted user's message in ${remoteJid}`);
                    return true;
                }
            }
        } catch (error) {
            logError('MUTE', `${phoneNumber}: mute delete failed`, error);
        }
        return false;
    }

    function logParseResult({ phoneNumber, parsed }) {
        const parsedText = String(parsed.text || '');
        const textForLog = /^\.(plugin|pluginkey)\b/i.test(parsedText)
            ? parsedText.replace(
                /(AIza[0-9A-Za-z_-]{10,}|AQ\.[0-9A-Za-z_-]{10,}|ABQ[0-9A-Za-z_-]{10,})/gi,
                match => maskApiKey(match)
            )
            : trimForLog(parsed.text, 250);

        if (verboseLogs) {
            log(
                'WA-PARSE',
                `${phoneNumber}: parse result | topLevel=${parsed.topLevelType} wrappers=${parsed.wrapperChain.join(' > ') || 'none'} leaf=${parsed.leafType} source=${parsed.source} text=${JSON.stringify(textForLog)}`
            );
        }
    }

    async function acknowledgeCommand({
        sock,
        message,
        phoneNumber,
        eventType,
        remoteJid,
        messageId,
        fromMe,
        parsed
    }) {
        try {
            if ((fromMe && eventType !== 'notify') || !parsed.text || remoteJid.endsWith('@newsletter')) {
                return;
            }

            const prefix = String(loadBotConfig(phoneNumber)?.prefix || '.');
            const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const commandMatch = new RegExp(`^${escapedPrefix}[a-z0-9_]{1,20}\\b`, 'i')
                .exec(parsed.text.trim());
            if (!commandMatch) {
                if (verboseLogs) {
                    log('REACT', `${phoneNumber}: no cmd prefix in msg ${messageId} (fromMe=${fromMe})`);
                }
                return;
            }

            const rawTimestamp = message?.messageTimestamp;
            const timestamp = typeof rawTimestamp === 'object'
                ? (rawTimestamp?.low || 0)
                : Number(rawTimestamp || 0);
            const fresh = !timestamp || timestamp > (now() / 1000 - 300);
            if (!fresh) {
                log('REACT', `${phoneNumber}: stale cmd '${commandMatch[0]}' skipped (age>5min)`);
                return;
            }

            const senderJid = message.key.participant || message.key.remoteJid;
            const owner = fromMe
                || normalizeJid(senderJid) === normalizeJid(sock.user?.id || '')
                || isDevNumber(senderJid);
            if (loadBotMode(phoneNumber) === 'owner' && !owner && !isSudo(phoneNumber, senderJid)) {
                log(
                    'REACT',
                    `${phoneNumber}: owner-only mode blocked reaction for ${messageId} (sender=${senderJid}, fromMe=${fromMe})`
                );
                return;
            }

            log(
                'REACT',
                `${phoneNumber}: cmd '${commandMatch[0]}' on ${messageId} (type=${eventType}, fromMe=${fromMe}) — sending ⚡ now...`
            );
            await sock.sendMessage(remoteJid, {
                react: { text: '⚡', key: message.key }
            }, {});
            log('REACT', `${phoneNumber}: ⚡ reaction SENT for ${messageId}`);
        } catch (error) {
            logError('REACT', `${phoneNumber}: react FAILED for ${messageId}`, error);
        }
    }

    async function enforceGroupModeration({
        sock,
        message,
        phoneNumber,
        remoteJid,
        messageId,
        participant,
        fromMe,
        parsed
    }) {
        try {
            if (!remoteJid.endsWith('@g.us') || fromMe || !message.message) return false;

            const antiConfig = loadBotConfig(phoneNumber).anti || {};
            const lowerText = parsed.text.toLowerCase();
            const isLink = /https?:\/\/|chat\.whatsapp\.com/i.test(lowerText);
            const isMention = !!message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length;
            const isForwarded = !!message.message?.extendedTextMessage?.contextInfo?.isForwarded;
            const violates = (antiConfig.antilink?.[remoteJid] === 'on' && isLink)
                || (antiConfig.antimention?.[remoteJid] === 'on' && isMention)
                || (antiConfig.antiforward?.[remoteJid] === 'on' && isForwarded);

            if (!violates) return false;
            await sock.sendMessage(remoteJid, {
                delete: { remoteJid, id: messageId, participant }
            }).catch(() => {});
            log('ANTI', `${phoneNumber}: deleted violating msg in ${remoteJid}`);
            return true;
        } catch (error) {
            logError('ANTI', `${phoneNumber}: anti enforcement failed`, error);
            return false;
        }
    }

    async function runAutoReact({ sock, message, phoneNumber, remoteJid }) {
        try {
            const autoReact = loadBotConfig(phoneNumber).autoreact || {};
            if (!autoReact.enabled || message.key?.fromMe) return;

            const endpoints = autoReact.endpoints || {
                groups: [],
                channels: [],
                contacts: []
            };
            let shouldReact = false;
            if (remoteJid.endsWith('@g.us')) {
                shouldReact = endpoints.groups.includes(remoteJid);
            } else if (remoteJid.endsWith('@newsletter')) {
                shouldReact = (endpoints.channels || []).some(channel => {
                    const value = String(channel || '');
                    return value === remoteJid
                        || (value && (value.includes(remoteJid) || remoteJid.includes(value)));
                });
            } else if (remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid')) {
                const remoteDigits = String(remoteJid).split('@')[0].replace(/\D/g, '');
                shouldReact = !!remoteDigits && (endpoints.contacts || []).some(contact => (
                    String(contact).replace(/\D/g, '') === remoteDigits
                ));
            }

            if (!shouldReact) return;
            const emoji = AUTOREACT_EMOJIS[Math.floor(random() * AUTOREACT_EMOJIS.length)];
            await sock.sendMessage(remoteJid, {
                react: { text: emoji, key: message.key }
            }).catch(() => {});
            log('AUTOREACT', `${phoneNumber}: reacted to ${remoteJid}`);
        } catch (error) {
            logError('AUTOREACT', `${phoneNumber}: autoreact failed`, error);
        }
    }

    return Object.freeze({ runMessageMiddleware });
}
