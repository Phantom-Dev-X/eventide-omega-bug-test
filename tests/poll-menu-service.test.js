import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { createPollMenuService } from '../src/whatsapp/poll-menu-service.js';

const hashBuf = (opt) => crypto.createHash('sha256').update(Buffer.from(opt)).digest();

function makeEngine(overrides = {}) {
    const logs = [];
    const errors = [];
    const flashes = [];
    const saved = [];
    const lastPollVotes = new Map();
    const menuReplyMessages = new Map();
    let voteAllowed = true;
    let pollCache = new Map();
    const state = {
        logs, errors, flashes, saved, lastPollVotes, menuReplyMessages,
        getPollCache: () => pollCache, setPollCache: (m) => { pollCache = m; },
        setVoteAllowed: (v) => { voteAllowed = v; }
    };
    const engine = createPollMenuService({
        log: (...a) => logs.push(a),
        logError: (...a) => errors.push(a),
        jidNormalizedUser: (jid) => {
            const str = String(jid || '').trim();
            if (!str) return '';
            const at = str.indexOf('@');
            if (at < 0) return str.split(':')[0];
            return str.slice(0, at).split(':')[0] + str.slice(at);
        },
        decryptPollVote: (encVote, ctx) => {
            if (ctx.pollCreatorJid === 'me@s.whatsapp.net' && ctx.voterJid === 'voter@s.whatsapp.net') {
                return { selectedOptions: [hashBuf(state.winningOption || 'Option B')] };
            }
            throw new Error('wrong combo');
        },
        loadPollCache: () => pollCache,
        savePollCache: (phone, cache) => { saved.push({ phone, entries: [...cache.entries()] }); },
        trimForLog: (v) => String(v ?? ''),
        proto: { Message: { create: (x) => x } },
        generateWAMessageFromContent: (remoteJid, content, opts) => ({
            key: { id: 'POLL1' },
            message: {
                pollCreationMessage: content.pollCreationMessage,
                messageContextInfo: { messageSecret: content.messageContextInfo.messageSecret }
            },
            __opts: opts,
            __remoteJid: remoteJid
        }),
        formatForWhatsApp: (t) => String(t ?? ''),
        flashPresenceOnline: (sock, phone) => flashes.push(phone),
        canVoteOnPoll: (phone, voters, ids, owners) => voteAllowed,
        lastPollVotes,
        menuReplyMessages,
        ...overrides
    });
    return { engine, state };
}

function sockDouble() {
    const relayed = [];
    const sent = [];
    return {
        sock: {
            user: { id: 'me:7@s.whatsapp.net', lid: '999@lid' },
            relayMessage: async (jid, message, opts) => { relayed.push({ jid, message, opts }); },
            sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: `S${sent.length}` } }; }
        },
        relayed, sent
    };
}

// --- constructor guards ---------------------------------------------------

