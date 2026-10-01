import test from 'node:test';
import assert from 'node:assert/strict';

import { createSandboxPayloadCommands } from '../src/commands/testing/sandbox-payloads.js';

function createFixture({ dev = false } = {}) {
    const replies = [];
    const logs = [];
    const errors = [];
    const records = [];
    const relays = [];
    const delays = [];
    let lookupResult = [{ exists: true }];
    let lookupError = null;
    let relayError = null;
    let relayFailAfter = null;
    let cardImagePrepared = null;
    let cardImageError = null;

    const sock = {
        user: { id: '2348000000001:5@s.whatsapp.net' },
        async onWhatsApp(jid) {
            if (lookupError) throw lookupError;
            return lookupResult;
        },
        async relayMessage(target, payload, opts) {
            relays.push({ target, payload, opts });
            if (relayError) throw relayError;
            if (relayFailAfter !== null && relays.length > relayFailAfter) {
                throw new Error('relay boom');
            }
            return `rid-${relays.length}`;
        }
    };

    const commands = createSandboxPayloadCommands({
        isDevNumber: () => dev,
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        delay: async ms => { delays.push(ms); },
        isSupabaseEnabled: () => false,
        setSyncPaused: () => {},
        buildAndrozPayload: () => ({ kind: 'androz' }),
        buildTestfffMessage: (target, imageMessage) => ({
            message: { kind: 'testfff', target, imageMessage },
            key: { id: 'testfff-key' }
        }),
        prepareCardImage: async () => {
            if (cardImageError) throw cardImageError;
            return cardImagePrepared;
        },
        wireBytesOf: payload => JSON.stringify(payload).length,
        recordBugSends: (...args) => records.push(args),
        log: (...args) => logs.push(args),
        logError: (...args) => errors.push(args)
    });

    const byName = Object.fromEntries(commands.map(c => [c.name, c]));

    return {
        commands, byName, sock, replies, logs, errors, records, relays, delays,
        setLookupResult(v) { lookupResult = v; },
        setLookupError(v) { lookupError = v; },
        setRelayError(v) { relayError = v; },
        setRelayFailAfter(v) { relayFailAfter = v; },
        setCardImage(v) { cardImagePrepared = v; },
        setCardImageError(v) { cardImageError = v; },
        baseContext(overrides = {}) {
            return {
                sock,
                remoteJid: 'chat@s.whatsapp.net',
                message: { key: { remoteJid: 'sender@s.whatsapp.net' } },
                phoneNumber: '2348000000001',
                senderJid: 'sender@s.whatsapp.net',
                isSenderOwner: true,
                args: [],
                prefix: '.',
                pushName: 'Tester',
                botConfig: {},
                ...overrides
            };
        }
    };
}

test('registers exactly crash-hard and frz-oom with no aliases', () => {
    const fixture = createFixture();
    assert.equal(fixture.commands.length, 2);
    assert.deepEqual(fixture.commands.map(c => c.name).sort(), ['crash-hard', 'frz-oom']);
    for (const c of fixture.commands) assert.deepEqual(c.aliases, []);
});

test('non-owner non-dev is rejected for crash-hard', async () => {
    const fixture = createFixture({ dev: false });
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ isSenderOwner: false, args: ['2348111111111'] }));
    assert.equal(fixture.replies.length, 1);
    assert.match(fixture.replies[0].text, /Owner only/);
    assert.equal(fixture.relays.length, 0);
});

test('dev number is authorized even without isSenderOwner', async () => {
    const fixture = createFixture({ dev: true });
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ isSenderOwner: false, args: ['2348111111111', '1'] }));
    assert.equal(fixture.relays.length, 1);
});

test('bare crash-hard shows usage and never fires', async () => {
    const fixture = createFixture();
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: [] }));
    assert.match(fixture.replies[0].text, /crash-hard USAGE/);
    assert.equal(fixture.relays.length, 0);
});

