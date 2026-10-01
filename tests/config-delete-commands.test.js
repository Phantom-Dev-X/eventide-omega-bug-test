import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createConfigDeleteCommands } from '../src/commands/system/config-delete.js';

function createFixture({ owner = false, dev = false } = {}) {
    const replies = [];
    const calls = [];
    const phoneNumber = '2348000000001';
    const warnConfigSessions = new Map();
    const antiConfigSessions = new Map();
    const autoreactSessions = new Map();
    const warningGroup = { phrases: ['alpha', 'beta', 'gamma', 'delta'] };
    const warningState = { groups: {} };
    const antideleteState = {
        endpoints: {
            groups: ['g1', 'g2'],
            channels: ['c1'],
            contacts: ['p1', 'p2']
        }
    };
    const botConfig = {
        autoreact: {
            enabled: true,
            endpoints: {
                groups: ['ag1', 'ag2'],
                channels: ['ac1'],
                contacts: ['ap1', 'ap2']
            }
        }
    };
    const definitions = createConfigDeleteCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        isDevNumber: () => dev,
        warnConfigSessions,
        antiConfigSessions,
        autoreactSessions,
        ensureWarnGroup: (...args) => {
            calls.push(['ensureWarnGroup', ...args]);
            return warningGroup;
        },
        getWarnState: number => {
            calls.push(['getWarnState', number]);
            return warningState;
        },
        saveWarnState: (...args) => calls.push(['saveWarnState', ...args]),
        getAntideleteState: number => {
            calls.push(['getAntideleteState', number]);
            return antideleteState;
        },
        listAntideleteEndpoints: state => ({
            rows: [
                ...state.endpoints.groups.map(v => ({ type: 'GROUP', v })),
                ...state.endpoints.channels.map(v => ({ type: 'CHANNEL', v })),
                ...state.endpoints.contacts.map(v => ({ type: 'CONTACT', v }))
            ]
        }),
        saveAntideleteState: (...args) => calls.push(['saveAntideleteState', ...args]),
        saveBotConfig: (...args) => calls.push(['saveBotConfig', ...args])
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        warnConfigSessions,
        antiConfigSessions,
        autoreactSessions,
        warningGroup,
        warningState,
        antideleteState,
        botConfig,
        context: {
            sock: {},
            remoteJid: 'chat@s.whatsapp.net',
            message: { key: { id: 'command-message' } },
            phoneNumber,
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: [],
            botConfig
        }
    };
}

test('del rejects unauthorized callers before inspecting configuration sessions', async () => {
    const fixture = createFixture();
    fixture.warnConfigSessions.set('2348000000001', { step: 'delete', group: 'group@g.us' });
    await fixture.registry.execute('.del', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Owner/Dev only.');
    assert.equal(fixture.calls.length, 0);
});

test('warning phrase deletion has highest flow precedence and removes descending indices', async () => {
    const fixture = createFixture({ owner: true });
    fixture.warnConfigSessions.set('2348000000001', { step: 'delete', group: 'group@g.us' });
    fixture.antiConfigSessions.set('2348000000001', { step: 'delete' });
    fixture.autoreactSessions.set('2348000000001', { step: 'delete' });
    fixture.context.args = ['2', '4'];
    await fixture.registry.execute('.del', fixture.context);

    assert.deepEqual(fixture.warningGroup.phrases, ['alpha', 'gamma']);
    assert.equal(fixture.warningState.groups['group@g.us'], fixture.warningGroup);
    assert.deepEqual(fixture.warnConfigSessions.get('2348000000001'), {
        step: 'matrix', group: 'group@g.us'
    });
    assert.equal(fixture.calls.some(call => call[0] === 'saveWarnState'), true);
    assert.equal(fixture.calls.some(call => call[0] === 'getAntideleteState'), false);
    assert.match(fixture.replies[0].text, /REMOVED\* :: 2/);
    assert.match(fixture.replies[0].text, /LEFT\* :: 2/);
});

test('warning flow preserves its specialized invalid-index guidance', async () => {
    const fixture = createFixture({ dev: true });
    fixture.warnConfigSessions.set('2348000000001', { step: 'delete', group: 'group@g.us' });
    fixture.context.args = ['0', '99', 'bad'];
    await fixture.registry.execute('.del', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Invalid indices. use: .del 1 3 (from the phrase list)');
    assert.equal(fixture.calls.some(call => call[0] === 'saveWarnState'), false);
});

test('antidelete deletion removes indexed endpoint buckets and closes its session', async () => {
    const fixture = createFixture({ owner: true });
    fixture.antiConfigSessions.set('2348000000001', { step: 'delete' });
    fixture.context.args = ['2', '4'];
    await fixture.registry.execute('.del', fixture.context);

    assert.deepEqual(fixture.antideleteState.endpoints, {
        groups: ['g1'],
        channels: ['c1'],
        contacts: ['p2']
    });
    assert.equal(fixture.antiConfigSessions.has('2348000000001'), false);
    assert.equal(fixture.calls.some(call => call[0] === 'saveAntideleteState'), true);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
    assert.match(fixture.replies[0].text, /Those chats are no longer/);
});

test('antidelete flow preserves specialized invalid-index guidance and session', async () => {
    const fixture = createFixture({ owner: true });
    fixture.antiConfigSessions.set('2348000000001', { step: 'delete' });
    fixture.context.args = ['999'];
    await fixture.registry.execute('.del', fixture.context);
    assert.match(fixture.replies[0].text, /numbers from the antidelete list/);
    assert.equal(fixture.antiConfigSessions.has('2348000000001'), true);
});

test('autoreact fallback deletes indexed endpoints and closes its session', async () => {
    const fixture = createFixture({ owner: true });
    fixture.autoreactSessions.set('2348000000001', { step: 'delete' });
    fixture.context.args = ['1', '3', '5'];
    await fixture.registry.execute('.del', fixture.context);

    assert.deepEqual(fixture.botConfig.autoreact.endpoints, {
        groups: ['ag2'],
        channels: [],
        contacts: ['ap1']
    });
    assert.equal(fixture.autoreactSessions.has('2348000000001'), false);
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), true);
    assert.match(fixture.replies[0].text, /The void no longer/);
});

test('autoreact fallback preserves generic invalid-index guidance without persistence', async () => {
    const fixture = createFixture({ owner: true });
    fixture.autoreactSessions.set('2348000000001', { step: 'delete' });
    fixture.context.args = [];
    await fixture.registry.execute('.del', fixture.context);
    assert.equal(fixture.replies[0].text, '❌ Invalid indices. use: .del 2 5 6 9 (numbers from the list)');
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotConfig'), false);
    assert.equal(fixture.autoreactSessions.has('2348000000001'), true);
});

test('duplicate indices preserve legacy splice behavior and removal count', async () => {
    const fixture = createFixture({ owner: true });
    fixture.warnConfigSessions.set('2348000000001', { step: 'delete', group: 'group@g.us' });
    fixture.context.args = ['2', '2'];
    await fixture.registry.execute('.del', fixture.context);
    assert.deepEqual(fixture.warningGroup.phrases, ['alpha', 'delta']);
    assert.match(fixture.replies[0].text, /REMOVED\* :: 2/);
});

test('config delete module registers one command', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.del']);
});
