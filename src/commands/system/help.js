/**
 * Interactive help surfaces: temporary antibug command menu and the
 * persona-aware AI help oracle.
 */
export function createHelpCommands(deps) {
    const {
        safeWaReply,
        buildBugMenuText,
        log,
        logError,
        isSudo,
        loadBotConfig,
        helpPersonaPollKeys,
        sendMenuPoll,
        helpPersonaPollQuestion,
        helpPersonaPollOptions,
        helpPersonaPollIds,
        getBoundHelpPrompt,
        callUniversalAI,
        aiOptsFor,
        getStaticHelpAnswer,
        terminalHeader,
        helpModeUsers,
        setTimer = setTimeout,
        clearTimer = clearTimeout,
        env = process.env
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildBugMenuText,
        log,
        logError,
        isSudo,
        loadBotConfig,
        sendMenuPoll,
        getBoundHelpPrompt,
        callUniversalAI,
        aiOptsFor,
        getStaticHelpAnswer,
        setTimer,
        clearTimer
    })) {
        if (typeof value !== 'function') throw new Error(`Help commands require ${name}()`);
    }
    for (const [name, value] of Object.entries({ helpPersonaPollKeys, helpModeUsers })) {
        if (!value || typeof value.get !== 'function' || typeof value.set !== 'function' || typeof value.delete !== 'function') {
            throw new Error(`Help commands require ${name}`);
        }
    }

    return Object.freeze([
        {
            name: 'bugmenu',
            aliases: ['bug-menu', 'bugmemu'],
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, prefix } = context;
                const menuText = buildBugMenuText(prefix);
                try {
                    await sock.sendMessage(remoteJid, {
                        react: { text: '🎗️', key: message.key }
                    }).catch(() => {});
                    await safeWaReply(sock, remoteJid, menuText, message);
                } catch (error) {
                    logError('WA-CMD', `${phoneNumber}: Failed sending bug menu`, error);
                }
            }
        },
        {
            name: 'help',
            aliases: ['mhelp', 'jelp'],
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, senderJid, args } = context;
                if (!context.isSenderOwner && !isSudo(phoneNumber, senderJid)) {
                    log('SECURITY', `${phoneNumber}: Ignored .help from non-owner/non-sudo.`);
                    return;
                }
                const question = args.join(' ').trim();
                const boundPersona = String(loadBotConfig(phoneNumber).helpPersona || '').trim().toLowerCase();

                if (!['eclipse', 'ruin'].includes(boundPersona)) {
                    if (helpPersonaPollKeys.get(phoneNumber)) {
                        await safeWaReply(sock, remoteJid,
                            `🛎 *HELP PERSONA FIRST*\n\n` +
                            `Pick how the oracle speaks in the\n` +
                            `poll above 👆 — then ask me again.\n\n` +
                            `Poll not showing? Pick by text:\n` +
                            `• *.helpset eclipse* — cinematic oracle\n` +
                            `• *.helpset ruin* — friendly support\n\n` +
                            `(saved forever)`, message);
                    } else {
                        await safeWaReply(sock, remoteJid,
                            `🛎 *EVENTIDE OMEGA — HELP PERSONA*\n\n` +
                            `Choose how I talk to you:\n\n` +
                            `🌑 *ECLIPSE* — cinematic oracle\n` +
                            `🛎 *RUIN* — friendly customer care\n\n` +
                            `Vote in the poll below 👇 —\n` +
                            `saved forever.\n\n` +
                            `No poll? *.helpset eclipse* / *.helpset ruin*\n` +
                            `picks by text.`, message);
                        const pollMessage = await sendMenuPoll(
                            sock,
                            remoteJid,
                            phoneNumber,
                            helpPersonaPollQuestion,
                            helpPersonaPollOptions,
                            helpPersonaPollIds
                        );
                        if (pollMessage?.key) helpPersonaPollKeys.set(phoneNumber, pollMessage.key);
                        log('HELPP', `${phoneNumber}: help persona gate asked ${remoteJid} (first .help).`);
                    }
                    return;
                }

                const systemPrompt = getBoundHelpPrompt(phoneNumber);
                if (question) {
                    try {
                        log('HELP-CMD', `${phoneNumber}: Querying AI Oracle: ${question}`);
                        const response = await callUniversalAI(question, systemPrompt, aiOptsFor(phoneNumber));
                        await safeWaReply(sock, remoteJid, `🤖 *Eventide Help:*\n\n${response}`, message);
                    } catch (error) {
                        logError('HELP-CMD', 'AI Oracle failed', error);
                        const staticAnswer = getStaticHelpAnswer(question);
                        if (staticAnswer) {
                            log('HELP-CMD', `${phoneNumber}: AI offline — answering from static index.`);
                            await safeWaReply(sock, remoteJid,
                                `🤖 *Eventide Help (offline index):*\n\n${staticAnswer}`, message);
                            return;
                        }
                        const diagnostic = terminalHeader +
                            `   ❌  *AI_ORACLE — OFFLINE*\n\n` +
                            `   The help AI couldn't respond right now.\n\n` +
                            `   *Diagnostic Report:*\n` +
                            `   • GEMINI_API_KEY: ${env.GEMINI_API_KEY ? 'Set (but request failed — check key validity or quota)' : 'Not Set'}\n` +
                            `   • OPENAI_API_KEY: ${env.OPENAI_API_KEY ? 'Set' : 'Not Set'}\n` +
                            `   • Pollinations Keyless Fallback: Busy or Unavailable (Shared Server IP rate limits reached)\n\n` +
                            `   *Fix:* Double-check your GEMINI_API_KEY on Render (get a free key from Google AI Studio), add a valid OPENAI_API_KEY — or attach YOUR own Gemini key with *.pluginkey <key>* and this session will use it.`;
                        await safeWaReply(sock, remoteJid, diagnostic, message);
                    }
                    return;
                }

                const helpKey = remoteJid;
                if (helpModeUsers.has(helpKey)) {
                    const state = helpModeUsers.get(helpKey);
                    if (state?.timer) clearTimer(state.timer);
                    helpModeUsers.delete(helpKey);
                    const offMessage = terminalHeader +
                        `   ╾━━━ HELP_MODE — OFFLINE ━━━╼\n\n` +
                        `   🔇  AI guide deactivated.\n\n` +
                        `   " The oracle steps back.\n     You walk alone again. "`;
                    await safeWaReply(sock, remoteJid, offMessage, message);
                } else {
                    const timer = setTimer(async () => {
                        helpModeUsers.delete(helpKey);
                        try {
                            await sock.sendMessage(remoteJid, {
                                text: terminalHeader + `╔═════ HELP_MODE ═════╗\n\n   ⏳  Help mode timed out after 10 min inactivity.\n   Type *.help* again to re-enable.`
                            });
                        } catch {}
                    }, 10 * 60 * 1000);
                    helpModeUsers.set(helpKey, { timer });
                    const onMessage = terminalHeader +
                        `   ╔══ HELP_PROTOCOL — ACTIVE ══╗\n\n` +
                        `   ✨  *AI help mode is ON*\n\n` +
                        `   Ask me anything about the bot:\n` +
                        `   • _"how do I use antilink?"_\n` +
                        `   • _"what does .kick do?"_\n` +
                        `   • _"how does .mode work?"_\n\n` +
                        `   🔄 Auto-exits after 10 min silence.\n` +
                        `   Type *.help* again to turn off.\n\n` +
                        `   " The oracle is listening. "`;
                    await safeWaReply(sock, remoteJid, onMessage, message);
                }
            }
        }
    ]);
}
