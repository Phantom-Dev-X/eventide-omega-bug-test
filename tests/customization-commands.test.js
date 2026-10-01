import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createCustomizationCommands } from '../src/commands/system/customization.js';

function createFixture({ owner = false, dev = false, botConfig } = {}) {
    const replies = [];
    const calls = [];
    const config = botConfig || {};
    const sock = {
        updateProfileName: async name => calls.push(['updateProfileName', name]),
        updateProfileStatus: async bio => calls.push(['updateProfileStatus', bio])
    };
    const definitions = createCustomizationCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        isDevNumber: () => dev,
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        botConfig: config,
        sock,
        context: {
            sock,
            remoteJid: 'chat@s.whatsapp.net',
            message: { key: { id: 'command-message' } },
            phoneNumber: '2348000000001',
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: [],
            prefix: '!',
            botConfig: config
        }
    };
}

test('all customization mutations reject unauthorized callers', async () => {
    const fixture = createFixture();
    for (const command of ['.setprefix', '.setalias', '.delalias', '.setname', '.setbio']) {
        await fixture.registry.execute(command, fixture.context);
    }
    assert.equal(fixture.replies.length, 5);
    assert.equal(fixture.replies.every(reply => reply.text === '❌ Owner/Dev only.'), true);
    assert.equal(fixture.calls.length, 0);
});

test('setprefix validates input and preserves the previous parsed prefix in output', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.setprefix', fixture.context);
    fixture.context.args = ['abc'];
    await fixture.registry.execute('.setprefix', fixture.context);
    assert.equal(fixture.replies.slice(0, 2).every(reply => /Provide a 1-character prefix/.test(reply.text)), true);

    fixture.context.args = ['##'];
    await fixture.registry.execute('.changeprefix', fixture.context);
    assert.equal(fixture.botConfig.prefix, '##');
    assert.match(fixture.replies[2].text, /OLD\* :: !/);
    assert.match(fixture.replies[2].text, /NEW\* :: "##"/);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
});

test('setalias normalizes triggers and requires a dot-command target', async () => {
    const fixture = createFixture({ dev: true });
    fixture.context.args = ['Ping', 'ping'];
    await fixture.registry.execute('.setalias', fixture.context);
    assert.match(fixture.replies[0].text, /use: \.setalias/);

    fixture.context.args = ['.P', '.PING'];
    await fixture.registry.execute('.setalias', fixture.context);
    assert.deepEqual(fixture.botConfig.aliases, { p: '.ping' });
    assert.match(fixture.replies[1].text, /TRIGGER\* :: !p/);
    assert.match(fixture.replies[1].text, /CASTS\* :: \.ping/);
});

test('delalias validates, removes, and persists aliases', async () => {
    const fixture = createFixture({ owner: true, botConfig: { aliases: { p: '.ping' } } });
    fixture.context.args = ['missing'];
    await fixture.registry.execute('.delalias', fixture.context);
    assert.match(fixture.replies[0].text, /No alias named "missing"/);

    fixture.context.args = ['.P'];
    await fixture.registry.execute('.delalias', fixture.context);
    assert.deepEqual(fixture.botConfig.aliases, {});
    assert.match(fixture.replies[1].text, /TRIGGER\* :: !p/);
    assert.match(fixture.replies[1].text, /UNBOUND/);
});

test('aliases remains public and renders empty and populated registries', async () => {
    const empty = createFixture();
    await empty.registry.execute('.aliases', empty.context);
    assert.match(empty.replies[0].text, /COUNT\* :: 0/);
    assert.match(empty.replies[0].text, /none bound/);

    const populated = createFixture({ botConfig: { aliases: { p: '.ping', u: '.uptime' } } });
    await populated.registry.execute('.aliases', populated.context);
    assert.match(populated.replies[0].text, /COUNT\* :: 2/);
    assert.match(populated.replies[0].text, /!p  →  \.ping/);
    assert.match(populated.replies[0].text, /!u  →  \.uptime/);
});

test('setname validates input then updates WhatsApp before persistence', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.setname', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ use: .setname <name>');

    fixture.context.args = ['Eventide', 'Omega'];
    await fixture.registry.execute('.setname', fixture.context);
    assert.deepEqual(fixture.calls.slice(0, 2).map(call => call[0]), ['updateProfileName', 'saveBotConfig']);
    assert.equal(fixture.botConfig.name, 'Eventide Omega');
    assert.match(fixture.replies[1].text, /ACCOUNT_RENAMED/);
});

test('setbio alias validates input and updates WhatsApp before persistence', async () => {
    const fixture = createFixture({ dev: true });
    await fixture.registry.execute('.setstatus', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ use: .setbio <text>');

    fixture.context.args = ['Into', 'the', 'void'];
    await fixture.registry.execute('.setstatus', fixture.context);
    assert.deepEqual(fixture.calls.slice(0, 2).map(call => call[0]), ['updateProfileStatus', 'saveBotConfig']);
    assert.equal(fixture.botConfig.bio, 'Into the void');
    assert.match(fixture.replies[1].text, /ACCOUNT_UPDATED/);
});

test('profile update failures do not mutate or persist configuration', async () => {
    const fixture = createFixture({ owner: true });
    fixture.sock.updateProfileName = async () => { throw new Error('name denied'); };
    fixture.sock.updateProfileStatus = async () => { throw new Error('bio denied'); };

    fixture.context.args = ['Name'];
    await fixture.registry.execute('.setname', fixture.context);
    fixture.context.args = ['Bio'];
    await fixture.registry.execute('.setbio', fixture.context);
    assert.equal(fixture.botConfig.name, undefined);
    assert.equal(fixture.botConfig.bio, undefined);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
    assert.match(fixture.replies[0].text, /name denied/);
    assert.match(fixture.replies[1].text, /bio denied/);
});

test('customization module registers six commands and both aliases', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), [
        '.aliases',
        '.delalias',
        '.setalias',
        '.setbio',
        '.setname',
        '.setprefix'
    ]);
    assert.equal(fixture.registry.has('.changeprefix'), true);
    assert.equal(fixture.registry.has('.setstatus'), true);
});
