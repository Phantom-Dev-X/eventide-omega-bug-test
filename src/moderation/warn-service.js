import fs from 'fs';
import path from 'path';

/**
 * Per-group warning system: threshold/action configuration (persisted inside
 * the shared bot_config.json via `warn`), the append-only per-user strike
 * ledger (warn_log.json), and `applyWarn` — the side-effecting strike +
 * optional auto-delete + optional kick flow invoked both by the manual
 * `.warn` command and by the phrase-ward auto-moderation path.
 *
 * `normalizeWarnConfig` stays in index.js because `loadBotConfig` (core
 * config infra, not warn-exclusive) calls it directly when hydrating the
 * shared per-session config object; it is injected here instead of
 * duplicated so there is a single source of truth for the shape.
 */
export function createWarnService(deps) {
    const {
        authDirRoot,
        loadBotConfig,
        saveBotConfig,
        normalizeWarnConfig,
        ensureDir,
        jidNormalizedUser,
        buildOmegaTerminal,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        loadBotConfig, saveBotConfig, normalizeWarnConfig, ensureDir,
        jidNormalizedUser, buildOmegaTerminal, log, logError
    })) {
        if (typeof value !== 'function') throw new Error(`Warn service requires ${name}()`);
    }
    if (typeof authDirRoot !== 'string' || !authDirRoot) {
        throw new Error('Warn service requires authDirRoot');
    }

    function getWarnState(phoneNumber) {
        return normalizeWarnConfig(loadBotConfig(phoneNumber));
    }

    function saveWarnState(phoneNumber, warn) {
        const cfg = loadBotConfig(phoneNumber);
        cfg.warn = normalizeWarnConfig({ warn });
        saveBotConfig(phoneNumber, cfg);
    }

    function ensureWarnGroup(phoneNumber, groupJid, extra = {}) {
        const warn = getWarnState(phoneNumber);
        warn.groups[groupJid] = {
            enabled: true,
            maxWarns: 3,
            action: 'kick',
            phrases: [],
            deleteOffending: true,
            ...(warn.groups[groupJid] || {}),
            ...extra
        };
        saveWarnState(phoneNumber, warn);
        return warn.groups[groupJid];
    }

    function loadWarnLog(phoneNumber) {
        const filePath = path.join(authDirRoot, phoneNumber, 'warn_log.json');
        try {
            if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
        } catch (err) { logError('WARN', `${phoneNumber}: failed to load warn_log.json`, err); }
        return {};
    }

    function saveWarnLog(phoneNumber, data) {
        const filePath = path.join(authDirRoot, phoneNumber, 'warn_log.json');
        try {
            ensureDir(path.dirname(filePath));
            fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
        } catch (err) { logError('WARN', `${phoneNumber}: failed to save warn_log.json`, err); }
    }

    function getUserWarns(phoneNumber, groupJid, userJid) {
        const log = loadWarnLog(phoneNumber);
        const rec = log?.[groupJid]?.[userJid];
        return rec && typeof rec === 'object' ? rec : { count: 0, history: [] };
    }

    function setUserWarns(phoneNumber, groupJid, userJid, rec) {
        const log = loadWarnLog(phoneNumber);
        if (!log[groupJid]) log[groupJid] = {};
        if (!rec || rec.count <= 0) delete log[groupJid][userJid];
        else {
            rec.history = Array.isArray(rec.history) ? rec.history.slice(-12) : [];
            log[groupJid][userJid] = rec;
        }
        saveWarnLog(phoneNumber, log);
    }

    function listGroupWarns(phoneNumber, groupJid) {
        const log = loadWarnLog(phoneNumber);
        const bucket = log?.[groupJid] || {};
        return Object.entries(bucket)
            .filter(([, v]) => v && v.count > 0)
            .sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
    }

    async function applyWarn(sock, phoneNumber, { groupJid, targetJid, byJid, reason, auto, originalMsg }) {
        const target = jidNormalizedUser(targetJid);
        if (!target || !groupJid?.endsWith('@g.us')) return;
        const gcfg = getWarnState(phoneNumber).groups[groupJid] || { enabled: true, maxWarns: 3, action: 'kick', phrases: [], deleteOffending: true };
        const rec = getUserWarns(phoneNumber, groupJid, target);
        rec.count = (rec.count || 0) + 1;
        rec.history = rec.history || [];
        rec.history.push({
            reason: String(reason || (auto ? 'auto-phrase' : 'manual')).slice(0, 120),
            by: byJid || 'system',
            at: Date.now(),
            auto: !!auto
        });
        setUserWarns(phoneNumber, groupJid, target, rec);

        const max = Number.isFinite(Number(gcfg.maxWarns)) ? Number(gcfg.maxWarns) : 3;
        const action = gcfg.action === 'none' ? 'none' : 'kick';
        const willKick = action === 'kick' && max > 0 && rec.count >= max;
        const num = target.split('@')[0];
        const byNum = String(byJid || '').split('@')[0].replace(/\D/g, '') || 'system';
        const limitLabel = max > 0 ? `${rec.count}/${max}` : `${rec.count}/∞`;

        if (auto && gcfg.deleteOffending && originalMsg?.key?.id) {
            await sock.sendMessage(groupJid, {
                delete: { remoteJid: groupJid, id: originalMsg.key.id, participant: originalMsg.key.participant || target }
            }).catch(() => {});
        }

        await sock.sendMessage(groupJid, {
            text: buildOmegaTerminal(
                `   ░▒▓█ *WARN_MARK* █▓▒░\n\n` +
                `   ✦ *TARGET* :: @${num}\n` +
                `   ✦ *STRIKES* :: ${limitLabel}\n` +
                `   ✦ *REASON* :: ${reason || (auto ? 'forbidden phrase' : 'manual')}\n` +
                `   ✦ *BY* :: ${auto ? 'AUTO_WARD' : '+' + byNum}\n` +
                `   ✦ *NEXT* :: ${willKick ? 'KICK' : (action === 'none' ? 'WARN_ONLY' : (max > 0 ? `${Math.max(0, max - rec.count)} LEFT` : 'NO_LIMIT'))}\n\n` +
                (willKick
                    ? `   " The limit is reached.\n     The vessel is cast out. "`
                    : `   " Another mark on the record.\n     Walk carefully. "`)
            ),
            mentions: [target]
        }).catch(() => {});

        if (willKick) {
            try {
                await sock.groupParticipantsUpdate(groupJid, [target], 'remove');
                setUserWarns(phoneNumber, groupJid, target, { count: 0, history: [] });
                await sock.sendMessage(groupJid, {
                    text: buildOmegaTerminal(
                        `   ░▒▓█ *WARN_LIMIT* █▓▒░\n\n` +
                        `   ✦ *TARGET* :: @${num}\n` +
                        `   ✦ *ACTION* :: KICKED\n` +
                        `   ✦ *STRIKES* :: ${limitLabel}\n\n` +
                        `   " Three shadows too many. "`
                    ),
                    mentions: [target]
                }).catch(() => {});
            } catch (err) {
                await sock.sendMessage(groupJid, { text: `⚠️ Warn limit reached but I could not kick @${num}. Make me admin.\n${err?.message || err}`, mentions: [target] }).catch(() => {});
            }
        }
        log('WARN', `${phoneNumber}: warned ${target} in ${groupJid} (${limitLabel}) reason=${reason}`);
    }

    return Object.freeze({
        getWarnState,
        saveWarnState,
        ensureWarnGroup,
        loadWarnLog,
        saveWarnLog,
        getUserWarns,
        setUserWarns,
        listGroupWarns,
        applyWarn
    });
}
