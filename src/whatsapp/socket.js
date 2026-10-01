/**
 * Constructs WhatsApp sockets and wires credential persistence.
 * Connection events and message processing remain injected boundaries so this
 * module does not depend on the application composition root.
 */
export function createSocketService(deps) {
    const {
        botRuntimeAllowed,
        isBlockedRenderService,
        currentRenderServiceId,
        telegramUsers,
        waSessions,
        makeWASocket,
        makeCacheableSignalKeyStore,
        createSilentLogger,
        useMultiFileAuthState,
        getBaileysVersion,
        getMessageFromStore,
        ensureDir,
        isSupabaseEnabled,
        downloadSessionFromSupabase,
        debouncedSyncLocalToSupabase,
        setTelegramUserState,
        saveUserMap,
        setupSocketEvents,
        setupMessageHandler,
        log,
        logError,
        verboseLogs = false
    } = deps || {};

    if (!telegramUsers || !waSessions) {
        throw new Error('Socket service requires telegramUsers and waSessions');
    }
    for (const [name, value] of Object.entries({
        makeWASocket,
        makeCacheableSignalKeyStore,
        createSilentLogger,
        useMultiFileAuthState,
        getBaileysVersion,
        getMessageFromStore,
        ensureDir,
        isSupabaseEnabled,
        downloadSessionFromSupabase,
        debouncedSyncLocalToSupabase,
        setTelegramUserState,
        saveUserMap,
        setupSocketEvents,
        setupMessageHandler,
        log,
        logError
    })) {
        if (typeof value !== 'function') throw new Error(`Socket service requires ${name}()`);
    }

    async function stopAllSessions(reason = 'unspecified') {
        log('SESSION', `Stopping all active sockets. Reason: ${reason}`);
        for (const [phoneNumber, session] of waSessions.entries()) {
            try {
                log('SESSION', `Closing socket for ${phoneNumber}`);
                await session?.sock?.end(undefined);
            } catch (error) {
                logError('SESSION', `Failed to close socket for ${phoneNumber}`, error);
            }
        }

        waSessions.clear();
        for (const [chatId, user] of telegramUsers.entries()) {
            telegramUsers.set(chatId, {
                phoneNumber: user?.phoneNumber || null,
                status: user?.phoneNumber ? 'connecting' : 'disconnected',
                sock: null
            });
        }
        saveUserMap();
    }

    async function createSocketForSession({
        phoneNumber,
        tgId,
        authDir,
        version = null,
        isRestore = false
    }) {
        if (!botRuntimeAllowed) {
            const reason = isBlockedRenderService
                ? `blocked Render service ${currentRenderServiceId}`
                : 'non-Render host';
            throw new Error(`WhatsApp socket startup is disabled on ${reason}.`);
        }
        ensureDir(authDir);

        if (isSupabaseEnabled()) {
            log('SUPABASE', `${phoneNumber}: Fetching credentials from Supabase before initialization...`);
            const restored = await downloadSessionFromSupabase(phoneNumber, authDir);
            if (restored) {
                log('SUPABASE', `${phoneNumber}: Credentials loaded from Supabase successfully.`);
            } else {
                log('SUPABASE', `${phoneNumber}: No credentials found on Supabase or failed to restore.`);
            }
        }

        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const resolvedVersion = version || await getBaileysVersion();
        const existingUser = tgId !== null && typeof tgId !== 'undefined'
            ? telegramUsers.get(tgId)
            : null;
        const nextStatus = !state?.creds?.registered && !isRestore
            ? 'pairing'
            : (existingUser?.status === 'pairing' && !isRestore ? 'pairing' : 'connecting');

        log(
            'SOCKET',
            `${phoneNumber}: creating socket (registered=${!!state?.creds?.registered}, restore=${isRestore}, tgId=${tgId ?? 'none'})`
        );

        const silentLogger = createSilentLogger();
        const sock = makeWASocket({
            version: resolvedVersion,
            logger: silentLogger,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, createSilentLogger())
            },
            browser: ['Ubuntu', 'Chrome', '120.0.0.0'],
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            keepAliveIntervalMs: 15000,
            shouldSyncHistoryMessage: () => false,
            getMessage: getMessageFromStore
        });
        sock._eventidePhone = phoneNumber;

        wrapSocketSendMessage(sock, phoneNumber);

        const wrappedSaveCreds = async () => {
            await saveCreds();
            if (isSupabaseEnabled()) {
                const session = waSessions.get(phoneNumber);
                if (session && session.allowSupabaseSync) {
                    debouncedSyncLocalToSupabase(phoneNumber, authDir);
                }
            }
        };
        sock.ev.on('creds.update', wrappedSaveCreds);

        if (isSupabaseEnabled()) {
            const originalKeysSet = state.keys.set;
            state.keys.set = async data => {
                await originalKeysSet(data);
                const session = waSessions.get(phoneNumber);
                if (session && session.allowSupabaseSync) {
                    debouncedSyncLocalToSupabase(phoneNumber, authDir);
                }
            };
        }

        waSessions.set(phoneNumber, {
            telegramChatId: tgId ?? null,
            sock,
            authDir,
            allowSupabaseSync: false
        });

        if (tgId !== null && typeof tgId !== 'undefined') {
            setTelegramUserState(tgId, {
                phoneNumber,
                status: nextStatus,
                sock
            });
            saveUserMap();
        }

        setupSocketEvents(sock, phoneNumber, tgId ?? null, authDir, resolvedVersion, isRestore);
        setupMessageHandler(sock, phoneNumber, tgId ?? null);

        return { sock, state, version: resolvedVersion };
    }

    function wrapSocketSendMessage(sock, phoneNumber) {
        const originalSendMessage = sock.sendMessage.bind(sock);
        sock.sendMessage = async (jid, content, options) => {
            if (content && typeof content === 'object' && content.react?.key) {
                const reactionKey = content.react.key;
                const reactionText = String(content.react.text || '');
                const remoteJid = typeof jid === 'string' ? jid : (reactionKey.remoteJid || '');
                log(
                    'WA-REACT',
                    `${phoneNumber}: reacting ${reactionText || '(empty)'} → ${remoteJid} (on msg ${reactionKey.id})`
                );
                try {
                    const result = await originalSendMessage(remoteJid, {
                        react: {
                            ...content.react,
                            key: reactionKey,
                            text: reactionText,
                            senderTimestampMs: content.react.senderTimestampMs || Date.now()
                        }
                    }, options || {});
                    log('WA-REACT', `${phoneNumber}: reaction sent (id=${result?.key?.id || '?'})`);
                    return result;
                } catch (error) {
                    logError('WA-REACT', `${phoneNumber}: reaction failed`, error);
                    throw error;
                }
            }

            const result = await originalSendMessage(jid, content, options);
            const remoteJid = typeof jid === 'string' ? jid : (jid?.remoteJid || '?');
            if (verboseLogs) {
                log('WA-SEND', `${phoneNumber}: sent msg | id=${result?.key?.id || '?'} jid=${remoteJid}`);
            }
            return result;
        };
    }

    return Object.freeze({
        createSocketForSession,
        stopAllSessions
    });
}
