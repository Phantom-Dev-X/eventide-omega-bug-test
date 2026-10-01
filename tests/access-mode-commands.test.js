import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createAccessModeCommands } from '../src/commands/system/access-mode.js';

function createFixture({ owner = false, initialMode = 'public' } = {}) {
    const replies = [];
    const calls = [];
    let mode = initialMode;
    const sock = {};
    const definitions = createAccessModeCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        loadBotMode: phoneNumber => {
            calls.push(['loadBotMode', phoneNumber]);
            return mode;
        },
        saveBotMode: (phoneNumber, value) => {
            calls.push(['saveBotMode', phoneNumber, value]);
            mode = value;
        },
        terminalHeader: 'HEADER\n'
    });
    return {
        registry: createCommandRegistry(definitions),
        replies,
        calls,
        getMode: () => mode,
        context: {
            sock,
            remoteJid: 'chat@s.whatsapp.net',
            message: { key: { id: 'command-message' } },
            phoneNumber: '2348000000001',
            isSenderOwner: owner,
            args: []
        }
    };
}

test('mode reports current state and usage before authorization when input is invalid', async () => {
    const fixture = createFixture({ initialMode: 'owner' });
    await fixture.registry.execute('.mode', fixture.context);
    assert.equal(fixture.replies[0].text, 'now: owner only\nuse: .mode public  |  .mode owner');
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotMode'), false);

    fixture.context.args = ['invalid'];
    await fixture.registry.execute('.mode', fixture.context);
    assert.equal(fixture.replies[1].text, 'now: owner only\nuse: .mode public  |  .mode owner');
});

test('all access-mode mutations reject non-owner callers', async () => {
    const fixture = createFixture();
    fixture.context.args = ['owner'];
    for (const command of ['.mode', '.public', '.owner']) {
        await fixture.registry.execute(command, fixture.context);
    }
    assert.equal(fixture.replies.length, 3);
    assert.equal(
        fixture.replies.every(reply => reply.text === '❌ Only the paired bot owner can modify the access mode.'),
        true
    );
    assert.equal(fixture.calls.some(call => call[0] === 'saveBotMode'), false);
});

test('mode persists owner and public transitions with previous-state output', async () => {
    const fixture = createFixture({ owner: true });
    fixture.context.args = ['OWNER'];
    await fixture.registry.execute('.mode', fixture.context);
    assert.equal(fixture.getMode(), 'owner');
    assert.match(fixture.replies[0].text, /PREVIOUS\* : PUBLIC/);
    assert.match(fixture.replies[0].text, /CURRENT\* : OWNER_ONLY/);
    assert.match(fixture.replies[0].text, /STATUS\* : RECONFIGURED/);

    fixture.context.args = ['public'];
    await fixture.registry.execute('.mode', fixture.context);
    assert.equal(fixture.getMode(), 'public');
    assert.match(fixture.replies[1].text, /PREVIOUS\* : OWNER_ONLY/);
    assert.match(fixture.replies[1].text, /CURRENT\* : PUBLIC/);
});

test('public shortcut preserves terminal header and gate-open response', async () => {
    const fixture = createFixture({ owner: true, initialMode: 'owner' });
    await fixture.registry.execute('.public', fixture.context);
    assert.equal(fixture.getMode(), 'public');
    assert.match(fixture.replies[0].text, /^HEADER\n/);
    assert.match(fixture.replies[0].text, /PREVIOUS\* : OWNER/);
    assert.match(fixture.replies[0].text, /STATUS\* : GATES_OPEN/);
});

test('owner shortcut preserves terminal header and throne-sealed response', async () => {
    const fixture = createFixture({ owner: true, initialMode: 'public' });
    await fixture.registry.execute('.owner', fixture.context);
    assert.equal(fixture.getMode(), 'owner');
    assert.match(fixture.replies[0].text, /^HEADER\n/);
    assert.match(fixture.replies[0].text, /PREVIOUS\* : PUBLIC/);
    assert.match(fixture.replies[0].text, /STATUS\* : THRONE_SEALED/);
});

test('access mode module registers three commands', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.mode', '.owner', '.public']);
});
