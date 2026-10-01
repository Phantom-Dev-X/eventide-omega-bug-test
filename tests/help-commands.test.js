import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createHelpCommands } from '../src/commands/system/help.js';

function createFixture({ owner = true, sudo = false, persona = 'eclipse' } = {}) {
    const replies = [];
    const sends = [];
    const logs = [];
    const errors = [];
    const polls = [];
    const aiCalls = [];
    const timers = [];
    const cleared = [];
    const helpPersonaPollKeys = new Map();
    const helpModeUsers = new Map();
    const sock = {
        sendMessage: async (...args) => {
            sends.push(args);
            return { key: { id: 'sent-message' } };
        }
    };
    let aiResult = 'oracle response';
    let staticResult = '';
    const definitions = createHelpCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildBugMenuText: prefix => `bug-menu:${prefix}`,
        log: (...args) => logs.push(args),
        logError: (...args) => errors.push(args),
        isSudo: () => sudo,
        loadBotConfig: () => ({ helpPersona: persona }),
        helpPersonaPollKeys,
        sendMenuPoll: async (...args) => {
            polls.push(args);
            return { key: { id: 'persona-poll' } };
        },
        helpPersonaPollQuestion: 'pick persona',
        helpPersonaPollOptions: ['Eclipse', 'Ruin'],
        helpPersonaPollIds: ['eclipse', 'ruin'],
        getBoundHelpPrompt: number => `prompt:${number}`,
        callUniversalAI: async (...args) => {
            aiCalls.push(args);
            if (aiResult instanceof Error) throw aiResult;
            return aiResult;
        },
        aiOptsFor: number => ({ phoneNumber: number }),
        getStaticHelpAnswer: () => staticResult,
        terminalHeader: 'TERMINAL\n',
        helpModeUsers,
        setTimer: (callback, milliseconds) => {
            const timer = { callback, milliseconds };
            timers.push(timer);
            return timer;
        },
        clearTimer: timer => cleared.push(timer),
        env: {}
    });
    return {
        registry: createCommandRegistry(definitions),
        replies, sends, logs, errors, polls, aiCalls, timers, cleared,
        helpPersonaPollKeys, helpModeUsers,
        setAiResult(value) { aiResult = value; },
        setStaticResult(value) { staticResult = value; },
        context: {
            sock,
            remoteJid: 'chat@s.whatsapp.net',
            message: { key: { id: 'incoming-message' } },
            phoneNumber: '2348000000001',
            senderJid: 'sender@s.whatsapp.net',
            isSenderOwner: owner,
            args: [],
            prefix: '!'
        }
    };
}

test('bug menu reacts and replies using the active prefix', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.bugmenu', fixture.context);
    assert.deepEqual(fixture.sends[0][1], {
        react: { text: '🎗️', key: fixture.context.message.key }
    });
    assert.equal(fixture.replies[0].text, 'bug-menu:!');
});

test('bug menu still replies when its reaction fails', async () => {
    const fixture = createFixture();
    fixture.context.sock.sendMessage = async () => { throw new Error('reaction unavailable'); };
    await fixture.registry.execute('.bug-menu', fixture.context);
    assert.equal(fixture.replies[0].text, 'bug-menu:!');
});

test('help aliases silently reject callers who are neither owner nor sudo', async () => {
    const fixture = createFixture({ owner: false, sudo: false });
    await fixture.registry.execute('.jelp', fixture.context);
    assert.equal(fixture.replies.length, 0);
    assert.match(fixture.logs[0][1], /non-owner\/non-sudo/);
});

test('first help request asks for a persona and tracks the poll key', async () => {
    const fixture = createFixture({ persona: '' });
    await fixture.registry.execute('.help', fixture.context);
    assert.match(fixture.replies[0].text, /EVENTIDE OMEGA — HELP PERSONA/);
    assert.equal(fixture.polls.length, 1);
    assert.deepEqual(fixture.polls[0].slice(3), [
        'pick persona', ['Eclipse', 'Ruin'], ['eclipse', 'ruin']
    ]);
    assert.deepEqual(fixture.helpPersonaPollKeys.get('2348000000001'), { id: 'persona-poll' });
});

test('an existing persona poll is not duplicated', async () => {
    const fixture = createFixture({ persona: '' });
    fixture.helpPersonaPollKeys.set('2348000000001', { id: 'existing' });
    await fixture.registry.execute('.mhelp', fixture.context);
    assert.match(fixture.replies[0].text, /HELP PERSONA FIRST/);
    assert.equal(fixture.polls.length, 0);
});

test('a help question invokes the bound AI oracle and replies', async () => {
    const fixture = createFixture({ sudo: true, owner: false, persona: 'ruin' });
    fixture.context.args = ['how', 'does', 'mode', 'work?'];
    await fixture.registry.execute('.help', fixture.context);
    assert.deepEqual(fixture.aiCalls[0], [
        'how does mode work?',
        'prompt:2348000000001',
        { phoneNumber: '2348000000001' }
    ]);
    assert.equal(fixture.replies[0].text, '🤖 *Eventide Help:*\n\noracle response');
});

test('AI failure uses a matching static help answer', async () => {
    const fixture = createFixture();
    fixture.context.args = ['antilink'];
    fixture.setAiResult(new Error('offline'));
    fixture.setStaticResult('Static antilink guide');
    await fixture.registry.execute('.help', fixture.context);
    assert.match(fixture.replies[0].text, /Eventide Help \(offline index\)/);
    assert.match(fixture.replies[0].text, /Static antilink guide/);
    assert.equal(fixture.errors.length, 1);
});

test('AI failure without a static answer returns environment diagnostics', async () => {
    const fixture = createFixture();
    fixture.context.args = ['unknown'];
    fixture.setAiResult(new Error('offline'));
    await fixture.registry.execute('.help', fixture.context);
    assert.match(fixture.replies[0].text, /AI_ORACLE — OFFLINE/);
    assert.match(fixture.replies[0].text, /GEMINI_API_KEY: Not Set/);
    assert.match(fixture.replies[0].text, /OPENAI_API_KEY: Not Set/);
});

test('bare help enables timed help mode and timeout removes it', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.help', fixture.context);
    assert.equal(fixture.timers.length, 1);
    assert.equal(fixture.timers[0].milliseconds, 10 * 60 * 1000);
    assert.equal(fixture.helpModeUsers.has('chat@s.whatsapp.net'), true);
    assert.match(fixture.replies[0].text, /HELP_PROTOCOL — ACTIVE/);

    await fixture.timers[0].callback();
    assert.equal(fixture.helpModeUsers.has('chat@s.whatsapp.net'), false);
    assert.match(fixture.sends.at(-1)[1].text, /timed out after 10 min inactivity/);
});

test('bare help disables active help mode and clears its timer', async () => {
    const fixture = createFixture();
    const timer = { id: 'old-timer' };
    fixture.helpModeUsers.set('chat@s.whatsapp.net', { timer });
    await fixture.registry.execute('.help', fixture.context);
    assert.deepEqual(fixture.cleared, [timer]);
    assert.equal(fixture.helpModeUsers.has('chat@s.whatsapp.net'), false);
    assert.match(fixture.replies[0].text, /HELP_MODE — OFFLINE/);
});

test('help command module registers primary commands and legacy aliases', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.bugmenu', '.help']);
    assert.equal(fixture.registry.has('.bugmemu'), true);
    assert.equal(fixture.registry.has('.mhelp'), true);
    assert.equal(fixture.registry.has('.jelp'), true);
});
