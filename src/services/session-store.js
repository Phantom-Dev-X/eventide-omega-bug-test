import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistent session-directory and Telegram-user mapping service.
 */
export function createSessionStore(deps) {
    const {
        authDir,
        userMapFile,
        telegramUsers,
        ensureDir,
        safeRm,
        isSupabaseEnabled,
        saveUserToSupabase,
        deleteUserFromSupabase,
        loadAllUsersFromSupabase,
        log,
        logError
    } = deps || {};

    if (!authDir || !userMapFile) throw new Error('Session store requires authDir and userMapFile');
    if (!telegramUsers) throw new Error('Session store requires telegramUsers');
    for (const [name, value] of Object.entries({
        ensureDir,
        safeRm,
        isSupabaseEnabled,
        saveUserToSupabase,
        deleteUserFromSupabase,
        loadAllUsersFromSupabase,
        log,
        logError
    })) {
        if (typeof value !== 'function') throw new Error(`Session store requires ${name}()`);
    }

    function getStoredSessionDirectories(directory = authDir) {
        if (!fs.existsSync(directory)) return [];
        return fs.readdirSync(directory).filter(name => {
            const fullPath = path.join(directory, name);
            try {
                return fs.statSync(fullPath).isDirectory();
            } catch {
                return false;
            }
        });
    }

    function countStoredSessions() {
        return getStoredSessionDirectories(authDir).length;
    }

    function normalizeAuthDirStructure() {
        ensureDir(authDir);
        const nestedSessionsDir = path.join(authDir, 'sessions');
        if (!fs.existsSync(nestedSessionsDir)) return;

        let nestedDirectories = [];
        try {
            nestedDirectories = getStoredSessionDirectories(nestedSessionsDir);
        } catch {
            nestedDirectories = [];
        }

        const rootDirectories = getStoredSessionDirectories(authDir);
        if (!nestedDirectories.length) return;
        if (!(rootDirectories.length === 1 && rootDirectories[0] === 'sessions')) return;

        log('STARTUP', 'Detected nested sessions/sessions structure from old restore. Flattening it now...');
        for (const item of fs.readdirSync(nestedSessionsDir)) {
            const from = path.join(nestedSessionsDir, item);
            const to = path.join(authDir, item);
            safeRm(to);
            fs.renameSync(from, to);
        }
        safeRm(nestedSessionsDir);
        log('STARTUP', 'Nested sessions directory fixed successfully.');
    }

    function findTelegramChatIdByPhone(phoneNumber) {
        for (const [chatId, user] of telegramUsers.entries()) {
            if (user?.phoneNumber === phoneNumber) return chatId;
        }
        return null;
    }

    function setTelegramUserState(chatId, {
        phoneNumber = null,
        status = 'disconnected',
        sock = null
    }) {
        if (chatId === null || typeof chatId === 'undefined') return;
        telegramUsers.set(chatId, { phoneNumber, status, sock });
        if (isSupabaseEnabled()) {
            saveUserToSupabase(chatId, phoneNumber, status);
        }
    }

    function clearTelegramUser(chatId) {
        if (chatId === null || typeof chatId === 'undefined') return;
        telegramUsers.set(chatId, {
            phoneNumber: null,
            status: 'disconnected',
            sock: null
        });
        if (isSupabaseEnabled()) {
            deleteUserFromSupabase(chatId);
        }
    }

    function saveUserMap() {
        const serialized = {};
        for (const [chatId, user] of telegramUsers.entries()) {
            if (user?.phoneNumber) {
                serialized[String(chatId)] = {
                    phoneNumber: user.phoneNumber,
                    status: user.status || 'disconnected'
                };
            }
        }

        try {
            fs.writeFileSync(userMapFile, JSON.stringify(serialized, null, 2));
            log('STATE', `Saved user map with ${Object.keys(serialized).length} user(s)`);
        } catch (error) {
            logError('STATE', 'Failed to save user map', error);
        }
    }

    async function loadUserMap({ clearExisting = false } = {}) {
        if (clearExisting) telegramUsers.clear();

        if (isSupabaseEnabled()) {
            const databaseMap = await loadAllUsersFromSupabase();
            if (databaseMap) {
                hydrateTelegramUsers(databaseMap);
                log('STATE', `Loaded ${telegramUsers.size} user(s) from Supabase.`);
                return;
            }
        }

        if (!fs.existsSync(userMapFile)) {
            log('STATE', 'user_map.json not found. Continuing without stored Telegram user map.');
            return;
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(userMapFile, 'utf8'));
            hydrateTelegramUsers(parsed);
            log('STATE', `Loaded ${telegramUsers.size} user(s) from user_map.json`);
        } catch (error) {
            logError('STATE', 'Failed to load user map', error);
        }
    }

    function hydrateTelegramUsers(serialized) {
        for (const [chatIdText, data] of Object.entries(serialized || {})) {
            const chatId = Number(chatIdText);
            if (!Number.isFinite(chatId)) continue;
            telegramUsers.set(chatId, {
                phoneNumber: data?.phoneNumber || null,
                status: data?.status || 'disconnected',
                sock: null
            });
        }
    }

    return Object.freeze({
        getStoredSessionDirectories,
        countStoredSessions,
        normalizeAuthDirStructure,
        findTelegramChatIdByPhone,
        setTelegramUserState,
        clearTelegramUser,
        saveUserMap,
        loadUserMap
    });
}
