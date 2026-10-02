import test from 'node:test';
import assert from 'node:assert/strict';

import { createFloodProbeService } from '../src/commands/testing/flood-probes.js';

function createFixture({ fromMe = false, dev = false, groupMember = true } = {}) {
    const replies = [];
    const logs = [];
    const errors = [];
    const records = [];
    const lookups = [];
    const delays = [];
    const sentCalls = {
        iozk: [], fios: [], crashmsg: [], ioszk: [], crashclick: [], gbhard: [], gbstatus: []
    };
    let lookupResult = [{ exists: true }];
    let lookupError = null;
    let inviteResult = { id: 'resolved@g.us' };
    let inviteError = null;
    let groupMetadataResult = {
        participants: [
            { id: '2348000000001:5@s.whatsapp.net' },
            { id: '2348555555555@s.whatsapp.net' },
            { id: '2348666666666@s.whatsapp.net' }
        ]
    };
    let groupMetadataError = null;
    let failAfter = null;

    const sock = {
        user: { id: '2348000000001:5@s.whatsapp.net' },
        async onWhatsApp(jid) {
            lookups.push(jid);
            if (lookupError) throw lookupError;
            return lookupResult;
        },
        async groupGetInviteInfo(code) {
            if (inviteError) throw inviteError;
            return inviteResult;
        },
        async groupMetadata(jid) {
            if (groupMetadataError) throw groupMetadataError;
            return groupMetadataResult;
        }
    };

    function makeSender(kind, shape) {
        return async (...args) => {
            sentCalls[kind].push(args);
            if (failAfter !== null && sentCalls[kind].length > failAfter) {
                throw new Error(`${kind} boom`);
            }
            return shape(sentCalls[kind].length);
        };
    }

    const service = createFloodProbeService({
        normalizeJid: jid => String(jid).replace(/:\d+(?=@)/, ''),
        isDevNumber: () => dev,
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        delay: async (ms) => { delays.push(ms); },
        isSupabaseEnabled: () => false,
        setSyncPaused: () => {},
        sendIozkProbe: makeSender('iozk', n => ({ ids: [`iozk-${n}`] })),
        sendFiosProbe: makeSender('fios', n => ({ ids: [`fios-${n}`] })),
        sendCrashmsgProbe: makeSender('crashmsg', n => ({ sent: 10, wireBytes: 123, ids: [`crashmsg-${n}`] })),
        sendIoszkProbe: makeSender('ioszk', n => ({ sent: 60, wireBytes: 456, ids: [`ioszk-${n}`] })),
        sendCrashclickProbe: makeSender('crashclick', n => ({ ids: [`crashclick-${n}`] })),
        sendGbHardProbe: makeSender('gbhard', n => ({ wireBytes: 789, ids: [`gbhard-${n}`] })),
        sendGbStatusProbe: makeSender('gbstatus', n => ({ wireBytes: 812, ids: [`gbstatus-${n}`] })),
        recordBugSends: (...args) => records.push(args),
        log: (...args) => logs.push(args),
        logError: (...args) => errors.push(args),
        fetchThumbnail: async () => Buffer.from('thumb')
    });

    return {
        service, sock, replies, logs, errors, records, lookups, delays, sentCalls,
        setLookupResult(value) { lookupResult = value; },
        setLookupError(value) { lookupError = value; },
        setInviteResult(value) { inviteResult = value; },
        setInviteError(value) { inviteError = value; },
        setGroupMetadata(value) { groupMetadataResult = value; },
        setGroupMetadataError(value) { groupMetadataError = value; },
        setFailAfter(value) { failAfter = value; },
        baseContext(overrides = {}) {
            return {
                sock,
                message: { key: { remoteJid: 'sender@s.whatsapp.net' } },
                phoneNumber: '2348000000001',
                remoteJid: 'chat@s.whatsapp.net',
                fromMe,
                words: [],
                firstWord: '',
                prefix: '.',
                ...overrides
            };
        }
    };
}

test('unrelated commands are not intercepted', async () => {
    const fixture = createFixture();
    const handled = await fixture.service.handle(fixture.baseContext({ words: ['.menu'], firstWord: '.menu' }));
    assert.equal(handled, false);
    assert.equal(fixture.replies.length, 0);
});

test('non-owner non-dev is rejected for every probe command', async () => {
    const fixture = createFixture({ fromMe: false, dev: false });
    for (const firstWord of ['.crash-iosd', '.frz-iosd', '.andro-nuke', '.ios-zk', '.gb', '.gb-hard', '.gb-status']) {
        const handled = await fixture.service.handle(fixture.baseContext({ words: [firstWord], firstWord }));
        assert.equal(handled, true);
    }
    assert.equal(fixture.replies.length, 7);
    for (const reply of fixture.replies) {
        assert.match(reply.text, /Owner\/dev only/);
    }
});

