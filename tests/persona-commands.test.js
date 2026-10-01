import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createPersonaCommands } from '../src/commands/system/persona.js';

function createFixture({ owner = false, dev = false, config } = {}) {
    const replies = [];
    const calls = [];
    const personaPollKeys = new Map();
    const helpPersonaPollKeys = new Map();
    const botConfig = config || {};
    const sock = {
        sendMessage: async (...args) => {
            calls.push(['sendMessage', ...args]);
            return { key: { id: 'deleted' } };
        }
    };
    const definitions = createPersonaCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        isDevNumber: () => dev,
        loadBotConfig: phoneNumber => {
            calls.push(['loadBotConfig', phoneNumber]);
            return botConfig;
        },
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args]),
        sendRuinMenu: async (...args) => calls.push(['sendRuinMenu', ...args]),
        sendEclipseMenu: async (...args) => calls.push(['sendEclipseMenu', ...args]),
        sendMenuPoll: async (...args) => {
            calls.push(['sendMenuPoll', ...args]);
            return { key: { id: 'new-poll', remoteJid: 'chat@s.whatsapp.net' } };
        },
        personaPollKeys,
        helpPersonaPollKeys,
        personaPollQuestion: 'CHOOSE PERSONA',
        personaPollOptions: ['Eclipse', 'Ruin'],
        personaPollIds: ['persona_eclipse', 'persona_ruin'],
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['logError', ...args])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        personaPollKeys,
        helpPersonaPollKeys,
        botConfig,
        sock,
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

test('menu routes ruin and eclipse personas to their original renderers', async () => {
    const ruin = createFixture({ config: { persona: 'RUIN' } });
    await ruin.registry.execute('.menu', ruin.context);
    assert.equal(ruin.calls.some(call => call[0] === 'sendRuinMenu'), true);
    assert.equal(ruin.calls.some(call => call[0] === 'sendEclipseMenu'), false);

    const eclipse = createFixture({ config: {} });
    await eclipse.registry.execute('.menu', eclipse.context);
    assert.equal(eclipse.calls.some(call => call[0] === 'sendEclipseMenu'), true);
});

test('ruin menu failures remain logged and contained', async () => {
    const fixture = createFixture({ config: { persona: 'ruin' } });
    const registry = createCommandRegistry(createPersonaCommands({
        safeWaReply: async () => {},
        buildOmegaTerminal: String,
        isDevNumber: () => false,
        loadBotConfig: () => fixture.botConfig,
        saveBotConfig: () => {},
        sendRuinMenu: async () => { throw new Error('menu failed'); },
        sendEclipseMenu: async () => {},
        sendMenuPoll: async () => {},
        personaPollKeys: new Map(),
        helpPersonaPollKeys: new Map(),
        personaPollQuestion: 'question',
        personaPollOptions: [],
        personaPollIds: [],
        log: () => {},
        logError: (...args) => fixture.calls.push(['logError', ...args])
    }));
    await registry.execute('.menu', fixture.context);
    assert.equal(fixture.calls.some(call => call[0] === 'logError'), true);
});

test('persona and help persona mutations reject unauthorized callers', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.persona', fixture.context);
    await fixture.registry.execute('.helpconfig', fixture.context);
    assert.deepEqual(fixture.replies.map(reply => reply.text), ['❌ Owner only.', '❌ Owner only.']);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
});

test('persona status reports normalized current binding and usage', async () => {
    const fixture = createFixture({ owner: true, config: { persona: 'RUIN' } });
    await fixture.registry.execute('.persona', fixture.context);
    assert.match(fixture.replies[0].text, /ACTIVE\* :: RUIN/);
    assert.match(fixture.replies[0].text, /\.persona reset/);
});

test('direct persona selection persists binding and clears stale poll reference', async () => {
    const fixture = createFixture({ dev: true, config: { persona: 'eclipse' } });
    fixture.personaPollKeys.set('2348000000001', { id: 'old' });
    fixture.context.args = ['RUIN'];
    await fixture.registry.execute('.persona', fixture.context);
    assert.equal(fixture.botConfig.persona, 'ruin');
    assert.equal(fixture.personaPollKeys.has('2348000000001'), false);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
    assert.match(fixture.replies[0].text, /BOUND\* :: RUIN/);
});

test('persona poll deletes stale poll and stores the fresh poll key', async () => {
    const fixture = createFixture({ owner: true, config: { persona: 'eclipse' } });
    fixture.personaPollKeys.set('2348000000001', {
        id: 'old-poll',
        remoteJid: 'old-chat@s.whatsapp.net'
    });
    fixture.context.args = ['choose'];
    await fixture.registry.execute('.persona', fixture.context);

    const deletion = fixture.calls.find(call => call[0] === 'sendMessage');
    assert.deepEqual(deletion[2], {
        delete: { remoteJid: 'old-chat@s.whatsapp.net', id: 'old-poll', fromMe: true }
    });
    assert.deepEqual(fixture.personaPollKeys.get('2348000000001'), {
        id: 'new-poll', remoteJid: 'chat@s.whatsapp.net'
    });
    const poll = fixture.calls.find(call => call[0] === 'sendMenuPoll');
    assert.deepEqual(poll.slice(-3), [
        'CHOOSE PERSONA',
        ['Eclipse', 'Ruin'],
        ['persona_eclipse', 'persona_ruin']
    ]);
});

test('persona reset clears persisted binding before opening chooser', async () => {
    const fixture = createFixture({ owner: true, config: { persona: 'ruin' } });
    fixture.context.args = ['reset'];
    await fixture.registry.execute('.persona', fixture.context);
    assert.equal(fixture.botConfig.persona, '');
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
    assert.match(fixture.replies[0].text, /PERSONA RESET/);
});

test('help persona status and aliases preserve current voice output', async () => {
    const fixture = createFixture({ dev: true, config: { helpPersona: 'eclipse' } });
    await fixture.registry.execute('.helpvoice', fixture.context);
    assert.match(fixture.replies[0].text, /ACTIVE\* :: ECLIPSE/);
    assert.match(fixture.replies[0].text, /\.helpconfig ruin/);
});

test('help persona selection persists voice and clears stale chooser', async () => {
    const fixture = createFixture({ owner: true, config: { helpPersona: 'eclipse' } });
    fixture.helpPersonaPollKeys.set('2348000000001', { id: 'old-help' });
    fixture.context.args = ['ruin'];
    await fixture.registry.execute('.helpset', fixture.context);
    assert.equal(fixture.botConfig.helpPersona, 'ruin');
    assert.equal(fixture.helpPersonaPollKeys.has('2348000000001'), false);
    assert.match(fixture.replies[0].text, /HELP PERSONA BOUND\* :: RUIN/);
});

test('persona module registers three commands and help aliases', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.helpconfig', '.menu', '.persona']);
    assert.equal(fixture.registry.has('.helpvoice'), true);
    assert.equal(fixture.registry.has('.helpset'), true);
});
