import test from 'node:test';
import assert from 'node:assert/strict';

import { createMessageMiddleware } from '../src/whatsapp/message-middleware.js';

function createFixture({ config = {}, mode = 'private', ...overrides } = {}) {
    const recentMessages = new Map();
    const mutedUsers = new Map();
    const calls = [];
    const sent = [];
    const sock = {
        user: { id: '2348000000001@s.whatsapp.net' },
        sendMessage: async (jid, content, options) => {
            sent.push({ jid, content, options });
            return { key: { id: `sent-${sent.length}` } };
        }
    };
    const middleware = createMessageMiddleware({
        verboseLogs: true,
        recentMessages,
        mutedUsers,
        slimProto: value => value,
        logMessage: (...args) => calls.push(['logMessage', ...args]),
        normalizeJid: jid => String(jid || '').split(':')[0],
        maskApiKey: value => `masked:${value.slice(0, 4)}`,
        trimForLog: value => String(value || '').slice(0, 250),
        loadBotConfig: () => config,
        loadBotMode: () => mode,
        isDevNumber: () => false,
        isSudo: () => false,
        now: () => 2_000_000,
        random: () => 0,
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['error', ...args]),
        ...overrides
    });

    function context(overrides = {}) {
        const message = {
            key: {
                remoteJid: 'chat@s.whatsapp.net',
                id: 'message-1',
                participant: 'sender@s.whatsapp.net',
                fromMe: false
            },
            message: { conversation: 'hello' },
            messageTimestamp: 1999,
            pushName: 'Sender'
        };
        return {
            sock,
            message,
            phoneNumber: '2348000000001',
            eventType: 'notify',
            remoteJid: message.key.remoteJid,
            messageId: message.key.id,
            participant: message.key.participant,
            fromMe: false,
            parsed: {
                text: 'hello',
                topLevelType: 'conversation',
                wrapperChain: [],
                leafType: 'conversation',
                source: 'conversation'
            },
            ...overrides
        };
    }

    return { middleware, recentMessages, mutedUsers, calls, sent, sock, context };
}

test('middleware caches and persists accepted messages before dispatch', async () => {
    const fixture = createFixture();
    const ctx = fixture.context();

    const shouldContinue = await fixture.middleware.runMessageMiddleware(ctx);

    assert.equal(shouldContinue, true);
    assert.deepEqual(
        fixture.recentMessages.get('2348000000001:chat@s.whatsapp.net:message-1'),
        {
            key: ctx.message.key,
            message: ctx.message.message,
            messageTimestamp: 1999,
            pushName: 'Sender',
            _cachedAt: 2_000_000
        }
    );
    assert.equal(fixture.calls.some(call => call[0] === 'logMessage'), true);
});

test('middleware deletes messages from muted group participants and stops dispatch', async () => {
    const fixture = createFixture();
    const remoteJid = 'group@g.us';
    fixture.mutedUsers.set('2348000000001:group@g.us', new Set(['muted@s.whatsapp.net']));
    const ctx = fixture.context({
        remoteJid,
        participant: 'muted@s.whatsapp.net',
        message: {
            key: {
                remoteJid,
                id: 'muted-message',
                participant: 'muted@s.whatsapp.net',
                fromMe: false
            },
            message: { conversation: 'hello' }
        },
        messageId: 'muted-message'
    });

    const shouldContinue = await fixture.middleware.runMessageMiddleware(ctx);

    assert.equal(shouldContinue, false);
    assert.deepEqual(fixture.sent[0].content.delete, {
        remoteJid,
        id: 'muted-message',
        participant: 'muted@s.whatsapp.net'
    });
});

test('middleware acknowledges fresh commands before normal dispatch', async () => {
    const fixture = createFixture();
    const ctx = fixture.context({
        parsed: {
            text: '.ping',
            topLevelType: 'conversation',
            wrapperChain: [],
            leafType: 'conversation',
            source: 'conversation'
        },
        message: {
            key: {
                remoteJid: 'chat@s.whatsapp.net',
                id: 'command-message',
                participant: 'sender@s.whatsapp.net',
                fromMe: false
            },
            message: { conversation: '.ping' },
            messageTimestamp: 1999
        },
        messageId: 'command-message'
    });

    const shouldContinue = await fixture.middleware.runMessageMiddleware(ctx);

    assert.equal(shouldContinue, true);
    assert.equal(fixture.sent[0].content.react.text, '⚡');
    assert.equal(fixture.sent[0].content.react.key.id, 'command-message');
});

test('owner-only mode suppresses command acknowledgement for unauthorized senders', async () => {
    const fixture = createFixture({ mode: 'owner' });
    const ctx = fixture.context({
        parsed: {
            text: '.ping',
            topLevelType: 'conversation',
            wrapperChain: [],
            leafType: 'conversation',
            source: 'conversation'
        }
    });

    const shouldContinue = await fixture.middleware.runMessageMiddleware(ctx);

    assert.equal(shouldContinue, true);
    assert.equal(fixture.sent.length, 0);
    assert.equal(
        fixture.calls.some(call => call[0] === 'log' && String(call[2]).includes('owner-only mode blocked')),
        true
    );
});

test('anti-link moderation deletes a violating group message and stops dispatch', async () => {
    const remoteJid = 'group@g.us';
    const fixture = createFixture({
        config: { anti: { antilink: { [remoteJid]: 'on' } } }
    });
    const ctx = fixture.context({
        remoteJid,
        participant: 'sender@s.whatsapp.net',
        parsed: {
            text: 'visit https://example.com',
            topLevelType: 'conversation',
            wrapperChain: [],
            leafType: 'conversation',
            source: 'conversation'
        },
        message: {
            key: {
                remoteJid,
                id: 'link-message',
                participant: 'sender@s.whatsapp.net',
                fromMe: false
            },
            message: { conversation: 'visit https://example.com' }
        },
        messageId: 'link-message'
    });

    const shouldContinue = await fixture.middleware.runMessageMiddleware(ctx);

    assert.equal(shouldContinue, false);
    assert.equal(fixture.sent.some(item => item.content.delete?.id === 'link-message'), true);
});

test('channel auto-react runs before channel posts are removed from command flow', async () => {
    const remoteJid = '12345@newsletter';
    const fixture = createFixture({
        config: {
            autoreact: {
                enabled: true,
                endpoints: { groups: [], channels: [remoteJid], contacts: [] }
            }
        }
    });
    const ctx = fixture.context({
        remoteJid,
        message: {
            key: { remoteJid, id: 'channel-post', fromMe: false },
            message: { conversation: 'announcement' }
        },
        messageId: 'channel-post'
    });

    const shouldContinue = await fixture.middleware.runMessageMiddleware(ctx);

    assert.equal(shouldContinue, false);
    assert.equal(fixture.sent.length, 1);
    assert.equal(fixture.sent[0].content.react.text, '🔥');
});
