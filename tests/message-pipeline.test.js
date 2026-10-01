import test from 'node:test';
import assert from 'node:assert/strict';

import { createMessagePipeline, parseCommandInput } from '../src/whatsapp/message-pipeline.js';

function createFixture(overrides = {}) {
    const calls = [];
    const pipeline = createMessagePipeline({
        verboseLogs: true,
        isRecentMessage: message => message.recent !== false,
        isIgnoredRemoteJid: jid => jid === 'status@broadcast',
        handleAntideleteRevoke: async (...args) => calls.push(['revoke', ...args]),
        trimForLog: value => String(value),
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['error', ...args]),
        ...overrides
    });
    return { pipeline, calls };
}

function message(overrides = {}) {
    return {
        key: {
            remoteJid: 'chat@s.whatsapp.net',
            id: 'message-1',
            participant: 'sender@s.whatsapp.net',
            fromMe: false,
            ...(overrides.key || {})
        },
        pushName: 'Sender',
        message: { conversation: '.ping' },
        ...overrides,
        key: {
            remoteJid: 'chat@s.whatsapp.net',
            id: 'message-1',
            participant: 'sender@s.whatsapp.net',
            fromMe: false,
            ...(overrides.key || {})
        }
    };
}

test('preflight returns normalized transport metadata for processable messages', async () => {
    const fixture = createFixture();
    const result = await fixture.pipeline.preprocessIncomingMessage({
        sock: {},
        message: message(),
        phoneNumber: '2348000000001',
        eventType: 'notify'
    });

    assert.deepEqual(result, {
        remoteJid: 'chat@s.whatsapp.net',
        messageId: 'message-1',
        participant: 'sender@s.whatsapp.net',
        fromMe: false,
        pushName: 'Sender',
        recent: true
    });
    assert.equal(Object.isFrozen(result), true);
});

test('preflight rejects ignored JIDs and messages without payloads', async () => {
    const fixture = createFixture();
    const ignored = await fixture.pipeline.preprocessIncomingMessage({
        sock: {},
        message: message({ key: { remoteJid: 'status@broadcast' } }),
        phoneNumber: '2348000000001',
        eventType: 'notify'
    });
    const empty = message();
    empty.message = null;
    const missingPayload = await fixture.pipeline.preprocessIncomingMessage({
        sock: {},
        message: empty,
        phoneNumber: '2348000000001',
        eventType: 'notify'
    });

    assert.equal(ignored, null);
    assert.equal(missingPayload, null);
});

test('preflight sends revoke packets to antidelete and stops normal processing', async () => {
    const fixture = createFixture();
    const revokeKey = { id: 'original-message', remoteJid: 'chat@s.whatsapp.net' };
    const incoming = message({
        message: { protocolMessage: { type: 'REVOKE', key: revokeKey } }
    });

    const result = await fixture.pipeline.preprocessIncomingMessage({
        sock: 'socket',
        message: incoming,
        phoneNumber: '2348000000001',
        eventType: 'notify'
    });

    assert.equal(result, null);
    assert.deepEqual(fixture.calls.find(call => call[0] === 'revoke').slice(1), [
        'socket',
        '2348000000001',
        incoming.key,
        revokeKey
    ]);
});

test('preflight permits only notify and append events', async () => {
    const fixture = createFixture();
    const result = await fixture.pipeline.preprocessIncomingMessage({
        sock: {},
        message: message(),
        phoneNumber: '2348000000001',
        eventType: 'history'
    });
    assert.equal(result, null);
});

test('preflight blocks append echoes from the bot but permits live owner messages', async () => {
    const fixture = createFixture();
    const ownMessage = message({ key: { fromMe: true } });

    const echo = await fixture.pipeline.preprocessIncomingMessage({
        sock: {},
        message: ownMessage,
        phoneNumber: '2348000000001',
        eventType: 'append'
    });
    const live = await fixture.pipeline.preprocessIncomingMessage({
        sock: {},
        message: ownMessage,
        phoneNumber: '2348000000001',
        eventType: 'notify'
    });

    assert.equal(echo, null);
    assert.equal(live.fromMe, true);
});

test('command parser preserves dot commands and arguments', () => {
    assert.deepEqual(parseCommandInput('.ping now', { prefix: '.' }), {
        text: '.ping now',
        normalized: '.ping now',
        firstWord: '.ping',
        args: ['now'],
        prefix: '.',
        token: '.ping',
        startsWithDot: true
    });
});

test('command parser maps custom prefixes to legacy dot tokens', () => {
    assert.deepEqual(parseCommandInput('>PiNg one two', { prefix: '>' }), {
        text: '>PiNg one two',
        normalized: '>PiNg one two',
        firstWord: '>PiNg',
        args: ['one', 'two'],
        prefix: '>',
        token: '.ping',
        startsWithDot: true
    });
    assert.equal(parseCommandInput('hello there', { prefix: '>' }).startsWithDot, false);
});
