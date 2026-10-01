import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createConfigurationCommands } from '../src/commands/system/configuration.js';

function createFixture({ owner = false, dev = false, botConfig } = {}) {
    const replies = [];
    const calls = [];
    const welcomeGoodbyeSessions = new Map();
    const autoreactSessions = new Map();
    const antiConfigSessions = new Map();
    const warnConfigSessions = new Map();
    const config = botConfig || {};
    const sock = {};
    const definitions = createConfigurationCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        isDevNumber: () => dev,
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args]),
        welcomeGoodbyeSessions,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        sendMenuPoll: async (...args) => calls.push(['sendMenuPoll', ...args])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        welcomeGoodbyeSessions,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        botConfig: config,
        sock,
        context: {
            sock,
            remoteJid: '12345@g.us',
            message: { key: { id: 'command-message' } },
            phoneNumber: '2348000000001',
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: [],
            botConfig: config
        }
    };
}

test('greeting configuration remains owner/developer-only and group-only', async () => {
    const denied = createFixture();
    await denied.registry.execute('.welcome', denied.context);
    assert.equal(denied.replies[0].text, '❌ Owner only.');
    assert.equal(denied.welcomeGoodbyeSessions.size, 0);

    const privateChat = createFixture({ dev: true });
    privateChat.context.remoteJid = 'chat@s.whatsapp.net';
    await privateChat.registry.execute('.goodbye', privateChat.context);
    assert.equal(privateChat.replies[0].text, '❌ Only works inside a group.');
});

test('welcome and goodbye initialize typed sessions and their original polls', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.welcome', fixture.context);
    assert.deepEqual(fixture.welcomeGoodbyeSessions.get('2348000000001'), {
        step: 'action', type: 'welcome', group: '12345@g.us'
    });
    assert.equal(fixture.replies[0].message, undefined);
    let poll = fixture.calls.find(call => call[0] === 'sendMenuPoll');
    assert.equal(poll[4], '✦ WELCOME MATRIX ✦');
    assert.deepEqual(poll[6], ['wg_wel_custom', 'wg_wel_default', 'wg_wel_off']);

    fixture.calls.length = 0;
    await fixture.registry.execute('.goodbye', fixture.context);
    assert.deepEqual(fixture.welcomeGoodbyeSessions.get('2348000000001'), {
        step: 'action', type: 'goodbye', group: '12345@g.us'
    });
    poll = fixture.calls.find(call => call[0] === 'sendMenuPoll');
    assert.equal(poll[4], '✦ GOODBYE MATRIX ✦');
    assert.deepEqual(poll[6], ['wg_gb_custom', 'wg_gb_default', 'wg_gb_off']);
});

test('greet initializes the untyped greeting selection flow', async () => {
    const fixture = createFixture({ dev: true });
    await fixture.registry.execute('.greet', fixture.context);
    assert.deepEqual(fixture.welcomeGoodbyeSessions.get('2348000000001'), {
        step: 'action', group: '12345@g.us'
    });
    const poll = fixture.calls.find(call => call[0] === 'sendMenuPoll');
    assert.equal(poll[4], '✦ GREETING MATRIX ✦');
    assert.deepEqual(poll[6], ['greet_welcome', 'greet_goodbye']);
});

test('autoreact remains paired-owner-only even for developers', async () => {
    const fixture = createFixture({ dev: true });
    await fixture.registry.execute('.autoreact', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Owner only.');
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
});

test('autoreact reports current state when no valid toggle is supplied', async () => {
    const fixture = createFixture({ owner: true, botConfig: { autoreact: { enabled: true } } });
    await fixture.registry.execute('.autoreact', fixture.context);
    assert.match(fixture.replies[0].text, /STATE\* :: ON/);
    assert.match(fixture.replies[0].text, /use: \.autoreact on/);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
});

test('autoreact creates defaults, persists toggles, and preserves enable warning', async () => {
    const fixture = createFixture({ owner: true });
    fixture.context.args = ['ON'];
    await fixture.registry.execute('.autoreact', fixture.context);
    assert.deepEqual(fixture.botConfig.autoreact, {
        enabled: true,
        endpoints: { groups: [], channels: [], contacts: [] }
    });
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
    assert.match(fixture.replies[0].text, /REACT_ENABLED/);
    assert.match(fixture.replies[0].text, /WARNING/);

    fixture.context.args = ['off'];
    await fixture.registry.execute('.autoreact', fixture.context);
    assert.equal(fixture.botConfig.autoreact.enabled, false);
    assert.match(fixture.replies[1].text, /REACT_DISABLED/);
    assert.doesNotMatch(fixture.replies[1].text, /WARNING/);
});

test('autoreactconfig resets antidelete flow and opens its endpoint poll', async () => {
    const fixture = createFixture({
        owner: true,
        botConfig: {
            autoreact: {
                enabled: true,
                endpoints: { groups: ['g'], channels: ['c'], contacts: ['u'] }
            }
        }
    });
    fixture.antiConfigSessions.set('2348000000001', { step: 'old' });
    await fixture.registry.execute('.autoreactconfig', fixture.context);
    assert.equal(fixture.antiConfigSessions.has('2348000000001'), false);
    assert.deepEqual(fixture.autoreactSessions.get('2348000000001'), { step: 'add_or_delete' });
    assert.match(fixture.replies[0].text, /GROUPS\* :: 1/);
    const poll = fixture.calls.find(call => call[0] === 'sendMenuPoll');
    assert.deepEqual(poll.slice(-2), [
        ['➕ Add Endpoint', '🗑️ Delete Endpoint'],
        ['ar_add', 'ar_delete']
    ]);
});

test('cancel clears every interactive configuration session and reports prior activity', async () => {
    const fixture = createFixture();
    for (const map of [
        fixture.antiConfigSessions,
        fixture.autoreactSessions,
        fixture.welcomeGoodbyeSessions,
        fixture.warnConfigSessions
    ]) map.set('2348000000001', { step: 'active' });

    await fixture.registry.execute('.cancel', fixture.context);
    assert.equal(fixture.replies[0].text, 'terminal:   ✦ *CANCELLED* :: no changes made.');
    assert.equal([
        fixture.antiConfigSessions,
        fixture.autoreactSessions,
        fixture.welcomeGoodbyeSessions,
        fixture.warnConfigSessions
    ].every(map => map.size === 0), true);

    await fixture.registry.execute('.cancel', fixture.context);
    assert.equal(fixture.replies[1].text, 'terminal:   ✦ *IDLE* :: nothing to cancel.');
});

test('configuration module registers six commands and legacy spaced alias', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), [
        '.autoreact',
        '.autoreactconfig',
        '.cancel',
        '.goodbye',
        '.greet',
        '.welcome'
    ]);
    assert.equal(fixture.registry.has('.autoreact config'), true);
});
