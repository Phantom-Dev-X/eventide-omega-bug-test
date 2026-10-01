import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSessionConfigStore } from '../src/config/session-config-store.js';
import { DEFAULT_BOT_CONFIG } from '../src/config/defaults.js';

function makeEngine(overrides = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgstore-'));
    const errors = [];
    const ensuredDirs = [];
    const syncs = [];
    let supabaseEnabled = false;
    const engine = createSessionConfigStore({
        logError: (...a) => errors.push(a),
        authDir: tmpDir,
        ensureDir: (d) => { ensuredDirs.push(d); fs.mkdirSync(d, { recursive: true }); },
        isSupabaseEnabled: () => supabaseEnabled,
        debouncedSyncLocalToSupabase: (...a) => syncs.push(a),
        ...overrides
    });
    return { engine, tmpDir, errors, ensuredDirs, syncs, enableSupabase: () => { supabaseEnabled = true; } };
}

const PHONE = '2348012345678';

// --- constructor guards ---------------------------------------------------

test('createSessionConfigStore throws when function deps are missing', () => {
    const base = { logError: () => {}, authDir: '/tmp', ensureDir: () => {}, isSupabaseEnabled: () => false, debouncedSyncLocalToSupabase: () => {} };
    for (const key of ['logError', 'ensureDir', 'isSupabaseEnabled', 'debouncedSyncLocalToSupabase']) {
        const broken = { ...base };
        delete broken[key];
        assert.throws(() => createSessionConfigStore(broken), new RegExp(key));
    }
});

test('createSessionConfigStore throws when authDir is missing or not a string', () => {
    const base = { logError: () => {}, ensureDir: () => {}, isSupabaseEnabled: () => false, debouncedSyncLocalToSupabase: () => {} };
    assert.throws(() => createSessionConfigStore({ ...base }), /authDir/);
    assert.throws(() => createSessionConfigStore({ ...base, authDir: '' }), /authDir/);
    assert.throws(() => createSessionConfigStore({ ...base, authDir: 5 }), /authDir/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- poll cache --------------------------------------------------------------

test('loadPollCache returns an empty Map for missing or corrupted files', () => {
    const { engine, tmpDir, errors } = makeEngine();
    assert.equal(engine.loadPollCache(PHONE).size, 0);
    fs.mkdirSync(path.join(tmpDir, PHONE), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PHONE, 'poll_cache.json'), '{oops');
    assert.equal(engine.loadPollCache(PHONE).size, 0);
    assert.equal(errors.length, 1);
});

test('savePollCache round-trips entries through poll_cache.json and syncs Supabase when enabled', () => {
    const { engine, tmpDir, syncs, enableSupabase } = makeEngine();
    fs.mkdirSync(path.join(tmpDir, PHONE), { recursive: true });
    const cache = new Map([['poll1', { ids: ['a', 'b'], fullMessage: { conversation: 'x' } }]]);
    engine.savePollCache(PHONE, cache);
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, PHONE, 'poll_cache.json'), 'utf8'));
    assert.deepEqual(raw, { poll1: { ids: ['a', 'b'], fullMessage: { conversation: 'x' } } });
    assert.equal(syncs.length, 0);

    enableSupabase();
    engine.savePollCache(PHONE, cache);
    assert.equal(syncs.length, 1);
    assert.equal(syncs[0][0], PHONE);
    assert.equal(syncs[0][1], path.join(tmpDir, PHONE));

    const loaded = engine.loadPollCache(PHONE);
    assert.equal(loaded.size, 1);
    assert.deepEqual(loaded.get('poll1').ids, ['a', 'b']);
});

test('savePollCache logs and swallows write failures', () => {
    const { engine, tmpDir, errors } = makeEngine();
    fs.writeFileSync(path.join(tmpDir, PHONE), 'not a dir'); // blocks the path
    engine.savePollCache(PHONE, new Map([['k', 1]]));
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], 'CACHE');
});

// --- bot mode ----------------------------------------------------------------

test('loadBotMode defaults to public and trims stored modes', () => {
    const { engine, tmpDir, errors } = makeEngine();
    assert.equal(engine.loadBotMode(PHONE), 'public');
    fs.mkdirSync(path.join(tmpDir, PHONE), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PHONE, 'bot_mode.txt'), 'owner\n');
    assert.equal(engine.loadBotMode(PHONE), 'owner');
    fs.writeFileSync(path.join(tmpDir, PHONE, 'bot_mode.txt'), '{corrupt');
    fs.chmodSync(path.join(tmpDir, PHONE, 'bot_mode.txt'), 0o000);
    try {
        assert.equal(engine.loadBotMode(PHONE), 'public');
        assert.equal(errors.length, 1);
    } finally {
        fs.chmodSync(path.join(tmpDir, PHONE, 'bot_mode.txt'), 0o644);
    }
});

test('saveBotMode writes the mode and syncs Supabase only when enabled', () => {
    const { engine, tmpDir, syncs, enableSupabase } = makeEngine();
    fs.mkdirSync(path.join(tmpDir, PHONE), { recursive: true });
    engine.saveBotMode(PHONE, 'owner');
    assert.equal(fs.readFileSync(path.join(tmpDir, PHONE, 'bot_mode.txt'), 'utf8'), 'owner');
    assert.equal(syncs.length, 0);
    enableSupabase();
    engine.saveBotMode(PHONE, 'public');
    assert.equal(syncs.length, 1);
    assert.equal(syncs[0][0], PHONE);
});

// --- normalizeAntideleteConfig ---------------------------------------------------

