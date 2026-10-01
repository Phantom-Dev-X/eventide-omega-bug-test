import test from 'node:test';
import assert from 'node:assert/strict';

import { createMessageAccessService } from '../src/whatsapp/message-access.js';

function createFixture({ mode = 'private', warnState = { groups: {} }, ...overrides } = {}) {
    const personaPollKeys = new Map();
    const calls = [];
    const sent = [];
    const sock = {
        user: { id: '2348000000001@s.whatsapp.net' },
        groupMetadata: async jid => ({
            id: jid,
            participants: [
                { id: '2348000000001@s.whatsapp.net' },
                { id: '2348111111111@s.whatsapp.net' }
            ]
        }),
        sendMessage: async (jid, content) => {
            sent.push({ jid, content });
            return { key: { id: `sent-${sent.length}` } };
        }
    };

    const service = createMessageAccessService({
        personaPollKeys,
        personaPollQuestion: 'Choose persona',
        personaPollOptions: ['Eclipse', 'Ruin'],
        personaPollIds: ['persona:eclipse', 'persona:ruin'],
        isSudo: () => false,
        normalizeJid: jid => String(jid || '').split(':')[0],
        safeWaReply: async (...args) => calls.push(['safeWaReply', ...args]),
        sendMenuPoll: async (...args) => {
            calls.push(['sendMenuPoll', ...args]);
            return { key: { id: 'persona-poll' } };
        },
        loadBotMode: () => mode,
        getWarnState: () => warnState,
        findMatchingPhrase: (text, phrases) => phrases.find(phrase => text.includes(phrase)) || null,
        isUserGroupAdmin: async () => false,
        isDevNumber: () => false,
        applyWarn: async (...args) => calls.push(['applyWarn', ...args]),
        getTttGame: () => null,
        tttIsReplyToBoard: () => false,
        tttTryMove: async (...args) => calls.push(['tttTryMove', ...args]),
        handleGameText: async () => false,
        findHidetagTrigger: () => null,
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['error', ...args]),
        ...overrides
    });

    function context(overrides = {}) {
        const remoteJid = overrides.remoteJid || 'chat@s.whatsapp.net';
        const message = overrides.message || {
            key: {
                remoteJid,
                participant: 'sender@s.whatsapp.net',
                fromMe: false,
                id: 'message-1'
            }
        };
        return {
            sock,
            message,
            phoneNumber: '2348000000001',
            remoteJid,
            messageId: message.key.id,
            fromMe: !!message.key.fromMe,
            text: '.ping',
            normalized: '.ping',
            prefix: '.',
            token: '.ping',
            startsWithDot: true,
            botConfig: { persona: 'eclipse', aliases: {} },
            ...overrides,
            message
        };
    }

    return { service, personaPollKeys, calls, sent, sock, context };
}

test('bound persona passes through with normalized access context', async () => {
    const fixture = createFixture();
    const result = await fixture.service.runPreCommandAccess(fixture.context());

    assert.deepEqual(result, {
        currentMode: 'private',
        senderJid: 'sender@s.whatsapp.net',
        isSenderOwner: false
    });
});

test('unbound persona blocks non-owner group commands without creating a group poll', async () => {
    const fixture = createFixture();
    const remoteJid = 'group@g.us';
    const result = await fixture.service.runPreCommandAccess(fixture.context({
        remoteJid,
        botConfig: { persona: null, aliases: {} },
        message: {
            key: {
                remoteJid,
                participant: 'sender@s.whatsapp.net',
                fromMe: false,
                id: 'group-command'
            }
        }
    }));

    assert.equal(result, null);
    assert.equal(fixture.calls.some(call => call[0] === 'sendMenuPoll'), false);
    assert.equal(
        fixture.calls.some(call => call[0] === 'safeWaReply' && call[3].includes('PERSONA LOCKED')),
        true
    );
});

test('unbound owner command creates and records a persona poll', async () => {
    const fixture = createFixture();
    const result = await fixture.service.runPreCommandAccess(fixture.context({
        botConfig: { persona: '', aliases: {} },
        message: {
            key: {
                remoteJid: 'chat@s.whatsapp.net',
                participant: '2348000000001@s.whatsapp.net',
                fromMe: true,
                id: 'owner-command'
            }
        }
    }));

    assert.equal(result, null);
    assert.equal(fixture.calls.some(call => call[0] === 'sendMenuPoll'), true);
    assert.equal(fixture.personaPollKeys.get('2348000000001').id, 'persona-poll');
});

test('phrase warning handles a violating non-admin group message before commands', async () => {
    const remoteJid = 'group@g.us';
    const fixture = createFixture({
        warnState: {
            groups: {
                [remoteJid]: { enabled: true, phrases: ['forbidden'] }
            }
        }
    });
    const ctx = fixture.context({
        remoteJid,
        text: 'this is forbidden',
        normalized: 'this is forbidden',
        token: 'this',
        startsWithDot: false,
        message: {
            key: {
                remoteJid,
                participant: 'sender@s.whatsapp.net',
                fromMe: false,
                id: 'warning-message'
            }
        }
    });

    const result = await fixture.service.runPreCommandAccess(ctx);

    assert.equal(result, null);
    const warning = fixture.calls.find(call => call[0] === 'applyWarn');
    assert.equal(warning[3].reason, 'phrase: "forbidden"');
    assert.equal(warning[3].auto, true);
});

test('active tic-tac-toe board replies are routed before command handling', async () => {
    const fixture = createFixture({
        getTttGame: () => ({ status: 'active' }),
        tttIsReplyToBoard: () => true,
        tttTryMove: async (...args) => fixture.calls.push(['tttTryMove', ...args])
    });

    const result = await fixture.service.runPreCommandAccess(fixture.context({
        text: '5',
        normalized: '5',
        token: '5',
        startsWithDot: false
    }));

    assert.equal(result, null);
    const move = fixture.calls.find(call => call[0] === 'tttTryMove');
    assert.equal(move[5], 4);
});

test('owner-only mode blocks unauthorized interactions', async () => {
    const fixture = createFixture({ mode: 'owner' });
    const result = await fixture.service.runPreCommandAccess(fixture.context());

    assert.equal(result, null);
    assert.equal(
        fixture.calls.some(call => call[0] === 'log' && call[1] === 'SECURITY'),
        true
    );
});

test('authorized hidetag sends one message mentioning every group participant', async () => {
    const remoteJid = 'group@g.us';
    const fixture = createFixture({
        isUserGroupAdmin: async () => true,
        findHidetagTrigger: () => ({ body: 'silent announcement' })
    });

    const result = await fixture.service.runPreCommandAccess(fixture.context({
        remoteJid,
        message: {
            key: {
                remoteJid,
                participant: 'admin@s.whatsapp.net',
                fromMe: false,
                id: 'hidetag-message'
            }
        }
    }));

    assert.equal(result, null);
    assert.deepEqual(fixture.sent[0], {
        jid: remoteJid,
        content: {
            text: 'silent announcement',
            mentions: [
                '2348000000001@s.whatsapp.net',
                '2348111111111@s.whatsapp.net'
            ]
        }
    });
});
