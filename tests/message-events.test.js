import test from 'node:test';
import assert from 'node:assert/strict';

import { createMessageEventService } from '../src/whatsapp/message-events.js';

function createFixture(overrides = {}) {
    const listeners = new Map();
    const calls = [];
    const sent = [];
    const lastPollVotes = new Map();
    const config = {};
    const sock = {
        ev: {
            on: (event, handler) => {
                const eventListeners = listeners.get(event) || [];
                eventListeners.push(handler);
                listeners.set(event, eventListeners);
            }
        },
        sendMessage: async (jid, content) => {
            sent.push({ jid, content });
            return { key: { id: `sent-${sent.length}` } };
        }
    };

    const dependencies = {
        verboseLogs: false,
        lastPollVotes,
        loadBotConfig: () => config,
        loadBotMode: () => 'private',
        handlePollUpdateMessage: (...args) => {
            calls.push(['handlePollUpdateMessage', ...args]);
            return null;
        },
        handleMenuVote: async (...args) => calls.push(['handleMenuVote', ...args]),
        handleWhatsAppMessage: async (...args) => calls.push(['handleWhatsAppMessage', ...args]),
        extractRevokeRef: (...args) => {
            calls.push(['extractRevokeRef', ...args]);
            return null;
        },
        handleAntideleteRevoke: async (...args) => calls.push(['handleAntideleteRevoke', ...args]),
        handlePollVote: (...args) => {
            calls.push(['handlePollVote', ...args]);
            return null;
        },
        normalizeJid: jid => jid,
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['error', ...args]),
        ...overrides
    };

    const service = createMessageEventService(dependencies);
    service.setupMessageHandler(sock, '2348000000001', 10);

    async function emit(event, payload) {
        for (const listener of listeners.get(event) || []) {
            await listener(payload);
        }
    }

    return {
        service,
        sock,
        listeners,
        calls,
        sent,
        config,
        lastPollVotes,
        emit
    };
}

test('message upserts send decrypted poll votes to the menu handler and skip normal flow', async () => {
    const voteResult = {
        optionId: 'menu:tools',
        pollId: 'poll-1',
        voterJid: 'voter@s.whatsapp.net'
    };
    const fixture = createFixture({
        handlePollUpdateMessage: (...args) => {
            fixture.calls.push(['handlePollUpdateMessage', ...args]);
            return voteResult;
        }
    });
    const message = {
        key: { id: 'vote-message', remoteJid: 'chat@s.whatsapp.net' },
        message: { pollUpdateMessage: {} }
    };

    await fixture.emit('messages.upsert', { type: 'notify', messages: [message] });

    assert.equal(fixture.calls.some(call => call[0] === 'handleWhatsAppMessage'), false);
    const menuCall = fixture.calls.find(call => call[0] === 'handleMenuVote');
    assert.deepEqual(menuCall.slice(2), [
        'chat@s.whatsapp.net',
        '2348000000001',
        'menu:tools',
        'poll-1',
        'voter@s.whatsapp.net'
    ]);
});

test('ordinary upserts are processed independently and preserve event type', async () => {
    const handledIds = [];
    const fixture = createFixture({
        handleWhatsAppMessage: async (_sock, message, _phone, _tgId, type) => {
            handledIds.push([message.key.id, type]);
            if (message.key.id === 'first') throw new Error('isolated failure');
        }
    });

    await fixture.emit('messages.upsert', {
        type: 'append',
        messages: [
            { key: { id: 'first' }, message: { conversation: '.ping' } },
            { key: { id: 'second' }, message: { conversation: '.menu' } }
        ]
    });

    assert.deepEqual(handledIds, [['first', 'append'], ['second', 'append']]);
    assert.equal(
        fixture.calls.some(call => call[0] === 'error' && call[1] === 'WA-HANDLER'),
        true
    );
});

test('message updates coordinate antidelete and suppress duplicate poll choices', async () => {
    const referenceKey = { id: 'deleted-message' };
    const fixture = createFixture({
        extractRevokeRef: () => referenceKey,
        handleAntideleteRevoke: async (...args) => fixture.calls.push(['handleAntideleteRevoke', ...args]),
        handlePollVote: () => 'menu:system'
    });
    const update = {
        key: { id: 'poll-2', remoteJid: 'group@g.us', participant: 'voter@s.whatsapp.net' },
        update: { pollUpdates: [{}], status: 3 }
    };

    await fixture.emit('messages.update', [update]);
    await fixture.emit('messages.update', [update]);

    assert.equal(
        fixture.calls.filter(call => call[0] === 'handleAntideleteRevoke').length,
        2
    );
    assert.equal(
        fixture.calls.filter(call => call[0] === 'handleMenuVote').length,
        1
    );
    assert.equal(
        fixture.lastPollVotes.get('poll-2:voter@s.whatsapp.net'),
        'menu:system'
    );
});

test('group participant events render configured welcome templates', async () => {
    const fixture = createFixture();
    fixture.config.welcomeMsg = {
        'group@g.us': 'Welcome {{name}} to Eventide.'
    };

    await fixture.emit('group-participants.update', {
        id: 'group@g.us',
        participants: ['2348111111111@s.whatsapp.net'],
        action: 'add'
    });

    assert.deepEqual(fixture.sent, [{
        jid: 'group@g.us',
        content: { text: 'Welcome 2348111111111 to Eventide.' }
    }]);
});
