const WA_STATUS_NAMES = Object.freeze({
    0: 'ERROR',
    1: 'PENDING',
    2: 'SERVER_ACK',
    3: 'DELIVERY_ACK',
    4: 'READ',
    5: 'PLAYED'
});

/**
 * Attaches WhatsApp message, poll, antidelete, history, and participant event
 * listeners. Message interpretation and command execution remain injected
 * boundaries so this module only coordinates event flow.
 */
export function createMessageEventService(deps) {
    const {
        verboseLogs = false,
        lastPollVotes,
        loadBotConfig,
        loadBotMode,
        handlePollUpdateMessage,
        handleMenuVote,
        handleWhatsAppMessage,
        extractRevokeRef,
        handleAntideleteRevoke,
        handlePollVote,
        normalizeJid,
        log,
        logError
    } = deps || {};

    if (!lastPollVotes) throw new Error('Message event service requires lastPollVotes');
    for (const [name, value] of Object.entries({
        loadBotConfig,
        loadBotMode,
        handlePollUpdateMessage,
        handleMenuVote,
        handleWhatsAppMessage,
        extractRevokeRef,
        handleAntideleteRevoke,
        handlePollVote,
        normalizeJid,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Message event service requires ${name}()`);
        }
    }

    function setupMessageHandler(sock, phoneNumber, tgId) {
        log('WA-HANDLER', `${phoneNumber}: attaching message handlers (tgId=${tgId ?? 'none'})`);
        log(
            'WA-HANDLER',
            `${phoneNumber}: ✅ commands now accepted — the bot will process incoming messages from here on.`
        );
        log(
            'REACT',
            `${phoneNumber}: ⚡ REACT SYSTEM ARMED — prefix="${loadBotConfig(phoneNumber)?.prefix || '.'}" mode=${loadBotMode(phoneNumber)} (VERBOSE_LOGS=${verboseLogs ? 'ON' : 'OFF'})`
        );

        sock.ev.on('messages.upsert', async event => {
            const type = event?.type || 'unknown';
            const messages = Array.isArray(event?.messages) ? event.messages : [];
            if (verboseLogs) {
                log(
                    'WA-EVENT',
                    `${phoneNumber}: messages.upsert received | type=${type} count=${messages.length}`
                );
            }

            for (const message of messages) {
                if (verboseLogs) {
                    log(
                        'WA-EVENT',
                        `${phoneNumber}: upsert msg | type=${type} id=${message?.key?.id || '?'} fromMe=${!!message?.key?.fromMe} jid=${message?.key?.remoteJid || '?'} participant=${message?.key?.participant || '-'}`
                    );
                }

                try {
                    if (message?.message?.pollUpdateMessage) {
                        log(
                            'POLL',
                            `${phoneNumber}: pollUpdateMessage upsert received for ${message.key?.id}`
                        );
                        const voteResult = handlePollUpdateMessage(sock, phoneNumber, message);
                        if (voteResult) {
                            log(
                                'POLL',
                                `${phoneNumber}: Decrypted poll vote on option ID: ${voteResult.optionId}`
                            );
                            const remoteJid = message.key?.remoteJid || message.key?.participant || null;
                            if (remoteJid) {
                                await handleMenuVote(
                                    sock,
                                    remoteJid,
                                    phoneNumber,
                                    voteResult.optionId,
                                    voteResult.pollId,
                                    voteResult.voterJid
                                );
                            }
                            continue;
                        }
                    }

                    await handleWhatsAppMessage(sock, message, phoneNumber, tgId, type);
                } catch (error) {
                    logError('WA-HANDLER', `${phoneNumber}: error while handling message`, error);
                }
            }
        });

        sock.ev.on('messages.update', async updates => {
            for (const { key, update } of (Array.isArray(updates) ? updates : [])) {
                try {
                    const referenceKey = extractRevokeRef(key, update);
                    if (!referenceKey) continue;
                    await handleAntideleteRevoke(sock, phoneNumber, key, referenceKey);
                } catch (error) {
                    logError('ANTIDELETE', `${phoneNumber}: antidelete failed`, error);
                }
            }
        });

        sock.ev.on('messages.update', async updates => {
            const count = Array.isArray(updates) ? updates.length : 0;
            log('WA-EVENT', `${phoneNumber}: messages.update received | count=${count}`);

            for (const { key, update } of (Array.isArray(updates) ? updates : [])) {
                if (update && typeof update.status === 'number') {
                    const stub = Array.isArray(update.messageStubParameters)
                        && update.messageStubParameters.length
                        ? ` code=[${update.messageStubParameters.join(', ')}]`
                        : '';
                    log(
                        'WA-EVENT',
                        `${phoneNumber}: status ${WA_STATUS_NAMES[update.status] || update.status} | id=${key?.id} jid=${key?.remoteJid || '?'}${stub}`
                    );
                }
            }

            for (const { key, update } of updates) {
                if (!update.pollUpdates) continue;

                log('POLL', `${phoneNumber}: Poll vote update received for message ${key.id}`);
                const votedOptionId = handlePollVote(
                    sock,
                    phoneNumber,
                    key,
                    update.pollUpdates
                );
                if (!votedOptionId) continue;

                const voterJid = normalizeJid(key.participant || key.remoteJid || '') || 'me';
                const voteKey = `${key.id}:${voterJid}`;
                if (lastPollVotes.get(voteKey) === votedOptionId) {
                    log('POLL', `${phoneNumber}: duplicate vote on ${votedOptionId} ignored`);
                    continue;
                }

                lastPollVotes.set(voteKey, votedOptionId);
                log('POLL', `${phoneNumber}: Decrypted vote on option ID: ${votedOptionId}`);
                const remoteJid = key.remoteJid || key.participant || null;
                if (remoteJid) {
                    await handleMenuVote(sock, remoteJid, phoneNumber, votedOptionId);
                }
            }
        });

        sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
            log(
                'WA-EVENT',
                `${phoneNumber}: messaging-history.set received | chats=${chats?.length || 0} contacts=${contacts?.length || 0} messages=${messages?.length || 0} isLatest=${!!isLatest}`
            );
        });

        sock.ev.on('group-participants.update', async update => {
            const { id, participants, action } = update || {};
            if (!id || !Array.isArray(participants)) return;
            try {
                const config = loadBotConfig(phoneNumber);
                const settingName = action === 'add'
                    ? 'welcomeMsg'
                    : action === 'remove' ? 'goodbyeMsg' : null;
                if (!settingName) return;

                const setting = (config[settingName] || {})[id];
                if (!setting || setting === 'off') return;

                for (const participant of participants) {
                    const number = participant.split('@')[0];
                    const name = number;
                    let text;
                    if (setting === 'default') {
                        text = settingName === 'welcomeMsg'
                            ? `*Welcome to the group, ${name}!* 👋\nEnjoy your stay under the eclipse.`
                            : `*Goodbye, ${name}.* The void will remember you.`;
                    } else {
                        text = setting.replace(/{{name}}/g, name);
                    }
                    await sock.sendMessage(id, { text }).catch(() => {});
                    log('WELCOME', `${phoneNumber}: ${action} message for ${number} in ${id}`);
                }
            } catch (error) {
                logError('WELCOME', `${phoneNumber}: welcome/goodbye send failed`, error);
            }
        });
    }

    return Object.freeze({ setupMessageHandler });
}
