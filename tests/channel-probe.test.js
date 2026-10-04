import test from 'node:test';
import assert from 'node:assert/strict';

import { createChannelProbeService } from '../src/commands/system/channel-probe.js';

function createFixture({ fromMe = true, dev = false } = {}) {
    const replies = [];
    const logs = [];
    const errors = [];
    const calls = [];
    const sock = {
        user: { id: '2348000000001:5@s.whatsapp.net' },
        async newsletterMetadata(type, key) {
            calls.push(['metadata', type, key]);
            return { id: '123@newsletter', name: 'Test Channel', subscribersCount: 500 };
        },
        async newsletterAdminMetadata(jid) { calls.push(['adminMeta', jid]); return { admins: { count: 2 } }; },
        async newsletterAdminCount(jid) { calls.push(['adminCount', jid]); return 2; },
        async newsletterSubscribers(jid) {
            calls.push(['subs', jid]);
            return { edges: [{ node: { contact: { jid: '2348999999999@s.whatsapp.net' } } }] };
        },
        async newsletterFetchMessages(jid, count) {
            calls.push(['messages', jid, count]);
            return { messages: [{ message_server_id: 175 }, { message_server_id: 176 }] };
        },
        async newsletterReactionSenders(jid, sid) {
            calls.push(['reactors', jid, sid]);
            return sid === '175'
                ? { senders: [{ sender: '2348111111111@s.whatsapp.net' }, { sender: '98765432109876@lid' }] }
                : {};
        },
        async newsletterPollVoterList(jid, sid) { calls.push(['voters', jid, sid]); return {}; },
        async newsletterViewStats(jid, sid) { calls.push(['views', jid, sid]); return { views: 42 }; },
        async newsletterChangeOwner(jid, newOwner) { calls.push(['changeOwner', jid, newOwner]); return {}; }
    };
    const service = createChannelProbeService({
        normalizeJid: jid => String(jid).replace(/:\d+(?=@)/, ''),
        isDevNumber: () => dev,
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        log: (...args) => logs.push(args),
        logError: (...args) => errors.push(args)
    });
    const baseContext = overrides => ({
        sock, message: { key: { remoteJid: 'sender@s.whatsapp.net' } },
        phoneNumber: '2348000000001', remoteJid: 'chat@s.whatsapp.net',
        fromMe, words: ['.chan-probe', 'x'], firstWord: '.chan-probe', prefix: '.', ...overrides
    });
    return { service, sock, replies, logs, errors, calls, baseContext };
}

test('non-channel-probe input is not handled', async () => {
    const f = createFixture();
    assert.equal(await f.service.handle(f.baseContext({ firstWord: '.menu', words: ['.menu'] })), false);
});

test('chan-probe requires owner or dev', async () => {
    const f = createFixture({ fromMe: false, dev: false });
    assert.equal(await f.service.handle(f.baseContext({})), true);
    assert.match(f.replies[0].text, /Owner\/dev only/);
});

test('chan-probe harvests phone + lid identities from every query', async () => {
    const f = createFixture();
    await f.service.handle(f.baseContext({
        words: ['.chan-probe', 'https://whatsapp.com/channel/ABC123xyz'],
        firstWord: '.chan-probe'
    }));
    const report = f.replies.at(-1).text;
    assert.match(report, /Test Channel/);
    assert.match(report, /2348999999999@s\.whatsapp\.net/);   // from subscribers
    assert.match(report, /2348111111111@s\.whatsapp\.net/);   // from reaction senders
    assert.match(report, /98765432109876@lid/);               // lid harvested
    assert.doesNotMatch(report, /2348000000001@s\.whatsapp\.net/); // bot self excluded
});

test('chan-owner transfers ownership to the bot account', async () => {
    const f = createFixture();
    await f.service.handle(f.baseContext({
        words: ['.chan-owner', 'https://whatsapp.com/channel/ABC123xyz'],
        firstWord: '.chan-owner'
    }));
    assert.deepEqual(f.calls.at(-1), ['changeOwner', '123@newsletter', '2348000000001@s.whatsapp.net']);
    assert.match(f.replies.at(-1).text, /Ownership transferred/);
});
