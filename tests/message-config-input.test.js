import test from 'node:test';
import assert from 'node:assert/strict';

import { createMessageConfigInputService } from '../src/whatsapp/message-config-input.js';

function createFixture() {
    const autoreactSessions = new Map();
    const antiConfigSessions = new Map();
    const warnConfigSessions = new Map();
    const welcomeGoodbyeSessions = new Map();
    const botConfig = {};
    const antideleteState = { endpoints: { groups: [], channels: [], contacts: [] } };
    const warnState = { groups: {} };
    const calls = [];

    const service = createMessageConfigInputService({
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        welcomeGoodbyeSessions,
        loadBotConfig: () => botConfig,
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args]),
        getAntideleteState: () => antideleteState,
        saveAntideleteState: (...args) => calls.push(['saveAntideleteState', ...args]),
        ensureWarnGroup: (phoneNumber, group, updates = {}) => {
            const current = warnState.groups[group] || { maxWarns: 3, phrases: [] };
            Object.assign(current, updates);
            warnState.groups[group] = current;
            calls.push(['ensureWarnGroup', phoneNumber, group, updates]);
            return current;
        },
        getWarnState: () => warnState,
        saveWarnState: (...args) => calls.push(['saveWarnState', ...args]),
        safeWaReply: async (...args) => calls.push(['safeWaReply', ...args]),
        buildOmegaTerminal: text => `terminal:${text}`
    });

    const baseContext = {
        sock: {},
        message: { key: { id: 'message-1' } },
        phoneNumber: '2348000000001',
        remoteJid: 'chat@s.whatsapp.net',
        text: 'hello',
        startsWithDot: false
    };

    return {
        service,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        welcomeGoodbyeSessions,
        botConfig,
        antideleteState,
        warnState,
        calls,
        context: overrides => ({ ...baseContext, ...overrides })
    };
}

test('command messages bypass plain-text configuration input', async () => {
    const fixture = createFixture();
    const handled = await fixture.service.handleConfigInput(fixture.context({
        text: '.ping',
        startsWithDot: true
    }));
    assert.equal(handled, false);
});

test('autoreact contact input persists a normalized number and clears the session', async () => {
    const fixture = createFixture();
    fixture.autoreactSessions.set('2348000000001', { step: 'awaiting_contact' });

    const handled = await fixture.service.handleConfigInput(fixture.context({
        text: '+234 811-111-1111'
    }));

    assert.equal(handled, true);
    assert.deepEqual(fixture.botConfig.autoreact.endpoints.contacts, ['2348111111111']);
    assert.equal(fixture.autoreactSessions.has('2348000000001'), false);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
});

test('invalid antidelete contact input keeps the session active', async () => {
    const fixture = createFixture();
    fixture.antiConfigSessions.set('2348000000001', { step: 'awaiting_contact' });

    const handled = await fixture.service.handleConfigInput(fixture.context({ text: '123' }));

    assert.equal(handled, true);
    assert.equal(fixture.antiConfigSessions.has('2348000000001'), true);
    assert.equal(fixture.calls.some(call => call[0] === 'saveAntideleteState'), false);
});

test('antidelete channel input persists the endpoint and clears the session', async () => {
    const fixture = createFixture();
    fixture.antiConfigSessions.set('2348000000001', { step: 'awaiting_channel' });

    await fixture.service.handleConfigInput(fixture.context({ text: 'channel-id' }));

    assert.deepEqual(fixture.antideleteState.endpoints.channels, ['channel-id']);
    assert.equal(fixture.antiConfigSessions.has('2348000000001'), false);
    assert.equal(fixture.calls.some(call => call[0] === 'saveAntideleteState'), true);
});

test('warning limit input validates and transitions back to the matrix', async () => {
    const fixture = createFixture();
    fixture.warnConfigSessions.set('2348000000001', {
        step: 'awaiting_limit',
        group: 'group@g.us'
    });

    await fixture.service.handleConfigInput(fixture.context({ text: '5' }));

    assert.equal(fixture.warnState.groups['group@g.us'].maxWarns, 5);
    assert.deepEqual(fixture.warnConfigSessions.get('2348000000001'), {
        step: 'matrix',
        group: 'group@g.us'
    });
});

test('warning phrase input persists a unique phrase', async () => {
    const fixture = createFixture();
    fixture.warnConfigSessions.set('2348000000001', {
        step: 'awaiting_phrase',
        group: 'group@g.us'
    });

    await fixture.service.handleConfigInput(fixture.context({ text: 'forbidden phrase' }));

    assert.deepEqual(fixture.warnState.groups['group@g.us'].phrases, ['forbidden phrase']);
    assert.equal(fixture.calls.some(call => call[0] === 'saveWarnState'), true);
});

test('custom welcome input is persisted and its session is cleared', async () => {
    const fixture = createFixture();
    fixture.welcomeGoodbyeSessions.set('2348000000001', {
        step: 'custom_text',
        type: 'welcome',
        group: 'group@g.us'
    });

    await fixture.service.handleConfigInput(fixture.context({ text: 'Welcome {{name}}!' }));

    assert.equal(fixture.botConfig.welcomeMsg['group@g.us'], 'Welcome {{name}}!');
    assert.equal(fixture.welcomeGoodbyeSessions.has('2348000000001'), false);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
});

test('cancel clears the active configuration session without persistence', async () => {
    const fixture = createFixture();
    fixture.warnConfigSessions.set('2348000000001', {
        step: 'awaiting_phrase',
        group: 'group@g.us'
    });

    await fixture.service.handleConfigInput(fixture.context({ text: '.cancel' }));

    assert.equal(fixture.warnConfigSessions.has('2348000000001'), false);
    assert.equal(fixture.calls.some(call => call[0] === 'saveWarnState'), false);
    assert.equal(
        fixture.calls.some(call => call[0] === 'safeWaReply' && call[3].includes('CANCELLED')),
        true
    );
});

test('ordinary non-command text is consumed after all session checks', async () => {
    const fixture = createFixture();
    const handled = await fixture.service.handleConfigInput(fixture.context({ text: 'hello' }));
    assert.equal(handled, true);
    assert.equal(fixture.calls.length, 0);
});