test('invalid target shows usage', async () => {
    const fixture = createFixture();
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: ['abc'] }));
    assert.match(fixture.replies[0].text, /USAGE/);
    assert.equal(fixture.relays.length, 0);
});

test('targeting the bot\'s own number is rejected', async () => {
    const fixture = createFixture();
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: ['2348000000001', '1'] }));
    assert.match(fixture.replies[0].text, /Cannot target the bot's own number/);
    assert.equal(fixture.relays.length, 0);
});

test('target with no WhatsApp account is rejected', async () => {
    const fixture = createFixture();
    fixture.setLookupResult([{ exists: false }]);
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: ['2348111111111', '1'] }));
    assert.match(fixture.replies[0].text, /has no WhatsApp account/);
    assert.equal(fixture.relays.length, 0);
});

test('lookup failure still allows a best-effort send', async () => {
    const fixture = createFixture();
    fixture.setLookupError(new Error('down'));
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: ['2348111111111', '1'] }));
    assert.equal(fixture.relays.length, 1);
});

test('crash-hard defaults to 200 sends when no amount is given', async () => {
    const fixture = createFixture();
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: ['2348111111111'] }));
    assert.equal(fixture.relays.length, 200);
    assert.equal(fixture.relays[0].opts.participant, true);
    assert.equal(fixture.records.length, 1);
});

test('crash-hard honors an explicit count and paces with flood jitter above 10', async () => {
    const fixture = createFixture();
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: ['2348111111111', '15'] }));
    assert.equal(fixture.relays.length, 15);
    assert.equal(fixture.delays.length, 14);
    for (const ms of fixture.delays) assert.ok(ms >= 30 && ms < 70);
});

test('crash-hard uses 1.2s pacing when count is 10 or below', async () => {
    const fixture = createFixture();
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: ['2348111111111', '3'] }));
    assert.equal(fixture.relays.length, 3);
    assert.deepEqual(fixture.delays, [1200, 1200]);
});

test('crash-hard amount is clamped to 300', async () => {
    const fixture = createFixture();
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: ['2348111111111', '999'] }));
    assert.equal(fixture.relays.length, 300);
});

test('crash-hard records a partial failure and reports it', async () => {
    const fixture = createFixture();
    fixture.setRelayFailAfter(2);
    await fixture.byName['crash-hard'].execute(fixture.baseContext({ args: ['2348111111111', '5'] }));
    assert.equal(fixture.errors.length, 1);
    assert.match(fixture.replies.at(-1).text, /TEST ERROR/);
    assert.equal(fixture.records.length, 1);
    assert.equal(fixture.records[0][2].length, 2);
});

test('frz-oom falls back to text headers when the card image fails', async () => {
    const fixture = createFixture();
    fixture.setCardImageError(new Error('catbox down'));
    await fixture.byName['frz-oom'].execute(fixture.baseContext({ args: ['2348111111111', '2'] }));
    assert.equal(fixture.relays.length, 2);
    assert.match(fixture.replies[0].text, /frz-oom\/txt started/);
    assert.ok(fixture.logs.some(entry => entry.join(' ').includes('using text headers')));
});

test('frz-oom uses the prepared image when available', async () => {
    const fixture = createFixture();
    fixture.setCardImage({ url: 'cached-image' });
    await fixture.byName['frz-oom'].execute(fixture.baseContext({ args: ['2348111111111', '1'] }));
    assert.match(fixture.replies[0].text, /frz-oom\/img started/);
    assert.equal(fixture.relays[0].opts.messageId, 'testfff-key');
});

test('custom prefix in usage text reflects the invoked display name', async () => {
    const fixture = createFixture();
    await fixture.byName['frz-oom'].execute(fixture.baseContext({ args: [] }));
    assert.match(fixture.replies[0].text, /frz-oom USAGE/);
});

test('constructor requires every dependency to be a function', () => {
    assert.throws(() => createSandboxPayloadCommands({}), /require/);
});
