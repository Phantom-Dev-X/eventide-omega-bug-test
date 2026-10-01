import https from 'https';

/**
 * Unified multi-provider AI engine: raw provider calls (Gemini/OpenAI/
 * Pollinations), per-user Gemini key management (validation, splitting,
 * masking, ordered-chain retry), the top-level `callUniversalAI` fallback
 * ladder (user keys -> env keys -> OpenAI -> Pollinations), and the scored
 * "fun" generation helper (roast/joke/etc.) used by the AI fun commands and
 * help-mode conversation flow.
 */
export function createAiEngine(deps) {
    const { log, logError, loadBotConfig } = deps || {};

    for (const [name, value] of Object.entries({ log, logError, loadBotConfig })) {
        if (typeof value !== 'function') throw new Error(`AI engine requires ${name}()`);
    }

    async function callGemini(prompt, systemInstruction = '', apiKey, opts = {}) {
        // GEMINI_MODEL env overrides. Default: gemini-3.6-flash — verified stable
        // for generateContent on fresh keys (3.5/3.7-flash intermittently return
        // 503 high-demand; 2.x models are retired for new projects).
        const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
        const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.4;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const body = JSON.stringify({
            system_instruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature }
        });

        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) resolve(text.trim());
                        else reject(new Error(parsed?.error?.message || 'Empty Gemini response'));
                    } catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    async function callOpenAI(prompt, systemInstruction = '', apiKey, opts = {}) {
        const url = `https://api.openai.com/v1/chat/completions`;
        const messages = [];
        if (systemInstruction) {
            messages.push({ role: 'system', content: systemInstruction });
        }
        messages.push({ role: 'user', content: prompt });
        const body = JSON.stringify({
            model: 'gpt-4o-mini',
            messages,
            temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4
        });

        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const text = parsed?.choices?.[0]?.message?.content;
                        if (text) resolve(text.trim());
                        else reject(new Error(parsed?.error?.message || 'Empty OpenAI response'));
                    } catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    async function callPollinations(prompt, systemInstruction = '', opts = {}) {
        const encodedPrompt = encodeURIComponent(prompt);
        const systemParam = systemInstruction ? `&system=${encodeURIComponent(systemInstruction)}` : '';
        const temp = typeof opts.temperature === 'number' ? opts.temperature : 0.4;
        const url = `https://text.pollinations.ai/${encodedPrompt}?model=openai${systemParam}&temperature=${temp}`;

        return new Promise((resolve, reject) => {
            const req = https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const text = data.trim();
                    const badStatus = res.statusCode && (res.statusCode < 200 || res.statusCode >= 300);
                    if (badStatus) {
                        return reject(new Error(`Pollinations HTTP ${res.statusCode}: ${text}`));
                    }
                    if (text && String(text).trim()) {
                        resolve(String(text).trim());
                    } else {
                        reject(new Error('Empty response from Pollinations'));
                    }
                });
            });
            req.on('error', reject);
        });
    }

    // 🔑 Per-user plugin key helpers (multi-user: one Gemini key per paired owner)
    function maskApiKey(key) {
        const k = String(key || '').trim();
        if (k.length < 8) return '(unset)';
        return `${k.slice(0, 5)}…${k.slice(-4)}`;
    }

    // ✅ Accepts BOTH Google key formats: classic (AIza…) and the newer
    // style Google now issues in AI Studio (AQ.…). Also covers the old ABQ…
    // shape, just in case. Anything else is rejected with a helpful message.
    function isValidGeminiKey(key) {
        const k = String(key || '').trim();
        return /^(AIza[0-9A-Za-z_-]{15,}|AQ\.[0-9A-Za-z_-]{15,}|ABQ[0-9A-Za-z_-]{15,})$/i.test(k);
    }

    // 🔑 Split a comma-separated key list into usable keys (multi-key rotation).
    function splitApiKeys(raw) {
        return String(raw || '').split(',')
            .map(k => k.trim())
            .filter(k => k.length > 5);
    }

    // 🔑 Mask a whole comma-separated key list for display (never leaks raw keys).
    function maskKeyList(raw) {
        const keys = splitApiKeys(raw);
        if (!keys.length) return 'NOT_SET';
        return keys.map((k, i) => `[${i + 1}] ${maskApiKey(k)}`).join('\n   ');
    }

    // 🔑 Try a list of Gemini keys IN ORDER — first success wins. Only when
    // EVERY key fails does this throw, so the caller can fall back cleanly.
    async function callGeminiChain(prompt, systemInstruction, keys, opts) {
        let lastErr = null;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            try {
                log('AI', `Gemini attempt ${i + 1}/${keys.length} with key ${maskApiKey(key)}...`);
                return await callGemini(prompt, systemInstruction, key, opts);
            } catch (err) {
                lastErr = err;
                logError('AI', `Gemini key ${maskApiKey(key)} failed (${i + 1}/${keys.length}), trying next...`, err);
            }
        }
        throw lastErr || new Error('All Gemini keys failed');
    }

    // Builds AI options that route this session's AI calls through the owner's
    // own Gemini key (if they set one with .pluginkey). Falls back to the default
    // chain (global Gemini → OpenAI → Pollinations) when no key is set.
    function aiOptsFor(phoneNumber, extra = {}) {
        try {
            const key = String(loadBotConfig(phoneNumber)?.geminiApiKey || '').trim();
            if (key) return { ...extra, geminiKey: key };
        } catch (err) {
            logError('AI', 'Failed to read plugin key', err);
        }
        return extra;
    }

    async function callUniversalAI(prompt, systemInstruction = '', opts = {}) {
        // 🔑 PER-USER GEMINI KEYS: once this session's owner attaches their own
        // key(s) with .pluginkey, their AI ALWAYS routes through THEIR keys first
        // (tried in order, key A → key B → ...). The shared default key is only
        // touched if ALL of the user's keys fail.
        const userKeys = splitApiKeys(opts?.geminiKey);
        if (userKeys.length) {
            try {
                log('AI', `Routing through user plugin keys (${userKeys.length})...`);
                return await callGeminiChain(prompt, systemInstruction, userKeys, opts);
            } catch (err) {
                logError('AI', 'All user plugin keys failed, falling back to general chain...', err);
            }
        }

        // 🔑 GENERAL GEMINI KEYS from .env — also supports comma-separated rotation.
        const envKeys = splitApiKeys(process.env.GEMINI_API_KEY);
        if (envKeys.length) {
            try {
                log('AI', `Attempting general Gemini keys (${envKeys.length})...`);
                return await callGeminiChain(prompt, systemInstruction, envKeys, opts);
            } catch (err) {
                logError('AI', 'All general Gemini keys failed, trying OpenAI fallback...', err);
            }
        }

        const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
        if (OPENAI_KEY && OPENAI_KEY.length > 5) {
            try {
                log('AI', 'Attempting OpenAI response...');
                return await callOpenAI(prompt, systemInstruction, OPENAI_KEY, opts);
            } catch (err) {
                logError('AI', 'OpenAI failed, trying fallback...', err);
            }
        }

        try {
            log('AI', 'Attempting Pollinations AI keyless fallback...');
            return await callPollinations(prompt, systemInstruction, opts);
        } catch (err) {
            logError('AI', 'Pollinations AI failed', err);
            throw new Error('All AI providers and fallbacks failed to respond.');
        }
    }

    function parseScoredAi(raw) {
        const text = String(raw || '').trim();
        const scoreMatch = text.match(/SCORE\s*:\s*(\d{1,2})/i);
        const bodyMatch = text.match(/(?:ROAST|LINE|JOKE|TEXT|ANSWER)\s*:\s*([\s\S]*?)(?:\n\s*SCORE\s*:|$)/i);
        const score = scoreMatch ? Math.min(10, parseInt(scoreMatch[1], 10)) : 0;
        let body = (bodyMatch ? bodyMatch[1] : text).trim();
        body = body.replace(/^["'`]+|["'`]+$/g, '').replace(/^\*+|\*+$/g, '').trim();
        return { body, score };
    }

    async function generateScoredFun(prompt, system, { minScore = 7, tries = 3, temperature = 0.95, geminiKey = '' } = {}) {
        let best = { body: '', score: 0 };
        for (let i = 0; i < tries; i++) {
            const raw = await callUniversalAI(prompt, system, { temperature, geminiKey });
            const parsed = parseScoredAi(raw);
            if (parsed.body && parsed.score >= best.score) best = parsed;
            if (parsed.body && parsed.body.length >= 12 && parsed.score >= minScore) return parsed;
            log('FUN', `scored ${parsed.score}/10 — dropping, retry ${i + 1}/${tries}`);
        }
        if (best.body && best.score >= minScore) return best;
        if (best.body) return best;
        throw new Error('AI returned empty fun text');
    }

    function funRoastSystem() {
        return `You are Eventide Omega, a roast assassin in a WhatsApp group. You write the kind of roast that makes the whole chat go "oooooh" and the victim mute the group for 10 minutes.

RULES:
- Savage, specific, funny. Punch with wit. Sound like a sharp West African group chat, not a Twitter bot.
- Nigerian/Pidgin slang is allowed when it hits (e.g. "this one no get sense", "your village people are tired").
- NO racial, religious, or homophobic slurs. No sexual violence. No attacking disabilities. No telling anyone to die.
- If they quoted a message, the roast MUST use that exact message as the weapon. Quote a fragment, then destroy it.
- 2 to 5 short lines. No hashtags. No intro like "here's a roast". No apology. No emojis except maybe one.
- Rate yourself honestly 1-10. 7+ means people would screenshot it. A generic "you're ugly" is a 3. A roast that uses their own words against them is an 8-10.

OUTPUT EXACTLY:
ROAST: <the roast>
SCORE: <number>`;
    }

    return Object.freeze({
        callGemini,
        callOpenAI,
        callPollinations,
        maskApiKey,
        isValidGeminiKey,
        splitApiKeys,
        maskKeyList,
        callGeminiChain,
        aiOptsFor,
        callUniversalAI,
        parseScoredAi,
        generateScoredFun,
        funRoastSystem
    });
}