test('dev number is authorized even when not fromMe', async () => {
    const fixture = createFixture({ fromMe: false, dev: true });
    const handled = await fixture.service.handle(fixture.baseContext({
        words: ['.crash-iosd'],
        firstWord: '.crash-iosd'
    }));
    assert.equal(handled, true);
    assert.match(fixture.replies[0].text, /USAGE/);
});

test('crash-iosd requires a trailing numeric amount', async () => {
    const fixture = createFixture({ fromMe: true });
    const handled = await fixture.service.handle(fixture.baseContext({
        words: ['.crash-iosd', '2348111111111'],
        firstWord: '.crash-iosd'
    }));
    assert.equal(handled, true);
    assert.match(fixture.replies[0].text, /USAGE/);
    assert.equal(fixture.sentCalls.iozk.length, 0);
});

test('crash-iosd floods the iozk probe the requested amount of times', async () => {
    const fixture = createFixture({ fromMe: true });
    const handled = await fixture.service.handle(fixture.baseContext({
        words: ['.crash-iosd', '2348111111111', '3'],
        firstWord: '.crash-iosd'
    }));
    assert.equal(handled, true);
    assert.equal(fixture.sentCalls.iozk.length, 3);
    assert.equal(fixture.sentCalls.fios.length, 0);
    const lastReply = fixture.replies.at(-1);
    assert.match(lastReply.text, /payload sent ×3/);
    assert.equal(fixture.records.length, 1);
});

test('frz-iosd floods the fios probe instead of iozk', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.frz-iosd', '2348111111111', '2'],
        firstWord: '.frz-iosd'
    }));
    assert.equal(fixture.sentCalls.fios.length, 2);
    assert.equal(fixture.sentCalls.iozk.length, 0);
});

test('amount above 300 is clamped to 300', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.crash-iosd', '2348111111111', '999'],
        firstWord: '.crash-iosd'
    }));
    assert.equal(fixture.sentCalls.iozk.length, 300);
});

test('iosd rejects targeting the bot\'s own number', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.crash-iosd', '2348000000001', '2'],
        firstWord: '.crash-iosd'
    }));
    assert.match(fixture.replies[0].text, /Cannot target the bot's own number/);
    assert.equal(fixture.sentCalls.iozk.length, 0);
});

test('iosd rejects a target with no WhatsApp account', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.setLookupResult([{ exists: false }]);
    await fixture.service.handle(fixture.baseContext({
        words: ['.crash-iosd', '2348111111111', '2'],
        firstWord: '.crash-iosd'
    }));
    assert.match(fixture.replies[0].text, /has no account/);
    assert.equal(fixture.sentCalls.iozk.length, 0);
});

test('iosd still sends when the account lookup throws (best effort)', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.setLookupError(new Error('lookup down'));
    await fixture.service.handle(fixture.baseContext({
        words: ['.crash-iosd', '2348111111111', '2'],
        firstWord: '.crash-iosd'
    }));
    assert.equal(fixture.sentCalls.iozk.length, 2);
});

test('iosd records a failure partway through the flood', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.setFailAfter(1);
    await fixture.service.handle(fixture.baseContext({
        words: ['.crash-iosd', '2348111111111', '3'],
        firstWord: '.crash-iosd'
    }));
    assert.equal(fixture.errors.length, 1);
    const lastReply = fixture.replies.at(-1);
    assert.match(lastReply.text, /sent ×1 then failed/);
});

test('andro-nuke with no args shows usage', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.andro-nuke'],
        firstWord: '.andro-nuke'
    }));
    assert.match(fixture.replies[0].text, /ANDRO-NUKE USAGE/);
});

test('andro-nuke defaults to one round when amount omitted', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.andro-nuke', '2348111111111'],
        firstWord: '.andro-nuke'
    }));
    assert.equal(fixture.sentCalls.crashmsg.length, 1);
    assert.match(fixture.replies.at(-1).text, /1 rounds, 10 payloads/);
});

test('andro-nuke runs the requested number of rounds with inter-round delay', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.andro-nuke', '2348111111111', '3'],
        firstWord: '.andro-nuke'
    }));
    assert.equal(fixture.sentCalls.crashmsg.length, 3);
    assert.equal(fixture.delays.length, 2);
});

test('ios-zk requires exactly one argument', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.ios-zk'],
        firstWord: '.ios-zk'
    }));
    assert.match(fixture.replies[0].text, /IOS-ZK USAGE/);
    assert.equal(fixture.sentCalls.ioszk.length, 0);
});

