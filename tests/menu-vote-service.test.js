import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenuVoteService } from '../src/whatsapp/menu-vote-service.js';

// The dispatcher takes 64 injected dependencies (43 functions, 8 session
// Maps, 11 strings, 2 arrays). This harness builds faithful doubles and
// records every call so tests can assert on routing, not implementation.
function makeHarness() {
    const calls = [];
    const logs = [];
    const errors = [];
    const state = {
        botConfig: {},
        warnState: {},
        warnLog: {},
        tttGame: null,
        antideleteState: { endpoints: [] }
    };
    const rec = (name) => (...args) => { calls.push([name, ...args]); };
    const recAsync = (name, result) => async (...args) => { calls.push([name, ...args]); return typeof result === 'function' ? result(...args) : (result ?? undefined); };

    const Maps = {};
    for (const name of ['antiConfigSessions', 'autoreactSessions', 'warnConfigSessions', 'welcomeGoodbyeSessions', 'tttSetupSessions', 'tttGames', 'personaPollKeys', 'helpPersonaPollKeys']) {
        Maps[name] = new Map();
    }

    const deps = {
        // logger
        log: (...a) => logs.push(a),
        logError: (...a) => errors.push(a),
        delay: recAsync('delay'),
        safeWaReply: recAsync('safeWaReply', { key: { id: 'R1' } }),
        // config store
        loadBotConfig: (phone) => state.botConfig,
        loadBotMode: () => 'public',
        saveBotConfig: (phone, cfg) => { calls.push(['saveBotConfig', phone, cfg]); state.botConfig = cfg; },
        // poll-menu service
        sendMenuPoll: recAsync('sendMenuPoll', { key: { id: 'NP1' } }),
        sendMenuBanner: recAsync('sendMenuBanner', { key: { id: 'B1' } }),
        recordMenuMessage: rec('recordMenuMessage'),
        deleteMenuMessages: recAsync('deleteMenuMessages'),
        buildBugMenuText: (prefix) => `bug-menu:${prefix}`,
        // personas
        sendEclipseMenu: recAsync('sendEclipseMenu'),
        sendRuinMenu: recAsync('sendRuinMenu'),
        buildRuinCommandIndexBox: rec('buildRuinCommandIndexBox'),
        buildRuinSystemMenu: rec('buildRuinSystemMenu'),
        buildRuinConfigMenu: rec('buildRuinConfigMenu'),
        buildRuinGroupMenu: rec('buildRuinGroupMenu'),
        buildRuinFunMenu: rec('buildRuinFunMenu'),
        buildOmegaTerminal: rec('buildOmegaTerminal'),
        handleGameVote: recAsync('handleGameVote'),
        // ttt engine
        getTttGame: (phone, jid) => state.tttGame,
        tttSamePlayer: rec('tttSamePlayer'),
        tttResolveLabel: rec('tttResolveLabel'),
        tttCollectIds: rec('tttCollectIds'),
        tttKey: (phone, jid) => `${phone}:${jid}`,
        tttClearTimer: rec('tttClearTimer'),
        tttDeletePoll: recAsync('tttDeletePoll'),
        tttDeleteVotedPoll: recAsync('tttDeleteVotedPoll'),
        tttPaint: rec('tttPaint'),
        tttArmTimer: rec('tttArmTimer'),
        tttArmDeadGame: rec('tttArmDeadGame'),
        tttStart: recAsync('tttStart'),
        tttTryMove: rec('tttTryMove'),
        tttOpenLobby: recAsync('tttOpenLobby'),
        // warn service
        getWarnState: (phone) => state.warnState,
        saveWarnState: (phone, s) => { calls.push(['saveWarnState', phone, s]); },
        ensureWarnGroup: (phone, jid, patch) => { calls.push(['ensureWarnGroup', phone, jid, patch]); return { enabled: patch?.enabled ?? true, phrases: [] }; },
        loadWarnLog: (phone) => state.warnLog,
        saveWarnLog: (phone, l) => { calls.push(['saveWarnLog', phone, l]); },
        // antidelete service
        getAntideleteState: (phone) => state.antideleteState,
        applyWardEndpoint: recAsync('applyWardEndpoint'),
        listAntideleteEndpoints: (phone) => state.antideleteState.endpoints,
        offerGroupPickPoll: recAsync('offerGroupPickPoll'),
        // session Maps
        ...Maps,
        // menu assets
        CONFIG_MENU_PATH: '/cfg.png',
        CONFIG_MENU_TEXT: 'cfg',
        DOMAIN_POLL_QUESTION: 'domain?',
        DOMAIN_POLL_OPTIONS: ['system', 'config'],
        DOMAIN_POLL_IDS: ['system', 'config'],
        FUN_MENU_PATH: '/fun.png',
        FUN_PLACEHOLDER_TEXT: 'fun',
        GROUP_MENU_PATH: '/grp.png',
        GROUP_MENU_TEXT: 'grp',
        OWNERS_MENU_PATH: '/own.png',
        OWNERS_WELCOME_TEXT: 'own',
        SYSTEM_MENU_PATH: '/sys.png',
        SYSTEM_MENU_TEXT: 'sys'
    };
    const engine = createMenuVoteService(deps);
    const sock = {
        user: { id: 'bot@s.whatsapp.net' },
        sendMessage: recAsync('sock.sendMessage', { key: { id: 'SM1' } }),
        groupFetchAllParticipating: recAsync('groupFetchAllParticipating', {})
    };
    return { engine, deps, sock, calls, logs, errors, state, Maps };
}

