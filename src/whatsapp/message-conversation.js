const HELP_MODE_TIMEOUT_MS = 10 * 60 * 1000;
const HELP_ECHO_PREFIXES = Object.freeze([
    '🤖',
    '╔',
    '✅',
    '📌',
    '⚠️',
    'eventide omega connected'
]);

/**
 * Handles stateful conversational flows that run before ordinary non-command
 * input and command dispatch.
 */
export function createMessageConversationService(deps) {
    const {
        autoreactSessions,
        antiConfigSessions,
        helpModeUsers,
        parseInviteOrJid,
        resolveAndJoinTarget,
        applyWardEndpoint,
        safeWaReply,
        buildOmegaTerminal,
        terminalHeader,
        getBoundHelpPrompt,
        callUniversalAI,
        aiOptsFor,
        clearScheduled = clearTimeout,
        schedule = setTimeout,
        log,
        logError
    } = deps || {};

    if (!autoreactSessions || !antiConfigSessions || !helpModeUsers) {
        throw new Error('Message conversation service requires flow state maps');
    }
    for (const [name, value] of Object.entries({
        parseInviteOrJid,
        resolveAndJoinTarget,
        applyWardEndpoint,
        safeWaReply,
        buildOmegaTerminal,
        getBoundHelpPrompt,
        callUniversalAI,
        aiOptsFor,
        clearScheduled,
        schedule,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Message conversation service requires ${name}()`);
        }
    }

    async function handleConversation(context) {
        if (await handleWardTargetInput(context)) return true;
        if (await handleHelpMode(context)) return true;
        return false;
    }

    async function handleWardTargetInput({
        sock,
        message,
        phoneNumber,
        remoteJid,
        text,
        normalized,
        token
    }) {
        const autoreactSession = autoreactSessions.get(phoneNumber);
        const antideleteSession = antiConfigSessions.get(phoneNumber);
        const pending = autoreactSession?.step === 'awaiting_ref'
            || autoreactSession?.step === 'pick_group'
            ? { ward: 'ar', session: autoreactSession }
            : antideleteSession?.step === 'awaiting_ref'
                || antideleteSession?.step === 'pick_group'
                ? { ward: 'ad', session: antideleteSession }
                : null;
        const looksLikeTarget = !!(parseInviteOrJid(text) || parseInviteOrJid(normalized));
        if (!pending || (pending.session.step !== 'awaiting_ref' && !looksLikeTarget)) {
            return false;
        }

        if (['.cancel', 'cancel'].includes(String(text).toLowerCase().trim()) || token === '.cancel') {
            clearWardSession(phoneNumber, pending.ward);
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal('   ✦ *CANCELLED* :: no changes made.'),
                message
            );
            return true;
        }

        if (!looksLikeTarget) return false;
        const result = await resolveAndJoinTarget(sock, text);
        if (!result.ok) {
            await safeWaReply(sock, remoteJid, `❌ ${result.error}`, message);
            return true;
        }

        const wantedType = pending.session.endpoint || result.kind;
        if (wantedType === 'channel' && result.kind !== 'channel') {
            await safeWaReply(sock, remoteJid, '❌ That is not a channel link/ID.', message);
            return true;
        }
        if (wantedType === 'group' && result.kind !== 'group') {
            await safeWaReply(sock, remoteJid, '❌ That is not a group invite/ID.', message);
            return true;
        }

        applyWardEndpoint(phoneNumber, pending.ward, result.kind, result.jid);
        clearWardSession(phoneNumber, pending.ward);
        await safeWaReply(
            sock,
            remoteJid,
            buildOmegaTerminal(
                `   ░▒▓█ *ENDPOINT_ADDED* █▓▒░\n\n` +
                `   ✦ *TYPE* :: ${result.kind.toUpperCase()}\n` +
                `   ✦ *TARGET* :: ${result.name || result.jid}\n` +
                `   ✦ *JOINED* :: ${result.joined ? 'YES' : 'ALREADY_IN'}\n\n` +
                (pending.ward === 'ad'
                    ? '   Arm with *.antidelete on* if needed.'
                    : '   Arm with *.autoreact on* if needed.')
            ),
            message
        );
        return true;
    }

    async function handleHelpMode({
        sock,
        message,
        phoneNumber,
        eventType,
        remoteJid,
        messageId,
        fromMe,
        text,
        token
    }) {
        if (!helpModeUsers.has(remoteJid) || token === '.help') return false;

        if ((fromMe && eventType === 'append')
            || HELP_ECHO_PREFIXES.some(prefix => text.startsWith(prefix))) {
            log(
                'LOOP-PREVENTION',
                `${phoneNumber}: skipped help-mode self-echo | type=${eventType} fromMe=${fromMe} id=${messageId} jid=${remoteJid}`
            );
            return true;
        }

        const currentState = helpModeUsers.get(remoteJid);
        if (currentState?.timer) clearScheduled(currentState.timer);
        const timer = schedule(async () => {
            helpModeUsers.delete(remoteJid);
            try {
                await sock.sendMessage(remoteJid, {
                    text: terminalHeader
                        + `╔═════ HELP_MODE ═════╗\n\n   ⏳  Help mode timed out after 10 min inactivity.\n   Type *.help* again to re-enable.`
                });
            } catch {
                // Timeout notification is best effort.
            }
        }, HELP_MODE_TIMEOUT_MS);
        helpModeUsers.set(remoteJid, { timer });

        try {
            const aiReply = await callUniversalAI(
                text,
                getBoundHelpPrompt(phoneNumber),
                aiOptsFor(phoneNumber)
            );
            await safeWaReply(sock, remoteJid, `🤖 *Eventide Help:*\n\n${aiReply}`, message);
        } catch (error) {
            logError('HELP-MODE', 'AI Help reply failed', error);
            await safeWaReply(
                sock,
                remoteJid,
                '❌ Help AI is offline right now. Type *.help* to exit help mode.',
                message
            );
        }
        return true;
    }

    function clearWardSession(phoneNumber, ward) {
        if (ward === 'ar') autoreactSessions.delete(phoneNumber);
        else antiConfigSessions.delete(phoneNumber);
    }

    return Object.freeze({ handleConversation });
}
