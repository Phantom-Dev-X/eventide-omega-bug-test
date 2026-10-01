// 🧰 Basic helpers — the small shared utilities every layer of the bot leans
// on, extracted from index.js unchanged: filesystem guards (ensureDir/safeRm),
// log truncation (trimForLog), number coercion for Baileys Longs (asNumber),
// uptime formatting (formatUptime/runtimeUptime), the EVENTIDE OMEGA terminal
// wrapper (buildOmegaTerminal), target-JID/quoted-text extraction for commands
// (resolveTargetJid/extractQuotedPlainText, built on the injected
// getQuotedContext/unwrapMessageContent/jidNormalizedUser), remote media
// download (fetchBuffer), and lazy optional-native-dep loaders
// (loadSharp/loadQrcode).
//
// Conventions: Node builtins (fs/https) and createRequire are imported
// directly; logError, getQuotedContext, unwrapMessageContent and
// jidNormalizedUser are injected so the module stays unit-testable.
import fs from 'fs';
import https from 'https';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export function createBasicHelpers(deps) {
    for (const name of ['logError', 'getQuotedContext', 'unwrapMessageContent', 'jidNormalizedUser']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createBasicHelpers: missing required dependency: ${name}`);
        }
    }
    const { logError, getQuotedContext, unwrapMessageContent, jidNormalizedUser } = deps;

    function ensureDir(dirPath) {
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    }

    function safeRm(targetPath) {
        try { fs.rmSync(targetPath, { recursive: true, force: true }); }
        catch (err) { logError('FS', `Failed to remove ${targetPath}`, err); }
    }

    function trimForLog(value, max = 200) {
        const text = String(value ?? '');
        return text.length > max ? `${text.slice(0, max)}…` : text;
    }

    function asNumber(value) {
        if (typeof value === 'number') return value;
        if (typeof value === 'bigint') return Number(value);
        if (typeof value === 'string') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        }
        if (value && typeof value.toNumber === 'function') {
            try { return value.toNumber(); }
            catch { return null; }
        }
        if (value && typeof value.low === 'number') return value.low;
        return null;
    }

    function formatUptime(totalSeconds) {
        const seconds = Math.max(0, Math.floor(totalSeconds || 0));
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hrs}h ${mins}m ${secs}s`;
    }

    // No-arg uptime formatter (mirrors phantom-x) using process.uptime().
    function runtimeUptime() {
        return formatUptime(process.uptime());
    }

    // Shared terminal wrapper — exactly matches phantom-x's buildOmegaTerminal.
    function buildOmegaTerminal(body) {
        return (
            '╔════════╦════════╗\n' +
            '        ⚠ EVENTIDE OMEGA\n' +
            '               TERMINAL ACCESS                                                                         \n' +
            '╚════════╩════════╝\n\n' +
            body + '\n\n' +
            '— *EVENTIDE OMEGA* · 👁'
        );
    }

    // Fetch a remote URL as a Buffer (for .gpp / .ggpp profile picture downloads).
    // Resolve a target JID from a reply-to message, an @mention, or a raw number.
    // Returns a normalized JID or null.
    function resolveTargetJid(msg, args) {
        const ctx = getQuotedContext(msg) || msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || null;
        if (ctx?.participant) return jidNormalizedUser(ctx.participant);   // replied message
        if (Array.isArray(ctx?.mentionedJid) && ctx.mentionedJid.length) return jidNormalizedUser(ctx.mentionedJid[0]); // @mention
        for (const tok of (args || [])) {
            const digits = tok.replace(/\D/g, '');
            if (digits.length >= 7) return `${digits}@s.whatsapp.net`;
        }
        return null;
    }

    function extractQuotedPlainText(msg) {
        const ctx = getQuotedContext(msg);
        const quoted = ctx?.quotedMessage;
        if (!quoted) return '';
        const inner = unwrapMessageContent(quoted).message || quoted;
        return (
            inner.conversation ||
            inner.extendedTextMessage?.text ||
            inner.imageMessage?.caption ||
            inner.videoMessage?.caption ||
            inner.documentMessage?.caption ||
            ''
        ).trim();
    }

    function fetchBuffer(url) {
        return new Promise((resolve, reject) => {
            const req = https.get(url, (res) => {
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            });
            req.on('error', reject);
            req.setTimeout(15000, () => { req.destroy(new Error('Timeout')); });
        });
    }

    // Lazy-load optional native deps so the bot boots even if a lib fails to
    // install on the host (e.g. sharp native binary). Each returns null on failure.
    function loadSharp() { try { return require('sharp'); } catch (_) { return null; } }
    function loadQrcode() { try { return require('qrcode'); } catch (_) { return null; } }

    return Object.freeze({
        ensureDir,
        safeRm,
        trimForLog,
        asNumber,
        formatUptime,
        runtimeUptime,
        buildOmegaTerminal,
        resolveTargetJid,
        extractQuotedPlainText,
        fetchBuffer,
        loadSharp,
        loadQrcode
    });
}
