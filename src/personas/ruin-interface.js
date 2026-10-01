import fs from 'fs';
import path from 'path';

/**
 * Ruin persona rendering engine — "clean minimal interface" menus.
 *
 * .menu -> status panel + poll (ALL MENU / SYSTEM / CONFIG / GROUP / FUN).
 * Every poll vote renders its own framed view in one message. Lines stay
 * short so nothing rolls over on the phone.
 *
 * This module owns only rendering and the top-level status-panel + poll send
 * (`sendRuinMenu`). The poll-vote dispatcher that routes `rm_all`/`rm_system`/
 * etc. to these builders stays in index.js — it is a shared, multi-persona
 * dispatcher and out of scope for this extraction.
 */
export function createRuinInterface(deps) {
    const {
        authDirRoot,
        loadBotConfig,
        loadBotMode,
        isSupabaseEnabled,
        flashPresenceOnline,
        delay,
        sendMenuPoll,
        log
    } = deps || {};

    for (const [name, value] of Object.entries({
        loadBotConfig,
        loadBotMode,
        isSupabaseEnabled,
        flashPresenceOnline,
        delay,
        sendMenuPoll,
        log
    })) {
        if (typeof value !== 'function') throw new Error(`Ruin interface requires ${name}()`);
    }
    if (typeof authDirRoot !== 'string' || !authDirRoot) {
        throw new Error('Ruin interface requires authDirRoot');
    }

    // Command index shown by the Ruin persona (categorized, wrapped, prefix-aware).
    const RUIN_MENU_CATEGORIES = [
        {
            label: '⚙ SYSTEM',
            cmds: ['menu', 'help', 'ping', 'alive', 'uptime', 'runtime', 'os', 'botinfo', 'info', 'version',
                'dev', 'settings', 'session', 'sessions', 'cmdstats', 'qr', 'logout',
                'restart', 'shutdown', 'reconnect', 'gitpull', 'backup']
        },
        {
            label: '🛠 CONFIG',
            cmds: ['mode', 'public', 'owner', 'persona', 'helpconfig', 'addsudo', 'removesudo', 'sudos', 'setprefix', 'changeprefix', 'setalias', 'delalias',
                'aliases', 'setname', 'setbio', 'setstatus', 'setpp', 'getpp', 'profile', 'pluginkey', 'plugin',
                'reset', 'devnumber', 'devcontact']
        },
        {
            label: '🎮 FUN',
            cmds: ['calc', 'base64', 'rizz', 'sticker', 'toimg', 'pickup', 'viewonce', 'vv', 'pfp', 'gpp', 'ggpp',
                'tictactoe', 'ttt', 'xo', 'hangman', 'hm', 'chain', 'wordchain', 'wc', 'trivia', 'quiz', 'riddle', 'hint']
        },
        {
            label: '👥 GROUP',
            cmds: ['add', 'kick', 'promote', 'demote', 'link', 'revoke', 'join', 'tagall', 'hidetag', 'ht',
                'mute', 'unmute', 'listmuted', 'lock', 'unlock', 'warn', 'unwarn', 'warns', 'warnconfig', 'warncfg', 'warnreset',
                'antilink', 'antimention', 'antiforward', 'antidelete', 'antideleteconfig', 'antideletecfg',
                'autoreact', 'autoreactconfig', 'welcome', 'goodbye', 'groupinfo', 'grouppic', 'listgc', 'block',
                'unblock', 'del', 'cancel']
        }
    ];
    const RUIN_TOTAL_CMDS = RUIN_MENU_CATEGORIES.reduce((n, c) => n + c.cmds.length, 0);

    // Wraps command tokens into lines of at most `width` chars. WhatsApp-safe:
    // every line stays short so nothing rolls over on the phone.
    function wrapCmdLines(tokens, width = 26) {
        const lines = [];
        let cur = '';
        for (const t of tokens) {
            if (cur && (cur + ' ' + t).length > width) {
                lines.push(cur);
                cur = t;
            } else {
                cur = cur ? cur + ' ' + t : t;
            }
        }
        if (cur) lines.push(cur);
        return lines;
    }

    function formatBytes(b) {
        if (!Number.isFinite(b) || b < 0) return '0 B';
        if (b < 1024) return `${b} B`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
        if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
        return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    let cachedStorageBytes = { at: 0, bytes: -1 };
    function getSessionStorageBytes() {
        const now = Date.now();
        if (cachedStorageBytes.bytes >= 0 && now - cachedStorageBytes.at < 60_000) return cachedStorageBytes.bytes;
        try {
            let total = 0;
            const walk = (dir) => {
                for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                    const p = path.join(dir, e.name);
                    if (e.isDirectory()) walk(p);
                    else { try { total += fs.statSync(p).size; } catch (_) {} }
                }
            };
            if (fs.existsSync(authDirRoot)) walk(authDirRoot);
            cachedStorageBytes = { at: now, bytes: total };
            return total;
        } catch (_) {
            return cachedStorageBytes.bytes >= 0 ? cachedStorageBytes.bytes : 0;
        }
    }

    // Compact uptime (0d 0h 1m 5s — no dashes, shorter lines)
    function formatPanelUptime(seconds) {
        const s = Math.max(0, Math.floor(seconds));
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return `${d}d - ${h}h - ${m}m - ${sec}s`;
    }

    // Short status facts shared by every Ruin design.
    function ruinStatusFacts(phoneNumber, sock) {
        const cfg = loadBotConfig(phoneNumber);
        const rawMode = String(loadBotMode(phoneNumber) || 'public').toLowerCase();
        return {
            name: String(sock.user?.name || phoneNumber).slice(0, 14),
            host: isSupabaseEnabled() ? 'RENDER · SUPABASE' : 'PANEL · LOCAL',
            prefix: String(cfg.prefix || '.'),
            mode: rawMode === 'owner' ? 'PRIVATE' : 'PUBLIC',
            cmds: String(RUIN_TOTAL_CMDS),
            uptime: formatPanelUptime(process.uptime()),
            time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toUpperCase(),
            storage: formatBytes(getSessionStorageBytes())
        };
    }

    // Command index lines per category, wrapped short + prefix-aware.
    // labelFmt styles the category headers (bold for most, $ shell for terminal).
    function ruinIndexLines(phoneNumber, width = 26, labelFmt = (l) => `*${l}*`) {
        const pfx = String(loadBotConfig(phoneNumber).prefix || '.');
        const out = [];
        for (const cat of RUIN_MENU_CATEGORIES) {
            out.push(labelFmt(cat.label));
            const tokens = cat.cmds.map(c => pfx + c);
            for (const line of wrapCmdLines(tokens, width)) out.push(line);
        }
        return out;
    }

    // Open-right frame (authentic CODEx style): no right border, 𖣘 sigils,
    // top/bottom borders span the same width so everything stays aligned.
    function ruinOpenBox(title, rows, innerW = 0) {
        const content = rows.map(r => String(r));
        const w = Math.max(innerW, ...content.map(r => r.length), 12);
        const t = `〔 𖣘 ${title} 〕`;
        const top = '╔══' + t + '═'.repeat(Math.max(1, w - t.length)) + '❐';
        const iTop = '║ ╔' + '═'.repeat(w - 1) + '◆';
        const body = content.map(r => '║ ║ ' + r).join('\n');
        const iBottom = '║ ╚' + '═'.repeat(w - 1) + '◆';
        const bottom = '╚' + '═'.repeat(w + 2) + '❐';
        return [top, iTop, body, iBottom, bottom].join('\n');
    }

    // ── STATUS PANEL (message 1 of Ruin .menu) ──
    function buildRuinStatusPanel(phoneNumber, sock) {
        const f = ruinStatusFacts(phoneNumber, sock);
        // truncate by code points so fancy names (astral chars) never split
        const name = Array.from(f.name).slice(0, 24).join('');
        return ruinOpenBox('EVENTIDE OMEGA', [
            `𖣘 USER: ${name}`,
            `𖣘 PERSONA: RUIN`,
            `𖣘 HOST: ${f.host}`,
            `𖣘 PREFIX: ${f.prefix}`,
            `𖣘 CMDS: ${f.cmds}`,
            `𖣘 UPTIME: ${f.uptime}`,
            `𖣘 MODE: ${f.mode}`,
            `𖣘 STORAGE: ${f.storage}`,
            `𖣘 TIME: ${f.time}`
        ]);
    }

    // ── ALL MENU: the full command index (exact format the owner picked) ──
    function buildRuinCommandIndexBox(phoneNumber) {
        const pfx = String(loadBotConfig(phoneNumber).prefix || '.');
        const rows = [];
        for (const cat of RUIN_MENU_CATEGORIES) {
            rows.push(cat.label);
            const tokens = cat.cmds.map(c => pfx + c);
            for (const line of wrapCmdLines(tokens, 39)) rows.push('   ' + line);
            rows.push('');
        }
        return ruinOpenBox('COMMAND INDEX', rows, 42);
    }

    // ── SYSTEM MENU ──
    function buildRuinSystemMenu(phoneNumber) {
        const pfx = String(loadBotConfig(phoneNumber).prefix || '.');
        const sec = (title, cmds) => {
            const out = [`𖣘 ${title}`];
            const tokens = cmds.map(c => pfx + c);
            for (const line of wrapCmdLines(tokens, 36)) out.push('   ' + line);
            return out;
        };
        const rows = [
            ...sec('STATUS', ['ping', 'alive', 'uptime', 'runtime', 'status', 'info', 'version', 'os', 'botinfo', 'profile', 'cmdstats']),
            ...sec('SESSION', ['session', 'sessions', 'qr', 'logout', 'reconnect', 'backup']),
            ...sec('DEPLOY', ['gitpull']),
            ...sec('POWER', ['restart', 'shutdown', 'dev', 'devnumber', 'devcontact'])
        ];
        return ruinOpenBox('SYSTEM MENU', rows, 40);
    }

    // ── CONFIG MENU ──
    function buildRuinConfigMenu(phoneNumber) {
        const pfx = String(loadBotConfig(phoneNumber).prefix || '.');
        const sec = (title, cmds) => {
            const out = [`𖣘 ${title}`];
            const tokens = cmds.map(c => pfx + c);
            for (const line of wrapCmdLines(tokens, 36)) out.push('   ' + line);
            return out;
        };
        const rows = [
            ...sec('ACCESS', ['mode', 'public', 'owner']),
            ...sec('IDENTITY', ['setname', 'setbio', 'setstatus', 'setpp', 'getpp', 'profile']),
            ...sec('PREFIX & ALIASES', ['setprefix', 'changeprefix', 'setalias', 'delalias', 'aliases']),
            ...sec('PERSONA', ['persona', 'helpconfig']),
            ...sec('SUDO', ['addsudo', 'removesudo', 'sudos']),
            ...sec('AI CORE', ['pluginkey', 'plugin']),
            ...sec('FACTORY', ['reset'])
        ];
        return ruinOpenBox('CONFIG MENU', rows, 40);
    }

    // ── GROUP MENU ──
    function buildRuinGroupMenu(phoneNumber) {
        const pfx = String(loadBotConfig(phoneNumber).prefix || '.');
        const sec = (title, cmds) => {
            const out = [`𖣘 ${title}`];
            const tokens = cmds.map(c => pfx + c);
            for (const line of wrapCmdLines(tokens, 36)) out.push('   ' + line);
            return out;
        };
        const rows = [
            ...sec('ADMIN', ['add', 'kick', 'promote', 'demote', 'mute', 'unmute', 'listmuted', 'lock', 'unlock', 'revoke', 'link', 'groupinfo', 'grouppic', 'listgc', 'getvcf', 'join']),
            ...sec('MASS', ['tagall', 'hidetag', 'ht']),
            ...sec('WARDS', ['antilink', 'antimention', 'antiforward', 'antidelete', 'antideleteconfig', 'antideletecfg', 'autoreact', 'autoreactconfig']),
            ...sec('WARN', ['warn', 'unwarn', 'warns', 'warnconfig', 'warncfg', 'warnreset']),
            ...sec('GREET', ['welcome', 'goodbye', 'greet']),
            ...sec('MODERATION', ['block', 'unblock', 'del', 'cancel'])
        ];
        return ruinOpenBox('GROUP MENU', rows, 40);
    }

    // ── FUN MENU ──
    function buildRuinFunMenu(phoneNumber) {
        const pfx = String(loadBotConfig(phoneNumber).prefix || '.');
        const sec = (title, cmds) => {
            const out = [`𖣘 ${title}`];
            const tokens = cmds.map(c => pfx + c);
            for (const line of wrapCmdLines(tokens, 36)) out.push('   ' + line);
            return out;
        };
        const rows = [
            ...sec('GAMES', ['tictactoe', 'ttt', 'xo', 'hangman', 'hm', 'chain', 'wordchain', 'wc', 'trivia', 'quiz', 'riddle', 'hint']),
            ...sec('MEDIA', ['sticker', 'toimg', 'viewonce', 'vv', 'pfp', 'gpp', 'ggpp']),
            ...sec('FUN', ['rizz', 'pickup', 'calc', 'base64'])
        ];
        return ruinOpenBox('FUN MENU', rows, 40);
    }

    // ── RUIN POLL (message 2 of Ruin .menu) ──
    const RUIN_POLL_QUESTION = `╔════════╦════════╗\n     EVENTIDE OMEGA\n╚════════╩════════╝`;
    const RUIN_POLL_OPTIONS = [
        '╰|...➤ [ 1. ALL MENU ]',
        '╰|...➤ [ 2. SYSTEM MENU ]',
        '╰|...➤ [ 3. CONFIG MENU ]',
        '╰|...➤ [ 4. GROUP MENU ]',
        '╰|...➤ [ 5. FUN MENU ]'
    ];
    const RUIN_POLL_IDS = ['rm_all', 'rm_system', 'rm_config', 'rm_group', 'rm_fun'];

    // Sends the Ruin persona menu: status panel, then the menu poll.
    async function sendRuinMenu(sock, remoteJid, phoneNumber) {
        if (sock?._eventidePhone) flashPresenceOnline(sock, sock._eventidePhone);
        await sock.sendMessage(remoteJid, { text: buildRuinStatusPanel(phoneNumber, sock) });
        await delay(400);
        await sendMenuPoll(sock, remoteJid, phoneNumber, RUIN_POLL_QUESTION, RUIN_POLL_OPTIONS, RUIN_POLL_IDS);
        log('WA-CMD', `${phoneNumber}: Ruin persona menu delivered (status panel + menu poll).`);
    }

    return Object.freeze({
        RUIN_MENU_CATEGORIES,
        RUIN_POLL_QUESTION,
        RUIN_POLL_OPTIONS,
        RUIN_POLL_IDS,
        ruinStatusFacts,
        ruinIndexLines,
        buildRuinStatusPanel,
        buildRuinCommandIndexBox,
        buildRuinSystemMenu,
        buildRuinConfigMenu,
        buildRuinGroupMenu,
        buildRuinFunMenu,
        sendRuinMenu
    });
}
