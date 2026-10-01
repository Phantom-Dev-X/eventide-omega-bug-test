const VALID_PERSONAS = new Set(['eclipse', 'ruin']);
const PERSONA_GATE_BYPASS_COMMANDS = new Set(['.persona', '.gitpull', '.gitupdate']);

/**
 * Handles the access and interaction gates that run after message middleware
 * but before command or conversational dispatch.
 */
export function createMessageAccessService(deps) {
    const {
        personaPollKeys,
        personaPollQuestion,
        personaPollOptions,
        personaPollIds,
        isSudo,
        normalizeJid,
        safeWaReply,
        sendMenuPoll,
        loadBotMode,
        getWarnState,
        findMatchingPhrase,
        isUserGroupAdmin,
        isDevNumber,
        applyWarn,
        getTttGame,
        tttIsReplyToBoard,
        tttTryMove,
        handleGameText,
        findHidetagTrigger,
        log,
        logError
    } = deps || {};

    if (!personaPollKeys) throw new Error('Message access service requires personaPollKeys');
    for (const [name, value] of Object.entries({
        isSudo,
        normalizeJid,
        safeWaReply,
        sendMenuPoll,
        loadBotMode,
        getWarnState,
        findMatchingPhrase,
        isUserGroupAdmin,
        isDevNumber,
        applyWarn,
        getTttGame,
        tttIsReplyToBoard,
        tttTryMove,
        handleGameText,
        findHidetagTrigger,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Message access service requires ${name}()`);
        }
    }

    async function runPreCommandAccess(context) {
        if (await enforcePersonaGate(context)) return null;

        const {
            sock,
            message,
            phoneNumber,
            remoteJid,
            fromMe,
            text,
            normalized,
            prefix,
            botConfig
        } = context;
        const currentMode = loadBotMode(phoneNumber);
        const senderJid = message.key.participant || message.key.remoteJid;
        const isSenderOwner = message.key.fromMe
            || normalizeJid(senderJid) === normalizeJid(sock.user.id);

        if (await enforcePhraseWarning({
            ...context,
            senderJid,
            isSenderOwner
        })) return null;

        if (/^[1-9]$/.test(normalized)) {
            const game = getTttGame(phoneNumber, remoteJid);
            if (game && game.status === 'active' && tttIsReplyToBoard(message, game)) {
                await tttTryMove(
                    sock,
                    phoneNumber,
                    remoteJid,
                    senderJid,
                    parseInt(normalized, 10) - 1,
                    message
                );
                return null;
            }
        }

        try {
            if (await handleGameText({
                sock,
                phoneNumber,
                remoteJid,
                senderJid,
                msg: message,
                text: normalized
            })) return null;
        } catch (error) {
            logError('GAMES', `${phoneNumber}: game text failed`, error);
        }

        if (currentMode === 'owner' && !isSenderOwner && !isSudo(phoneNumber, senderJid)) {
            log('SECURITY', `${phoneNumber}: Ignored non-owner interaction in owner-only mode.`);
            return null;
        }

        const hidetag = findHidetagTrigger(normalized, prefix, botConfig.aliases);
        if (hidetag && remoteJid.endsWith('@g.us')) {
            try {
                const senderAdmin = isSenderOwner
                    || isDevNumber(senderJid)
                    || await isUserGroupAdmin(sock, remoteJid, senderJid);
                if (!senderAdmin) {
                    await safeWaReply(sock, remoteJid, '⛔ Group Admin only.', message);
                    return null;
                }
                const metadata = await sock.groupMetadata(remoteJid);
                const participantJids = metadata.participants.map(participant => participant.id);
                await sock.sendMessage(remoteJid, {
                    text: hidetag.body || '‎',
                    mentions: participantJids
                });
                log(
                    'HIDETAG',
                    `${phoneNumber}: silent mention ${participantJids.length} in ${remoteJid}`
                );
            } catch (error) {
                logError('HIDETAG', `${phoneNumber}: hidetag failed`, error);
                await safeWaReply(
                    sock,
                    remoteJid,
                    `❌ Hidetag failed. ${error?.message || error}`,
                    message
                );
            }
            return null;
        }

        return Object.freeze({ currentMode, senderJid, isSenderOwner });
    }

    async function enforcePersonaGate(context) {
        const {
            sock,
            message,
            phoneNumber,
            remoteJid,
            messageId,
            token,
            startsWithDot,
            botConfig
        } = context;
        if (!startsWithDot || PERSONA_GATE_BYPASS_COMMANDS.has(token)) return false;

        const boundPersona = String(botConfig.persona || '').trim().toLowerCase();
        const senderJid = message.key.participant || message.key.remoteJid;
        if (VALID_PERSONAS.has(boundPersona) || isSudo(phoneNumber, senderJid)) return false;

        const gateOwner = message.key.fromMe
            || normalizeJid(senderJid) === normalizeJid(sock.user?.id || '');
        try {
            if (remoteJid.endsWith('@g.us') && !gateOwner) {
                await safeWaReply(
                    sock,
                    remoteJid,
                    `🎭 *PERSONA LOCKED*\n\nThis bot's persona hasn't been\nchosen yet. Ask the owner to\npick it in the bot's DM.`,
                    message
                );
            } else if (personaPollKeys.get(phoneNumber)) {
                await safeWaReply(
                    sock,
                    remoteJid,
                    `🎭 *PERSONA FIRST*\n\nPick your persona in the poll\nabove 👆 — then commands run.\n\n(saved forever, no re-pairing)`,
                    message
                );
            } else {
                await safeWaReply(
                    sock,
                    remoteJid,
                    `🎭 *EVENTIDE OMEGA — PERSONA*\n\nPick how the bot looks & feels:\n\n🌑 *ECLIPSE* — cinematic terminal\n⚙️ *RUIN* — clean & minimal\n\nVote in the poll below 👇 —\nsaved forever.`,
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
            }
            log(
                'PERSONA',
                `${phoneNumber}: persona gate asked ${remoteJid} (${messageId}, cmd='${token}')`
            );
        } catch (error) {
            logError('PERSONA', `${phoneNumber}: persona gate failed`, error);
        }
        return true;
    }

    async function enforcePhraseWarning(context) {
        const {
            sock,
            message,
            phoneNumber,
            remoteJid,
            fromMe,
            text,
            senderJid,
            isSenderOwner
        } = context;
        try {
            if (!remoteJid.endsWith('@g.us') || fromMe || !text) return false;
            const groupConfig = getWarnState(phoneNumber).groups[remoteJid];
            if (!groupConfig?.enabled
                || !Array.isArray(groupConfig.phrases)
                || !groupConfig.phrases.length) return false;

            const matchingPhrase = findMatchingPhrase(text, groupConfig.phrases);
            if (!matchingPhrase) return false;

            const senderAdmin = await isUserGroupAdmin(sock, remoteJid, senderJid);
            if (senderAdmin || isSenderOwner || isDevNumber(senderJid)) return false;

            await applyWarn(sock, phoneNumber, {
                groupJid: remoteJid,
                targetJid: senderJid,
                byJid: sock.user?.id,
                reason: `phrase: "${matchingPhrase}"`,
                auto: true,
                originalMsg: message
            });
            return true;
        } catch (error) {
            logError('WARN', `${phoneNumber}: phrase ward failed`, error);
            return false;
        }
    }

    return Object.freeze({ runPreCommandAccess });
}