test('ios-zk fetches a thumbnail and sends the probe once', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.ios-zk', '2348111111111'],
        firstWord: '.ios-zk'
    }));
    assert.equal(fixture.sentCalls.ioszk.length, 1);
    assert.match(fixture.replies.at(-1).text, /sent 60 payloads \(thumb 5B\)/);
});

test('gb requires an argument', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb'],
        firstWord: '.gb'
    }));
    assert.match(fixture.replies[0].text, /GB USAGE/);
});

test('gb yes requires being inside a group', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb', 'yes'],
        firstWord: '.gb',
        remoteJid: 'chat@s.whatsapp.net'
    }));
    assert.match(fixture.replies.at(-1).text, /must be run inside a group/);
});

test('gb yes inside a group fires ten crashclick probes', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb', 'yes'],
        firstWord: '.gb',
        remoteJid: 'group123@g.us'
    }));
    assert.equal(fixture.sentCalls.crashclick.length, 10);
    assert.match(fixture.replies.at(-1).text, /CrashClick ×10\/10/);
});

test('gb resolves an invite link to a group jid', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.setInviteResult({ id: 'invited@g.us' });
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb', 'https://chat.whatsapp.com/ABC123'],
        firstWord: '.gb'
    }));
    assert.equal(fixture.sentCalls.crashclick.length, 10);
    assert.equal(fixture.records[0][1], 'invited@g.us');
});

test('gb reports when the invite link cannot be resolved', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.setInviteError(new Error('expired'));
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb', 'https://chat.whatsapp.com/ABC123'],
        firstWord: '.gb'
    }));
    assert.match(fixture.replies[0].text, /could not be resolved/);
    assert.equal(fixture.sentCalls.crashclick.length, 0);
});

test('gb accepts a bare group jid', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb', 'direct@g.us'],
        firstWord: '.gb'
    }));
    assert.equal(fixture.sentCalls.crashclick.length, 10);
});

test('gb-hard defaults to ten payloads and reports wire size', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb-hard', 'direct@g.us'],
        firstWord: '.gb-hard'
    }));
    assert.equal(fixture.sentCalls.gbhard.length, 10);
    assert.match(fixture.replies.at(-1).text, /789B wire each/);
});

test('gb-status targets members via the status pipeline and shields the bot account', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb-status', 'direct@g.us'],
        firstWord: '.gb-status'
    }));
    assert.equal(fixture.sentCalls.gbstatus.length, 3);
    const call = fixture.sentCalls.gbstatus[0];
    assert.equal(call[1], 'direct@g.us');
    // audience = members MINUS the bot's own account (2348000000001)
    assert.deepEqual(call[2], ['2348555555555@s.whatsapp.net', '2348666666666@s.whatsapp.net']);
    // recorded as status entries so /unbug deletes them from status@broadcast
    assert.deepEqual(fixture.records[0][3], { status: true });
    assert.match(fixture.replies[0].text, /shielded/i);
    assert.match(fixture.replies.at(-1).text, /2 member/);
});

test('gb-status reports missing members instead of firing', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.setGroupMetadata({ participants: [{ id: '2348000000001:5@s.whatsapp.net' }] });
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb-status', 'direct@g.us'],
        firstWord: '.gb-status'
    }));
    assert.equal(fixture.sentCalls.gbstatus.length, 0);
    assert.match(fixture.replies.at(-1).text, /No other members/);
});

test('gb-hard honors a custom amount capped at 100', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb-hard', 'direct@g.us', '500'],
        firstWord: '.gb-hard'
    }));
    assert.equal(fixture.sentCalls.gbhard.length, 100);
});

test('gb-hard records sends and reports partial failure', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.setFailAfter(2);
    await fixture.service.handle(fixture.baseContext({
        words: ['.gb-hard', 'direct@g.us', '5'],
        firstWord: '.gb-hard'
    }));
    assert.equal(fixture.errors.length, 1);
    assert.match(fixture.replies.at(-1).text, /sent ×2 then failed/);
    assert.equal(fixture.records.length, 1);
});

test('custom prefix is recognized for every command', async () => {
    const fixture = createFixture({ fromMe: true });
    await fixture.service.handle(fixture.baseContext({
        words: ['!gb', 'direct@g.us'],
        firstWord: '!gb',
        prefix: '!'
    }));
    assert.equal(fixture.sentCalls.crashclick.length, 10);
});

test('constructor requires every dependency to be a function', () => {
    assert.throws(() => createFloodProbeService({}), /requires/);
});
