import path from 'path';
import fs from 'fs';

/**
 * Telegram bot command surface: /start, /pair, the plain-text pairing-number
 * handler, /status, /unbug, /disconnect, and /help. Registered only when a
 * Telegram bot instance exists. Behavior, wording, and pacing are preserved
 * exactly as they were inline in index.js.
 */
export function createTelegramCommandService(deps) {
    const {
        authDirRoot,
        maxUsers,
        telegramUsers,
        waSessions,
        safeTgSend,
        setTelegramUserState,
        saveUserMap,
        clearTelegramUser,
        initiatePairing,
        requireAdminOrExplain,
        countStoredSessions,
        formatUptime,
        isSupabaseEnabled,
        deleteSessionFromSupabase,
        loadBugSends,
        saveBugSends,
        safeRm,
        delay,
        trimForLog,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeTgSend,
        setTelegramUserState,
        saveUserMap,
        clearTelegramUser,
        initiatePairing,
        requireAdminOrExplain,
        countStoredSessions,
        formatUptime,
        isSupabaseEnabled,
        deleteSessionFromSupabase,
        loadBugSends,
        saveBugSends,
        safeRm,
        delay,
        trimForLog,
        log,
        logError
    })) {
        if (typeof value !== 'function') throw new Error(`Telegram commands require ${name}()`);
    }
    for (const [name, value] of Object.entries({ telegramUsers, waSessions })) {
        if (!value || typeof value.get !== 'function') {
            throw new Error(`Telegram commands require ${name}`);
        }
    }
    if (typeof authDirRoot !== 'string' || !authDirRoot) {
        throw new Error('Telegram commands require authDirRoot');
    }
    if (typeof maxUsers !== 'number') {
        throw new Error('Telegram commands require maxUsers');
    }

    async function handleStart(msg) {
        const chatId = msg.chat.id;
        log('TELEGRAM', `/start from ${chatId}`);

        const existing = telegramUsers.get(chatId);
        if (existing?.status === 'connected') {
            await safeTgSend(chatId, `✅ *Connected!*\n\n📱 ${existing.phoneNumber}\n🤖 Bot is active.`);
            return;
        }

        await safeTgSend(
            chatId,
            `🤖 *WhatsApp Multi-Bot*\n\nSend your number to pair using country code without + sign.\nExample: 2348012345678\n\n/pair — Start pairing\n/status — Show status\n/sessions — List all connected numbers\n/unbug — Remove sent bug messages (72h window)\n/disconnect — Disconnect your session\n/help — Commands`
        );
    }

    async function handlePair(msg) {
        const chatId = msg.chat.id;
        log('TELEGRAM', `/pair from ${chatId}`);

        const existing = telegramUsers.get(chatId);
        if (existing?.status === 'connected') {
            await safeTgSend(chatId, '❌ You are already connected. Use /disconnect first if you want to re-pair.');
            return;
        }

        if (existing?.status === 'pairing' || existing?.status === 'waiting_number') {
            await safeTgSend(chatId, '⏳ Pairing is already in progress. Please send your number now.');
            return;
        }

        setTelegramUserState(chatId, { phoneNumber: null, status: 'waiting_number', sock: null });
        saveUserMap();
        await safeTgSend(chatId, '📱 *Enter your number*\n\nUse country code + number and do not include the + sign.\nExample: 2348012345678');
    }

    async function handleMessage(msg) {
        try {
            const chatId = msg.chat.id;
            const chatType = msg.chat.type;
            const text = msg.text?.trim();

            if (chatType !== 'private') return;
            if (!text) return;
            if (text.startsWith('/')) return;

            log('TELEGRAM', `Text message from ${chatId}: ${trimForLog(text, 120)}`);

            const user = telegramUsers.get(chatId);
            if (!user) {
                await safeTgSend(chatId, '🤖 Use /start to begin first.');
                return;
            }

            if (user.status !== 'waiting_number') return;

            const phoneNumber = text.replace(/\D/g, '');
            if (phoneNumber.length < 10 || phoneNumber.length > 15) {
                await safeTgSend(chatId, '❌ Invalid number. Example: 2348012345678');
                return;
            }

            await safeTgSend(chatId, `🔑 *Connecting...*\n\n📱 ${phoneNumber}\n\n⏳ Generating your pairing code...`);

            try {
                await initiatePairing(chatId, phoneNumber);
            } catch (err) {
                await safeTgSend(chatId, `❌ Pairing failed.\n\n${err.message}\n\nUse /pair to retry.`);
            }
        } catch (err) {
            logError('TELEGRAM', 'Error inside message handler', err);
        }
    }

    async function handleStatus(msg) {
        const chatId = msg.chat.id;
        log('TELEGRAM', `/status from ${chatId}`);

        if (!(await requireAdminOrExplain(chatId))) return;

        const user = telegramUsers.get(chatId);
        const statusMap = {
            waiting_number: '⏳ Waiting for number',
            pairing: '🔑 Pairing in progress',
            connecting: '🔄 Connecting',
            connected: '✅ Connected',
            disconnected: '❌ Disconnected'
        };

        const sessionDirs = countStoredSessions();
        await safeTgSend(
            chatId,
            `📊 *Status*\n\nYour state: ${statusMap[user?.status || 'disconnected'] || '❓ Unknown'}\nYour number: ${user?.phoneNumber || 'None'}\n\n👥 Active sockets: ${waSessions.size}\n📁 Stored sessions: ${sessionDirs}/${maxUsers}\n🧠 Loaded Telegram users: ${telegramUsers.size}\n⏱️ Uptime: ${formatUptime(process.uptime())}\n☁️ Supabase Sync: ${isSupabaseEnabled() ? '✅ Enabled' : '❌ Disabled'}`
        );
    }

    // /sessions — list every number connected to this bot: live sockets
    // (green = connected, yellow = still connecting) plus numbers with a
    // saved session on disk that are currently offline. Admin-only.
    async function handleSessions(msg) {
        const chatId = msg.chat.id;
        log('TELEGRAM', `/sessions from ${chatId}`);
        if (!(await requireAdminOrExplain(chatId))) return;

        const lines = [];
        const activeKeys = new Set();
        for (const [phoneNumber, session] of waSessions) {
            const key = String(phoneNumber);
            activeKeys.add(key);
            activeKeys.add(key.replace(/\D/g, ''));
            const alive = !!(session?.sock?.user?.id);
            const name = session?.sock?.user?.name || '';
            const tg = session?.telegramChatId ? ' · TG linked' : '';
            lines.push(
                `${alive ? '🟢' : '🟡'} +${key.replace(/\D/g, '')}` +
                `${name ? ` — ${name}` : ''}${alive ? '' : ' (connecting…)'}${tg}`
            );
        }
        try {
            const stored = fs.readdirSync(authDirRoot, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => e.name)
                .filter(name => {
                    const digits = name.replace(/\D/g, '');
                    return digits.length >= 7 && !activeKeys.has(name) && !activeKeys.has(digits);
                });
            for (const name of stored) {
                lines.push(`💤 +${name.replace(/\D/g, '')} (offline — session saved)`);
            }
        } catch (_) {}

        await safeTgSend(
            chatId,
            `📱 *Sessions* — ${waSessions.size} active · ${countStoredSessions()}/${maxUsers} stored\n\n` +
            (lines.length ? lines.join('\n') : '_none_')
        );
    }

    // /unbug — antidote: delete tracked bug messages for everyone.
    //   /unbug <receiver>           → auto: every active bot with tracked sends to that number
    //   /unbug <sender> <receiver>  → explicit: delete through the bot that SENT the bug
    //   /unbug all                  → clean every tracked target (end-of-campaign sweep)
    //   /unbug fast <any of the above> → EMERGENCY pace: 1s between deletes
    // WhatsApp rule: only the account that SENT a message can revoke it, so the
    // delete always goes through the bot number that fired the payload — the
    // sender is written into the ledger (bug_sends.json) at send time.
    async function handleUnbug(msg) {
        const chatId = msg.chat.id;
        log('TELEGRAM', `/unbug from ${chatId}`);
        if (!(await requireAdminOrExplain(chatId))) return;

        let parts = (msg.text || '').trim().split(/\s+/).slice(1);
        // "fast" as the first word = emergency pace: 1s between deletes
        // instead of 3s — for when a live hit needs cleaning RIGHT NOW.
        const FAST = parts[0]?.toLowerCase() === 'fast';
        if (FAST) parts = parts.slice(1);
        if (!parts.length) {
            await safeTgSend(chatId,
                '🧹 *Unbug — remove sent bug messages*\n\n' +
                'Usage:\n`/unbug <receiver>` — auto (any of your bots)\n`/unbug <sender> <receiver>` — through the bot that sent it\n`/unbug all` — clean every tracked target\n`/unbug fast <any of the above>` — ⚡ 1s between deletes\n\nReceiver can be a number, a group JID, or a group *invite link*.\n\n' +
                'Deletes bug messages from the last 72h — for everyone, so the target is unbugged too. One message every 3 seconds — or fast for 1-second emergency pace.');
            return;
        }

        const normJid = s => String(s || '').includes('@') ? s : `${String(s || '').replace(/\D/g, '')}@s.whatsapp.net`;
        // Receiver can also be a group INVITE LINK — resolve it to the group
        // JID exactly like .gb does (any active session can fetch invite info).
        const resolveInvite = async code => {
            for (const [, session] of waSessions) {
                if (!session?.sock?.user?.id) continue;
                try {
                    const info = await session.sock.groupGetInviteInfo(code);
                    if (info?.id) return info.id;
                } catch (_) {}
            }
            return null;
        };
        const asReceiverJid = async arg => {
            arg = String(arg || '');
            if (arg.includes('chat.whatsapp.com/')) {
                const code = arg.split('chat.whatsapp.com/')[1].split(/[?\s]/)[0].trim();
                return code ? (await resolveInvite(code)) : null;
            }
            return normJid(arg);
        };
        const jobs = [];
        if (parts[0].toLowerCase() === 'all') {
            for (const [phoneNumber, session] of waSessions) {
                const entries = loadBugSends(phoneNumber);
                if (entries.length && session?.sock?.user?.id) jobs.push({ phoneNumber, sock: session.sock, entries });
            }
        } else if (parts.length === 1) {
            const tJid = await asReceiverJid(parts[0]);
            if (!tJid) {
                await safeTgSend(chatId, '❌ Could not resolve that invite link — is it valid?');
                return;
            }
            for (const [phoneNumber, session] of waSessions) {
                const entries = loadBugSends(phoneNumber).filter(e => e.jid === tJid);
                if (entries.length && session?.sock?.user?.id) jobs.push({ phoneNumber, sock: session.sock, entries });
            }
        } else {
            const senderNum = parts[0].replace(/\D/g, '');
            const tJid = await asReceiverJid(parts[1]);
            if (!tJid) {
                await safeTgSend(chatId, '❌ Could not resolve that invite link — is it valid?');
                return;
            }
            const session = waSessions.get(senderNum);
            if (!session?.sock?.user?.id) {
                await safeTgSend(chatId, `❌ *${senderNum || '?'}* is not a paired/active bot session.`);
                return;
            }
            const entries = loadBugSends(senderNum).filter(e => e.jid === tJid);
            if (!entries.length) {
                await safeTgSend(chatId, `ℹ️ No tracked bug messages from *${senderNum}* to *${tJid}* in the last 72h.`);
                return;
            }
            jobs.push({ phoneNumber: senderNum, sock: session.sock, entries });
        }

        if (!jobs.length) {
            const tracked = [];
            for (const [phoneNumber] of waSessions) {
                const byTarget = {};
                for (const e of loadBugSends(phoneNumber)) byTarget[e.jid] = (byTarget[e.jid] || 0) + 1;
                for (const [t, c] of Object.entries(byTarget)) tracked.push(`• ${phoneNumber} → ${t} (${c} msg)`);
            }
            await safeTgSend(chatId, tracked.length
                ? `ℹ️ Nothing matches that. Tracked right now:\n${tracked.join('\n')}`
                : 'ℹ️ No tracked bug messages in the last 72h — nothing to unbug.');
            return;
        }

        let total = 0;
        for (const j of jobs) total += j.entries.length;
        const intervalSec = FAST ? 1 : 3;
        await safeTgSend(chatId, `🧹 Unbugging ${total} message(s) via ${jobs.length} bot session(s), one every ${intervalSec}s${FAST ? ' ⚡ FAST' : ''} (~${Math.ceil(total * intervalSec / 60)} min). Stay calm…`);

        let totalDeleted = 0;
        for (const job of jobs) {
            for (let i = 0; i < job.entries.length; i++) {
                const entry = job.entries[i];
                try {
                    // Status-bug entries live under status@broadcast, not the
                    // target JID — delete them where they were posted.
                    const delJid = entry.status ? 'status@broadcast' : entry.jid;
                    await job.sock.sendMessage(delJid, { delete: { remoteJid: delJid, fromMe: true, id: entry.id } });
                    totalDeleted++;
                } catch (err) {
                    logError('TEST', `unbug delete failed (${entry.id})`, err);
                }
                // Drop the entry either way so a restart never redoes finished work.
                saveBugSends(job.phoneNumber, loadBugSends(job.phoneNumber).filter(e => e.id !== entry.id));
                if (i < job.entries.length - 1) await delay(FAST ? 1000 : 3000);
            }
        }
        await safeTgSend(chatId, `✅ *Unbug complete* — deleted ${totalDeleted}/${total} message(s). The target chat(s) are clean.`);
    }

    async function handleDisconnect(msg) {
        const chatId = msg.chat.id;
        log('TELEGRAM', `/disconnect from ${chatId}`);

        const user = telegramUsers.get(chatId);
        if (!user?.phoneNumber) {
            await safeTgSend(chatId, '❌ You do not have an active session to disconnect.');
            return;
        }

        const phoneNumber = user.phoneNumber;
        const session = waSessions.get(phoneNumber);
        if (session?.sock) {
            try {
                await session.sock.end(undefined);
            } catch (err) {
                logError('SESSION', `Manual disconnect failed to close socket for ${phoneNumber}`, err);
            }
        }

        waSessions.delete(phoneNumber);
        safeRm(path.join(authDirRoot, phoneNumber));
        if (isSupabaseEnabled()) {
            await deleteSessionFromSupabase(phoneNumber);
        }
        clearTelegramUser(chatId);
        saveUserMap();

        await safeTgSend(chatId, `✅ Disconnected ${phoneNumber} successfully.`);
    }

    async function handleHelp(msg) {
        const chatId = msg.chat.id;
        log('TELEGRAM', `/help from ${chatId}`);

        await safeTgSend(
            chatId,
            `📖 *Commands*\n\n/start — Welcome message\n/pair — Connect your WhatsApp\n/status — Show status\n/sessions — List all connected numbers\n/unbug — Remove sent bug messages (72h window)\n/disconnect — Disconnect your session\n/help — Show commands\n\n*WhatsApp commands:*\n.ping`
        );
    }

    function register(tgBot) {
        if (!tgBot) return;
        tgBot.onText(/\/start/, handleStart);
        tgBot.onText(/\/pair/, handlePair);
        tgBot.on('message', handleMessage);
        tgBot.onText(/\/status/, handleStatus);
        tgBot.onText(/\/sessions/, handleSessions);
        tgBot.onText(/\/unbug/, handleUnbug);
        tgBot.onText(/\/disconnect/, handleDisconnect);
        tgBot.onText(/\/help/, handleHelp);
    }

    return Object.freeze({
        register,
        handleStart,
        handlePair,
        handleMessage,
        handleStatus,
        handleSessions,
        handleUnbug,
        handleDisconnect,
        handleHelp
    });
}
