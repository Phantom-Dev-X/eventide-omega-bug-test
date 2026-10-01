import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createConfigManagementCommands } from '../src/commands/system/config-management.js';

function createFixture({ owner = false, dev = false, botConfig } = {}) {
    const replies = [];
    const calls = [];
    const config = botConfig || {};
    const defaultBotConfig = {
        prefix: '.',
        aliases: {},
        bootDmSent: false,
        nested: { enabled: true }
    };
    const antideleteState = {
        enabled: true,
        endpoints: {
            groups: ['g1', 'g2'],
            channels: ['c1'],
            contacts: ['p1', 'p2', 'p3']
        }
    };
    const sock = {
        user: { id: 'bot@s.whatsapp.net' },
        updateProfilePicture: async (...args) => calls.push(['updateProfilePicture', ...args])
    };
    const definitions = createConfigManagementCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        isDevNumber: () => dev,
        downloadMediaMessage: async (...args) => {
            calls.push(['downloadMediaMessage', ...args]);
            return Buffer.from('profile-picture');
        },
        createSilentLogger: () => ({ level: 'silent' }),
        getAntideleteState: phoneNumber => {
            calls.push(['getAntideleteState', phoneNumber]);
            return antideleteState;
        },
        loadBotMode: phoneNumber => {
            calls.push(['loadBotMode', phoneNumber]);
            return 'owner';
        },
        splitApiKeys: value => String(value || '').split(',').map(item => item.trim()).filter(Boolean),
        defaultBotConfig,
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args]),
        logError: (...args) => calls.push(['logError', ...args]),
        cloneConfig: value => structuredClone(value)
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        botConfig: config,
        defaultBotConfig,
        antideleteState,
        sock,
        context: {
            sock,
            remoteJid: 'chat@s.whatsapp.net',
            message: { key: { id: 'command-message' }, message: {} },
            phoneNumber: '2348000000001',
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: [],
            prefix: '!',
            botConfig: config
        }
    };
}

test('setpp rejects unauthorized callers before inspecting media', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.setpp', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Owner/Dev only.');
    assert.equal(fixture.calls.length, 0);
});

test('setpp requires a quoted image or sticker', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.setpp', fixture.context);
    assert.equal(
        fixture.replies[0].text,
        '❌ Reply to an image with .setpp to change the profile picture.'
    );
});

test('setpp downloads quoted media and updates the host profile picture', async () => {
    const fixture = createFixture({ dev: true });
    fixture.context.message.message = {
        extendedTextMessage: {
            contextInfo: { quotedMessage: { stickerMessage: { id: 'sticker' } } }
        }
    };
    await fixture.registry.execute('.setpp', fixture.context);

    const download = fixture.calls.find(call => call[0] === 'downloadMediaMessage');
    assert.deepEqual(download[1], { message: { imageMessage: { id: 'sticker' } } });
    assert.equal(download[2], 'buffer');
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'updateProfilePicture'),
        ['updateProfilePicture', 'bot@s.whatsapp.net', Buffer.from('profile-picture')]
    );
    assert.match(fixture.replies[0].text, /AVATAR_SWAPPED/);
});

test('setpp reports and logs media or profile update failures', async () => {
    const fixture = createFixture({ owner: true });
    fixture.context.message.message = {
        extendedTextMessage: { contextInfo: { quotedMessage: { imageMessage: {} } } }
    };
    fixture.sock.updateProfilePicture = async () => { throw new Error('picture denied'); };
    await fixture.registry.execute('.setpp', fixture.context);
    assert.equal(fixture.calls.some(call => call[0] === 'logError'), true);
    assert.equal(fixture.replies[0].text, '❌ Could not set profile pic. Error: picture denied');
});

test('settings remains public and reports all persisted configuration counters', async () => {
    const fixture = createFixture({
        botConfig: {
            aliases: { p: '.ping', u: '.uptime' },
            autoreact: { enabled: true },
            name: 'Omega',
            bio: 'Into the void',
            geminiApiKey: 'key-a,key-b'
        }
    });
    await fixture.registry.execute('.settings', fixture.context);
    const output = fixture.replies[0].text;
    assert.match(output, /PREFIX\* :: !/);
    assert.match(output, /MODE\* :: OWNER_ONLY/);
    assert.match(output, /ALIASES\* :: 2/);
    assert.match(output, /AUTOREACT\* :: ON/);
    assert.match(output, /ANTIDELETE\* :: ON/);
    assert.match(output, /AD_ENDS\* :: G2\/C1\/P3/);
    assert.match(output, /NAME\* :: Omega/);
    assert.match(output, /BIO\* :: Into the void/);
    assert.match(output, /PLUGIN KEYS\* :: 2/);
});

test('reset rejects unauthorized callers without cloning or persisting defaults', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.reset', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Owner/Dev only.');
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
});

test('reset deep-clones defaults, suppresses repeat boot DMs, and persists', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.reset', fixture.context);
    const save = fixture.calls.find(call => call[0] === 'saveBotConfig');
    assert.equal(save[1], '2348000000001');
    assert.deepEqual(save[2], {
        prefix: '.',
        aliases: {},
        bootDmSent: true,
        nested: { enabled: true }
    });
    assert.notEqual(save[2], fixture.defaultBotConfig);
    assert.notEqual(save[2].nested, fixture.defaultBotConfig.nested);
    assert.equal(fixture.defaultBotConfig.bootDmSent, false);
    assert.match(fixture.replies[0].text, /FACTORY_RESET/);
});

test('config management module registers three commands', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.reset', '.setpp', '.settings']);
});
