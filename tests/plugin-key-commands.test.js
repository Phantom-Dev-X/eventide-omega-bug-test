import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createPluginKeyCommands } from '../src/commands/system/plugin-key.js';

function createFixture({ owner = false, dev = false, stored = '' } = {}) {
    const replies = [];
    const calls = [];
    const config = { geminiApiKey: stored };
    const sock = {};
    const definitions = createPluginKeyCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        isDevNumber: () => dev,
        loadBotConfig: phoneNumber => {
            calls.push(['loadBotConfig', phoneNumber]);
            return config;
        },
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args]),
        splitApiKeys: value => String(value || '').split(',').map(item => item.trim()).filter(Boolean),
        maskApiKey: key => `${key.slice(0, 5)}…${key.slice(-2)}`,
        isValidGeminiKey: key => key.startsWith('valid-')
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

test('plugin key management rejects unauthorized callers before loading config', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.pluginkey', fixture.context);
    assert.equal(
        fixture.replies[0].text,
        '❌ Owner/Dev only. Only the paired bot owner can set their own key.'
    );
    assert.equal(fixture.calls.length, 0);
});

test('plugin key status reports empty routing without persistence', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.plugin', fixture.context);
    assert.match(fixture.replies[0].text, /KEYS\* :: 0/);
    assert.match(fixture.replies[0].text, /KEY\* :: NOT_SET/);
    assert.match(fixture.replies[0].text, /OWNER_DEFAULT_CHAIN/);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
});

test('plugin key status masks every stored key and never exposes raw values', async () => {
    const fixture = createFixture({ dev: true, stored: 'valid-secret-one,valid-secret-two' });
    await fixture.registry.execute('.pluginkey', fixture.context);
    const output = fixture.replies[0].text;
    assert.match(output, /KEYS\* :: 2/);
    assert.match(output, /valid…ne/);
    assert.match(output, /valid…wo/);
    assert.doesNotMatch(output, /valid-secret-one/);
    assert.doesNotMatch(output, /valid-secret-two/);
    assert.match(output, /YOUR_GEMINI_KEYS/);
});

test('off and remove clear the session key pool and persist', async () => {
    for (const command of ['off', 'REMOVE']) {
        const fixture = createFixture({ owner: true, stored: 'valid-secret' });
        fixture.context.args = [command];
        await fixture.registry.execute('.pluginkey', fixture.context);
        assert.equal(fixture.config.geminiApiKey, '');
        assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
        assert.match(fixture.replies[0].text, /PLUGIN_KEY_SEVERED/);
    }
});

test('invalid or empty replacement lists are rejected without persistence', async () => {
    const invalid = createFixture({ owner: true, stored: 'valid-existing' });
    invalid.context.args = ['invalid-key'];
    await invalid.registry.execute('.pluginkey', invalid.context);
    assert.match(invalid.replies[0].text, /does not look like a valid Gemini API key list/);
    assert.equal(invalid.config.geminiApiKey, 'valid-existing');
    assert.equal(invalid.calls.some(call => call[0] === 'saveBotConfig'), false);

    const emptySet = createFixture({ owner: true });
    emptySet.context.args = ['set', ''];
    await emptySet.registry.execute('.pluginkey', emptySet.context);
    assert.equal(emptySet.calls.some(call => call[0] === 'saveBotConfig'), false);
});

test('append mode deduplicates keys while preserving first-seen order', async () => {
    const fixture = createFixture({ owner: true, stored: 'valid-a,valid-b' });
    fixture.context.args = ['valid-b,valid-c,valid-a'];
    await fixture.registry.execute('.pluginkey', fixture.context);
    assert.equal(fixture.config.geminiApiKey, 'valid-a,valid-b,valid-c');
    assert.match(fixture.replies[0].text, /PLUGIN_KEYS_EXTENDED/);
    assert.match(fixture.replies[0].text, /TOTAL\* :: 3/);
    assert.match(fixture.replies[0].text, /ADDED\* :: 1/);
});

test('append mode reports already-bound when no key is added', async () => {
    const fixture = createFixture({ dev: true, stored: 'valid-a,valid-b' });
    fixture.context.args = ['valid-b,valid-a'];
    await fixture.registry.execute('.pluginkey', fixture.context);
    assert.equal(fixture.config.geminiApiKey, 'valid-a,valid-b');
    assert.match(fixture.replies[0].text, /PLUGIN_KEYS_ALREADY_BOUND/);
    assert.match(fixture.replies[0].text, /ADDED\* :: 0/);
});

test('set mode replaces the complete key pool in supplied order', async () => {
    const fixture = createFixture({ owner: true, stored: 'valid-old-a,valid-old-b' });
    fixture.context.args = ['SET', 'valid-new-b,valid-new-a,valid-new-b'];
    await fixture.registry.execute('.pluginkey', fixture.context);
    assert.equal(fixture.config.geminiApiKey, 'valid-new-b,valid-new-a');
    assert.match(fixture.replies[0].text, /PLUGIN_KEYS_RESET/);
    assert.match(fixture.replies[0].text, /TOTAL\* :: 2/);
    assert.match(fixture.replies[0].text, /ADDED\* :: -/);
});

test('plugin key module registers its primary command and alias', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.pluginkey']);
    assert.equal(fixture.registry.has('.plugin'), true);
});
