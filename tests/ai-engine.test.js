import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'https';
import { EventEmitter } from 'events';
import { createAiEngine } from '../src/ai/ai-engine.js';

// ---------------------------------------------------------------------------
// https.request / https.get mocking helpers.
//
// The raw provider calls (callGemini/callOpenAI/callPollinations) talk to
// real hosts via the Node `https` module directly (no injectable transport —
// matches the behaviour of the code they were extracted from). To unit test
// them deterministically and offline, we monkey-patch `https.request`/
// `https.get` for the duration of a test and always restore the originals
// in a `finally` block.
// ---------------------------------------------------------------------------

function fakeReq() {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {};
    return req;
}

function queueRequestMock(statusCode, body) {
    return (url, opts, cb) => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        const req = fakeReq();
        cb(res);
        queueMicrotask(() => {
            res.emit('data', body);
            res.emit('end');
        });
        return req;
    };
}

function queueGetMock(statusCode, body) {
    return (url, cb) => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        const req = fakeReq();
        cb(res);
        queueMicrotask(() => {
            res.emit('data', body);
            res.emit('end');
        });
        return req;
    };
}

function withMockedRequest(statusCode, body, fn) {
    const original = https.request;
    https.request = queueRequestMock(statusCode, body);
    return fn().finally(() => { https.request = original; });
}

function withMockedGet(statusCode, body, fn) {
    const original = https.get;
    https.get = queueGetMock(statusCode, body);
    return fn().finally(() => { https.get = original; });
}

function withMockedRequestSequence(responses, fn) {
    const original = https.request;
    let i = 0;
    https.request = (url, opts, cb) => {
        const { statusCode, body } = responses[Math.min(i, responses.length - 1)];
        i++;
        const res = new EventEmitter();
        res.statusCode = statusCode;
        const req = fakeReq();
        cb(res);
        queueMicrotask(() => {
            res.emit('data', body);
            res.emit('end');
        });
        return req;
    };
    return fn().finally(() => { https.request = original; });
}

function makeEngine(overrides = {}) {
    const logs = [];
    const errors = [];
    return {
        engine: createAiEngine({
            log: (...args) => logs.push(args),
            logError: (...args) => errors.push(args),
            loadBotConfig: () => ({}),
            ...overrides
        }),
        logs,
        errors
    };
}

// --- constructor guards ------------------------------------------------

test('createAiEngine throws when log is missing', () => {
    assert.throws(() => createAiEngine({ logError: () => {}, loadBotConfig: () => ({}) }), /log/);
});

test('createAiEngine throws when logError is missing', () => {
    assert.throws(() => createAiEngine({ log: () => {}, loadBotConfig: () => ({}) }), /logError/);
});

