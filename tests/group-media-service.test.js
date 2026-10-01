import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupMediaService } from '../src/whatsapp/group-media-service.js';

// Baileys-faithful jidNormalizedUser double: PN JIDs lose their device part,
// everything else (bare numbers, @lid JIDs) passes through unchanged.
const jidNormalizedUser = (jid) => {
    const s = String(jid || '').trim();
    if (!s) return undefined;
    const m = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/i.exec(s);
    return m ? `${m[1]}@s.whatsapp.net` : s;
};

function makeEngine(overrides = {}) {
    const downloads = [];
    const stored = new Map();
    let downloadResults = []; // consumed per call; when empty -> buffer
    const engine = createGroupMediaService({
        jidNormalizedUser,
        getQuotedContext: (msg) => msg?.__quoted ?? null,
        downloadMediaMessage: async (full, kind, _, opts) => {
            downloads.push({ full, kind, opts });
            const result = downloadResults.length ? downloadResults.shift() : { buffer: Buffer.from('media') };
            if (result.throw) throw new Error(result.throw);
            return result.buffer;
        },
        pino: () => ({ level: 'silent' }),
        getMessageFromStore: async (key) => stored.get(key.id) ?? null,
        ...overrides
    });
    return { engine, downloads, stored, setDownloadResults: (r) => { downloadResults = r; } };
}

function msgWithQuoted(quoted, extras = {}) {
    return {
        key: { remoteJid: 'g@g.us', id: 'MSG1', participant: 'sender@s.whatsapp.net' },
        __quoted: { stanzaId: 'Q9', participant: 'quoter@s.whatsapp.net', quotedMessage: quoted },
        ...extras
    };
}

// --- constructor guards ---------------------------------------------------

