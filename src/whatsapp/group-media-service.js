// 🖼️ Group & media service — creator-aware group-admin checks plus
// quoted-media download, extracted from index.js unchanged.
// `isParticipantAdmin` matches participants by JID (or phone digits when one
// side is a PN) and treats the group CREATOR as admin — WhatsApp metadata
// sets admin = null for the creator, so plain p.admin truthiness wrongly
// rejected the owner. `isUserGroupAdmin` resolves metadata via
// sock.groupMetadata and delegates. `downloadQuotedMedia` unwraps quoted
// view-once (V1/V2/V2Extension) media, downloads it as a buffer (with the
// reupload hook when the socket supports it), and falls back to the message
// store when WhatsApp has already expired the media keys.
export function createGroupMediaService(deps) {
    for (const name of ['jidNormalizedUser', 'getQuotedContext', 'downloadMediaMessage', 'pino', 'getMessageFromStore']) {
        if (typeof deps?.[name] !== 'function') {
            throw new Error(`createGroupMediaService: missing required dependency: ${name}`);
        }
    }
    const { jidNormalizedUser, getQuotedContext, downloadMediaMessage, pino, getMessageFromStore } = deps;

    // ✅ Creator-aware admin check. WhatsApp group metadata sets admin = null for
    // the group CREATOR, so `p.admin` truthiness alone wrongly rejected the owner.
    // This matches by JID (or phone digits when one side is a PN) and treats the
    // creator as admin in every case.
    function isParticipantAdmin(meta, jid) {
        try {
            if (!jid) return false;
            const norm = jidNormalizedUser(jid);
            const digits = String(jid).split('@')[0].replace(/\D/g, '');
            const ownerNorm = jidNormalizedUser(meta?.owner || '');
            if (norm === ownerNorm) return true; // the creator is always admin
            const found = meta?.participants?.find(p => {
                const ids = [p.id, p.phoneNumber, p.jid].filter(Boolean).map(jidNormalizedUser);
                if (ids.includes(norm)) return true;
                if (!digits) return false;
                // PN digits fallback (never for LIDs — those digits aren't phone numbers)
                return ids.some(id => id.endsWith('@s.whatsapp.net') && String(id).split('@')[0].replace(/\D/g, '') === digits);
            });
            if (!found) return false;
            const foundIds = [found.id, found.phoneNumber, found.jid].filter(Boolean).map(jidNormalizedUser);
            return !!found.admin || (ownerNorm && foundIds.includes(ownerNorm));
        } catch { return false; }
    }

    async function isUserGroupAdmin(sock, groupJid, jid) {
        try {
            const meta = await sock.groupMetadata(groupJid);
            return isParticipantAdmin(meta, jid);
        } catch { return false; }
    }

    async function downloadQuotedMedia(sock, msg) {
        const ctx = getQuotedContext(msg);
        const quoted = ctx?.quotedMessage;
        if (!quoted) throw new Error('Reply to a view-once photo/video first.');

        let inner = quoted;
        if (inner.viewOnceMessage?.message) inner = inner.viewOnceMessage.message;
        else if (inner.viewOnceMessageV2?.message) inner = inner.viewOnceMessageV2.message;
        else if (inner.viewOnceMessageV2Extension?.message) inner = inner.viewOnceMessageV2Extension.message;

        const type = inner.imageMessage ? 'imageMessage'
            : inner.videoMessage ? 'videoMessage'
            : inner.audioMessage ? 'audioMessage'
            : inner.documentMessage ? 'documentMessage'
            : inner.stickerMessage ? 'stickerMessage'
            : null;
        if (!type) throw new Error('Quoted message has no media.');

        const node = { ...inner[type], viewOnce: false };
        const isViewOnce = !!(
            quoted.viewOnceMessage || quoted.viewOnceMessageV2 || quoted.viewOnceMessageV2Extension ||
            inner[type]?.viewOnce
        );

        const full = {
            key: {
                remoteJid: msg.key.remoteJid,
                id: ctx.stanzaId || msg.key.id,
                fromMe: false,
                participant: ctx.participant || msg.key.participant
            },
            message: { [type]: node }
        };

        const opts = { logger: pino({ level: 'silent' }) };
        if (typeof sock.updateMediaMessage === 'function') {
            opts.reuploadRequest = sock.updateMediaMessage.bind(sock);
        }

        try {
            const buffer = await downloadMediaMessage(full, 'buffer', {}, opts);
            if (buffer && buffer.length) return { buffer, type, node, isViewOnce };
        } catch (_) {}

        if (ctx?.stanzaId) {
            const stored = await getMessageFromStore({ id: ctx.stanzaId, remoteJid: msg.key.remoteJid });
            if (stored) {
                const retry = { key: full.key, message: stored };
                const buffer = await downloadMediaMessage(retry, 'buffer', {}, opts);
                if (buffer && buffer.length) return { buffer, type, node, isViewOnce };
            }
        }
        throw new Error('WhatsApp already expired the media keys. Ask them to resend, or reply faster.');
    }

    return Object.freeze({
        isParticipantAdmin,
        isUserGroupAdmin,
        downloadQuotedMedia
    });
}