test('createAiEngine throws when loadBotConfig is missing', () => {
    assert.throws(() => createAiEngine({ log: () => {}, logError: () => {} }), /loadBotConfig/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- maskApiKey ----------------------------------------------------------

test('maskApiKey masks a long key, keeping head and tail', () => {
    const { engine } = makeEngine();
    assert.equal(engine.maskApiKey('AIzaSyABCDEFGHIJKLMNOP1234'), 'AIzaS…1234');
});

test('maskApiKey returns (unset) for short/empty keys', () => {
    const { engine } = makeEngine();
    assert.equal(engine.maskApiKey(''), '(unset)');
    assert.equal(engine.maskApiKey('short'), '(unset)');
    assert.equal(engine.maskApiKey(undefined), '(unset)');
});

// --- isValidGeminiKey ------------------------------------------------------

test('isValidGeminiKey accepts classic AIza-style keys', () => {
    const { engine } = makeEngine();
    assert.equal(engine.isValidGeminiKey('AIzaSyABCDEFGHIJKLMNOPQRSTUVWX'), true);
});

test('isValidGeminiKey accepts newer AQ.-style keys', () => {
    const { engine } = makeEngine();
    assert.equal(engine.isValidGeminiKey('AQ.abcdefghijklmnopqrstuvwx'), true);
});

test('isValidGeminiKey accepts legacy ABQ-style keys', () => {
    const { engine } = makeEngine();
    assert.equal(engine.isValidGeminiKey('ABQabcdefghijklmnopqrstuvwx'), true);
});

test('isValidGeminiKey rejects garbage/empty input', () => {
    const { engine } = makeEngine();
    assert.equal(engine.isValidGeminiKey('not-a-key'), false);
    assert.equal(engine.isValidGeminiKey(''), false);
    assert.equal(engine.isValidGeminiKey(undefined), false);
});

// --- splitApiKeys / maskKeyList --------------------------------------------

test('splitApiKeys splits, trims, and filters short tokens', () => {
    const { engine } = makeEngine();
    const result = engine.splitApiKeys(' AIzaSyKeyOneLongEnough , x , AIzaSyKeyTwoLongEnough,,  ');
    assert.deepEqual(result, ['AIzaSyKeyOneLongEnough', 'AIzaSyKeyTwoLongEnough']);
});

test('splitApiKeys returns empty array for empty/undefined input', () => {
    const { engine } = makeEngine();
    assert.deepEqual(engine.splitApiKeys(''), []);
    assert.deepEqual(engine.splitApiKeys(undefined), []);
});

test('maskKeyList returns NOT_SET when there are no usable keys', () => {
    const { engine } = makeEngine();
    assert.equal(engine.maskKeyList(''), 'NOT_SET');
});

test('maskKeyList numbers and masks each key', () => {
    const { engine } = makeEngine();
    const result = engine.maskKeyList('AIzaSyKeyOneLongEnough,AIzaSyKeyTwoLongEnough');
    assert.match(result, /^\[1\] .+….+\n {3}\[2\] .+….+$/);
});

// --- aiOptsFor ---------------------------------------------------------

test('aiOptsFor attaches geminiKey when the owner has a plugin key set', () => {
    const { engine } = makeEngine({ loadBotConfig: () => ({ geminiApiKey: 'AIzaSyOwnerKeyLongEnough' }) });
    const opts = engine.aiOptsFor('2340000000000', { temperature: 0.9 });
    assert.equal(opts.geminiKey, 'AIzaSyOwnerKeyLongEnough');
    assert.equal(opts.temperature, 0.9);
});

test('aiOptsFor passes extras through unchanged when no plugin key is set', () => {
    const { engine } = makeEngine({ loadBotConfig: () => ({}) });
    const opts = engine.aiOptsFor('2340000000000', { temperature: 0.5 });
    assert.deepEqual(opts, { temperature: 0.5 });
});

test('aiOptsFor swallows loadBotConfig errors and falls back to extras', () => {
    const { engine, errors } = makeEngine({
        loadBotConfig: () => { throw new Error('disk error'); }
    });
    const opts = engine.aiOptsFor('2340000000000', { foo: 'bar' });
    assert.deepEqual(opts, { foo: 'bar' });
    assert.equal(errors.length, 1);
});

// --- parseScoredAi -------------------------------------------------------

test('parseScoredAi extracts ROAST body and SCORE', () => {
    const { engine } = makeEngine();
    const result = engine.parseScoredAi('ROAST: your wifi is slower than your village light\nSCORE: 8');
    assert.equal(result.body, 'your wifi is slower than your village light');
    assert.equal(result.score, 8);
});

test('parseScoredAi strips surrounding quotes and asterisks', () => {
    const { engine } = makeEngine();
    const result = engine.parseScoredAi('ROAST: "**nice shoes, shame about the feet**"\nSCORE: 6');
    assert.equal(result.body, 'nice shoes, shame about the feet');
    assert.equal(result.score, 6);
});

test('parseScoredAi caps score at 10 and defaults missing score to 0', () => {
    const { engine } = makeEngine();
    const capped = engine.parseScoredAi('ROAST: too good\nSCORE: 15');
    assert.equal(capped.score, 10);
    const missing = engine.parseScoredAi('just plain text with no markers');
    assert.equal(missing.score, 0);
    assert.equal(missing.body, 'just plain text with no markers');
});

// --- funRoastSystem -------------------------------------------------------

test('funRoastSystem returns the expected output contract', () => {
    const { engine } = makeEngine();
    const prompt = engine.funRoastSystem();
    assert.match(prompt, /ROAST: <the roast>/);
    assert.match(prompt, /SCORE: <number>/);
});

// --- callGemini ------------------------------------------------------------

test('callGemini resolves with trimmed text on a good response', async () => {
    const { engine } = makeEngine();
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: '  hi there  ' }] } }] });
    await withMockedRequest(200, body, async () => {
        const result = await engine.callGemini('prompt', 'sys', 'AIzaKey');
        assert.equal(result, 'hi there');
    });
});

test('callGemini rejects with the API error message when candidates are empty', async () => {
    const { engine } = makeEngine();
    const body = JSON.stringify({ error: { message: 'quota exceeded' } });
    await withMockedRequest(200, body, async () => {
        await assert.rejects(() => engine.callGemini('prompt', '', 'AIzaKey'), /quota exceeded/);
    });
});

test('callGemini rejects on malformed JSON', async () => {
    const { engine } = makeEngine();
    await withMockedRequest(200, 'not json', async () => {
        await assert.rejects(() => engine.callGemini('prompt', '', 'AIzaKey'));
    });
});

// --- callOpenAI --------------------------------------------------------

test('callOpenAI resolves with trimmed message content', async () => {
    const { engine } = makeEngine();
    const body = JSON.stringify({ choices: [{ message: { content: ' hello from gpt ' } }] });
    await withMockedRequest(200, body, async () => {
        const result = await engine.callOpenAI('prompt', 'sys', 'sk-key');
        assert.equal(result, 'hello from gpt');
    });
});

test('callOpenAI rejects with API error message on empty choices', async () => {
    const { engine } = makeEngine();
    const body = JSON.stringify({ error: { message: 'invalid api key' } });
    await withMockedRequest(200, body, async () => {
        await assert.rejects(() => engine.callOpenAI('prompt', '', 'sk-key'), /invalid api key/);
    });
});

// --- callPollinations ----------------------------------------------------

