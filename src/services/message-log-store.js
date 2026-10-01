// 📼 Message log store — the persistent message log behind antidelete
// full-history recovery, plus the shared phrase-matching helpers, extracted
// from index.js unchanged. Every non-self message that flows through the bot
// is slimmed (thumbnails/waveform/scansidecar stripped, contextInfo reduced
// to the essentials) and stored by id in msg_log.json (last 800 entries), so
// a message deleted later can always be recovered — even after a restart.
// NOT synced to Supabase (full proto + per-message rewrites were blowing
// Render RAM). Writes are debounced 8s per session via msgLogSaveTimers.
// The phrase helpers power the warn phrase-wards and the .hidetag trigger
// parser (prefix + alias aware).
//
// Conventions: fs/path are imported directly; the shared msgLogCache /
// msgLogSaveTimers Maps (src/core/state.js), logError, authDir, ensureDir and
// extractMessageText are injected.
import fs from 'fs';
import path from 'path';

export function createMessageLogStore(deps) {
    for (const name of ['logError', 'ensureDir', 'extractMessageText']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createMessageLogStore: missing required dependency: ${name}`);
        }
    }
    if (typeof deps?.authDir !== 'string' || !deps.authDir) {
        throw new Error('createMessageLogStore: missing required dependency: authDir');
    }
    if (!(deps?.msgLogCache instanceof Map) || !(deps?.msgLogSaveTimers instanceof Map)) {
        throw new Error('createMessageLogStore: missing required dependency: msgLogCache/msgLogSaveTimers (Map)');
    }
    const { msgLogCache, msgLogSaveTimers, logError, authDir, ensureDir, extractMessageText } = deps;

    // ──────────────────────────────────────────────
    // 📼 PERSISTENT MESSAGE LOG (for antidelete full-history recovery)
    // Stores every message (by id) that flows through the bot after pairing, so a
    // message deleted later can always be recovered — even after a bot restart.
    // Stored per-session in msg_log.json. NOT synced to Supabase (it was blowing
    // Render RAM — full proto + 5k entries + rewrite-on-every-msg).
    // ──────────────────────────────────────────────
    const MSG_LOG_LIMIT = 800;

    function slimProto(message) {
        if (!message || typeof message !== 'object') return message || null;
        const out = {};
        for (const [k, v] of Object.entries(message)) {
            if (!v || typeof v !== 'object' || Array.isArray(v)) { out[k] = v; continue; }
            const cloned = { ...v };
            delete cloned.jpegThumbnail;
            delete cloned.thumbnailDirectPath;
            delete cloned.thumbnailSha256;
            delete cloned.scansSidecar;
            delete cloned.midQualityFileSha256;
            delete cloned.waveform;
            if (cloned.contextInfo) {
                cloned.contextInfo = {
                    stanzaId: cloned.contextInfo.stanzaId,
                    participant: cloned.contextInfo.participant,
                    mentionedJid: cloned.contextInfo.mentionedJid,
                    isForwarded: cloned.contextInfo.isForwarded
                };
            }
            out[k] = cloned;
        }
        return out;
    }

    function loadMsgLog(phoneNumber) {
        if (msgLogCache.has(phoneNumber)) return msgLogCache.get(phoneNumber);
        const filePath = path.join(authDir, phoneNumber, 'msg_log.json');
        let data = {};
        try {
            if (fs.existsSync(filePath)) {
                const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                data = parsed && typeof parsed === 'object' ? parsed : {};
            }
        } catch (err) { logError('MSGLOG', `${phoneNumber}: failed to load msg_log.json`, err); }
        msgLogCache.set(phoneNumber, data);
        return data;
    }

    function flushMsgLog(phoneNumber) {
        const log = msgLogCache.get(phoneNumber);
        if (!log) return;
        const filePath = path.join(authDir, phoneNumber, 'msg_log.json');
        try {
            ensureDir(path.dirname(filePath));
            fs.writeFileSync(filePath, JSON.stringify(log), 'utf8');
        } catch (err) { logError('MSGLOG', `${phoneNumber}: failed to save msg_log.json`, err); }
    }

    function scheduleMsgLogSave(phoneNumber) {
        if (msgLogSaveTimers.has(phoneNumber)) return;
        const timer = setTimeout(() => {
            msgLogSaveTimers.delete(phoneNumber);
            flushMsgLog(phoneNumber);
        }, 8000);
        msgLogSaveTimers.set(phoneNumber, timer);
    }

    function logMessage(phoneNumber, remoteJid, msg) {
        try {
            const id = msg?.key?.id;
            if (!id || msg?.key?.fromMe) return;
            const log = loadMsgLog(phoneNumber);
            const keys = Object.keys(log);
            if (keys.length >= MSG_LOG_LIMIT) delete log[keys[0]];
            const parsed = extractMessageText(msg);
            log[id] = {
                remoteJid,
                participant: msg?.key?.participant || null,
                text: parsed?.text || '',
                type: parsed?.leafType || 'unknown',
                message: slimProto(msg?.message),
                ts: msg?.messageTimestamp ? Number(msg.messageTimestamp) : Date.now() / 1000
            };
            scheduleMsgLogSave(phoneNumber);
        } catch (err) { logError('MSGLOG', `${phoneNumber}: logMessage failed`, err); }
    }

    function escapeRegExp(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function textHasPhrase(text, phrase) {
        const p = String(phrase || '').trim();
        if (!p || !text) return false;
        if (p.length <= 3) {
            try { return new RegExp(`(^|[^a-z0-9])${escapeRegExp(p)}([^a-z0-9]|$)`, 'i').test(text); }
            catch { return String(text).toLowerCase().includes(p.toLowerCase()); }
        }
        return String(text).toLowerCase().includes(p.toLowerCase());
    }

    function findMatchingPhrase(text, phrases) {
        for (const p of (phrases || [])) {
            if (textHasPhrase(text, p)) return p;
        }
        return null;
    }

    function findHidetagTrigger(normalized, prefix, aliases) {
        const pfx = prefix || '.';
        const triggers = new Set(['.hidetag', '.ht', `${pfx}hidetag`, `${pfx}ht`]);
        for (const [k, v] of Object.entries(aliases || {})) {
            if (v === '.hidetag' || v === '.ht') {
                triggers.add('.' + k);
                triggers.add(pfx + k);
            }
        }
        const parts = String(normalized || '').split(/\s+/).filter(Boolean);
        const idx = parts.findIndex(part => triggers.has(part.toLowerCase()));
        if (idx < 0) return null;
        return { body: [...parts.slice(0, idx), ...parts.slice(idx + 1)].join(' ').trim() };
    }

    return Object.freeze({
        slimProto,
        loadMsgLog,
        flushMsgLog,
        scheduleMsgLogSave,
        logMessage,
        escapeRegExp,
        textHasPhrase,
        findMatchingPhrase,
        findHidetagTrigger
    });
}
