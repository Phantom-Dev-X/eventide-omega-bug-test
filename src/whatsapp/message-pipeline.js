/**
 * Performs the transport-level preflight shared by every incoming WhatsApp
 * message before feature or command handling begins.
 */
export function createMessagePipeline(deps) {
    const {
        verboseLogs = false,
        isRecentMessage,
        isIgnoredRemoteJid,
        handleAntideleteRevoke,
        trimForLog,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        isRecentMessage,
        isIgnoredRemoteJid,
        handleAntideleteRevoke,
        trimForLog,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Message pipeline requires ${name}()`);
        }
    }

    async function preprocessIncomingMessage({ sock, message, phoneNumber, eventType }) {
        const remoteJid = message?.key?.remoteJid || 'unknown';
        const messageId = message?.key?.id || 'unknown';
        const participant = message?.key?.participant || 'none';
        const fromMe = !!message?.key?.fromMe;
        const pushName = message?.pushName || 'unknown';
        const recent = isRecentMessage(message);

        if (verboseLogs) {
            log(
                'WA-MSG',
                `${phoneNumber}: incoming event message seen | eventType=${eventType} id=${messageId} jid=${remoteJid} participant=${participant} fromMe=${fromMe} pushName=${trimForLog(pushName, 60)} recent=${recent}`
            );
        }

        if (isIgnoredRemoteJid(remoteJid)) {
            log('WA-MSG', `${phoneNumber}: skipping ignored jid ${remoteJid}`);
            return null;
        }

        if (!message?.message) {
            log('WA-MSG', `${phoneNumber}: message ${messageId} has no message payload. Skipping.`);
            return null;
        }

        const protocolMessage = message.message?.protocolMessage;
        if (protocolMessage && (protocolMessage.type === 0 || protocolMessage.type === 'REVOKE')) {
            try {
                await handleAntideleteRevoke(
                    sock,
                    phoneNumber,
                    message.key,
                    protocolMessage.key || message.key
                );
            } catch (error) {
                logError('ANTIDELETE', `${phoneNumber}: upsert revoke failed`, error);
            }
            return null;
        }

        if (eventType !== 'notify' && eventType !== 'append') {
            if (verboseLogs) {
                log(
                    'WA-MSG',
                    `${phoneNumber}: skipping eventType=${eventType} for message ${messageId} because it is not processable.`
                );
            }
            return null;
        }

        if (fromMe && eventType === 'append') {
            if (verboseLogs) {
                log(
                    'WA-MSG',
                    `${phoneNumber}: skipped own echo (append+fromMe) | id=${messageId} jid=${remoteJid}`
                );
            }
            return null;
        }

        return Object.freeze({
            remoteJid,
            messageId,
            participant,
            fromMe,
            pushName,
            recent
        });
    }

    return Object.freeze({ preprocessIncomingMessage });
}

/**
 * Normalizes configured prefixes to the legacy dot-token format used by the
 * existing command handlers.
 */
export function parseCommandInput(rawText, botConfig = {}) {
    const text = String(rawText || '').trim();
    const normalized = text.trim();
    const words = normalized.split(/\s+/);
    const firstWord = words[0] || '';
    const args = words.slice(1);
    const prefix = botConfig.prefix || '.';
    let token = firstWord.toLowerCase();
    let startsWithDot = normalized.startsWith('.');

    if (prefix !== '.' && firstWord.toLowerCase().startsWith(prefix.toLowerCase())) {
        token = `.${firstWord.slice(prefix.length).toLowerCase()}`;
        startsWithDot = true;
    }

    return Object.freeze({
        text,
        normalized,
        firstWord,
        args,
        prefix,
        token,
        startsWithDot
    });
}
