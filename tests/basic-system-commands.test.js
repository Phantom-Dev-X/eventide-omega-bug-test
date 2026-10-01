import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createBasicSystemCommands } from '../src/commands/system/basic.js';

function createFixture() {
    const replies = [];
    const sent = [];
    const times = [1000, 1125];
    const sock = {
        sendMessage: async (jid, content, options) => {
            sent.push({ jid, content, options });
            return { key: { id: 'scan-message' } };
        }
    };
    const registry = createCommandRegistry(createBasicSystemCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        runtimeUptime: () => '1h 2m 3s',
        now: () => times.shift() ?? 1125,
        memoryUsage: () => ({
            heapUsed: 10 * 1024 * 1024,
            heapTotal: 20 * 1024 * 1024,
            rss: 30 * 1024 * 1024
        }),
        processVersion: 'v20.20.2',
        platform: 'linux',
        architecture: 'x64',
        pid: 4321
    }));
    const message = { key: { id: 'command-message' } };
    const context = { sock, remoteJid: 'chat@s.whatsapp.net', message };
    return { registry, replies, sent, context, message };
}

test('ping preserves scan message, latency classification, and uptime output', async () => {
    const fixture = createFixture();

    assert.equal(await fixture.registry.execute('.ping', fixture.context), true);

    assert.deepEqual(fixture.sent[0], {
        jid: 'chat@s.whatsapp.net',
        content: { text: '⚡ _scanning signal...' },
        options: { quoted: fixture.message }
    });
    assert.match(fixture.replies[0].text, /125ms/);
    assert.match(fixture.replies[0].text, /STABLE/);
    assert.match(fixture.replies[0].text, /1h 2m 3s/);
});

test('uptime and runtime commands preserve process memory details', async () => {
    const fixture = createFixture();

    await fixture.registry.execute('.uptime', fixture.context);
    await fixture.registry.execute('.runtime', fixture.context);

    assert.match(fixture.replies[0].text, /10MB \/ 20MB/);
    assert.match(fixture.replies[0].text, /30MB/);
    assert.match(fixture.replies[0].text, /4321/);
    assert.match(fixture.replies[1].text, /NODE.*20\.20\.2/);
    assert.match(fixture.replies[1].text, /RSS.*30MB/);
});

test('info, version, and os commands preserve stable public output', async () => {
    const fixture = createFixture();

    await fixture.registry.execute('.info', fixture.context);
    await fixture.registry.execute('.version', fixture.context);
    await fixture.registry.execute('.os', fixture.context);

    assert.match(fixture.replies[0].text, /CORE_MANIFEST/);
    assert.match(fixture.replies[0].text, /BUG_SHIELD: ACTIVE/);
    assert.match(fixture.replies[1].text, /v1\.0\.0_STABLE/);
    assert.match(fixture.replies[2].text, /PLATFORM.*linux/);
    assert.match(fixture.replies[2].text, /ARCH.*x64/);
});

test('basic system command group registers exactly six commands', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), [
        '.info',
        '.os',
        '.ping',
        '.runtime',
        '.uptime',
        '.version'
    ]);
});
