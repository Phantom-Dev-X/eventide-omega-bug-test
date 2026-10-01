// 🎭 Presence service — the human-like presence controller plus the
// safe WhatsApp reply path, extracted from index.js unchanged. The controller
// randomly cycles each session between online/offline (30/45/60/90-minute
// periods) so the bot looks less like a 24/7 automated server, and flashes
// the bot online for ~5 minutes whenever a command is answered.
// `safeWaReply` formats every outbound text reply (markdown → WhatsApp via
// the injected formatForWhatsApp), prepends the channel link with the baked
// preview card (attachChannelPreview), paces the send by a fixed 1s, and
// retries once without the quoted message on failure.
//
// Conventions: the shared presenceControllers Map (src/core/state.js), log,
// logError, delay, formatForWhatsApp, groupChannelLink and
// attachChannelPreview are injected.
export function createPresenceService(deps) {
    for (const name of ['log', 'logError', 'delay', 'formatForWhatsApp', 'attachChannelPreview']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createPresenceService: missing required dependency: ${name}`);
        }
    }
    if (typeof deps?.groupChannelLink !== 'string' || !deps.groupChannelLink) {
        throw new Error('createPresenceService: missing required dependency: groupChannelLink');
    }
    if (!(deps?.presenceControllers instanceof Map)) {
        throw new Error('createPresenceService: missing required dependency: presenceControllers (Map)');
    }
    const { log, logError, presenceControllers, delay, formatForWhatsApp, groupChannelLink, attachChannelPreview } = deps;

    // ──────────────────────────────────────────────
    // 🎭 HUMAN-LIKE PRESENCE CONTROLLER
    // Randomly cycles the bot between "online" and "offline" for varying durations
    // (e.g. online 1h, offline 30m, online 30m, offline 1h30m). While offline, a
    // command flashes it online for ~5 min, then it returns to the background
    // state. This makes the bot look less like a 24/7 automated server (reduces
    // ban/flag risk). Works per-session (multi-user bot).
    // ──────────────────────────────────────────────

    function applyPresence(sock, phoneNumber, state) {
        if (!sock) return;
        try {
            sock.sendPresenceUpdate(state).catch(() => {});
            log('PRESENCE', `${phoneNumber}: presence -> ${state}`);
        } catch (err) {
            logError('PRESENCE', `${phoneNumber}: failed to set presence ${state}`, err);
        }
    }

    function getPresenceController(sock, phoneNumber) {
        let ctrl = presenceControllers.get(phoneNumber);
        if (!ctrl) {
            ctrl = { sock, backgroundState: 'unavailable', cycleTimer: null, flashTimer: null };
            presenceControllers.set(phoneNumber, ctrl);
        } else {
            ctrl.sock = sock;
        }
        return ctrl;
    }

    // Pick a random "online" or "offline" period (30, 45, 60 or 90 minutes).
    function scheduleNextPresenceCycle(phoneNumber) {
        const ctrl = presenceControllers.get(phoneNumber);
        if (!ctrl) return;
        const durationsMin = [30, 45, 60, 90];
        const dur = durationsMin[Math.floor(Math.random() * durationsMin.length)] * 60 * 1000;
        if (ctrl.cycleTimer) clearTimeout(ctrl.cycleTimer);
        ctrl.cycleTimer = setTimeout(() => {
            const cur = presenceControllers.get(phoneNumber);
            if (!cur) return;
            cur.backgroundState = cur.backgroundState === 'available' ? 'unavailable' : 'available';
            applyPresence(cur.sock, phoneNumber, cur.backgroundState);
            scheduleNextPresenceCycle(phoneNumber);
        }, dur);
    }

    // Starts the random online/offline cycle for a freshly-connected socket.
    function startPresenceCycle(sock, phoneNumber) {
        const ctrl = getPresenceController(sock, phoneNumber);
        ctrl.backgroundState = Math.random() < 0.5 ? 'available' : 'unavailable';
        applyPresence(sock, phoneNumber, ctrl.backgroundState);
        scheduleNextPresenceCycle(phoneNumber);
    }

    // Flash the bot online when a command is used, then return to the current
    // background state after ~5 minutes.
    function flashPresenceOnline(sock, phoneNumber) {
        if (!sock) return;
        const ctrl = getPresenceController(sock, phoneNumber);
        applyPresence(sock, phoneNumber, 'available');
        if (ctrl.flashTimer) clearTimeout(ctrl.flashTimer);
        ctrl.flashTimer = setTimeout(() => {
            const cur = presenceControllers.get(phoneNumber);
            if (!cur) return;
            applyPresence(cur.sock, phoneNumber, cur.backgroundState);
        }, 5 * 60 * 1000);
    }

    async function safeWaReply(sock, remoteJid, text, quoted) {
        // 💡 Flash the bot online before any reply (dot commands, .help, help-mode
        // conversations, etc.), then return to the background presence after ~5 min.
        const flashPhone = sock?._eventidePhone;
        if (flashPhone) flashPresenceOnline(sock, flashPhone);
        try {
            let formattedText = formatForWhatsApp(text);

            // Channel URL sits on its own line so the baked PDV preview card
            // follows text replies. Polls and image messages never go through here.
            if (!formattedText.startsWith('🤖') && !formattedText.includes(groupChannelLink)) {
                formattedText = `${groupChannelLink}\n\n${formattedText}`;
            }

            // ⚡ Fixed 1s pacing: the reaction is already sent instantly by the
            // command handler, then this reply lands ~1s later. Removed the old
            // typing-presence round-trips and the length-based 1–2.7s delay —
            // they made the bot feel slow and added socket traffic.
            await delay(1000);

            const content = await attachChannelPreview({ text: formattedText });
            await sock.sendMessage(remoteJid, content, quoted ? { quoted } : undefined);
            return true;
        } catch (err) {
            logError('WA-SEND', `Quoted reply failed for ${remoteJid}. Retrying without quote`, err);
            try {
                let formattedText = formatForWhatsApp(text);
                if (!formattedText.startsWith('🤖') && !formattedText.includes(groupChannelLink)) {
                    formattedText = `${groupChannelLink}\n\n${formattedText}`;
                }
                const content = await attachChannelPreview({ text: formattedText });
                await sock.sendMessage(remoteJid, content);
                return true;
            } catch (retryErr) {
                logError('WA-SEND', `Reply failed for ${remoteJid}`, retryErr);
                return false;
            }
        }
    }

    return Object.freeze({
        applyPresence,
        getPresenceController,
        scheduleNextPresenceCycle,
        startPresenceCycle,
        flashPresenceOnline,
        safeWaReply
    });
}