test('normalizeAntideleteConfig passes through the modern shape with copied endpoints', () => {
    const { engine } = makeEngine();
    const groups = ['g1@g.us'];
    const result = engine.normalizeAntideleteConfig({ antidelete: { enabled: true, endpoints: { groups, channels: ['c@newsletter'], contacts: [] } } });
    assert.deepEqual(result, { enabled: true, endpoints: { groups: ['g1@g.us'], channels: ['c@newsletter'], contacts: [] } });
    assert.notEqual(result.endpoints.groups, groups); // copied, not shared
});

test('normalizeAntideleteConfig migrates legacy on/off maps including anti.antidelete', () => {
    const { engine } = makeEngine();
    const legacy = engine.normalizeAntideleteConfig({ antidelete: { 'g1@g.us': 'on', 'g2@g.us': 'off', 'notajid': 'on' } });
    assert.deepEqual(legacy, { enabled: true, endpoints: { groups: ['g1@g.us'], channels: [], contacts: [] } });

    const nested = engine.normalizeAntideleteConfig({ anti: { antidelete: { 'g3@g.us': 'on' } } });
    assert.deepEqual(nested, { enabled: true, endpoints: { groups: ['g3@g.us'], channels: [], contacts: [] } });

    const empty = engine.normalizeAntideleteConfig({});
    assert.deepEqual(empty, { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } });
});

// --- normalizeWarnConfig ---------------------------------------------------------

test('normalizeWarnConfig normalizes group entries with defaults', () => {
    const { engine } = makeEngine();
    const result = engine.normalizeWarnConfig({
        warn: {
            groups: {
                'g1@g.us': { enabled: true, maxWarns: '5', action: 'none', phrases: ['  bad  ', '', 'worse'], deleteOffending: false },
                'g2@g.us': { enabled: true },
                'g3@g.us': { maxWarns: -2 },
                invalid: null
            }
        }
    });
    assert.deepEqual(result.groups['g1@g.us'], { enabled: true, maxWarns: 5, action: 'none', phrases: ['bad', 'worse'], deleteOffending: false });
    assert.deepEqual(result.groups['g2@g.us'], { enabled: true, maxWarns: 3, action: 'kick', phrases: [], deleteOffending: true });
    assert.equal(result.groups['g3@g.us'].maxWarns, 0);
    assert.equal('invalid' in result.groups, false);
    assert.deepEqual(engine.normalizeWarnConfig({}), { groups: {} });
});

// --- loadBotConfig -----------------------------------------------------------------

test('loadBotConfig returns an isolated clone of the defaults when no file exists', () => {
    const { engine } = makeEngine();
    const config = engine.loadBotConfig(PHONE);
    assert.deepEqual(config, structuredClone(DEFAULT_BOT_CONFIG));
    config.prefix = '!';
    config.autoreact.endpoints.groups.push('mutated@g.us');
    const fresh = engine.loadBotConfig(PHONE);
    assert.equal(fresh.prefix, '.');
    assert.deepEqual(fresh.autoreact.endpoints.groups, []);
});

test('loadBotConfig deep-merges stored settings over the defaults', () => {
    const { engine, tmpDir } = makeEngine();
    fs.mkdirSync(path.join(tmpDir, PHONE), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PHONE, 'bot_config.json'), JSON.stringify({
        prefix: '!',
        name: 'Omega',
        aliases: { menu: 'm' },
        autoreact: { enabled: true, endpoints: { groups: ['g1@g.us'] } },
        antidelete: { 'g2@g.us': 'on' },
        warn: { groups: { 'g3@g.us': { enabled: true, maxWarns: 2 } } }
    }));
    const config = engine.loadBotConfig(PHONE);
    assert.equal(config.prefix, '!');
    assert.equal(config.name, 'Omega');
    assert.equal(config.bio, '');                     // default kept
    assert.deepEqual(config.aliases, { menu: 'm' });
    assert.equal(config.autoreact.enabled, true);
    assert.deepEqual(config.autoreact.endpoints.groups, ['g1@g.us']);
    assert.deepEqual(config.autoreact.endpoints.channels, []); // default endpoints kept
    assert.deepEqual(config.antidelete, { enabled: true, endpoints: { groups: ['g2@g.us'], channels: [], contacts: [] } });
    assert.equal(config.warn.groups['g3@g.us'].maxWarns, 2);
});

test('loadBotConfig falls back to defaults on corrupted JSON', () => {
    const { engine, tmpDir, errors } = makeEngine();
    fs.mkdirSync(path.join(tmpDir, PHONE), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PHONE, 'bot_config.json'), 'not json at all');
    assert.deepEqual(engine.loadBotConfig(PHONE), structuredClone(DEFAULT_BOT_CONFIG));
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], 'CONFIG');
});

// --- saveBotConfig --------------------------------------------------------------------

test('saveBotConfig ensures the directory, writes JSON, and syncs Supabase when enabled', () => {
    const { engine, tmpDir, ensuredDirs, syncs, enableSupabase } = makeEngine();
    const config = { ...structuredClone(DEFAULT_BOT_CONFIG), prefix: '?' };
    engine.saveBotConfig(PHONE, config);
    assert.deepEqual(ensuredDirs, [path.join(tmpDir, PHONE)]);
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, PHONE, 'bot_config.json'), 'utf8'));
    assert.equal(written.prefix, '?');
    assert.equal(syncs.length, 0);

    enableSupabase();
    engine.saveBotConfig(PHONE, config);
    assert.equal(syncs.length, 1);
    assert.equal(syncs[0][0], PHONE);
});

test('saveBotConfig logs and swallows write failures', () => {
    const { engine, tmpDir, errors } = makeEngine();
    fs.writeFileSync(path.join(tmpDir, PHONE), 'not a dir');
    engine.saveBotConfig(PHONE, { prefix: '!' });
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], 'CONFIG');
});
