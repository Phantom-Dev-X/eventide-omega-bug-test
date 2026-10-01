import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessService } from '../src/moderation/access-service.js';

function makeEngine(config = {}, overrides = {}) {
    const configs = typeof config === 'function' ? config : () => config;
    const engine = createAccessService({
        loadBotConfig: configs,
        isGamePoll: (ids) => ids.some(id => String(id).startsWith('arena_')),
        ...overrides
    });
    return { engine };
}

// --- constructor guards ---------------------------------------------------

test('createAccessService throws when loadBotConfig is missing', () => {
    assert.throws(() => createAccessService({ isGamePoll: () => false }), /loadBotConfig/);
});

test('createAccessService throws when isGamePoll is missing', () => {
    assert.throws(() => createAccessService({ loadBotConfig: () => ({}) }), /isGamePoll/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- normalizeDigits ------------------------------------------------------

test('normalizeDigits strips everything that is not a digit', () => {
    const { engine } = makeEngine();
    assert.equal(engine.normalizeDigits('+234 (801) 234-5678'), '2348012345678');
    assert.equal(engine.normalizeDigits('abc'), '');
    assert.equal(engine.normalizeDigits(''), '');
    assert.equal(engine.normalizeDigits(null), '');
    assert.equal(engine.normalizeDigits(undefined), '');
    assert.equal(engine.normalizeDigits(12345), '12345');
});

// --- isSudo ---------------------------------------------------------------

test('isSudo matches sudo entries by digits across JID forms', () => {
    const { engine } = makeEngine({ sudos: ['2348012345678'] });
    assert.equal(engine.isSudo('2348012345678', '2348012345678@s.whatsapp.net'), true);
    assert.equal(engine.isSudo('2348012345678', '2348012345678:5@s.whatsapp.net'), true);
    assert.equal(engine.isSudo('2348012345678', '+234 801 234 5678'), true);
    assert.equal(engine.isSudo('2348012345678', '2348099999999@s.whatsapp.net'), false);
});

test('isSudo returns false for empty or malformed sudo lists', () => {
    assert.equal(makeEngine({}).engine.isSudo('2348012345678', '2348012345678@s.whatsapp.net'), false);
    assert.equal(makeEngine({ sudos: [] }).engine.isSudo('2348012345678', '2348012345678@s.whatsapp.net'), false);
    assert.equal(makeEngine({ sudos: 'not-a-list' }).engine.isSudo('2348012345678', '2348012345678@s.whatsapp.net'), false);
    assert.equal(makeEngine({ sudos: ['2348012345678'] }).engine.isSudo('2348012345678', ''), false);
    assert.equal(makeEngine({ sudos: ['2348012345678'] }).engine.isSudo('2348012345678', null), false);
});

// --- canVoteOnPoll -----------------------------------------------------------

test('canVoteOnPoll lets owners vote on anything', () => {
    const { engine } = makeEngine({});
    assert.equal(engine.canVoteOnPoll('2348012345678', ['2348012345678@s.whatsapp.net'], ['persona_eclipse'], ['2348012345678@s.whatsapp.net']), true);
    assert.equal(engine.canVoteOnPoll('2348012345678', ['someone-else@s.whatsapp.net'], ['random'], ['2348012345678@s.whatsapp.net']), false);
});

test('canVoteOnPoll keeps bot-self config polls owner-only, even for sudoes', () => {
    const { engine } = makeEngine({ sudos: ['2348111111111'] });
    const sudoVoter = ['2348111111111@s.whatsapp.net'];
    for (const id of ['persona_eclipse', 'helpp_ruin', 'ar_on', 'ad_off', 'wn_3', 'wg_kick', 'greet_hi']) {
        assert.equal(engine.canVoteOnPoll('2348012345678', sudoVoter, [id], []), false, id);
    }
});

test('canVoteOnPoll grants sudoes menu navigation but not strangers', () => {
    const { engine } = makeEngine({ sudos: ['2348111111111'] });
    const sudoVoter = ['2348111111111@s.whatsapp.net'];
    const stranger = ['2348222222222@s.whatsapp.net'];
    for (const id of ['rm_owners', 'owners', 'group', 'fun', 'bug', 'system', 'config']) {
        assert.equal(engine.canVoteOnPoll('2348012345678', sudoVoter, [id], []), true, id);
        assert.equal(engine.canVoteOnPoll('2348012345678', stranger, [id], []), false, id);
    }
});

test('canVoteOnPoll opens game polls to everyone', () => {
    const { engine } = makeEngine({});
    const stranger = ['2348222222222@s.whatsapp.net'];
    assert.equal(engine.canVoteOnPoll('2348012345678', stranger, ['ttt_move_3'], []), true);
    assert.equal(engine.canVoteOnPoll('2348012345678', stranger, ['arena_join'], []), true);
    assert.equal(engine.canVoteOnPoll('2348012345678', stranger, ['random_poll'], []), false);
});

test('canVoteOnPoll coerces non-array voters and ids to empty without throwing', () => {
    const { engine } = makeEngine({});
    assert.equal(engine.canVoteOnPoll('2348012345678', null, 'ttt_x', []), false);
    assert.equal(engine.canVoteOnPoll('2348012345678', undefined, undefined, []), false);
    // Non-array ownerJids degrades to a string .includes() that matches nothing,
    // but ttt polls stay open to everyone regardless of ownerJids.
    assert.equal(engine.canVoteOnPoll('2348012345678', ['v@s.whatsapp.net'], ['ttt_move_3'], 'not-an-array'), true);
});
