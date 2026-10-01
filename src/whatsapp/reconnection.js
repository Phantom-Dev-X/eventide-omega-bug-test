const TEN_MINUTES_MS = 10 * 60 * 1000;
const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Owns cleanup and reconnect policy for closed WhatsApp sockets.
 * Socket construction is injected to keep this module independent from the
 * application composition root and avoid circular imports.
 */
export function createReconnectionService(deps) {
    const {
        waSessions,
        reconnectAttempts,
        connectionClosed428s,
        safeRm,
        isSupabaseEnabled,
        deleteSessionFromSupabase,
        clearTelegramUser,
        setTelegramUserState,
        saveUserMap,
        safeTgSend,
        createSocketForSession,
        resetBaileysVersionCache,
        getBaileysVersion,
        delay,
        getClose428BaseDelayMs,
        getClose428StormBackoffMs,
        now = Date.now,
        random = Math.random,
        log,
        logError
    } = deps || {};

    if (!waSessions || !reconnectAttempts || !connectionClosed428s) {
        throw new Error('Reconnection service requires session and reconnect state maps');
    }
    for (const [name, value] of Object.entries({
        safeRm,
        isSupabaseEnabled,
        deleteSessionFromSupabase,
        clearTelegramUser,
        setTelegramUserState,
        saveUserMap,
        safeTgSend,
        createSocketForSession,
        resetBaileysVersionCache,
        getBaileysVersion,
        delay,
        getClose428BaseDelayMs,
        getClose428StormBackoffMs,
        now,
        random,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Reconnection service requires ${name}()`);
        }
    }

    async function cleanupDisconnectedSession({
        phoneNumber,
        tgId,
        authDir,
        notifyText = null,
        removeAuthDir = false,
        reason = 'unspecified'
    }) {
        log('SESSION', `${phoneNumber}: cleaning up session. Reason: ${reason}`);
        waSessions.delete(phoneNumber);

        if (removeAuthDir) {
            safeRm(authDir);
            if (isSupabaseEnabled()) {
                await deleteSessionFromSupabase(phoneNumber);
            }
        }

        if (tgId !== null && typeof tgId !== 'undefined') {
            clearTelegramUser(tgId);
            saveUserMap();
            if (notifyText) await safeTgSend(tgId, notifyText);
        }
    }

    async function handleConnectionClosed428({
        sock,
        phoneNumber,
        tgId,
        authDir,
        isRestore
    }) {
        const liveSession = waSessions.get(phoneNumber);
        if (liveSession?.sock && liveSession.sock !== sock) {
            log('SOCKET', `${phoneNumber}: stale 428 close ignored.`);
            return;
        }
        waSessions.delete(phoneNumber);

        const timestamp = now();
        let state = connectionClosed428s.get(phoneNumber);
        if (!state || timestamp - state.windowStart > TEN_MINUTES_MS) {
            state = { count: 0, windowStart: timestamp, lastNotifiedAt: 0 };
        }
        state.count += 1;
        connectionClosed428s.set(phoneNumber, state);

        const storming = state.count > 3;
        const baseDelay = getClose428BaseDelayMs();
        const stormBackoff = getClose428StormBackoffMs();
        const delayMs = storming
            ? stormBackoff
            : baseDelay + Math.floor(random() * baseDelay);
        log(
            'SOCKET',
            `${phoneNumber}: 428 connectionClosed (#${state.count}). Credentials are fine — session is NOT deleted. ${storming ? 'STORM — backing off (same number running in two places?).' : 'Reconnecting with a fresh WA version...'}`
        );

        resetBaileysVersionCache();
        let freshVersion = null;
        try {
            freshVersion = await getBaileysVersion();
        } catch {
            // The socket factory can resolve a version itself if refresh fails.
        }

        if (tgId !== null && typeof tgId !== 'undefined') {
            setTelegramUserState(tgId, {
                phoneNumber,
                status: 'connecting',
                sock: null
            });
            saveUserMap();
        }

        await delay(delayMs);

        try {
            await createSocketForSession({
                phoneNumber,
                tgId,
                authDir,
                version: freshVersion,
                isRestore
            });
            log('SOCKET', `${phoneNumber}: socket rebuilt after 428 with fresh WA version.`);
        } catch (error) {
            logError('SOCKET', `${phoneNumber}: failed to rebuild socket after 428`, error);
        }
    }

    async function restartSocketAfterClose({
        closingSock,
        phoneNumber,
        tgId,
        authDir,
        version,
        isRestore,
        reason,
        delayMs = 5000
    }) {
        const liveSession = waSessions.get(phoneNumber);
        if (liveSession?.sock && liveSession.sock !== closingSock) {
            log('SOCKET', `${phoneNumber}: stale socket close ignored. Reason: ${reason}`);
            return;
        }

        waSessions.delete(phoneNumber);

        const attempts = (reconnectAttempts.get(phoneNumber) || 0) + 1;
        reconnectAttempts.set(phoneNumber, attempts);
        log(
            'SOCKET',
            `${phoneNumber}: Connection closed (Attempt ${attempts}/${MAX_RECONNECT_ATTEMPTS}). Reason: ${reason}`
        );

        if (attempts > MAX_RECONNECT_ATTEMPTS) {
            log(
                'SOCKET',
                `${phoneNumber}: Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded. Cleaning up session.`
            );
            reconnectAttempts.delete(phoneNumber);
            await cleanupDisconnectedSession({
                phoneNumber,
                tgId,
                authDir,
                removeAuthDir: true,
                reason: 'Max reconnect attempts exceeded (3)',
                notifyText: `⚠️ *Connection Lost Permanently!*\n\n📱 ${phoneNumber}\nWe failed to reconnect after 3 attempts. This login session has been flagged as stale and deleted from Supabase.\n\nPlease link your WhatsApp again using /pair.`
            });
            return;
        }

        if (tgId !== null && typeof tgId !== 'undefined') {
            setTelegramUserState(tgId, {
                phoneNumber,
                status: 'connecting',
                sock: null
            });
            saveUserMap();
        }

        log('SOCKET', `${phoneNumber}: rebuilding socket in ${delayMs}ms. Reason: ${reason}`);
        await delay(delayMs);

        try {
            await createSocketForSession({
                phoneNumber,
                tgId,
                authDir,
                version,
                isRestore
            });
            log('SOCKET', `${phoneNumber}: socket rebuilt successfully after close.`);
        } catch (error) {
            logError('SOCKET', `${phoneNumber}: failed to rebuild socket`, error);
        }
    }

    return Object.freeze({
        cleanupDisconnectedSession,
        handleConnectionClosed428,
        restartSocketAfterClose
    });
}
