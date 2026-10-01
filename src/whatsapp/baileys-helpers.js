// 🔧 Baileys helpers — the WhatsApp-protocol glue layer, extracted from
// index.js unchanged: `getDisconnectCode` (normalises disconnect statusCode
// shapes), `getMessageFromStore` (Baileys' message-by-reference lookup for
// "delete for everyone" — in-memory sent polls → recent-messages cache →
// persistent msg_log across all sessions → poll_cache fallback),
// `isRecentMessage` (messageTimestamp recency window via the injected
// asNumber + recentAppendWindowSeconds), `isIgnoredRemoteJid` (status/
// broadcast ignore list — @newsletter intentionally NOT ignored),
// `getBaileysVersion` (fetchLatestBaileysVersion with a 1h in-factory cache)
// plus `resetBaileysVersionCache` (the reconnection service clears it on
// reconnect), and `resolveCommandReply` (COMMANDS lookup via the injected
// commands object).
export function createBaileysHelpers(deps) {
    for (const name of ['log', 'logError', 'getStoredSessionDirectories', 'loadMsgLog', 'loadPollCache', 'asNumber', 'fetchLatestBaileysVersion']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createBaileysHelpers: missing required dependency: ${name}`);
        }
    }
    if (typeof deps?.authDir !== 'string' || !deps.authDir) {
        throw new Error('createBaileysHelpers: missing required dependency: authDir');
    }
    if (!(deps?.sentPolls instanceof Map) || !(deps?.recentMessages instanceof Map)) {
        throw new Error('createBaileysHelpers: missing required dependency: sentPolls/recentMessages (Map)');
    }
    if (!deps?.commands || typeof deps.commands !== 'object') {
        throw new Error('createBaileysHelpers: missing required dependency: commands');
    }
    if (typeof deps?.recentAppendWindowSeconds !== 'number' || !Number.isFinite(deps.recentAppendWindowSeconds)) {
        throw new Error('createBaileysHelpers: missing required dependency: recentAppendWindowSeconds');
    }
    const { log, logError, authDir, sentPolls, recentMessages, getStoredSessionDirectories, loadMsgLog, loadPollCache, asNumber, fetchLatestBaileysVersion, commands, recentAppendWindowSeconds } = deps;

    let cachedBaileysVersion = null;
    let cachedBaileysVersionAt = 0;

    function resetBaileysVersionCache() {
        cachedBaileysVersion = null;
        cachedBaileysVersionAt = 0;
    }

    function getDisconnectCode(lastDisconnect) {
        return lastDisconnect?.error?.output?.statusCode
            ?? lastDisconnect?.error?.statusCode
            ?? lastDisconnect?.statusCode
            ?? null;
    }

    // Decrypt / Retrieve messages from memory map OR local persistent JSON.
    // Baileys calls this to fetch a message by reference (e.g. for "delete for
    // everyone" — the protocol message carries a reference and Baileys looks up
    // the original here so it can emit the delete).
    async function getMessageFromStore(key) {
        const inMemory = sentPolls.get(key.id);
        if (inMemory) return inMemory;

        // Look in the recent-messages cache first (this is how antidelete recovers content)
        const cacheKey = `__all__:${key.remoteJid || ''}:${key.id}`;
        for (const [k, v] of recentMessages) {
            if (k.endsWith(':' + key.id) && v?.message) return v.message;
        }

        // Full-history recovery: check the persistent msg_log across all sessions
        for (const number of getStoredSessionDirectories(authDir)) {
            const log = loadMsgLog(number);
            if (log[key.id]?.message) return log[key.id].message;
            if (log[key.id]?.text) return { conversation: log[key.id].text };
        }

        // Fallback: search poll_cache.json files
        const sessionDirs = getStoredSessionDirectories(authDir);
        for (const number of sessionDirs) {
            const cache = loadPollCache(number);
            const cached = cache.get(key.id);
            if (cached && cached.fullMessage) {
                return cached.fullMessage;
            }
        }
        return null;
    }

    function isRecentMessage(msg, maxAgeSeconds = recentAppendWindowSeconds) {
        const ts = asNumber(msg?.messageTimestamp);
        if (!ts) return false;
        const age = Math.abs(Date.now() / 1000 - ts);
        return age <= maxAgeSeconds;
    }

    // Check if message JID is on the ignore list
    function isIgnoredRemoteJid(remoteJid) {
        if (!remoteJid) return true;
        if (remoteJid === 'status@broadcast') return true;
        if (remoteJid.endsWith('@broadcast')) return true;
        // NOTE: @newsletter (channels) are NOT ignored here anymore — autoreact /
        // antidelete watch channels, and the command flow is skipped for them
        // later in handleWhatsAppMessage.
        return false;
    }

    async function getBaileysVersion() {
        const maxCacheAgeMs = 60 * 60 * 1000;
        const now = Date.now();
        if (cachedBaileysVersion && (now - cachedBaileysVersionAt) < maxCacheAgeMs) {
            return cachedBaileysVersion;
        }

        const { version } = await fetchLatestBaileysVersion();
        cachedBaileysVersion = version;
        cachedBaileysVersionAt = now;
        log('BAILEYS', `Using WA version ${version.join('.')}`);
        return version;
    }

    function resolveCommandReply(command, phoneNumber) {
        return commands[command] || null;
    }

    return Object.freeze({
        getDisconnectCode,
        getMessageFromStore,
        isRecentMessage,
        isIgnoredRemoteJid,
        getBaileysVersion,
        resolveCommandReply,
        resetBaileysVersionCache
    });
}
