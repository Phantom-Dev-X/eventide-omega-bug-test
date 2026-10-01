import test from 'node:test';
import assert from 'node:assert/strict';
import { createHelpVoice } from '../src/ai/help-voice.js';

function makeEngine(config = {}) {
    const configs = typeof config === 'function' ? config : () => config;
    return { engine: createHelpVoice({ loadBotConfig: configs }) };
}

// --- constructor guard / interface ---------------------------------------

test('createHelpVoice throws when loadBotConfig is missing', () => {
    assert.throws(() => createHelpVoice({}), /loadBotConfig/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- formatForWhatsApp -------------------------------------------------------

test('formatForWhatsApp converts headers, emphasis and bullets the established way', () => {
    const { engine } = makeEngine();
    assert.equal(
        engine.formatForWhatsApp('### Header\n**bold** and *ital*\n- item one\n* item two\n+ item three'),
        '_Header_\n_bold_ and _ital_\n• item one\n• item two\n• item three'
    );
});

test('formatForWhatsApp simplifies fenced code blocks', () => {
    const { engine } = makeEngine();
    assert.equal(engine.formatForWhatsApp('```js\nconst x = 1;\n```'), '```const x = 1;\n```');
});

test('formatForWhatsApp is null-safe and leaves plain text alone', () => {
    const { engine } = makeEngine();
    assert.equal(engine.formatForWhatsApp(null), '');
    assert.equal(engine.formatForWhatsApp(undefined), '');
    assert.equal(engine.formatForWhatsApp('plain text'), 'plain text');
});

// --- fact sheet and voices ------------------------------------------------------

test('HELP_FACT_SHEET carries the hard-truth rules registry', () => {
    const { engine } = makeEngine();
    assert.ok(engine.HELP_FACT_SHEET.startsWith('HARD TRUTH RULES:'));
    assert.ok(engine.HELP_FACT_SHEET.length > 500);
});

test('getHelpSystemPrompt is the cinematic eclipse oracle voice', () => {
    const { engine } = makeEngine();
    const prompt = engine.getHelpSystemPrompt();
    assert.ok(prompt.includes('EVENTIDE OMEGA'));
    assert.ok(prompt.includes('ORACLE'));
    assert.ok(prompt.includes(engine.HELP_FACT_SHEET));
});

test('getRuinHelpSystemPrompt is the friendly support voice', () => {
    const { engine } = makeEngine();
    const prompt = engine.getRuinHelpSystemPrompt();
    assert.ok(prompt.includes('RUIN SUPPORT PERSONA'));
    assert.ok(prompt.includes(engine.HELP_FACT_SHEET));
});

test('getBoundHelpPrompt respects the session help persona binding', () => {
    const { engine: ruin } = makeEngine({ helpPersona: 'ruin' });
    assert.ok(ruin.getBoundHelpPrompt('2348012345678').includes('RUIN SUPPORT PERSONA'));

    for (const helpPersona of ['', 'eclipse', 'ECLIPSE', 'other']) {
        const { engine } = makeEngine({ helpPersona });
        assert.ok(engine.getBoundHelpPrompt('2348012345678').includes('ORACLE'), `persona=${helpPersona}`);
    }

    const { engine: dynamic } = makeEngine((phone) => ({ helpPersona: phone === '1' ? 'ruin' : 'eclipse' }));
    assert.ok(dynamic.getBoundHelpPrompt('1').includes('RUIN'));
    assert.ok(dynamic.getBoundHelpPrompt('2').includes('ORACLE'));
});

// --- static fallback ------------------------------------------------------------

test('getStaticHelpAnswer answers core topics and stays silent on unknown ones', () => {
    const { engine } = makeEngine();
    const antilink = engine.getStaticHelpAnswer('how do I turn on antilink?');
    assert.ok(antilink.length > 0);
    assert.ok(antilink.includes('antilink'));

    assert.equal(engine.getStaticHelpAnswer('what is the meaning of life'), '');
    assert.equal(engine.getStaticHelpAnswer(''), '');
    assert.equal(engine.getStaticHelpAnswer(null), '');
});

test('getStaticHelpAnswer caps the reply at the first two matching blocks', () => {
    const { engine } = makeEngine();
    // Matches antilink (1st), autoreact (4th) and warn (7th) — only the first
    // two blocks in code order may be returned.
    const answer = engine.getStaticHelpAnswer('antilink autoreact warn');
    assert.ok(answer.includes('ANTILINK WARD'));
    assert.ok(answer.includes('AUTOREACT'));
    assert.equal(answer.includes('WARN SYSTEM'), false);
});
