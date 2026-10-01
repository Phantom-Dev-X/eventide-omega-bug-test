import path from 'node:path';

/**
 * Pairing/session-restoration coordinator.
 *
 * Socket construction remains behind the injected createSocketForSession
 * boundary. This keeps pairing independently testable and prevents this module
 * from importing the application entry point.
 */
export function createPairingService(deps) {
    const {
        authDirRoot,
        maxUsers,
        telegramUsers,
        webPairSessions,
        countStoredSessions,
        getStoredSessionDirectories,
        normalizeAuthDirStructure,
        findTelegramChatIdByPhone,
        setTelegramUserState,
        clearTelegramUser,
        saveUserMap,
        ensureDir,
        safeTgSend,
        createSocketForSession,
        isSupabaseEnabled,
        getAllSessionPhoneNumbers,
        downloadSessionFromSupabase,
        loadAuthState,
        log,
        logError
    } = deps || {};

    const requiredFunctions = {
        countStoredSessions,
        getStoredSessionDirectories,
        normalizeAuthDirStructure,
        findTelegramChatIdByPhone,
        setTelegramUserState,
        clearTelegramUser,
        saveUserMap,
        ensureDir,
        safeTgSend,
        createSocketForSession,
        isSupabaseEnabled,
        getAllSessionPhoneNumbers,
        downloadSessionFromSupabase,
        loadAuthState,
        log,
        logError
    };

    if (!authDirRoot) throw new Error('Pairing service requires authDirRoot');
    if (!telegramUsers || !webPairSessions) {
        throw new Error('Pairing service requires telegramUsers and webPairSessions');
    }
    for (const [name, value] of Object.entries(requiredFunctions)) {
        if (typeof value !== 'function') throw new Error(`Pairing service requires ${name}()`);
    }

    async function initiatePairing(tgId, phoneNumber) {
        log('PAIR', `Starting pairing flow for ${phoneNumber} (Telegram ${tgId})`);

        const sessionCount = countStoredSessions();
        if (sessionCount >= maxUsers) {
            await safeTgSend(tgId, `🚫 *Server Full!*\n\nMax users reached: ${maxUsers}`);
            clearTelegramUser(tgId);
            saveUserMap();
            return;
        }

        for (const [chatId, user] of telegramUsers.entries()) {
            if (chatId !== tgId && user?.phoneNumber === phoneNumber && user?.status !== 'disconnected') {
                await safeTgSend(chatId, '❌ That number is already in use on this server.');
                clearTelegramUser(tgId);
                saveUserMap();
                return;
            }
        }

        const authDir = path.join(authDirRoot, phoneNumber);
        ensureDir(authDir);
        setTelegramUserState(tgId, { phoneNumber, status: 'pairing', sock: null });
        saveUserMap();

        try {
            await createSocketForSession({ phoneNumber, tgId, authDir, isRestore: false });
            log('PAIR', `${phoneNumber}: pairing socket created successfully.`);
        } catch (error) {
            logError('PAIR', `${phoneNumber}: initiatePairing failed`, error);
            clearTelegramUser(tgId);
            saveUserMap();
            throw error;
        }
    }

    async function initiateWebPairing(phoneNumber) {
        log('WEBPAIR', `Starting web pairing flow for ${phoneNumber}`);
        try {
            const sessionCount = countStoredSessions();
            if (sessionCount >= maxUsers) {
                return { ok: false, error: `Server full. Max users reached: ${maxUsers}` };
            }

            const directories = getStoredSessionDirectories(authDirRoot);
            if (directories.includes(phoneNumber)) {
                return {
                    ok: false,
                    error: 'That number already has a session. Use /disconnect or delete it.'
                };
            }

            const authDir = path.join(authDirRoot, phoneNumber);
            ensureDir(authDir);
            webPairSessions.set(phoneNumber, {
                code: null,
                status: 'pending',
                createdAt: Date.now()
            });

            await createSocketForSession({ phoneNumber, tgId: null, authDir, isRestore: false });
            log('WEBPAIR', `${phoneNumber}: pairing socket created (web).`);
            return { ok: true };
        } catch (error) {
            logError('WEBPAIR', `${phoneNumber}: web pairing failed`, error);
            webPairSessions.delete(phoneNumber);
            return { ok: false, error: error?.message || 'Pairing failed' };
        }
    }

    async function restoreAllSessions() {
        normalizeAuthDirStructure();
        ensureDir(authDirRoot);

        let sessionDirectories = getStoredSessionDirectories(authDirRoot);

        if (isSupabaseEnabled()) {
            log('RESTORE', 'Fetching session list from Supabase for startup recovery...');
            const databaseNumbers = await getAllSessionPhoneNumbers();
            sessionDirectories = Array.from(new Set([...sessionDirectories, ...databaseNumbers]));
        }

        if (!sessionDirectories.length) {
            log('RESTORE', 'No local or database session folders found to reconnect.');
            return 0;
        }

        let restoredCount = 0;
        for (const phoneNumber of sessionDirectories) {
            const authDir = path.join(authDirRoot, phoneNumber);
            try {
                if (isSupabaseEnabled()) {
                    await downloadSessionFromSupabase(phoneNumber, authDir);
                }

                const { state } = await loadAuthState(authDir);
                if (!state?.creds?.registered) {
                    log('RESTORE', `${phoneNumber}: credentials are not registered. Skipping this folder.`);
                    continue;
                }

                const tgId = findTelegramChatIdByPhone(phoneNumber);
                await createSocketForSession({
                    phoneNumber,
                    tgId,
                    authDir,
                    isRestore: true
                });
                restoredCount += 1;
                log(
                    'RESTORE',
                    `${phoneNumber}: socket recreation queued successfully${tgId ? ` (TG ${tgId})` : ''}.`
                );
            } catch (error) {
                logError('RESTORE', `${phoneNumber}: failed to restore session`, error);
            }
        }

        return restoredCount;
    }

    return Object.freeze({
        initiatePairing,
        initiateWebPairing,
        restoreAllSessions
    });
}
