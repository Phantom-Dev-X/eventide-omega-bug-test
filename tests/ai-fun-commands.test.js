import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createAiFunCommands } from '../src/commands/fun/ai.js';

function createFixture() {
    const sends = [];
    const replies = [];
    const generations = [];
    const errors = [];
    const presence = [];
    let targetJid = null;
    let quotedText = '';
    let quotedContext = null;
    let generationResult = { body: 'generated body' };
    let presenceError = null;
    const sock = {
        async sendPresenceUpdate(...args) {
            presence.push(args);
            if (presenceError) throw presenceError;
        },
        async sendMessage(...args) {
            sends.push(args);
            return { key: { id: 'output' } };
        }
    };
    const definitions = createAiFunCommands({
        resolveTargetJid: () => targetJid,
        extractQuotedPlainText: () => quotedText,
        getQuotedContext: () => quotedContext,
        normalizeJid: jid => String(jid).replace(/:\d+(?=@)/, ''),
        funRoastSystem: () => 'roast-system',
        generateScoredFun: async (...args) => {
            generations.push(args);
            if (generationResult instanceof Error) throw generationResult;
            return generationResult;
        },
        loadBotConfig: () => ({ geminiApiKey: '  session-key  ' }),
        logError: (...args) => errors.push(args),
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message })
    });
    return {
        registry: createCommandRegistry(definitions),
        sends, replies, generations, errors, presence,
        setTarget(value) { targetJid = value; },
        setQuotedText(value) { quotedText = value; },
        setQuotedContext(value) { quotedContext = value; },
        setGenerationResult(value) { generationResult = value; },
        setPresenceError(value) { presenceError = value; },
        context: {
            sock,
            remoteJid: 'group@g.us',
            message: { message: {} },
            phoneNumber: '2348000000001',
            senderJid: '2348111111111:4@s.whatsapp.net',
            args: [],
            pushName: 'Ada'
        }
    };
}

const commandCases = [
    ['.roast', '🔥 *ROAST*', 7, 3, /Target name\/number: Ada/, 'roast-system'],
    ['.pickupline', '💋 *PICKUP LINE*', 7, 2, /Write a fresh pickup line/, /pickup lines/],
    ['.joke', '😂 *JOKE*', 7, 2, /Tell a fresh joke/, /short jokes/],
    ['.compliment', '✨ *COMPLIMENT*', 6, 2, /Compliment this person/, /compliments/],
    ['.flirt', '😉 *FLIRT*', 7, 2, /Flirt with them/, /You flirt/],
    ['.rate', '📊 *RATE*', 1, 2, /Rate this person/, /rate things/]
];

for (const [token, header, minScore, tries, promptPattern, systemPattern] of commandCases) {
    test(`${token} preserves its prompt, scoring options, and response header`, async () => {
        const fixture = createFixture();
        await fixture.registry.execute(token, fixture.context);
        const [prompt, system, options] = fixture.generations[0];
        assert.match(prompt, promptPattern);
        if (systemPattern instanceof RegExp) assert.match(system, systemPattern);
        else assert.equal(system, systemPattern);
        assert.deepEqual(options, {
            minScore,
            tries,
            temperature: 0.95,
            geminiKey: 'session-key'
        });
        assert.equal(fixture.presence.length, 1);
        assert.equal(fixture.sends[0][1].text, `${header}\n\ngenerated body`);
        assert.deepEqual(fixture.sends[0][2], { quoted: fixture.context.message });
    });
}

test('pickup aliases dispatch through the pickupline behavior', async () => {
    for (const token of ['.pickup', '.rizz']) {
        const fixture = createFixture();
        await fixture.registry.execute(token, fixture.context);
        assert.match(fixture.sends[0][1].text, /^💋 \*PICKUP LINE\*/);
        assert.equal(fixture.generations[0][2].tries, 2);
    }
});

test('target resolution normalizes mentions, strips numeric target args, and includes extra context', async () => {
    const fixture = createFixture();
    fixture.setTarget('2348222222222:9@s.whatsapp.net');
    fixture.context.args = ['@target', '2348222222222', 'football'];
    await fixture.registry.execute('.roast', fixture.context);
    assert.match(fixture.generations[0][0], /Target name\/number: 2348222222222/);
    assert.match(fixture.generations[0][0], /Extra context from the commander: football/);
    assert.equal(fixture.sends[0][1].text, '🔥 *ROAST*\n\n@2348222222222\n\ngenerated body');
    assert.deepEqual(fixture.sends[0][1].mentions, ['2348222222222@s.whatsapp.net']);
});

test('quoted text supplies fallback target and is truncated in generated prompts', async () => {
    const fixture = createFixture();
    fixture.setQuotedText('x'.repeat(500));
    fixture.setQuotedContext({ participant: '2348333333333@s.whatsapp.net' });
    await fixture.registry.execute('.rate', fixture.context);
    const prompt = fixture.generations[0][0];
    assert.match(prompt, /^Rate this message out of 10/);
    assert.match(prompt, new RegExp(`"""${'x'.repeat(400)}"""$`));
    assert.deepEqual(fixture.sends[0][1].mentions, ['2348333333333@s.whatsapp.net']);
});

test('ship prioritizes two context mentions and does not prepend a target mention line', async () => {
    const fixture = createFixture();
    fixture.setTarget('2348444444444@s.whatsapp.net');
    fixture.setQuotedContext({
        mentionedJid: ['2348555555555:2@s.whatsapp.net', '2348666666666@s.whatsapp.net']
    });
    await fixture.registry.execute('.ship', fixture.context);
    assert.equal(fixture.generations[0][0], 'Ship +2348555555555:2 with +2348666666666. Score the take.');
    assert.deepEqual(fixture.sends[0][1].mentions, [
        '2348555555555@s.whatsapp.net',
        '2348666666666@s.whatsapp.net'
    ]);
    assert.equal(fixture.sends[0][1].text, '💘 *SHIP*\n\ngenerated body');
});

test('ship falls back to sender and current chat when mentions are absent', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.ship', fixture.context);
    assert.equal(fixture.generations[0][0], 'Ship +2348111111111:4 with +group. Score the take.');
    assert.deepEqual(fixture.sends[0][1].mentions, [
        '2348111111111@s.whatsapp.net',
        'group@g.us'
    ]);
});

test('presence failures are non-fatal and generation still runs', async () => {
    const fixture = createFixture();
    fixture.setPresenceError(new Error('presence unavailable'));
    await fixture.registry.execute('.joke', fixture.context);
    assert.equal(fixture.generations.length, 1);
    assert.equal(fixture.sends.length, 1);
});

test('generation failures are logged and return the preserved fallback reply', async () => {
    const fixture = createFixture();
    fixture.setGenerationResult(new Error('provider offline'));
    await fixture.registry.execute('.compliment', fixture.context);
    assert.deepEqual(fixture.errors[0].slice(0, 2), ['FUN', '.compliment failed']);
    assert.match(fixture.replies[0].text, /The void refused to cook/);
    assert.match(fixture.replies[0].text, /provider offline/);
    assert.equal(fixture.sends.length, 0);
});

test('AI fun module registers seven primary commands and pickup aliases', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), [
        '.compliment', '.flirt', '.joke', '.pickupline', '.rate', '.roast', '.ship'
    ]);
    assert.equal(fixture.registry.has('.pickup'), true);
    assert.equal(fixture.registry.has('.rizz'), true);
});
