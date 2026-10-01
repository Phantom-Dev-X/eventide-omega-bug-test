import fs from 'node:fs';
import path from 'node:path';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

/**
 * Routes Baileys connection updates and coordinates connection-open side
 * effects. All application services are injected to keep this module isolated.
 */
export function createConnectionEventService(deps) {
    const {
        rootDir,
        disconnectReason,
        waSessions,
        reconnectAttempts,
        connectionClosed428s,
        webPairSessions,
        personaPollKeys,
        personaPollQuestion,
        personaPollOptions,
        personaPollIds,
        getDisconnectCode,
        setTelegramUserState,
        saveUserMap,
        safeTgSend,
        startPresenceCycle,
        isSupabaseEnabled,
        debouncedSyncLocalToSupabase,
        loadBotConfig,
        saveBotConfig,
        sendMenuPoll,
        truncateCommitName,
        cleanupDisconnectedSession,
        handleConnectionClosed428,
        restartSocketAfterClose,
        delay,
        schedule = setTimeout,
        now = Date.now,
        log,
        logError
    } = deps || {};

    if (!rootDir) throw new Error('Connection event service requires rootDir');
    for (const [name, value] of Object.entries({
        disconnectReason,
        waSessions,
        reconnectAttempts,
        connectionClosed428s,
        webPairSessions,
        personaPollKeys
    })) {
        if (!value) throw new Error(`Connection event service requires ${name}`);
    }
    for (const [name, value] of Object.entries({
        getDisconnectCode,
        setTelegramUserState,
        saveUserMap,
        safeTgSend,
        startPresenceCycle,
        isSupabaseEnabled,
        debouncedSyncLocalToSupabase,
        loadBotConfig,
        saveBotConfig,
        sendMenuPoll,
        truncateCommitName,
        cleanupDisconnectedSession,
        handleConnectionClosed428,
        restartSocketAfterClose,
        delay,
        schedule,
        now,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Connection event service requires ${name}()`);
        }
    }

    function setupSocketEvents(sock, phoneNumber, tgId, authDir, version, isRestore) {
        let pairingCodeSentForThisSocket = false;

        sock.ev.on('connection.update', async update => {
            const { connection, lastDisconnect } = update || {};
            const code = getDisconnectCode(lastDisconnect);
            const registered = !!sock?.authState?.creds?.registered;

            log(
                'CONNECTION',
                `${phoneNumber}: connection.update connection=${connection || 'unknown'} code=${code ?? 'none'} registered=${registered} restore=${isRestore}`
            );

            if (connection === 'connecting' && !isRestore && !registered && !pairingCodeSentForThisSocket) {
                pairingCodeSentForThisSocket = true;
                try {
                    if (hasTelegramId(tgId)) {
                        setTelegramUserState(tgId, {
                            phoneNumber,
                            status: 'pairing',
                            sock
                        });
                        saveUserMap();
                    }

                    await delay(2000);
                    log('PAIR', `${phoneNumber}: requesting pairing code now...`);
                    const pairingCode = await sock.requestPairingCode(phoneNumber);
                    log('PAIR', `${phoneNumber}: pairing code generated successfully: ${pairingCode}`);

                    webPairSessions.set(phoneNumber, {
                        code: pairingCode,
                        status: 'waiting',
                        createdAt: now()
                    });

                    if (hasTelegramId(tgId)) {
                        await safeTgSend(
                            tgId,
                            `🔓 *PAIRING CODE*\n\nCode: ${pairingCode}\n\n📋 *Steps:*\n1. WhatsApp → Settings → Linked Devices\n2. Tap "Link a Device"\n3. Tap "Link with phone number"\n4. Enter this code: ${pairingCode}\n\n⚠️ This code expires quickly, so use it now.`
                        );
                    }
                } catch (error) {
                    pairingCodeSentForThisSocket = false;
                    logError('PAIR', `${phoneNumber}: failed to request pairing code`, error);
                    if (hasTelegramId(tgId)) {
                        await safeTgSend(
                            tgId,
                            `❌ Failed to generate pairing code.\n\n${error.message}\n\nUse /pair to retry.`
                        );
                    }
                }
                return;
            }

            if (connection === 'open') {
                await handleConnectionOpen({ sock, phoneNumber, tgId, authDir });
                return;
            }

            if (connection === 'close') {
                await handleConnectionClose({
                    sock,
                    phoneNumber,
                    tgId,
                    authDir,
                    version,
                    isRestore,
                    code
                });
            }
        });
    }

    async function handleConnectionOpen({ sock, phoneNumber, tgId, authDir }) {
        log('CONNECTION', `${phoneNumber}: connection opened successfully.`);
        reconnectAttempts.set(phoneNumber, 0);
        waSessions.set(phoneNumber, {
            telegramChatId: tgId ?? null,
            sock,
            authDir,
            allowSupabaseSync: false
        });

        schedule(() => startPresenceCycle(sock, phoneNumber), 4000);

        if (hasTelegramId(tgId)) {
            setTelegramUserState(tgId, {
                phoneNumber,
                status: 'connected',
                sock
            });
            saveUserMap();
            await safeTgSend(
                tgId,
                `✅✅✅ *Connected!* ✅✅✅\n\n📱 ${phoneNumber}\n🤖 Bot active now.\n\nType .menu in WhatsApp.`
            );
        }

        schedule(async () => {
            const currentSession = waSessions.get(phoneNumber);
            if (currentSession) {
                currentSession.allowSupabaseSync = true;
                if (isSupabaseEnabled()) {
                    log(
                        'SUPABASE',
                        `${phoneNumber}: Connection open for 10 seconds. Triggering first cloud sync...`
                    );
                    debouncedSyncLocalToSupabase(phoneNumber, authDir, 100);
                }
            }
        }, 10000);

        schedule(() => sendFirstPairingMessages(sock, phoneNumber), 5000);
        await sendDeployNotice(sock, phoneNumber);
        await sendConnectionClosed428Notice(sock, phoneNumber);

        log(
            'READY',
            `${phoneNumber}: ⚡ SESSION READY — the bot is responding now. Type .ping in WhatsApp to confirm.`
        );
    }

    async function sendFirstPairingMessages(sock, phoneNumber) {
        try {
            const myJid = sock?.authState?.creds?.me?.id;
            if (!myJid) return;

            const config = loadBotConfig(phoneNumber);
            if (config.bootDmSent) {
                log('SELF', `${phoneNumber}: Boot DMs already sent — skipping (reconnect).`);
                return;
            }

            const selfJid = `${myJid.split(':')[0]}@s.whatsapp.net`;
            log('SELF', `${phoneNumber}: First pairing detected — sending welcome + persona poll...`);
            await sock.sendMessage(selfJid, {
                text: 'eventide omega connected — pick your persona below, then type .menu to begin'
            });

            try {
                const pollMessage = await sendMenuPoll(
                    sock,
                    selfJid,
                    phoneNumber,
                    personaPollQuestion,
                    personaPollOptions,
                    personaPollIds
                );
                if (pollMessage?.key) personaPollKeys.set(phoneNumber, pollMessage.key);
                log('SELF', `${phoneNumber}: persona poll sent (${pollMessage?.key?.id || '?'}).`);
            } catch (error) {
                logError('PERSONA', `${phoneNumber}: failed to send persona poll`, error);
            }

            config.bootDmSent = true;
            saveBotConfig(phoneNumber, config);
            log('SELF', `${phoneNumber}: Welcome + persona poll sent and flag persisted.`);
        } catch (error) {
            logError('SELF', `${phoneNumber}: failed to send boot DMs`, error);
        }
    }

    async function sendDeployNotice(sock, phoneNumber) {
        try {
            const myJid = sock?.authState?.creds?.me?.id;
            if (!myJid) return;

            const selfJid = `${myJid.split(':')[0]}@s.whatsapp.net`;
            const bootStatus = consumeBootStatus();

            if (bootStatus?.kind === 'deployed') {
                await sock.sendMessage(selfJid, {
                    text: `🔄 *PANEL RESTART — NEW COMMIT DEPLOYED*\n\n` +
                        `   "${truncateCommitName(bootStatus.name)}"\n` +
                        `   (${(bootStatus.hash || '').slice(0, 7)})\n\n` +
                        `✅ eventide omega is online\n` +
                        `⚡ ready — type *.ping* to test.\n\n` +
                        `   " the void rebuilt itself\n     and it is faster now. "`
                }).catch(() => {});
                log('DEPLOY', `${phoneNumber}: panel-restart deploy DM sent (${bootStatus.name}).`);
                return;
            }

            if (bootStatus?.kind === 'latest') {
                await sock.sendMessage(selfJid, {
                    text: `✅ *PANEL RESTART — ALREADY LATEST*\n\n` +
                        `   "${truncateCommitName(bootStatus.name)}"\n` +
                        `   (${(bootStatus.hash || '').slice(0, 7)})\n\n` +
                        `⚡ online — type *.ping* to test.`
                }).catch(() => {});
                log('DEPLOY', `${phoneNumber}: panel-restart already-latest DM sent (${bootStatus.name}).`);
                return;
            }

            const runCommit = readCurrentCommit();
            if (!runCommit) return;

            const config = loadBotConfig(phoneNumber);
            if (config.lastDeployNotifiedCommit === runCommit) return;

            config.lastDeployNotifiedCommit = runCommit;
            saveBotConfig(phoneNumber, config);
            await sock.sendMessage(selfJid, {
                text: `🔄 *DEPLOY COMPLETE*\n\n` +
                    `✅ eventide omega is online\n` +
                    `📦 commit: ${runCommit.slice(0, 7)}\n\n` +
                    `⚡ ready — type *.ping* to test.\n\n` +
                    `   " the void rebuilt itself\n     and it is faster now. "`
            }).catch(() => {});
            log('DEPLOY', `${phoneNumber}: deploy notice DM sent for commit ${runCommit}`);
        } catch (error) {
            logError('DEPLOY', `${phoneNumber}: deploy notice failed`, error);
        }
    }

    function consumeBootStatus() {
        const bootStatusPath = path.join(rootDir, 'BOOT_STATUS.txt');
        if (!fs.existsSync(bootStatusPath)) return null;
        try {
            const raw = fs.readFileSync(bootStatusPath, 'utf8').trim();
            fs.unlinkSync(bootStatusPath);
            if (!raw) return null;
            const parts = raw.split('|');
            return {
                kind: parts[0] || '',
                hash: parts[1] || '',
                name: parts.slice(2).join('|') || ''
            };
        } catch {
            return null;
        }
    }

    function readCurrentCommit() {
        try {
            const content = fs.readFileSync(path.join(rootDir, 'CURRENT_COMMIT.txt'), 'utf8').trim();
            return content ? content.split(' ')[0] : '';
        } catch {
            return '';
        }
    }

    async function sendConnectionClosed428Notice(sock, phoneNumber) {
        try {
            const state = connectionClosed428s.get(phoneNumber);
            const myJid = sock?.authState?.creds?.me?.id;
            if (!state || state.count <= 0 || !myJid) return;
            if (now() - (state.lastNotifiedAt || 0) <= THIRTY_MINUTES_MS) return;

            state.lastNotifiedAt = now();
            connectionClosed428s.set(phoneNumber, state);
            const selfJid = `${myJid.split(':')[0]}@s.whatsapp.net`;
            await sock.sendMessage(selfJid, {
                text: `⚠️ *CONNECTION NOTICE (428)*\n\n` +
                    `WhatsApp closed my connection\n` +
                    `${state.count}x recently.\n\n` +
                    `That usually means this number\n` +
                    `is linked in TWO places at once\n` +
                    `(e.g. Render + panel both on).\n\n` +
                    `If both are running, stop one —\n` +
                    `they fight each other forever.\n\n` +
                    `   " one body, one vessel. "`
            }).catch(() => {});
            log('SOCKET', `${phoneNumber}: 428 owner notice DM sent (${state.count} closes).`);
        } catch {
            // This notice must never disrupt a successful connection.
        }
    }

    async function handleConnectionClose({
        sock,
        phoneNumber,
        tgId,
        authDir,
        version,
        isRestore,
        code
    }) {
        log('CONNECTION', `${phoneNumber}: connection closed. Status code=${code ?? 'unknown'}`);

        if (code === 500) {
            await cleanupDisconnectedSession({
                phoneNumber,
                tgId,
                authDir,
                removeAuthDir: true,
                reason: 'bad session (500)',
                notifyText: `⚠️ *Session Error!*\n\n📱 ${phoneNumber}\nThis session became invalid and has been deleted. Use /pair again.`
            });
            return;
        }

        if (code === disconnectReason.loggedOut) {
            await cleanupDisconnectedSession({
                phoneNumber,
                tgId,
                authDir,
                removeAuthDir: true,
                reason: 'logged out',
                notifyText: `📱 *Logged Out!*\n\n📱 ${phoneNumber}\nThis session was logged out from WhatsApp. Credentials have been removed from Supabase. Use /pair to reconnect.`
            });
            return;
        }

        if (code === 515) {
            await restartSocketAfterClose({
                closingSock: sock,
                phoneNumber,
                tgId,
                authDir,
                version,
                isRestore,
                reason: 'Baileys requested new socket (515)',
                delayMs: 3000
            });
            return;
        }

        if (code === disconnectReason.connectionClosed) {
            await handleConnectionClosed428({
                sock,
                phoneNumber,
                tgId,
                authDir,
                isRestore
            });
            return;
        }

        await restartSocketAfterClose({
            closingSock: sock,
            phoneNumber,
            tgId,
            authDir,
            version,
            isRestore,
            reason: `connection closed (${code ?? 'unknown'})`,
            delayMs: 5000
        });
    }

    function hasTelegramId(tgId) {
        return tgId !== null && typeof tgId !== 'undefined';
    }

    return Object.freeze({ setupSocketEvents });
}