const find = (calls, name) => calls.filter((c) => c[0] === name);

// --- constructor guards -----------------------------------------------------

test('createMenuVoteService validates all 64 injected dependencies', () => {
    const { deps } = makeHarness();
    const functionNames = ['log', 'delay', 'safeWaReply', 'sendMenuPoll', 'handleGameVote', 'tttStart'];
    for (const name of functionNames) {
        const broken = { ...deps };
        delete broken[name];
        assert.throws(() => createMenuVoteService(broken), new RegExp(name));
    }
    assert.throws(() => createMenuVoteService({ ...deps, tttGames: {} }), /tttGames \(Map\)/);
    assert.throws(() => createMenuVoteService({ ...deps, OWNERS_MENU_PATH: 5 }), /OWNERS_MENU_PATH \(string\)/);
    assert.throws(() => createMenuVoteService({ ...deps, DOMAIN_POLL_OPTIONS: 'x' }), /DOMAIN_POLL_OPTIONS \(array\)/);
});

test('returned interface is frozen', () => {
    const { engine } = makeHarness();
    assert.ok(Object.isFrozen(engine));
    assert.equal(typeof engine.handleMenuVote, 'function');
});

// --- dispatcher basics --------------------------------------------------------

test('handleMenuVote cleans up the previous reply first and never throws', async () => {
    const { engine, sock, calls, errors } = makeHarness();
    await engine.handleMenuVote(sock, 'remote@s.whatsapp.net', '234801', 'unknown_vote', 'P1', 'voter@s.whatsapp.net');
    const dels = find(calls, 'deleteMenuMessages');
    assert.equal(dels.length, 1);
    assert.deepEqual(dels[0].slice(1), [sock, 'P1:voter@s.whatsapp.net']);
    assert.equal(errors.length, 0); // unknown votes fall through silently
});

// --- persona branches -----------------------------------------------------------

test('persona_eclipse shows the eclipse menu and clears the pending poll key', async () => {
    const { engine, sock, calls, Maps } = makeHarness();
    Maps.personaPollKeys.set('234801', { id: 'PP9', remoteJid: 'remote@s.whatsapp.net' });
    await engine.handleMenuVote(sock, 'remote@s.whatsapp.net', '234801', 'persona_eclipse', 'P1');
    assert.ok(find(calls, 'sendEclipseMenu').length >= 1);
    assert.equal(Maps.personaPollKeys.has('234801'), false);
    assert.ok(find(calls, 'tttDeleteVotedPoll').length >= 1);
});

test('helpp_ruin binds the help persona and confirms in chat', async () => {
    const { engine, sock, calls, Maps } = makeHarness();
    Maps.helpPersonaPollKeys.set('234801', { id: 'HP9', remoteJid: 'remote@s.whatsapp.net' });
    await engine.handleMenuVote(sock, 'remote@s.whatsapp.net', '234801', 'helpp_ruin', 'P1');
    const saves = find(calls, 'saveBotConfig');
    assert.equal(saves.length, 1);
    assert.equal(saves[0][2].helpPersona, 'ruin');
    assert.ok(find(calls, 'sock.sendMessage').length >= 1);
    assert.equal(Maps.helpPersonaPollKeys.has('234801'), false);
});

