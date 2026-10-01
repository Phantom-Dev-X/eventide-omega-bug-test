import test from 'node:test';
import assert from 'node:assert/strict';

import { createMessageConversationService } from '../src/whatsapp/message-conversation.js';

function createFixture(overrides = {}) {
    const autoreactSessions = new Map();
    const antiConfigSessions = new Map();
    const helpModeUsers = new Map();
    const calls = [];
    const sent = [];
    const scheduled = [];
    const sock = {
        sendMessage: async (jid, content) => {
            sent.push({ jid, content });
            return { key: { id: `sent-${sent.length}` } };
        }
    };
    const service = createMessageConversationService({
        autoreactSessions,
        antiConfigSessions,
        helpModeUsers,
        parseInviteOrJid: text => String(text).includes('target') ? { kind: 'group' } : null,
        resolveAndJoinTarget: async () => ({
            ok: true,
            kind: 'group',
            jid: 'group@g.us',
            name: 'Test Group',
            joined: true
        }),
        applyWardEndpoint: (...args) => calls.push(['applyWardEndpoint', ...args]),
        safeWaReply: async (...args) => calls.push(['safeWaReply', ...args]),
        buildOmegaTerminal: text => `terminal:${text}`,
        terminalHeader: 'HEADER\n',
        getBoundHelpPrompt: phoneNumber => `prompt:${phoneNumber}`,
        callUniversalAI: async (...args) => {
            calls.push(['callUniversalAI', ...args]);
            return 'AI response';
        },
        aiOptsFor: phoneNumber => ({ phoneNumber }),
        clearScheduled: timer => calls.push(['clearScheduled', timer]),
        schedule: (callback, milliseconds) => {
            const timer = { callback, milliseconds };
            scheduled.push(timer);
            return timer;
        },
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['error', ...args]),
        ...overrides
    });

    function context(overrides = {}) {
        return {
            sock,
            message: { key: { id: 'message-1', remoteJid: 'chat@s.whatsapp.net' } },
            phoneNumber: '2348000000001',
            eventType: 'notify',
            remoteJid: 'chat@s.whatsapp.net',
            messageId: 'message-1',
            fromMe: false,
            text: 'hello',
            normalized: 'hello',
            token: 'hello',
            ...overrides
        };
    }

    return {
        service,
        autoreactSessions,
        antiConfigSessions,
        helpModeUsers,
        calls,
        sent,
        scheduled,
        sock,
        context
    };
}

test('ward input cancellation clears the active configuration session', async () => {
    const fixture = createFixture();
    fixture.autoreactSessions.set('2348000000001', { step: 'awaiting_ref' });

    const handled = await fixture.service.handleConversation(fixture.context({
        text: '.cancel',
        normalized: '.cancel',
        token: '.cancel'
    }));

    assert.equal(handled, true);
    assert.equal(fixture.autoreactSessions.has('2348000000001'), false);
    assert.equal(
        fixture.calls.some(call => call[0] === 'safeWaReply' && call[3].includes('CANCELLED')),
        true
    );
});

test('ward target input resolves, stores, and confirms a matching endpoint', async () => {
    const fixture = createFixture();
    fixture.antiConfigSessions.set('2348000000001', {
        step: 'awaiting_ref',
        endpoint: 'group'
    });

    const handled = await fixture.service.handleConversation(fixture.context({
        text: 'target group link',
        normalized: 'target group link'
    }));

    assert.equal(handled, true);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'applyWardEndpoint'),
        ['applyWardEndpoint', '2348000000001', 'ad', 'group', 'group@g.us']
    );
    assert.equal(fixture.antiConfigSessions.has('2348000000001'), false);
});

test('ward target type mismatch is rejected without clearing the pending session', async () => {
    const fixture = createFixture();
    fixture.autoreactSessions.set('2348000000001', {
        step: 'awaiting_ref',
        endpoint: 'channel'
    });

    const handled = await fixture.service.handleConversation(fixture.context({
        text: 'target group link',
        normalized: 'target group link'
    }));

    assert.equal(handled, true);
    assert.equal(fixture.autoreactSessions.has('2348000000001'), true);
    assert.equal(
        fixture.calls.some(call => call[0] === 'safeWaReply' && call[3].includes('not a channel')),
        true
    );
});

test('help mode ignores bot echo signatures without calling the AI', async () => {
    const fixture = createFixture();
    fixture.helpModeUsers.set('chat@s.whatsapp.net', { timer: null });

    const handled = await fixture.service.handleConversation(fixture.context({
        fromMe: true,
        eventType: 'append',
        text: '🤖 automated response'
    }));

    assert.equal(handled, true);
    assert.equal(fixture.calls.some(call => call[0] === 'callUniversalAI'), false);
});

test('help mode resets its timeout and replies with the AI response', async () => {
    const fixture = createFixture();
    const oldTimer = { id: 'old' };
    fixture.helpModeUsers.set('chat@s.whatsapp.net', { timer: oldTimer });

    const handled = await fixture.service.handleConversation(fixture.context({
        text: 'How do I use ping?'
    }));

    assert.equal(handled, true);
    assert.deepEqual(
        fixture.calls.find(call => call[0] === 'clearScheduled'),
        ['clearScheduled', oldTimer]
    );
    assert.equal(fixture.scheduled[0].milliseconds, 10 * 60 * 1000);
    assert.equal(
        fixture.calls.some(call => call[0] === 'safeWaReply' && call[3].includes('AI response')),
        true
    );
});

test('.help bypasses the active help-mode interceptor for normal command handling', async () => {
    const fixture = createFixture();
    fixture.helpModeUsers.set('chat@s.whatsapp.net', { timer: null });

    const handled = await fixture.service.handleConversation(fixture.context({
        text: '.help',
        normalized: '.help',
        token: '.help'
    }));

    assert.equal(handled, false);
    assert.equal(fixture.calls.some(call => call[0] === 'callUniversalAI'), false);
});