test('createPollMenuService throws when deps are missing or wrong-typed', () => {
    const base = {
        log: () => {}, logError: () => {}, jidNormalizedUser: () => '', decryptPollVote: () => {},
        loadPollCache: () => new Map(), savePollCache: () => {}, trimForLog: () => '',
        proto: {}, generateWAMessageFromContent: () => ({}), formatForWhatsApp: () => '',
        flashPresenceOnline: () => {}, canVoteOnPoll: () => true,
        lastPollVotes: new Map(), menuReplyMessages: new Map()
    };
    for (const key of ['log', 'logError', 'jidNormalizedUser', 'decryptPollVote', 'loadPollCache', 'savePollCache', 'trimForLog', 'generateWAMessageFromContent', 'formatForWhatsApp', 'flashPresenceOnline', 'canVoteOnPoll']) {
        const broken = { ...base };
        delete broken[key];
        assert.throws(() => createPollMenuService(broken), new RegExp(key));
    }
    assert.throws(() => createPollMenuService({ ...base, proto: 'x' }), /proto/);
    assert.throws(() => createPollMenuService({ ...base, lastPollVotes: {} }), /lastPollVotes/);
    assert.throws(() => createPollMenuService({ ...base, menuReplyMessages: {} }), /menuReplyMessages/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- decryptVoteOption -------------------------------------------------------

test('decryptVoteOption brute-forces creator/voter combos and maps the hash to an index', () => {
    const { engine } = makeEngine();
    const idx = engine.decryptVoteOption(
        'aabb', ['Option A', 'Option B'], 'P1',
        ['wrong@s.whatsapp.net', 'me@s.whatsapp.net'],
        ['voter@s.whatsapp.net'],
        'enc-payload'
    );
    assert.equal(idx, 1);
});

test('decryptVoteOption returns -1 when no combo decrypts or the hash is unknown', () => {
    const { engine, state } = makeEngine();
    assert.equal(engine.decryptVoteOption('aabb', ['A', 'B'], 'P1', ['x@s.whatsapp.net'], ['voter@s.whatsapp.net'], 'enc'), -1);
    state.winningOption = 'Not An Option';
    assert.equal(engine.decryptVoteOption('aabb', ['A', 'B'], 'P1', ['me@s.whatsapp.net'], ['voter@s.whatsapp.net'], 'enc'), -1);
});

// --- handlePollVote ------------------------------------------------------------

test('handlePollVote needs a cached poll and voting rights', () => {
    const { engine, state } = makeEngine();
    const { sock } = sockDouble();
    assert.equal(engine.handlePollVote(sock, '2348012345678', { id: 'UNKNOWN' }, []), null);

    state.setPollCache(new Map([['P1', { secretHex: 'aabb', options: ['A', 'B'], ids: ['ttt_x', 'ttt_y'] }]]));
    state.setVoteAllowed(false);
    assert.equal(engine.handlePollVote(sock, '2348012345678', { id: 'P1', remoteJid: 'g@g.us' }, [{ vote: 'enc' }]), null);
});

test('handlePollVote returns the decrypted menu id for an owner vote', () => {
    const { engine, state } = makeEngine();
    const { sock } = sockDouble();
    state.setPollCache(new Map([['P1', { secretHex: 'aabb', options: ['Option A', 'Option B'], ids: ['ttt_a', 'ttt_b'] }]]));
    // fromMe vote: voters are the bot's own PN/LID; creator combo won't match,
    // so decrypt fails and the handler returns null unless the combo hits.
    const result = engine.handlePollVote(sock, '2348012345678', { id: 'P1', fromMe: true, remoteJid: 'me@s.whatsapp.net' }, [{ vote: 'enc' }]);
    assert.equal(result, null);

    // Now vote as the matching creator/voter pair via key.participant.
    state.setPollCache(new Map([['P1', { secretHex: 'aabb', options: ['Option A', 'Option B'], ids: ['ttt_a', 'ttt_b'] }]]));
    const hit = engine.handlePollVote(sock, '2348012345678', { id: 'P1', participant: 'voter@s.whatsapp.net', remoteJid: 'g@g.us' }, [{ vote: 'enc' }]);
    assert.equal(hit, 'ttt_b');
});

// --- handlePollUpdateMessage -----------------------------------------------------

test('handlePollUpdateMessage ignores non-poll, unknown, and unauthorised updates', () => {
    const { engine, state, state: s } = makeEngine();
    const { sock } = sockDouble();
    assert.equal(engine.handlePollUpdateMessage(sock, '2348012345678', { message: {} }), null);
    assert.equal(engine.handlePollUpdateMessage(sock, '2348012345678', {
        message: { pollUpdateMessage: { pollCreationMessageKey: { id: 'NOPE' }, vote: 'enc' } }
    }), null);
    assert.ok(s.logs.some(a => a[0] === 'POLL'));

    state.setPollCache(new Map([['P1', { secretHex: 'aabb', options: ['A'], ids: ['ttt_a'] }]]));
    state.setVoteAllowed(false);
    assert.equal(engine.handlePollUpdateMessage(sock, '2348012345678', {
        key: { participant: 'voter@s.whatsapp.net' },
        message: { pollUpdateMessage: { pollCreationMessageKey: { id: 'P1', participant: 'creator@s.whatsapp.net' }, vote: 'enc' } }
    }), null);
    assert.ok(s.logs.some(a => String(a[1]).includes('ignored non-owner')));
});

test('handlePollUpdateMessage returns the vote and de-duplicates repeat selections', () => {
    const { engine, state } = makeEngine();
    const { sock } = sockDouble();
    state.setPollCache(new Map([['P1', { secretHex: 'aabb', options: ['Option A', 'Option B'], ids: ['rm_one', 'rm_two'] }]]));
    const msg = {
        key: { participant: 'voter@s.whatsapp.net' },
        message: { pollUpdateMessage: { pollCreationMessageKey: { id: 'P1', participant: 'creator@s.whatsapp.net' }, vote: 'enc' } }
    };
    const first = engine.handlePollUpdateMessage(sock, '2348012345678', msg);
    assert.deepEqual(first, { optionId: 'rm_two', pollId: 'P1', voterJid: 'voter@s.whatsapp.net' });

    const second = engine.handlePollUpdateMessage(sock, '2348012345678', msg);
    assert.equal(second, null);
    assert.ok(state.logs.some(a => String(a[1]).includes('duplicate vote')));
});

// --- sendMenuPoll -------------------------------------------------------------------

test('sendMenuPoll validates destination, question, options and ids', async () => {
    const { engine } = makeEngine();
    const { sock } = sockDouble();
    await assert.rejects(() => engine.sendMenuPoll(sock, 'unknown', '2348012345678', 'p', ['a', 'b'], ['x', 'y']), /destination is missing/i);
    await assert.rejects(() => engine.sendMenuPoll(sock, 'r@s.whatsapp.net', '2348012345678', '  ', ['a', 'b'], ['x', 'y']), /question is empty/i);
    await assert.rejects(() => engine.sendMenuPoll(sock, 'r@s.whatsapp.net', '2348012345678', 'q', ['only'], ['x']), /2–12 options/i);
    await assert.rejects(() => engine.sendMenuPoll(sock, 'r@s.whatsapp.net', '2348012345678', 'q', ['a', 'b'], ['x']), /option\/id mismatch/i);
});

test('sendMenuPoll relays the V1 envelope and caches the secret, options and ids', async () => {
    const { engine, state } = makeEngine();
    const { sock, relayed } = sockDouble();
    const pollMsg = await engine.sendMenuPoll(sock, 'r@s.whatsapp.net', '2348012345678', ' Pick one ', [' A ', '', 'B'], ['id1', 'id2']);
    assert.equal(pollMsg.key.id, 'POLL1');
    assert.equal(relayed.length, 1);
    assert.equal(relayed[0].jid, 'r@s.whatsapp.net');
    assert.ok(relayed[0].message.pollCreationMessage);

    assert.equal(state.saved.length, 1);
    const [pollId, entry] = state.saved[0].entries.find(([id]) => id === 'POLL1');
    assert.equal(pollId, 'POLL1');
    assert.deepEqual(entry.options, ['A', 'B']);
    assert.deepEqual(entry.ids, ['id1', 'id2']);
    assert.equal(entry.secretHex.length, 64);
    assert.ok(entry.fullMessage.pollCreationMessage);
});

// --- sendMenuBanner --------------------------------------------------------------------

test('sendMenuBanner sends the image and falls back to text on failure', async () => {
    const { engine } = makeEngine();
    const sock = {
        sendMessage: async (jid, content) => {
            if (content.image) throw new Error('image rejected');
            return { key: { id: 'TXT1' } };
        }
    };
    const key = await engine.sendMenuBanner(sock, 'r@s.whatsapp.net', '/img.png', 'caption');
    assert.deepEqual(key, { id: 'TXT1' });
});

test('sendMenuBanner returns null when both image and text fail', async () => {
    const { engine, state } = makeEngine();
    const sock = { sendMessage: async () => { throw new Error('down'); } };
    const key = await engine.sendMenuBanner(sock, 'r@s.whatsapp.net', '/img.png', 'caption');
    assert.equal(key, null);
    assert.ok(state.errors.some(a => a[0] === 'WA-BANNER'));
});

// --- recordMenuMessage / deleteMenuMessages --------------------------------------------

test('recordMenuMessage tracks sent menu keys and deleteMenuMessages cleans them', async () => {
    const { engine, state } = makeEngine();
    const { sock, sent } = sockDouble();
    engine.recordMenuMessage('rk', null);
    engine.recordMenuMessage('rk', { id: 'M1' });
    engine.recordMenuMessage('rk', { id: 'M2', remoteJid: 'r@s.whatsapp.net' });
    assert.equal(state.menuReplyMessages.get('rk').length, 2);

    await engine.deleteMenuMessages(sock, 'rk');
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map(s => s.content.delete.id), ['M1', 'M2']);
    assert.equal(state.menuReplyMessages.has('rk'), false);
});

test('deleteMenuMessages swallows per-message failures', async () => {
    const { engine, state } = makeEngine();
    const sock = { sendMessage: async () => { throw new Error('gone'); } };
    state.menuReplyMessages.set('rk', [{ id: 'M1', remoteJid: 'r@s.whatsapp.net' }]);
    await engine.deleteMenuMessages(sock, 'rk');
    assert.ok(state.errors.some(a => a[0] === 'WA-DEL'));
    assert.equal(state.menuReplyMessages.has('rk'), false);
});

// --- buildBugMenuText ---------------------------------------------------------------------

test('buildBugMenuText still carries the upstream free-variable bug (d3268bb) verbatim', () => {
    const { engine } = makeEngine();
    // currentMode lost its defining scope upstream when the bug-menu text was
    // lifted into a shared builder. The extraction preserves this exactly;
    // callers (.bugmenu / the BUG MENU vote) hit this ReferenceError today.
    assert.throws(() => engine.buildBugMenuText('.'), /currentMode is not defined/);
});
