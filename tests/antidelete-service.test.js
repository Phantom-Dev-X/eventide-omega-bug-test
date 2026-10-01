import test from 'node:test';
import assert from 'node:assert/strict';

import { createAntideleteService } from '../src/moderation/antidelete-service.js';

function normalizeAntideleteConfig(parsed) {
    const empty = { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } };
    const raw = parsed?.antidelete;
    if (raw && typeof raw === 'object' && (raw.endpoints || typeof raw.enabled === 'boolean')) {
        return {
            enabled: !!raw.enabled,
            endpoints: {
                groups: Array.isArray(raw.endpoints?.groups) ? [...raw.endpoints.groups] : [],
                channels: Array.isArray(raw.endpoints?.channels) ? [...raw.endpoints.channels] : [],
                contacts: Array.isArray(raw.endpoints?.contacts) ? [...raw.endpoints.contacts] : []
            }
        };
    }
    return empty;
}

function normalizeJid(jid) {
    if (!jid) return jid;
    return String(jid).replace(/:\d+(?=@)/, '');
}

function createFixture() {
    const configStore = new Map();
    const sent = [];
    const logs = [];
    const autoreactSessions = new Map();
    const antiConfigSessions = new Map();
    const warnConfigSessions = new Map();
    const recentMessages = new Map();
    const messageStore = new Map(); // id -> message content, simulating getMessageFromStore

    const sock = {
        user: { id: '234800000bot@s.whatsapp.net' },
        async sendMessage(jid, payload) {
            sent.push({ jid, payload });
            return { key: { id: `msg-${sent.length}` } };
        }
    };

    const service = createAntideleteService({
        loadBotConfig: phoneNumber => configStore.get(phoneNumber) || {},
        saveBotConfig: (phoneNumber, cfg) => configStore.set(phoneNumber, cfg),
        normalizeAntideleteConfig,
        listParticipatingGroups: async () => [
            { id: '1@g.us', name: 'Alpha' },
            { id: '2@g.us', name: 'Beta' }
        ],
        buildOmegaTerminal: body => `[TERMINAL]\n${body}`,
        sendMenuPoll: async (s, remoteJid, phoneNumber, question, options, ids) => {
            sent.push({ jid: remoteJid, payload: { pollQuestion: question, options, ids } });
            return { key: { id: 'poll-1' } };
        },
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        recentMessages,
        isIgnoredRemoteJid: remoteJid => remoteJid === 'status@broadcast',
        jidNormalizedUser: normalizeJid,
        getMessageFromStore: async key => messageStore.get(key?.id) || null,
        log: (...args) => logs.push(args)
    });

    return { service, sock, configStore, sent, logs, autoreactSessions, antiConfigSessions, warnConfigSessions, recentMessages, messageStore };
}

test('constructor requires every function dependency', () => {
    assert.throws(() => createAntideleteService({}), /require/);
});

test('constructor requires the shared session/state Maps', () => {
    assert.throws(() => createAntideleteService({
        loadBotConfig: () => ({}),
        saveBotConfig: () => {},
        normalizeAntideleteConfig: p => p,
        listParticipatingGroups: async () => [],
        buildOmegaTerminal: b => b,
        sendMenuPoll: async () => {},
        isIgnoredRemoteJid: () => false,
        jidNormalizedUser: j => j,
        getMessageFromStore: async () => null,
        log: () => {}
    }), /Map/);
});

test('getAntideleteState/saveAntideleteState round-trip and clear legacy cfg.anti.antidelete', () => {
    const { service, configStore } = createFixture();
    configStore.set('234801', { anti: { antidelete: { '1@g.us': 'on' } } });

    service.saveAntideleteState('234801', { enabled: true, endpoints: { groups: ['1@g.us'], channels: [], contacts: [] } });
    const cfg = configStore.get('234801');
    assert.equal(cfg.antidelete.enabled, true);
    assert.deepEqual(cfg.antidelete.endpoints.groups, ['1@g.us']);
    assert.equal(cfg.anti.antidelete, undefined, 'legacy anti.antidelete bucket should be cleared');

    const state = service.getAntideleteState('234801');
    assert.equal(state.enabled, true);
    assert.deepEqual(state.endpoints.groups, ['1@g.us']);
});