test('callPollinations resolves with trimmed text on 200', async () => {
    const { engine } = makeEngine();
    await withMockedGet(200, '  a keyless reply  ', async () => {
        const result = await engine.callPollinations('prompt');
        assert.equal(result, 'a keyless reply');
    });
});

test('callPollinations rejects on non-2xx status', async () => {
    const { engine } = makeEngine();
    await withMockedGet(500, 'server error', async () => {
        await assert.rejects(() => engine.callPollinations('prompt'), /HTTP 500/);
    });
});

test('callPollinations rejects on empty body', async () => {
    const { engine } = makeEngine();
    await withMockedGet(200, '   ', async () => {
        await assert.rejects(() => engine.callPollinations('prompt'), /Empty response/);
    });
});

// --- callGeminiChain -------------------------------------------------------

test('callGeminiChain resolves using the first working key', async () => {
    const { engine } = makeEngine();
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'first key works' }] } }] });
    await withMockedRequest(200, body, async () => {
        const result = await engine.callGeminiChain('prompt', '', ['AIzaKeyOne', 'AIzaKeyTwo']);
        assert.equal(result, 'first key works');
    });
});

test('callGeminiChain falls through to the next key after a failure', async () => {
    const { engine, errors } = makeEngine();
    const failBody = JSON.stringify({ error: { message: 'first key dead' } });
    const okBody = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'second key works' }] } }] });
    await withMockedRequestSequence(
        [{ statusCode: 200, body: failBody }, { statusCode: 200, body: okBody }],
        async () => {
            const result = await engine.callGeminiChain('prompt', '', ['AIzaKeyOne', 'AIzaKeyTwo']);
            assert.equal(result, 'second key works');
            assert.equal(errors.length, 1);
        }
    );
});

test('callGeminiChain throws when every key fails', async () => {
    const { engine } = makeEngine();
    const failBody = JSON.stringify({ error: { message: 'dead key' } });
    await withMockedRequest(200, failBody, async () => {
        await assert.rejects(
            () => engine.callGeminiChain('prompt', '', ['AIzaKeyOne', 'AIzaKeyTwo']),
            /dead key/
        );
    });
});

// --- callUniversalAI (fallback ladder) --------------------------------

test('callUniversalAI routes through the caller-supplied geminiKey first', async () => {
    const { engine } = makeEngine();
    const prevEnvGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'user key wins' }] } }] });
    try {
        await withMockedRequest(200, body, async () => {
            const result = await engine.callUniversalAI('prompt', '', { geminiKey: 'AIzaUserKeyLongEnough' });
            assert.equal(result, 'user key wins');
        });
    } finally {
        if (prevEnvGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevEnvGemini;
    }
});

test('callUniversalAI falls back to Pollinations when no keys are configured', async () => {
    const { engine } = makeEngine();
    const prevGemini = process.env.GEMINI_API_KEY;
    const prevOpenAi = process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
        await withMockedGet(200, 'keyless fallback reply', async () => {
            const result = await engine.callUniversalAI('prompt', '', {});
            assert.equal(result, 'keyless fallback reply');
        });
    } finally {
        if (prevGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevGemini;
        if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevOpenAi;
    }
});

test('callUniversalAI throws when every provider fails', async () => {
    const { engine } = makeEngine();
    const prevGemini = process.env.GEMINI_API_KEY;
    const prevOpenAi = process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
        await withMockedGet(500, 'down', async () => {
            await assert.rejects(() => engine.callUniversalAI('prompt', '', {}), /All AI providers/);
        });
    } finally {
        if (prevGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevGemini;
        if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevOpenAi;
    }
});

// --- generateScoredFun ---------------------------------------------------

test('generateScoredFun returns the first attempt that meets minScore', async () => {
    const { engine } = makeEngine();
    const prevGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ROAST: nice try\nSCORE: 9' }] } }] });
    try {
        await withMockedGet(200, 'ROAST: nice try\nSCORE: 9', async () => {
            const result = await engine.generateScoredFun('roast them', 'system', { geminiKey: '', minScore: 7, tries: 3 });
            assert.equal(result.body, 'nice try');
            assert.equal(result.score, 9);
        });
    } finally {
        if (prevGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevGemini;
    }
    void body;
});

test('generateScoredFun returns the best-seen attempt if minScore is never hit', async () => {
    const { engine } = makeEngine();
    const prevGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
        await withMockedGet(200, 'ROAST: a weak one liner\nSCORE: 3', async () => {
            const result = await engine.generateScoredFun('roast them', 'system', { minScore: 9, tries: 2 });
            assert.equal(result.body, 'a weak one liner');
            assert.equal(result.score, 3);
        });
    } finally {
        if (prevGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevGemini;
    }
});

test('generateScoredFun throws when the AI returns empty text on every try', async () => {
    const { engine } = makeEngine();
    const prevGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
        await withMockedGet(200, '', async () => {
            await assert.rejects(
                () => engine.generateScoredFun('roast them', 'system', { minScore: 7, tries: 1 }),
                /empty fun text|All AI providers/
            );
        });
    } finally {
        if (prevGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevGemini;
    }
});
