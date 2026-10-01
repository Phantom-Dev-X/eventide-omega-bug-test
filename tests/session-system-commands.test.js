import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createSessionSystemCommands } from '../src/commands/system/session.js';

function createFixture({ dev = false, owner = false } = {}) {
    const replies = [];
    const waSessions = new Map([
        ['2348000000001', { sock: {} }],
        ['2348000000002', { sock: {} }]
    ]);
    const registry = createCommandRegistry(createSessionSystemCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        runtimeUptime: () => '2h 3m 4s',
        loadBotMode: () => 'private',
        waSessions,
        isDevNumber: () => dev,
        countSystemCommands: () => 64,
        isRenderRuntime: true,
        environment: {
            RENDER_SERVICE_NAME: 'eventide-service',
            RENDER_SERVICE_ID: 'srv-example',
            RENDER_INSTANCE_ID: 'instance-example',
            RENDER_EXTERNAL_URL: 'https://eventide.example',
            RENDER_GIT_COMMIT: 'abcdef123456'
        },
        memoryUsage: () => ({ heapUsed: 25 * 1024 * 1024 })
    }));
    const message = { key: { id: 'command-message' } };
    const context = {
        sock: { user: { id: '2348000000001:1@s.whatsapp.net' } },
        remoteJid: 'chat@s.whatsapp.net',
        message,
        phoneNumber: '2348000000001',
        senderJid: 'sender@s.whatsapp.net',
        isSenderOwner: owner
    };
    return { registry, replies, waSessions, context };
}

test('public status hides deployment identity and total session count', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.status', fixture.context);

    assert.match(fixture.replies[0].text, /SYSTEM_STATUS/);
    assert.match(fixture.replies[0].text, /MODE.*PUBLIC/);
    assert.doesNotMatch(fixture.replies[0].text, /SERVICE_ID/);
    assert.doesNotMatch(fixture.replies[0].text, /SESSIONS/);
});

test('owner status includes deployment identity and session count', async () => {
    const fixture = createFixture({ owner: true });
    await fixture.registry.execute('.status', fixture.context);

    assert.match(fixture.replies[0].text, /SESSIONS.*2/);
    assert.match(fixture.replies[0].text, /HOST.*RENDER/);
    assert.match(fixture.replies[0].text, /SERVICE_ID.*srv-example/);
    assert.match(fixture.replies[0].text, /COMMIT.*abcdef1/);
});

test('session output hides global socket count from regular users', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.session', fixture.context);

    assert.match(fixture.replies[0].text, /PHONE.*2348000000001/);
    assert.match(fixture.replies[0].text, /JID.*2348000000001:1/);
    assert.doesNotMatch(fixture.replies[0].text, /SOCKETS/);
});

test('sessions command denies regular users and lists sessions for developers', async () => {
    const regular = createFixture();
    await regular.registry.execute('.sessions', regular.context);
    assert.match(regular.replies[0].text, /ACCESS_DENIED/);
    assert.doesNotMatch(regular.replies[0].text, /2348000000002/);

    const developer = createFixture({ dev: true });
    await developer.registry.execute('.sessions', developer.context);
    assert.match(developer.replies[0].text, /COUNT.*2/);
    assert.match(developer.replies[0].text, /2348000000001/);
    assert.match(developer.replies[0].text, /2348000000002/);
});

test('botinfo and alive preserve identity and health output', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.botinfo', fixture.context);
    await fixture.registry.execute('.alive', fixture.context);

    assert.match(fixture.replies[0].text, /CORE_IDENTITY/);
    assert.match(fixture.replies[0].text, /COMMANDS.*64/);
    assert.match(fixture.replies[1].text, /VESSEL_STATUS/);
    assert.match(fixture.replies[1].text, /STATE.*ALIVE/);
});

test('cmdstats remains owner or developer only', async () => {
    const regular = createFixture();
    await regular.registry.execute('.cmdstats', regular.context);
    assert.equal(regular.replies[0].text, '❌ Owner/Dev only.');

    const owner = createFixture({ owner: true });
    await owner.registry.execute('.cmdstats', owner.context);
    assert.match(owner.replies[0].text, /CMD_STATS/);
    assert.match(owner.replies[0].text, /COMMANDS.*64/);
});

test('session system group registers six commands', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), [
        '.alive',
        '.botinfo',
        '.cmdstats',
        '.session',
        '.sessions',
        '.status'
    ]);
});
