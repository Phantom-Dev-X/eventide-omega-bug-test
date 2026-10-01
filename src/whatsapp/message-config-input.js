/**
 * Handles plain-text responses expected by active configuration sessions.
 * Returns true for every non-command message because ordinary text is ignored
 * after all configured conversational interceptors have had a chance to run.
 */
export function createMessageConfigInputService(deps) {
    const {
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        welcomeGoodbyeSessions,
        loadBotConfig,
        saveBotConfig,
        getAntideleteState,
        saveAntideleteState,
        ensureWarnGroup,
        getWarnState,
        saveWarnState,
        safeWaReply,
        buildOmegaTerminal
    } = deps || {};

    for (const [name, value] of Object.entries({
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        welcomeGoodbyeSessions
    })) {
        if (!value) throw new Error(`Message config input service requires ${name}`);
    }
    for (const [name, value] of Object.entries({
        loadBotConfig,
        saveBotConfig,
        getAntideleteState,
        saveAntideleteState,
        ensureWarnGroup,
        getWarnState,
        saveWarnState,
        safeWaReply,
        buildOmegaTerminal
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Message config input service requires ${name}()`);
        }
    }

    async function handleConfigInput({
        sock,
        message,
        phoneNumber,
        remoteJid,
        text,
        startsWithDot
    }) {
        if (startsWithDot) return false;
        if (await handleAutoreactInput({ sock, message, phoneNumber, remoteJid, text })) return true;
        if (await handleAntideleteInput({ sock, message, phoneNumber, remoteJid, text })) return true;
        if (await handleWarnInput({ sock, message, phoneNumber, remoteJid, text })) return true;
        if (await handleWelcomeGoodbyeInput({ sock, message, phoneNumber, remoteJid, text })) return true;
        return true;
    }

    async function handleAutoreactInput(context) {
        const { sock, message, phoneNumber, remoteJid, text } = context;
        const session = autoreactSessions.get(phoneNumber);
        if (session?.step !== 'awaiting_contact' && session?.step !== 'awaiting_channel') {
            return false;
        }

        if (isCancel(text)) {
            autoreactSessions.delete(phoneNumber);
            await sendCancelled(sock, remoteJid, message);
            return true;
        }

        const isContact = session.step === 'awaiting_contact';
        const autoReact = loadBotConfig(phoneNumber).autoreact || {
            enabled: false,
            endpoints: { groups: [], channels: [], contacts: [] }
        };
        autoReact.endpoints = autoReact.endpoints || {
            groups: [],
            channels: [],
            contacts: []
        };

        if (isContact) {
            const number = text.replace(/\D/g, '');
            if (number.length < 7) {
                await safeWaReply(
                    sock,
                    remoteJid,
                    '❌ Invalid number. Enter a valid number, or type *.cancel* to exit.',
                    message
                );
                return true;
            }
            if (!autoReact.endpoints.contacts.includes(number)) {
                autoReact.endpoints.contacts.push(number);
            }
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal(
                    `   ░▒▓█ *ENDPOINT_ADDED* █▓▒░\n\n` +
                    `   ✦ *TYPE* :: CONTACT\n` +
                    `   ✦ *TARGET* :: ${number}\n\n` +
                    `   All msgs from this number will be\n` +
                    `   auto-reacted.`
                ),
                message
            );
        } else {
            const value = text.trim();
            if (!autoReact.endpoints.channels.includes(value)) {
                autoReact.endpoints.channels.push(value);
            }
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal(
                    `   ░▒▓█ *ENDPOINT_ADDED* █▓▒░\n\n` +
                    `   ✦ *TYPE* :: CHANNEL\n` +
                    `   ✦ *TARGET* :: ${value}\n\n` +
                    `   Channel added to auto-react.`
                ),
                message
            );
        }

        const config = loadBotConfig(phoneNumber);
        config.autoreact = autoReact;
        saveBotConfig(phoneNumber, config);
        autoreactSessions.delete(phoneNumber);
        return true;
    }

    async function handleAntideleteInput(context) {
        const { sock, message, phoneNumber, remoteJid, text } = context;
        const session = antiConfigSessions.get(phoneNumber);
        if (session?.step !== 'awaiting_contact' && session?.step !== 'awaiting_channel') {
            return false;
        }

        if (isCancel(text)) {
            antiConfigSessions.delete(phoneNumber);
            await sendCancelled(sock, remoteJid, message);
            return true;
        }

        const isContact = session.step === 'awaiting_contact';
        const antidelete = getAntideleteState(phoneNumber);
        antidelete.endpoints = antidelete.endpoints || {
            groups: [],
            channels: [],
            contacts: []
        };

        if (isContact) {
            const number = text.replace(/\D/g, '');
            if (number.length < 7) {
                await safeWaReply(
                    sock,
                    remoteJid,
                    '❌ Invalid number. Enter a valid number, or type *.cancel* to exit.',
                    message
                );
                return true;
            }
            if (!antidelete.endpoints.contacts.includes(number)) {
                antidelete.endpoints.contacts.push(number);
            }
            saveAntideleteState(phoneNumber, antidelete);
            antiConfigSessions.delete(phoneNumber);
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal(
                    `   ░▒▓█ *ENDPOINT_ADDED* █▓▒░\n\n` +
                    `   ✦ *TYPE* :: CONTACT\n` +
                    `   ✦ *TARGET* :: ${number}\n\n` +
                    `   Deleted msgs from this number will\n` +
                    `   be forwarded to the owner DM.\n` +
                    `   Arm it with *.antidelete on* if needed.`
                ),
                message
            );
        } else {
            const value = text.trim();
            if (!antidelete.endpoints.channels.includes(value)) {
                antidelete.endpoints.channels.push(value);
            }
            saveAntideleteState(phoneNumber, antidelete);
            antiConfigSessions.delete(phoneNumber);
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal(
                    `   ░▒▓█ *ENDPOINT_ADDED* █▓▒░\n\n` +
                    `   ✦ *TYPE* :: CHANNEL\n` +
                    `   ✦ *TARGET* :: ${value}\n\n` +
                    `   Channel added to anti-delete.\n` +
                    `   Arm it with *.antidelete on* if needed.`
                ),
                message
            );
        }
        return true;
    }

    async function handleWarnInput(context) {
        const { sock, message, phoneNumber, remoteJid, text } = context;
        const session = warnConfigSessions.get(phoneNumber);
        if (session?.step !== 'awaiting_limit' && session?.step !== 'awaiting_phrase') {
            return false;
        }

        if (isCancel(text)) {
            warnConfigSessions.delete(phoneNumber);
            await sendCancelled(sock, remoteJid, message);
            return true;
        }

        const group = session.group;
        if (!group) {
            warnConfigSessions.delete(phoneNumber);
            await safeWaReply(
                sock,
                remoteJid,
                '❌ Warn session expired. Use .warnconfig again.',
                message
            );
            return true;
        }

        if (session.step === 'awaiting_limit') {
            const maximum = parseInt(text.trim(), 10);
            if (!Number.isFinite(maximum) || maximum < 0 || maximum > 50) {
                await safeWaReply(
                    sock,
                    remoteJid,
                    '❌ Send a number 0–50. `0` = never kick. Or *.cancel*',
                    message
                );
                return true;
            }
            ensureWarnGroup(phoneNumber, group, { maxWarns: maximum });
            warnConfigSessions.set(phoneNumber, { step: 'matrix', group });
            await safeWaReply(
                sock,
                remoteJid,
                buildOmegaTerminal(
                    `   ░▒▓█ *WARN_LIMIT* █▓▒░\n\n` +
                    `   ✦ *MAX* :: ${maximum === 0 ? '∞ (never kick)' : maximum}\n\n` +
                    `   " The line is drawn. "`
                ),
                message
            );
            return true;
        }

        const phrase = text.trim();
        if (phrase.length < 2 || phrase.length > 60) {
            await safeWaReply(
                sock,
                remoteJid,
                '❌ Phrase must be 2–60 characters. Or *.cancel*',
                message
            );
            return true;
        }
        const groupConfig = ensureWarnGroup(phoneNumber, group);
        if (!groupConfig.phrases.includes(phrase)) groupConfig.phrases.push(phrase);
        const warnState = getWarnState(phoneNumber);
        warnState.groups[group] = groupConfig;
        saveWarnState(phoneNumber, warnState);
        warnConfigSessions.set(phoneNumber, { step: 'matrix', group });
        await safeWaReply(
            sock,
            remoteJid,
            buildOmegaTerminal(
                `   ░▒▓█ *PHRASE_BOUND* █▓▒░\n\n` +
                `   ✦ *PHRASE* :: ${phrase}\n` +
                `   ✦ *TOTAL* :: ${groupConfig.phrases.length}\n\n` +
                `   " That word now carries\n     a mark. "`
            ),
            message
        );
        return true;
    }

    async function handleWelcomeGoodbyeInput(context) {
        const { sock, message, phoneNumber, remoteJid, text } = context;
        const session = welcomeGoodbyeSessions.get(phoneNumber);
        if (session?.step !== 'custom_text') return false;

        const isWelcome = session.type === 'welcome';
        if (isCancel(text)) {
            welcomeGoodbyeSessions.delete(phoneNumber);
            await sendCancelled(sock, remoteJid, message);
            return true;
        }

        const config = loadBotConfig(phoneNumber);
        const settingName = isWelcome ? 'welcomeMsg' : 'goodbyeMsg';
        config[settingName] = config[settingName] || {};
        config[settingName][session.group] = text.trim();
        saveBotConfig(phoneNumber, config);
        welcomeGoodbyeSessions.delete(phoneNumber);
        await safeWaReply(
            sock,
            remoteJid,
            buildOmegaTerminal(
                `   ✦ *${isWelcome ? 'WELCOME' : 'GOODBYE'}* :: CUSTOM\n\n` +
                `   " The ${isWelcome ? 'threshold greets' : 'farewell is spoken'}\n     with your words. "`
            ),
            message
        );
        return true;
    }

    function isCancel(text) {
        const normalized = String(text).toLowerCase().trim();
        return normalized === 'cancel' || normalized === '.cancel';
    }

    async function sendCancelled(sock, remoteJid, message) {
        await safeWaReply(
            sock,
            remoteJid,
            buildOmegaTerminal('   ✦ *CANCELLED* :: no changes made.'),
            message
        );
    }

    return Object.freeze({ handleConfigInput });
}