test('applyWardEndpoint("ad", ...) appends to the antidelete groups/channels endpoint list without duplicating', () => {
    const { service, configStore } = createFixture();
    service.applyWardEndpoint('234801', 'ad', 'group', '1@g.us');
    service.applyWardEndpoint('234801', 'ad', 'group', '1@g.us'); // duplicate, should be ignored
    service.applyWardEndpoint('234801', 'ad', 'channel', 'chan@newsletter');

    const state = service.getAntideleteState('234801');
    assert.deepEqual(state.endpoints.groups, ['1@g.us']);
    assert.deepEqual(state.endpoints.channels, ['chan@newsletter']);
});

test('applyWardEndpoint("ar", ...) appends to the autoreact config bucket', () => {
    const { service, configStore } = createFixture();
    service.applyWardEndpoint('234801', 'ar', 'group', '1@g.us');
    const cfg = configStore.get('234801');
    assert.deepEqual(cfg.autoreact.endpoints.groups, ['1@g.us']);
});

test('applyWardEndpoint(generic ward, ...) marks cfg.anti[ward][jid] = "on"', () => {
    const { service, configStore } = createFixture();
    service.applyWardEndpoint('234801', 'antilink', 'group', '1@g.us');
    const cfg = configStore.get('234801');
    assert.equal(cfg.anti.antilink['1@g.us'], 'on');
});

test('offerGroupPickPoll stores the right session map per ward, sends intro + poll, and records pollKey', async () => {
    const { service, sock, sent, antiConfigSessions } = createFixture();
    const poll = await service.offerGroupPickPoll(sock, '9@s.whatsapp.net', '234801', 'ad', 'Choose a group');

    assert.equal(poll.key.id, 'poll-1');
    const sess = antiConfigSessions.get('234801');
    assert.equal(sess.step, 'pick_group');
    assert.equal(sess.rows.length, 2);
    assert.equal(sess.pollKey.id, 'poll-1');

    const pollMsg = sent.find(m => m.payload.pollQuestion);
    assert.deepEqual(pollMsg.payload.options, ['Alpha', 'Beta', 'Paste link or ID']);
    assert.deepEqual(pollMsg.payload.ids, ['ad_grp_0', 'ad_grp_1', 'ad_grp_paste']);
});

test('listAntideleteEndpoints formats groups/channels/contacts and reports an empty state', () => {
    const { service } = createFixture();
    const empty = service.listAntideleteEndpoints({ endpoints: { groups: [], channels: [], contacts: [] } });
    assert.match(empty.list, /no endpoints yet/);

    const filled = service.listAntideleteEndpoints({
        endpoints: { groups: ['1@g.us'], channels: ['c@newsletter'], contacts: ['234801@s.whatsapp.net'] }
    });
    assert.match(filled.list, /GROUPS/);
    assert.match(filled.list, /CHANNELS/);
    assert.match(filled.list, /CONTACTS/);
    assert.equal(filled.rows.length, 3);
});

test('antideleteWatchesChat respects enabled flag, ignored jids, and per-kind endpoint matching', () => {
    const { service } = createFixture();
    const ad = {
        enabled: true,
        endpoints: { groups: ['1@g.us'], channels: ['12036399@newsletter'], contacts: ['234801@s.whatsapp.net'] }
    };
    assert.equal(service.antideleteWatchesChat({ enabled: false, endpoints: ad.endpoints }, '1@g.us'), false);
    assert.equal(service.antideleteWatchesChat(ad, 'status@broadcast'), false, 'ignored remoteJid should short-circuit');
    assert.equal(service.antideleteWatchesChat(ad, '1@g.us'), true);
    assert.equal(service.antideleteWatchesChat(ad, '2@g.us'), false);
    assert.equal(service.antideleteWatchesChat(ad, '12036399@newsletter'), true, 'exact channel match');
    assert.equal(service.antideleteWatchesChat(ad, '234801:5@s.whatsapp.net'), true, 'contact matches via normalized jid');
    assert.equal(service.antideleteWatchesChat(ad, '234999@s.whatsapp.net'), false);
});

