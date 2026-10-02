import test from 'node:test';
import assert from 'node:assert/strict';

import { createOneShotProbeService } from '../src/commands/testing/one-shot-probes.js';

function createFixture({ fromMe = false, dev = false } = {}) {
    const replies = [];
    const probes = [];
    const records = [];
    const logs = [];
    const errors = [];
    const lookups = [];
    let lookupResult = [{ exists: true }];
    let lookupError = null;
    let probeError = null;
    const sock = {
        user: { id: '2348000000001:5@s.whatsapp.net' },
        async onWhatsApp(jid) {
            lookups.push(jid);
            if (lookupError) throw lookupError;
            return lookupResult;
        }
    };
    const sendProbe = kind => async (_sock, jid) => {
        probes.push([kind, jid]);
        if (probeError) throw probeError;
        return { ids: [`${kind}-message`] };
    };
    const service = createOneShotProbeService({
        normalizeJid: jid => String(jid).replace(/:\d+(?=@)/, ''),
        isDevNumber: () => dev,
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        sendIozkProbe: sendProbe('iozk'),
        sendFiosProbe: sendProbe('fios'),
        sendStatusBugProbe: sendProbe('sbug'),
        recordBugSends: (...args) => records.push(args),
        log: (...args) => logs.push(args),
        logError: (...args) => errors.push(args)
    });
    return {
        service, sock, replies, probes, records, logs, errors, lookups,
        setLookupResult(value) { lookupResult = value; },
        setLookupError(value) { lookupError = value; },
        setProbeError(value) { probeError = value; },
        context: {
            sock,
            message: { key: { remoteJid: 'sender@s.whatsapp.net' } },
            phoneNumber: '2348000000001',
            remoteJid: 'chat@s.whatsapp.net',
            fromMe,
            words: ['.crash-ios', '2348111111111'],
            firstWord: '.crash-ios',
            prefix: '.'
        }
    };
}

test('non-probe input is not handled', async () => {
    const fixture = createFixture();
    fixture.context.words = ['.menu'];
    fixture.context.firstWord = '.menu';
    assert.equal(await fixture.service.handle(fixture.context), false);
    assert.equal(fixture.replies.length, 0);
});

test('probe commands reject callers who are neither owner nor developer', async () => {
    const fixture = createFixture();
    assert.equal(await fixture.service.handle(fixture.context), true);
    assert.equal(fixture.replies[0].text, '❌ Owner/dev only.');
    assert.equal(fixture.lookups.length, 0);
});

test('normalized bot identity authorizes an owner message', async () => {
    const fixture = createFixture();
    fixture.context.message.key.participant = '2348000000001@s.whatsapp.net';
    fixture.context.message.key.remoteJid = 'group@g.us';
    await fixture.service.handle(fixture.context);
    assert.equal(fixture.probes.length, 1);
});

test('one-shot commands reject an amount and point to matching flood command', async () => {
    for (const [name, flood] of [['crash-ios', 'crash-iosd'], ['frz-ios', 'frz-iosd']]) {
        const fixture = createFixture({ dev: true });
        fixture.context.words = [`.${name}`, '2348111111111', '10'];
        fixture.context.firstWord = `.${name}`;
        await fixture.service.handle(fixture.context);
        assert.match(fixture.replies[0].text, new RegExp(`\\.${name} is a one-shot`));
        assert.match(fixture.replies[0].text, new RegExp(`\\.${flood}`));
        assert.equal(fixture.probes.length, 0);
    }
});

test('invalid targets preserve command-specific usage guidance', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.context.words = ['.frz-ios', 'bad-target'];
    fixture.context.firstWord = '.frz-ios';
    await fixture.service.handle(fixture.context);
    assert.equal(fixture.replies[0].text, 'Usage: .frz-ios <number>');
});

test('bot own number is rejected before WhatsApp lookup', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.context.words = ['.crash-ios', '2348000000001'];
    await fixture.service.handle(fixture.context);
    assert.match(fixture.replies[0].text, /Cannot target the bot's own number/);
    assert.equal(fixture.lookups.length, 0);
});

test('missing WhatsApp account is reported without sending probe', async () => {
    const fixture = createFixture({ dev: true });
    fixture.setLookupResult([{ exists: false }]);
    await fixture.service.handle(fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Test number has no account: 2348111111111');
    assert.equal(fixture.probes.length, 0);
});

test('lookup failure preserves best-effort one-shot send', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.setLookupError(new Error('lookup unavailable'));
    await fixture.service.handle(fixture.context);
    assert.deepEqual(fixture.probes, [['iozk', '2348111111111@s.whatsapp.net']]);
    assert.deepEqual(fixture.records[0], [
        '2348000000001',
        '2348111111111@s.whatsapp.net',
        ['iozk-message']
    ]);
    assert.match(fixture.replies[0].text, /sending/);
    assert.equal(fixture.replies[1].text, '🧪 .crash-ios probe sent to 2348111111111.');
});

test('status-bug posts via the status pipeline and records a status entry', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.context.words = ['.status-bug', '2348333333333'];
    fixture.context.firstWord = '.status-bug';
    await fixture.service.handle(fixture.context);
    assert.deepEqual(fixture.probes, [['sbug', '2348333333333@s.whatsapp.net']]);
    assert.deepEqual(fixture.records[0], [
        '2348000000001',
        '2348333333333@s.whatsapp.net',
        ['sbug-message'],
        { status: true }
    ]);
    assert.match(fixture.replies[0].text, /\.status-bug sending/);
    assert.match(fixture.replies[1].text, /self-shielded/);
    assert.equal(fixture.logs[0][0], 'SBUG');
});

test('custom-prefix frz-ios dispatches the F_OS probe with preserved logging', async () => {
    const fixture = createFixture({ dev: true });
    fixture.context.words = ['!frz-ios', '2348222222222'];
    fixture.context.firstWord = '!frz-ios';
    fixture.context.prefix = '!';
    await fixture.service.handle(fixture.context);
    assert.deepEqual(fixture.probes, [['fios', '2348222222222@s.whatsapp.net']]);
    assert.equal(fixture.logs[0][0], 'FIS');
    assert.match(fixture.logs[0][1], /F_OS probe sent to test target 2348222222222/);
    assert.equal(fixture.replies[1].text, '🧪 .frz-ios probe sent to 2348222222222.');
});

test('probe failures are contained, logged, and reported', async () => {
    const fixture = createFixture({ fromMe: true });
    fixture.setProbeError(new Error('transport failed'));
    await fixture.service.handle(fixture.context);
    assert.deepEqual(fixture.errors[0].slice(0, 2), ['CIS', '2348000000001: IOZK probe failed']);
    assert.equal(fixture.records.length, 0);
    assert.equal(fixture.replies[1].text, '❌ .crash-ios send failed: transport failed');
});