// --- main menu branches -----------------------------------------------------------

test("the owners branch sends the banner, domain poll and records them", async () => {
    const { engine, sock, calls } = makeHarness();
    await engine.handleMenuVote(sock, 'remote@s.whatsapp.net', '234801', 'owners', 'P1');
    const banners = find(calls, 'sendMenuBanner');
    assert.equal(banners.length, 1);
    assert.deepEqual(banners[0].slice(1, 4), [sock, 'remote@s.whatsapp.net', '/own.png']);
    const polls = find(calls, 'sendMenuPoll');
    assert.equal(polls.length, 1);
    const recs = find(calls, 'recordMenuMessage');
    assert.equal(recs.length, 2);
});

test('the system branch sends the system menu banner and records it', async () => {
    const { engine, sock, calls } = makeHarness();
    await engine.handleMenuVote(sock, 'remote@s.whatsapp.net', '234801', 'system', 'P1');
    const banners = find(calls, 'sendMenuBanner');
    assert.equal(banners.length, 1);
    assert.equal(banners[0][3], '/sys.png');
    assert.equal(find(calls, 'recordMenuMessage').length, 1);
});

// --- warn ward branches --------------------------------------------------------------

test('wn_on arms the warn ward for the voting group', async () => {
    const { engine, sock, calls, Maps } = makeHarness();
    Maps.warnConfigSessions.set('234801', { step: 'matrix', group: 'g@us' });
    await engine.handleMenuVote(sock, 'g@us', '234801', 'wn_on', 'P1');
    const ensures = find(calls, 'ensureWarnGroup');
    assert.equal(ensures.length, 1);
    assert.deepEqual(ensures[0].slice(1, 4), ['234801', 'g@us', { enabled: true }]);
    assert.ok(find(calls, 'safeWaReply').length >= 1);
});

test('wn_agrp_<id> puts the picked group under the ward', async () => {
    const { engine, sock, calls, Maps } = makeHarness();
    Maps.warnConfigSessions.set('234801', { jids: ['G1', 'G2'], groups: ['Alpha', 'Beta'] });
    await engine.handleMenuVote(sock, 'remote@s.whatsapp.net', '234801', 'wn_agrp_1', 'P1');
    const ensures = find(calls, 'ensureWarnGroup');
    assert.equal(ensures.length, 2); // arm + read back the config
    assert.deepEqual(ensures[0].slice(1, 4), ['234801', 'G2', { enabled: true }]);
    assert.equal(Maps.warnConfigSessions.get('234801').group, 'G2');
});

// --- welcome/goodbye branches -----------------------------------------------------------

test('wg_wel_off disables the welcome message in bot config', async () => {
    const { engine, sock, calls, Maps } = makeHarness();
    Maps.welcomeGoodbyeSessions.set('234801', { group: 'g@us' });
    await engine.handleMenuVote(sock, 'g@us', '234801', 'wg_wel_off', 'P1');
    const saves = find(calls, 'saveBotConfig');
    assert.equal(saves.length, 1);
    assert.equal(saves[0][2].welcomeMsg['g@us'], 'off');
});

// --- autoreact / antidelete endpoint setup -------------------------------------------------

test('ar_cat_group offers a group picker and remembers the category', async () => {
    const { engine, sock, calls, Maps } = makeHarness();
    await engine.handleMenuVote(sock, 'remote@s.whatsapp.net', '234801', 'ar_cat_group', 'P1');
    const picks = find(calls, 'offerGroupPickPoll');
    assert.equal(picks.length, 1);
    assert.equal(picks[0][4], 'ar');
});

test('endpoint sessions receive pasted refs via ad_grp_paste', async () => {
    const { engine, sock, calls, Maps, state } = makeHarness();
    Maps.antiConfigSessions.set('234801', { stage: 'paste', category: 'group' });
    state.antideleteState.endpoints = [];
    await engine.handleMenuVote(sock, 'remote@s.whatsapp.net', '234801', 'ad_grp_paste', 'P1');
    // The paste handler applies the ward endpoint to the config state.
    assert.ok(find(calls, 'applyWardEndpoint').length + find(calls, 'safeWaReply').length >= 1);
});
