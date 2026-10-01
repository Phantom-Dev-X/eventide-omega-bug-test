import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createSudoCommands } from '../src/commands/system/sudo.js';

function createFixture({ owner = false, dev = false, sudos, quotedContext = null } = {}) {
    const replies = [];
    const calls = [];
    const config = { sudos };
    const sock = {};
    const definitions = createSudoCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        isDevNumber: () => dev,
        loadBotConfig: phoneNumber => {
            calls.push(['loadBotConfig', phoneNumber]);
            return config;
        },
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args]),
        getQuotedContext: () => quotedContext,
        normalizeDigits: value => String(value || '').replace(/\D/g, ''),
        normalizeJid: jid => String(jid).replace(':4@', '@')
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        config,
        context: {
            sock,
            remoteJid: 'chat@s.whatsapp.net',
            message: { key: { id: 'command-message' } },
            phoneNumber: '2348000000001',
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: []
        }
    };
}

test('all sudo commands reject unauthorized callers before loading config', async () => {
    const fixture = createFixture();
    for (const command of ['.addsudo', '.delsudo', '.sudos']) {
        await fixture.registry.execute(command, fixture.context);
    }
    assert.equal(fixture.replies.every(reply => reply.text === '❌ Owner/Dev only.'), true);
    assert.equal(fixture.calls.length, 0);
});

test('sudo listing normalizes stored values and preserves empty/list output', async () => {
    const empty = createFixture({ owner: true });
    await empty.registry.execute('.listsudos', empty.context);
    assert.match(empty.replies[0].text, /no sudoes yet/);
    assert.deepEqual(empty.config.sudos, []);
    assert.equal(empty.calls.some(call => call[0] === 'saveBotConfig'), false);

    const populated = createFixture({ dev: true, sudos: ['+234 800 000 0002', '', null, '2348000000003'] });
    await populated.registry.execute('.sudos', populated.context);
    assert.deepEqual(populated.config.sudos, ['2348000000002', '2348000000003']);
    assert.match(populated.replies[0].text, /\[1\] 2348000000002/);
    assert.match(populated.replies[0].text, /\[2\] 2348000000003/);
});

test('addsudo requires a resolvable target and preserves usage guidance', async () => {
    const fixture = createFixture({ owner: true, sudos: [] });
    await fixture.registry.execute('.addsudo', fixture.context);
    assert.match(fixture.replies[0].text, /\.addsudo 234xxxxxxxxx/);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
});

test('addsudo prioritizes quoted sender over argument and mention', async () => {
    const fixture = createFixture({
        owner: true,
        sudos: [],
        quotedContext: {
            participant: '2348000000009:4@s.whatsapp.net',
            mentionedJid: ['2348000000008@s.whatsapp.net']
        }
    });
    fixture.context.args = ['2348000000007'];
    await fixture.registry.execute('.addsudo', fixture.context);
    assert.deepEqual(fixture.config.sudos, ['23480000000094']);
    assert.match(fixture.replies[0].text, /SUDO GRANTED\* :: 23480000000094/);
});

test('addsudo resolves numeric arguments before mention metadata', async () => {
    const fixture = createFixture({
        dev: true,
        sudos: [],
        quotedContext: { mentionedJid: ['2348000000008@s.whatsapp.net'] }
    });
    fixture.context.args = ['+234 800 000 0007'];
    await fixture.registry.execute('.addsudo', fixture.context);
    assert.deepEqual(fixture.config.sudos, ['2348000000007']);
});

test('addsudo resolves mention JIDs when no numeric argument exists', async () => {
    const fixture = createFixture({
        owner: true,
        sudos: [],
        quotedContext: { mentionedJid: ['2348000000008:4@s.whatsapp.net'] }
    });
    fixture.context.args = ['@Person'];
    await fixture.registry.execute('.addsudo', fixture.context);
    assert.deepEqual(fixture.config.sudos, ['2348000000008']);
});

test('addsudo avoids duplicates but preserves save and success behavior', async () => {
    const fixture = createFixture({ owner: true, sudos: ['2348000000002'] });
    fixture.context.args = ['2348000000002'];
    await fixture.registry.execute('.addsudo', fixture.context);
    assert.deepEqual(fixture.config.sudos, ['2348000000002']);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
    assert.match(fixture.replies[0].text, /SUDO GRANTED/);
});

test('delsudo reports absent targets and removes existing targets', async () => {
    const fixture = createFixture({ owner: true, sudos: ['2348000000002', '2348000000003'] });
    fixture.context.args = ['2348000000009'];
    await fixture.registry.execute('.removesudo', fixture.context);
    assert.match(fixture.replies[0].text, /wasn't in the list/);

    fixture.context.args = ['2348000000002'];
    await fixture.registry.execute('.delsudo', fixture.context);
    assert.deepEqual(fixture.config.sudos, ['2348000000003']);
    assert.match(fixture.replies[1].text, /SUDO REVOKED/);
    assert.equal(fixture.calls.filter(call => call[0] === 'saveBotConfig').length, 2);
});

test('sudo module registers three commands and removal/list aliases', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.addsudo', '.delsudo', '.sudos']);
    assert.equal(fixture.registry.has('.removesudo'), true);
    assert.equal(fixture.registry.has('.listsudos'), true);
});
