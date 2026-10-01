import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuinInterface } from '../src/personas/ruin-interface.js';

function createFixture({ prefix = '.', mode = 'public', supabase = false } = {}) {
    const sent = [];
    const logs = [];
    const delays = [];
    const presenceFlashes = [];
    const pollCalls = [];

    const sock = {
        _eventidePhone: '2348000000001',
        user: { name: 'Tester' },
        async sendMessage(jid, payload) {
            sent.push({ jid, payload });
            return { key: { id: `msg-${sent.length}`, remoteJid: jid } };
        }
    };

    const ruin = createRuinInterface({
        authDirRoot: '/tmp/does-not-exist-eventide-auth',
        loadBotConfig: () => ({ prefix }),
        loadBotMode: () => mode,
        isSupabaseEnabled: () => supabase,
        flashPresenceOnline: (s, phoneNumber) => presenceFlashes.push(phoneNumber),
        delay: async ms => { delays.push(ms); },
        sendMenuPoll: async (s, remoteJid, phoneNumber, question, options, ids) => {
            pollCalls.push({ remoteJid, phoneNumber, question, options, ids });
        },
        log: (...args) => logs.push(args)
    });

    return { ruin, sock, sent, logs, delays, presenceFlashes, pollCalls };
}

test('constructor requires every dependency', () => {
    assert.throws(() => createRuinInterface({}), /require/);
});

test('ruinStatusFacts reports public mode by default', () => {
    const fixture = createFixture({ mode: 'public' });
    const facts = fixture.ruin.ruinStatusFacts('2348000000001', fixture.sock);
    assert.equal(facts.mode, 'PUBLIC');
    assert.equal(facts.name, 'Tester');
    assert.equal(facts.prefix, '.');
});

test('ruinStatusFacts reports private mode for owner mode', () => {
    const fixture = createFixture({ mode: 'owner' });
    const facts = fixture.ruin.ruinStatusFacts('2348000000001', fixture.sock);
    assert.equal(facts.mode, 'PRIVATE');
});

test('ruinStatusFacts reflects Supabase host state', () => {
    const fixture = createFixture({ supabase: true });
    const facts = fixture.ruin.ruinStatusFacts('2348000000001', fixture.sock);
    assert.equal(facts.host, 'RENDER · SUPABASE');
});

test('ruinStatusFacts falls back to the phone number when no push name exists', () => {
    const fixture = createFixture();
    fixture.sock.user = {};
    const facts = fixture.ruin.ruinStatusFacts('2348000000001', fixture.sock);
    assert.equal(facts.name, '2348000000001');
});

test('buildRuinStatusPanel renders a framed box with every status fact', () => {
    const fixture = createFixture();
    const panel = fixture.ruin.buildRuinStatusPanel('2348000000001', fixture.sock);
    assert.match(panel, /EVENTIDE OMEGA/);
    assert.match(panel, /USER: Tester/);
    assert.match(panel, /PERSONA: RUIN/);
    assert.match(panel, /MODE: PUBLIC/);
});

test('buildRuinCommandIndexBox lists every category with the configured prefix', () => {
    const fixture = createFixture({ prefix: '!' });
    const box = fixture.ruin.buildRuinCommandIndexBox('2348000000001');
    assert.match(box, /COMMAND INDEX/);
    assert.match(box, /⚙ SYSTEM/);
    assert.match(box, /🛠 CONFIG/);
    assert.match(box, /🎮 FUN/);
    assert.match(box, /👥 GROUP/);
    assert.match(box, /!menu/);
    assert.doesNotMatch(box, /\.menu/);
});

test('buildRuinSystemMenu groups system commands into sections', () => {
    const fixture = createFixture();
    const menu = fixture.ruin.buildRuinSystemMenu('2348000000001');
    assert.match(menu, /SYSTEM MENU/);
    assert.match(menu, /STATUS/);
    assert.match(menu, /SESSION/);
    assert.match(menu, /DEPLOY/);
    assert.match(menu, /POWER/);
    assert.match(menu, /\.ping/);
});

test('buildRuinConfigMenu groups config commands into sections', () => {
    const fixture = createFixture();
    const menu = fixture.ruin.buildRuinConfigMenu('2348000000001');
    assert.match(menu, /CONFIG MENU/);
    assert.match(menu, /ACCESS/);
    assert.match(menu, /IDENTITY/);
    assert.match(menu, /PREFIX & ALIASES/);
    assert.match(menu, /SUDO/);
    assert.match(menu, /AI CORE/);
    assert.match(menu, /FACTORY/);
});

test('buildRuinGroupMenu groups group commands into sections', () => {
    const fixture = createFixture();
    const menu = fixture.ruin.buildRuinGroupMenu('2348000000001');
    assert.match(menu, /GROUP MENU/);
    assert.match(menu, /ADMIN/);
    assert.match(menu, /MASS/);
    assert.match(menu, /WARDS/);
    assert.match(menu, /WARN/);
    assert.match(menu, /GREET/);
    assert.match(menu, /MODERATION/);
});

test('buildRuinFunMenu groups fun commands into sections', () => {
    const fixture = createFixture();
    const menu = fixture.ruin.buildRuinFunMenu('2348000000001');
    assert.match(menu, /FUN MENU/);
    assert.match(menu, /GAMES/);
    assert.match(menu, /MEDIA/);
    assert.match(menu, /FUN/);
});

test('ruinIndexLines wraps every category using the configured prefix', () => {
    const fixture = createFixture({ prefix: '#' });
    const lines = fixture.ruin.ruinIndexLines('2348000000001');
    assert.ok(lines.some(l => l.includes('⚙ SYSTEM')));
    assert.ok(lines.some(l => l.includes('#menu')));
});

test('RUIN_MENU_CATEGORIES exposes the four fixed categories', () => {
    const fixture = createFixture();
    const labels = fixture.ruin.RUIN_MENU_CATEGORIES.map(c => c.label);
    assert.deepEqual(labels, ['⚙ SYSTEM', '🛠 CONFIG', '🎮 FUN', '👥 GROUP']);
});

test('sendRuinMenu flashes presence, sends the status panel, then the poll', async () => {
    const fixture = createFixture();
    await fixture.ruin.sendRuinMenu(fixture.sock, 'chat@s.whatsapp.net', '2348000000001');
    assert.deepEqual(fixture.presenceFlashes, ['2348000000001']);
    assert.equal(fixture.sent.length, 1);
    assert.match(fixture.sent[0].payload.text, /EVENTIDE OMEGA/);
    assert.deepEqual(fixture.delays, [400]);
    assert.equal(fixture.pollCalls.length, 1);
    assert.equal(fixture.pollCalls[0].ids.length, 5);
    assert.deepEqual(fixture.pollCalls[0].ids, ['rm_all', 'rm_system', 'rm_config', 'rm_group', 'rm_fun']);
});

test('sendRuinMenu skips the presence flash when the socket has no bound phone', async () => {
    const fixture = createFixture();
    fixture.sock._eventidePhone = undefined;
    await fixture.ruin.sendRuinMenu(fixture.sock, 'chat@s.whatsapp.net', '2348000000001');
    assert.equal(fixture.presenceFlashes.length, 0);
});

test('RUIN_POLL_OPTIONS and RUIN_POLL_IDS stay aligned', () => {
    const fixture = createFixture();
    assert.equal(fixture.ruin.RUIN_POLL_OPTIONS.length, fixture.ruin.RUIN_POLL_IDS.length);
});
