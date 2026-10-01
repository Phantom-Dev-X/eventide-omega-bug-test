/**
 * Antidelete engine: per-session enable/endpoint config (groups/channels/
 * contacts watch-lists, persisted inside the shared bot_config.json via the
 * injected `normalizeAntideleteConfig`), the group-picker poll shared by the
 * antidelete/autoreact/anti-ward setup flows (`offerGroupPickPoll`), endpoint
 * matching (`antideleteWatchesChat`), and the revoke-event recovery/forward
 * flow (`extractRevokeRef` -> `recoverDeletedContent` -> `handleAntideleteRevoke`).
 *
 * `normalizeAntideleteConfig` stays in index.js because `loadBotConfig` (core
 * config infra, not antidelete-exclusive) calls it directly when hydrating
 * the shared per-session config object; it is injected here instead of
 * duplicated so there is a single source of truth for the shape.
 */
export function createAntideleteService(deps) {
    const {
        loadBotConfig,
        saveBotConfig,
        normalizeAntideleteConfig,
        listParticipatingGroups,
        buildOmegaTerminal,
        sendMenuPoll,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        recentMessages,
        isIgnoredRemoteJid,
        jidNormalizedUser,
        getMessageFromStore,
        log
    } = deps || {};

    for (const [name, value] of Object.entries({
        loadBotConfig, saveBotConfig, normalizeAntideleteConfig, listParticipatingGroups,
        buildOmegaTerminal, sendMenuPoll, isIgnoredRemoteJid, jidNormalizedUser,
        getMessageFromStore, log
    })) {
        if (typeof value !== 'function') throw new Error(`Antidelete service requires ${name}()`);
    }
    for (const [name, value] of Object.entries({
        autoreactSessions, antiConfigSessions, warnConfigSessions, recentMessages
    })) {
        if (!value || typeof value.get !== 'function' || typeof value.set !== 'function') {
            throw new Error(`Antidelete service requires a ${name} Map`);
        }
    }

    function getAntideleteState(phoneNumber) {
        return normalizeAntideleteConfig(loadBotConfig(phoneNumber));
    }

    function saveAntideleteState(phoneNumber, ad) {
        const cfg = loadBotConfig(phoneNumber);
        cfg.antidelete = {
            enabled: !!ad.enabled,
            endpoints: {
                groups: [...(ad.endpoints?.groups || [])],
                channels: [...(ad.endpoints?.channels || [])],
                contacts: [...(ad.endpoints?.contacts || [])]
            }
        };
        if (cfg.anti?.antidelete) delete cfg.anti.antidelete;
        saveBotConfig(phoneNumber, cfg);
    }

    function applyWardEndpoint(phoneNumber, ward, kind, jid) {
        if (ward === 'ad') {
            const ad = getAntideleteState(phoneNumber);
            ad.endpoints = ad.endpoints || { groups: [], channels: [], contacts: [] };
            const bucket = kind === 'channel' ? 'channels' : 'groups';
            if (!ad.endpoints[bucket].includes(jid)) ad.endpoints[bucket].push(jid);
            saveAntideleteState(phoneNumber, ad);
            return;
        }
        if (ward === 'ar') {
            const bc = loadBotConfig(phoneNumber);
            bc.autoreact = bc.autoreact || { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } };
            bc.autoreact.endpoints = bc.autoreact.endpoints || { groups: [], channels: [], contacts: [] };
            const bucket = kind === 'channel' ? 'channels' : 'groups';
            if (!bc.autoreact.endpoints[bucket].includes(jid)) bc.autoreact.endpoints[bucket].push(jid);
            saveBotConfig(phoneNumber, bc);
            return;
        }
        const cfg = loadBotConfig(phoneNumber);
        cfg.anti = cfg.anti || {};
        cfg.anti[ward] = cfg.anti[ward] || {};
        cfg.anti[ward][jid] = 'on';
        saveBotConfig(phoneNumber, cfg);
    }

    async function offerGroupPickPoll(sock, remoteJid, phoneNumber, ward, label) {
        let rows = [];
        try { rows = await listParticipatingGroups(sock); } catch (_) {}
        const names = rows.map(r => (r.name || r.id).slice(0, 72));
        const ids = rows.map((_, i) => `${ward}_grp_${i}`);
        const shown = names.slice(0, 10);
        const shownIds = ids.slice(0, 10);
        shown.push('Paste link or ID');
        shownIds.push(`${ward}_grp_paste`);
        if (rows.length > 10) {
            // keep paste as last; swap 10th for More if we ever paginate
        }
        if (ward === 'ar') autoreactSessions.set(phoneNumber, { step: 'pick_group', ward, rows, chat: remoteJid });
        else if (ward === 'ad') antiConfigSessions.set(phoneNumber, { step: 'pick_group', ward, rows, chat: remoteJid });
        else warnConfigSessions.set(phoneNumber, { ...(warnConfigSessions.get(phoneNumber) || {}), step: 'pick_group', ward, rows, chat: remoteJid });
        await sock.sendMessage(remoteJid, {
            text: buildOmegaTerminal(
                `   ${label}\n\n` +
                `   ${rows.length} group(s) I am in.\n` +
                `   Poll shows the first 10.\n` +
                `   Or *reply to the poll* with a\n` +
                `   group invite / ID.\n` +
                `   If I am not inside, I will join.`
            )
        }).catch(() => {});
        const poll = await sendMenuPoll(sock, remoteJid, phoneNumber, 'SELECT GROUP', shown, shownIds);
        const sessMap = ward === 'ar' ? autoreactSessions : ward === 'ad' ? antiConfigSessions : warnConfigSessions;
        const prev = sessMap.get(phoneNumber) || {};
        sessMap.set(phoneNumber, { ...prev, pollKey: poll?.key || null });
        return poll;
    }

    function listAntideleteEndpoints(ad) {
        const g = ad.endpoints?.groups || [];
        const c = ad.endpoints?.channels || [];
        const ct = ad.endpoints?.contacts || [];
        const rows = [
            ...g.map(e => ({ type: 'GROUP', v: e })),
            ...c.map(e => ({ type: 'CHANNEL', v: e })),
            ...ct.map(e => ({ type: 'CONTACT', v: e }))
        ];
        let list = '';
        let n = 1;
        if (g.length) {
            list += `  ─ *GROUPS* ─\n`;
            for (const e of g) list += `   [${n++}] ${e}\n`;
        }
        if (c.length) {
            list += `  ─ *CHANNELS* ─\n`;
            for (const e of c) list += `   [${n++}] ${e}\n`;
        }
        if (ct.length) {
            list += `  ─ *CONTACTS* ─\n`;
            for (const e of ct) list += `   [${n++}] ${e}\n`;
        }
        if (!rows.length) list = '   _no endpoints yet_';
        return { list, rows };
    }

    function antideleteWatchesChat(ad, remoteJid) {
        if (!ad?.enabled || !remoteJid) return false;
        if (isIgnoredRemoteJid(remoteJid)) return false;
        const eps = ad.endpoints || { groups: [], channels: [], contacts: [] };
        if (remoteJid.endsWith('@g.us')) return (eps.groups || []).includes(remoteJid);
        if (remoteJid.endsWith('@newsletter')) {
            return (eps.channels || []).some(ch => {
                const s = String(ch || '');
                return s === remoteJid || (s && (s.includes(remoteJid) || remoteJid.includes(s)));
            });
        }
        if (remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid')) {
            const digits = String(remoteJid).split('@')[0].replace(/\D/g, '');
            const norm = jidNormalizedUser(remoteJid);
            return (eps.contacts || []).some(c => {
                const raw = String(c || '');
                const cd = raw.replace(/\D/g, '');
                return raw === remoteJid || raw === norm || (cd && cd === digits);
            });
        }
        return false;
    }

    function extractRevokeRef(key, update) {
        const proto = update?.message?.protocolMessage;
        const t = proto?.type;
        if (t === 14 || t === 'MESSAGE_EDIT') return null;
        if ((t === 0 || t === 'REVOKE') && proto?.key) return proto.key;
        if (update?.protocolMessageKey) return update.protocolMessageKey;
        if (update?.messageStubType === 1 || update?.messageStubType === 21) return proto?.key || key;
        if (String(key?.id || '').startsWith('REVOKE_')) return proto?.key || update?.protocolMessageKey || key;
        return null;
    }

    async function recoverDeletedContent(refKey) {
        let deletedContent = null;
        try { deletedContent = await getMessageFromStore(refKey); } catch (_) {}
        if (!deletedContent && refKey?.id) {
            for (const [, v] of recentMessages) {
                if (v?.key?.id === refKey.id && v?.message) { deletedContent = v.message; break; }
            }
            if (!deletedContent) {
                for (const [k, v] of recentMessages) {
                    if (k.endsWith(':' + refKey.id) && v?.message) { deletedContent = v.message; break; }
                }
            }
        }
        return deletedContent;
    }

    async function handleAntideleteRevoke(sock, phoneNumber, eventKey, refKey) {
        const chatJid = refKey?.remoteJid || eventKey?.remoteJid;
        if (!chatJid) return;
        const ad = getAntideleteState(phoneNumber);
        if (!antideleteWatchesChat(ad, chatJid)) return;

        const deletedContent = await recoverDeletedContent(refKey || eventKey);
        const deletedBy = eventKey?.participant
            ? eventKey.participant.split('@')[0]
            : (eventKey?.remoteJid ? eventKey.remoteJid.split('@')[0] : 'unknown');
        const myJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
        const ownerChat = myJid || chatJid;
        const where = chatJid.endsWith('@g.us') ? 'a group' : chatJid.endsWith('@newsletter') ? 'a channel' : 'a chat';

        if (deletedContent) {
            const fakeMsg = {
                key: {
                    remoteJid: chatJid,
                    id: refKey?.id || eventKey.id,
                    participant: eventKey.participant,
                    fromMe: false
                },
                message: deletedContent
            };
            await sock.sendMessage(ownerChat, { forward: fakeMsg }).catch(() => {});
        }
        await sock.sendMessage(ownerChat, {
            text: `⚠️ *ANTIDELETE*\n\nA message was deleted in ${where}.\n\n🗑️ *Chat*: ${chatJid}\n👤 *Deleted by*: +${deletedBy}\n${deletedContent ? '\n_Forwarded the deleted message above._' : '\n_Original content could not be recovered._'}`
        }).catch(() => {});
        log('ANTIDELETE', `${phoneNumber}: forwarded deleted msg from ${chatJid} to owner`);
    }

    return Object.freeze({
        getAntideleteState,
        saveAntideleteState,
        applyWardEndpoint,
        offerGroupPickPoll,
        listAntideleteEndpoints,
        antideleteWatchesChat,
        extractRevokeRef,
        recoverDeletedContent,
        handleAntideleteRevoke
    });
}