test('createGroupMediaService throws when deps are missing', () => {
    const base = {
        jidNormalizedUser, getQuotedContext: () => null,
        downloadMediaMessage: async () => null, pino: () => ({}),
        getMessageFromStore: async () => null
    };
    for (const key of Object.keys(base)) {
        const broken = { ...base };
        delete broken[key];
        assert.throws(() => createGroupMediaService(broken), new RegExp(key));
    }
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- isParticipantAdmin ------------------------------------------------------

test('isParticipantAdmin treats the group creator as admin even with admin null', () => {
    const { engine } = makeEngine();
    const meta = { owner: '2348000000000@s.whatsapp.net', participants: [] };
    assert.equal(engine.isParticipantAdmin(meta, '2348000000000@s.whatsapp.net'), true);
    assert.equal(engine.isParticipantAdmin(meta, '2348000000000:9@s.whatsapp.net'), true);
    assert.equal(engine.isParticipantAdmin(meta, 'other@s.whatsapp.net'), false);
});

test('isParticipantAdmin matches participants by id, jid, and the PN digits fallback', () => {
    const { engine } = makeEngine();
    const meta = {
        owner: 'owner@s.whatsapp.net',
        participants: [
            { id: '111@s.whatsapp.net', admin: 'admin' },
            { id: '2348022222222:5@s.whatsapp.net', admin: 'admin' },
            { jid: '333:2@s.whatsapp.net', admin: 'superadmin' },
            { id: '987654321098765@lid', admin: 'admin' }
        ]
    };
    assert.equal(engine.isParticipantAdmin(meta, '111@s.whatsapp.net'), true);
    // PN digits fallback: device-suffixed participant JID matches the bare PN
    assert.equal(engine.isParticipantAdmin(meta, '2348022222222@s.whatsapp.net'), true);
    assert.equal(engine.isParticipantAdmin(meta, '333@s.whatsapp.net'), true);
    // LID digits never match a phone-number JID
    assert.equal(engine.isParticipantAdmin(meta, '987654321098765@s.whatsapp.net'), false);
    assert.equal(engine.isParticipantAdmin(meta, '999@s.whatsapp.net'), false);
    // plain member (admin falsy, not owner) is not an admin
    const plain = { owner: 'owner@s.whatsapp.net', participants: [{ id: '555@s.whatsapp.net', admin: null }] };
    assert.equal(engine.isParticipantAdmin(plain, '555@s.whatsapp.net'), false);
});

test('isParticipantAdmin handles bad input without throwing', () => {
    const { engine } = makeEngine();
    assert.equal(engine.isParticipantAdmin(null, 'x@s.whatsapp.net'), false);
    assert.equal(engine.isParticipantAdmin({}, null), false);
    assert.equal(engine.isParticipantAdmin({}, ''), false);
});

// --- isUserGroupAdmin ------------------------------------------------------------

test('isUserGroupAdmin resolves metadata and swallows groupMetadata failures', async () => {
    const { engine } = makeEngine();
    const sockOk = { groupMetadata: async () => ({ owner: 'o@s.whatsapp.net', participants: [] }) };
    assert.equal(await engine.isUserGroupAdmin(sockOk, 'g@g.us', 'o@s.whatsapp.net'), true);

    const sockFail = { groupMetadata: async () => { throw new Error('gone'); } };
    assert.equal(await engine.isUserGroupAdmin(sockFail, 'g@g.us', 'o@s.whatsapp.net'), false);
});

// --- downloadQuotedMedia -------------------------------------------------------------

test('downloadQuotedMedia requires a quoted message with media', async () => {
    const { engine } = makeEngine();
    await assert.rejects(() => engine.downloadQuotedMedia({}, msgWithQuoted(null)), /Reply to a view-once photo\/video first/);
    await assert.rejects(() => engine.downloadQuotedMedia({}, msgWithQuoted({ audioNote: {} })), /has no media/);
});

test('downloadQuotedMedia unwraps view-once images and strips the viewOnce flag', async () => {
    const { engine, downloads } = makeEngine();
    const quoted = { viewOnceMessage: { message: { imageMessage: { url: 'https://x', viewOnce: true } } } };
    const result = await engine.downloadQuotedMedia({}, msgWithQuoted(quoted));
    assert.ok(result.buffer.equals(Buffer.from('media')));
    assert.equal(result.type, 'imageMessage');
    assert.equal(result.node.viewOnce, false);
    assert.equal(result.isViewOnce, true);
    assert.equal(downloads.length, 1);
    const full = downloads[0].full;
    assert.equal(full.key.id, 'Q9');
    assert.equal(full.key.participant, 'quoter@s.whatsapp.net');
    assert.equal(full.key.fromMe, false);
    assert.deepEqual(full.message, { imageMessage: { url: 'https://x', viewOnce: false } });
});

test('downloadQuotedMedia binds the reupload hook when the socket supports it', async () => {
    const { engine, downloads } = makeEngine();
    let reuploadBound = null;
    const sock = { updateMediaMessage: function (arg) { reuploadBound = arg; } };
    await engine.downloadQuotedMedia(sock, msgWithQuoted({ videoMessage: { url: 'https://v' } }));
    assert.equal(typeof downloads[0].opts.reuploadRequest, 'function');
    downloads[0].opts.reuploadRequest('ping');
    assert.equal(reuploadBound, 'ping');
});

test('downloadQuotedMedia retries from the message store when the keys expired once', async () => {
    const { engine, downloads, stored, setDownloadResults } = makeEngine();
    stored.set('Q9', { imageMessage: { url: 'https://stored' } });
    setDownloadResults([{ throw: 'expired' }]);
    const result = await engine.downloadQuotedMedia({}, msgWithQuoted({ imageMessage: { url: 'https://x' } }));
    assert.ok(result.buffer.equals(Buffer.from('media')));
    assert.equal(downloads.length, 2);
    assert.deepEqual(downloads[1].full.message, { imageMessage: { url: 'https://stored' } });
});

test('downloadQuotedMedia gives up with the expiry message when nothing works', async () => {
    const { engine, setDownloadResults } = makeEngine();
    setDownloadResults([{ throw: 'expired' }, { throw: 'expired' }]);
    await assert.rejects(
        () => engine.downloadQuotedMedia({}, msgWithQuoted({ imageMessage: { url: 'https://x' } })),
        /WhatsApp already expired the media keys/
    );
});