test('extractRevokeRef recognizes revoke/stub/legacy shapes and ignores edits', () => {
    const { service } = createFixture();
    assert.equal(service.extractRevokeRef({}, { message: { protocolMessage: { type: 14 } } }), null);
    assert.deepEqual(
        service.extractRevokeRef({}, { message: { protocolMessage: { type: 0, key: { id: 'abc' } } } }),
        { id: 'abc' }
    );
    assert.deepEqual(
        service.extractRevokeRef({}, { protocolMessageKey: { id: 'def' } }),
        { id: 'def' }
    );
    assert.deepEqual(
        service.extractRevokeRef({ id: 'fallback' }, { messageStubType: 1 }),
        { id: 'fallback' }
    );
    assert.deepEqual(
        service.extractRevokeRef({ id: 'REVOKE_xyz' }, {}),
        { id: 'REVOKE_xyz' }
    );
    assert.equal(service.extractRevokeRef({ id: 'plain' }, {}), null);
});

test('recoverDeletedContent prefers the message store, then scans recentMessages by id/suffix', async () => {
    const { service, messageStore, recentMessages } = createFixture();
    messageStore.set('from-store', { conversation: 'hi' });
    assert.deepEqual(await service.recoverDeletedContent({ id: 'from-store' }), { conversation: 'hi' });

    recentMessages.set('somekey', { key: { id: 'by-id' }, message: { conversation: 'recent-by-id' } });
    assert.deepEqual(await service.recoverDeletedContent({ id: 'by-id' }), { conversation: 'recent-by-id' });

    recentMessages.set('chat:suffix-match', { key: { id: 'other' }, message: { conversation: 'recent-by-suffix' } });
    assert.deepEqual(await service.recoverDeletedContent({ id: 'suffix-match' }), { conversation: 'recent-by-suffix' });

    assert.equal(await service.recoverDeletedContent({ id: 'missing' }), null);
});

test('handleAntideleteRevoke no-ops without a chat jid or when the chat is not watched', async () => {
    const { service, sock, sent, configStore } = createFixture();
    await service.handleAntideleteRevoke(sock, '234801', {}, {});
    assert.equal(sent.length, 0);

    configStore.set('234801', { antidelete: { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } } });
    await service.handleAntideleteRevoke(sock, '234801', { remoteJid: '1@g.us' }, { remoteJid: '1@g.us', id: 'm1' });
    assert.equal(sent.length, 0);
});

test('handleAntideleteRevoke forwards recovered content and notifies the owner chat', async () => {
    const { service, sock, sent, configStore, messageStore } = createFixture();
    configStore.set('234801', { antidelete: { enabled: true, endpoints: { groups: ['1@g.us'], channels: [], contacts: [] } } });
    messageStore.set('m1', { conversation: 'deleted text' });

    await service.handleAntideleteRevoke(
        sock, '234801',
        { remoteJid: '1@g.us', id: 'm1', participant: '2@s.whatsapp.net' },
        { remoteJid: '1@g.us', id: 'm1' }
    );

    const forward = sent.find(m => m.payload.forward);
    assert.ok(forward, 'expected a forwarded copy of the recovered content');
    assert.equal(forward.jid, '234800000bot@s.whatsapp.net');

    const notice = sent.find(m => m.payload.text?.includes('ANTIDELETE'));
    assert.ok(notice);
    assert.match(notice.payload.text, /a group/);
    assert.match(notice.payload.text, /\+2/);
    assert.match(notice.payload.text, /Forwarded the deleted message above/);
});

test('handleAntideleteRevoke still notifies the owner when content could not be recovered', async () => {
    const { service, sock, sent, configStore } = createFixture();
    configStore.set('234801', { antidelete: { enabled: true, endpoints: { groups: ['1@g.us'], channels: [], contacts: [] } } });

    await service.handleAntideleteRevoke(
        sock, '234801',
        { remoteJid: '1@g.us', id: 'unrecoverable', participant: '2@s.whatsapp.net' },
        { remoteJid: '1@g.us', id: 'unrecoverable' }
    );

    assert.equal(sent.some(m => m.payload.forward), false);
    const notice = sent.find(m => m.payload.text?.includes('ANTIDELETE'));
    assert.match(notice.payload.text, /could not be recovered/);
});

test('interface is frozen', () => {
    const { service } = createFixture();
    assert.throws(() => { service.getAntideleteState = () => {}; }, TypeError);
});
