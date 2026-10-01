// ⚙️ Session config store — the per-session persistent settings layer,
// extracted from index.js unchanged: the poll-vote cache (poll_cache.json,
// Map in / JSON out), the bot mode flag (bot_mode.txt, default public), and
// the merged bot config (bot_config.json — defaults from DEFAULT_BOT_CONFIG
// deep-merged with the stored file, with antidelete/warn normalized through
// the same normalizeAntideleteConfig/normalizeWarnConfig the antidelete and
// warn services consume). Every write also triggers a debounced Supabase sync
// of the session folder when Supabase is enabled.
//
// Conventions: fs/path and DEFAULT_BOT_CONFIG (./defaults.js) are imported
// directly; logError, authDir, ensureDir, isSupabaseEnabled and
// debouncedSyncLocalToSupabase are injected.
import fs from 'fs';
import path from 'path';
import { DEFAULT_BOT_CONFIG } from './defaults.js';

export function createSessionConfigStore(deps) {
    for (const name of ['logError', 'ensureDir', 'isSupabaseEnabled', 'debouncedSyncLocalToSupabase']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createSessionConfigStore: missing required dependency: ${name}`);
        }
    }
    if (typeof deps?.authDir !== 'string' || !deps.authDir) {
        throw new Error('createSessionConfigStore: missing required dependency: authDir');
    }
    const { logError, authDir, ensureDir, isSupabaseEnabled, debouncedSyncLocalToSupabase } = deps;

    // ──────────────────────────────────────────────
    // 📂 LOCAL PERSISTENT BOT CONFIG HELPERS
    // ──────────────────────────────────────────────
    function loadPollCache(phoneNumber) {
        const filePath = path.join(authDir, phoneNumber, 'poll_cache.json');
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                return new Map(Object.entries(JSON.parse(raw)));
            } catch (err) {
                logError('CACHE', `${phoneNumber}: Failed to load poll_cache.json`, err);
            }
        }
        return new Map();
    }

    function savePollCache(phoneNumber, cacheMap) {
        const filePath = path.join(authDir, phoneNumber, 'poll_cache.json');
        try {
            const obj = Object.fromEntries(cacheMap.entries());
            fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
            if (isSupabaseEnabled()) {
                const sessionDir = path.join(authDir, phoneNumber);
                debouncedSyncLocalToSupabase(phoneNumber, sessionDir);
            }
        } catch (err) {
            logError('CACHE', `${phoneNumber}: Failed to save poll_cache.json`, err);
        }
    }

    function loadBotMode(phoneNumber) {
        const filePath = path.join(authDir, phoneNumber, 'bot_mode.txt');
        if (fs.existsSync(filePath)) {
            try {
                return fs.readFileSync(filePath, 'utf8').trim();
            } catch (err) {
                logError('MODE', `${phoneNumber}: Failed to read bot_mode.txt`, err);
            }
        }
        return 'public'; // Default mode is public
    }

    function saveBotMode(phoneNumber, mode) {
        const filePath = path.join(authDir, phoneNumber, 'bot_mode.txt');
        try {
            fs.writeFileSync(filePath, mode, 'utf8');
            if (isSupabaseEnabled()) {
                const sessionDir = path.join(authDir, phoneNumber);
                debouncedSyncLocalToSupabase(phoneNumber, sessionDir);
            }
        } catch (err) {
            logError('MODE', `${phoneNumber}: Failed to save bot_mode.txt`, err);
        }
    }

    // ──────────────────────────────────────────────
    // ⚙️ BOT CONFIG STORE (persistent, synced to Supabase)
    // Per-phone config: prefix, aliases, identity, toggles. Stored as JSON in the
    // session folder so it survives redeploys (the folder is synced to Supabase).
    // ──────────────────────────────────────────────


    // Normalize antidelete to the same shape as autoreact. Also migrates the old
    // per-group { [jid]: 'on'/'off' } map (and legacy anti.antidelete) into endpoints.
    function normalizeAntideleteConfig(parsed) {
        const empty = { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } };
        const raw = parsed?.antidelete;
        if (raw && typeof raw === 'object' && (raw.endpoints || typeof raw.enabled === 'boolean')) {
            return {
                enabled: !!raw.enabled,
                endpoints: {
                    groups: Array.isArray(raw.endpoints?.groups) ? [...raw.endpoints.groups] : [],
                    channels: Array.isArray(raw.endpoints?.channels) ? [...raw.endpoints.channels] : [],
                    contacts: Array.isArray(raw.endpoints?.contacts) ? [...raw.endpoints.contacts] : []
                }
            };
        }
        const legacy = (raw && typeof raw === 'object' ? raw : null) || parsed?.anti?.antidelete || {};
        const groups = Object.entries(legacy)
            .filter(([k, v]) => v === 'on' && typeof k === 'string' && k.includes('@'))
            .map(([k]) => k);
        return { enabled: groups.length > 0, endpoints: { groups, channels: [], contacts: [] } };
    }

    function normalizeWarnConfig(parsed) {
        const groups = {};
        const rawGroups = parsed?.warn?.groups;
        if (rawGroups && typeof rawGroups === 'object') {
            for (const [jid, g] of Object.entries(rawGroups)) {
                if (!jid || !g || typeof g !== 'object') continue;
                const max = parseInt(g.maxWarns, 10);
                groups[jid] = {
                    enabled: !!g.enabled,
                    maxWarns: Number.isFinite(max) ? Math.max(0, max) : 3,
                    action: g.action === 'none' ? 'none' : 'kick',
                    phrases: Array.isArray(g.phrases) ? g.phrases.map(s => String(s).trim()).filter(Boolean) : [],
                    deleteOffending: g.deleteOffending !== false
                };
            }
        }
        return { groups };
    }

    function loadBotConfig(phoneNumber) {
        const filePath = path.join(authDir, phoneNumber, 'bot_config.json');
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(raw);
                return {
                    ...structuredClone(DEFAULT_BOT_CONFIG),
                    ...(parsed || {}),
                    aliases: { ...(parsed?.aliases || {}) },
                    autoreact: { ...DEFAULT_BOT_CONFIG.autoreact, ...(parsed?.autoreact || {}), endpoints: { ...DEFAULT_BOT_CONFIG.autoreact.endpoints, ...(parsed?.autoreact?.endpoints || {}) } },
                    antidelete: normalizeAntideleteConfig(parsed),
                    warn: normalizeWarnConfig(parsed)
                };
            }
        } catch (err) {
            logError('CONFIG', `${phoneNumber}: Failed to load bot_config.json`, err);
        }
        return structuredClone(DEFAULT_BOT_CONFIG);
    }

    function saveBotConfig(phoneNumber, config) {
        const filePath = path.join(authDir, phoneNumber, 'bot_config.json');
        try {
            ensureDir(path.dirname(filePath));
            fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
            if (isSupabaseEnabled()) {
                const sessionDir = path.join(authDir, phoneNumber);
                debouncedSyncLocalToSupabase(phoneNumber, sessionDir);
            }
        } catch (err) {
            logError('CONFIG', `${phoneNumber}: Failed to save bot_config.json`, err);
        }
    }

    return Object.freeze({
        loadPollCache,
        savePollCache,
        loadBotMode,
        saveBotMode,
        normalizeAntideleteConfig,
        normalizeWarnConfig,
        loadBotConfig,
        saveBotConfig
    });
}
