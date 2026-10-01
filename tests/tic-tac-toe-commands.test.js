import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createTicTacToeCommands } from '../src/commands/game/tic-tac-toe.js';

function createFixture({ owner = false } = {}) {
    const sends = [];
    const calls = [];
    const replies = [];
    const errors = [];
    const tttGames = new Map();
    const tttSetupSessions = new Map();
    let liveGame = null;
    let samePlayer = false;
    let replyToBoard = false;
    let target = null;
    let pollResult = { key: { id: 'mode-poll' } };
    const sock = {
        async sendMessage(...args) {
            sends.push(args);
            return { key: { id: 'sent' } };
        }
    };
    const definitions = createTicTacToeCommands({
        getTttGame: (...args) => {
            calls.push(['getTttGame', ...args]);
            return liveGame;
        },
        tttSamePlayer: (...args) => {
            calls.push(['tttSamePlayer', ...args]);
            return samePlayer;
        },
        tttClearTimer: game => calls.push(['tttClearTimer', game]),
        tttDeletePoll: async (...args) => calls.push(['tttDeletePoll', ...args]),
        tttPaint: async (...args) => calls.push(['tttPaint', ...args]),
        tttArmTimer: (...args) => calls.push(['tttArmTimer', ...args]),
        tttGames,
        tttKey: (number, jid) => `${number}:${jid}`,
        buildOmegaTerminal: text => `terminal:${text}`,
        tttIsReplyToBoard: (...args) => {
            calls.push(['tttIsReplyToBoard', ...args]);
            return replyToBoard;
        },
        tttTryMove: async (...args) => calls.push(['tttTryMove', ...args]),
        resolveTargetJid: (...args) => {
            calls.push(['resolveTargetJid', ...args]);
            return target;
        },
        tttOfferChallenge: async (...args) => calls.push(['tttOfferChallenge', ...args]),
        tttStart: async (...args) => calls.push(['tttStart', ...args]),
        tttResolveLabel: async (...args) => {
            calls.push(['tttResolveLabel', ...args]);
            return 'Player Label';
        },
        tttCollectIds: (...args) => {
            calls.push(['tttCollectIds', ...args]);
            return ['player-id'];
        },
        tttSetupSessions,
        sendMenuPoll: async (...args) => {
            calls.push(['sendMenuPoll', ...args]);
            return pollResult;
        },
        logError: (...args) => errors.push(args),
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message })
    });
    return {
        registry: createCommandRegistry(definitions),
        sends, calls, replies, errors, tttGames, tttSetupSessions,
        setLiveGame(value) { liveGame = value; },
        setSamePlayer(value) { samePlayer = value; },
        setReplyToBoard(value) { replyToBoard = value; },
        setTarget(value) { target = value; },
        setPollResult(value) { pollResult = value; },
        context: {
            sock,
            phoneNumber: '2348000000001',
            remoteJid: 'group@g.us',
            senderJid: '2348111111111@s.whatsapp.net',
            isSenderOwner: owner,
            args: [],
            message: { key: { id: 'incoming' } }
        }
    };
}

function callsNamed(fixture, name) {
    return fixture.calls.filter(call => call[0] === name);
}

test('accept reports when no pending challenge exists', async () => {
    const fixture = createFixture();
    fixture.context.args = ['accept'];
    await fixture.registry.execute('.ttt', fixture.context);
    assert.equal(fixture.sends[0][1].text, '❌ No pending challenge.');
});

test('only challenged player or owner can accept', async () => {
    const fixture = createFixture();
    fixture.setLiveGame({ status: 'pending', o: 'other@s.whatsapp.net' });
    fixture.context.args = ['yes'];
    await fixture.registry.execute('.xo', fixture.context);
    assert.equal(fixture.sends[0][1].text, '❌ Only the challenged soul may accept.');
    assert.equal(callsNamed(fixture, 'tttPaint').length, 0);
});

test('accept activates challenge and preserves cleanup, paint, and timer order', async () => {
    const fixture = createFixture();
    const game = { status: 'pending', o: fixture.context.senderJid, boardKey: { id: 'old' } };
    fixture.setLiveGame(game);
    fixture.setSamePlayer(true);
    fixture.context.args = ['accept'];
    await fixture.registry.execute('.tictactoe', fixture.context);
    assert.equal(game.status, 'active');
    assert.equal(game.boardKey, null);
    const lifecycle = fixture.calls
        .map(call => call[0])
        .filter(name => ['tttClearTimer', 'tttDeletePoll', 'tttPaint', 'tttArmTimer'].includes(name));
    assert.deepEqual(lifecycle, ['tttClearTimer', 'tttDeletePoll', 'tttPaint', 'tttArmTimer']);
});

test('decline clears pending challenge, deletes storage entry, and replies', async () => {
    const fixture = createFixture();
    const game = { status: 'pending' };
    fixture.setLiveGame(game);
    const key = '2348000000001:group@g.us';
    fixture.tttGames.set(key, game);
    fixture.context.args = ['decline'];
    await fixture.registry.execute('.ttt', fixture.context);
    assert.equal(fixture.tttGames.has(key), false);
    assert.equal(callsNamed(fixture, 'tttClearTimer').length, 1);
    assert.equal(callsNamed(fixture, 'tttDeletePoll').length, 1);
    assert.equal(fixture.sends[0][1].text, '🕊 Challenge declined. The grid sleeps.');
});

test('quit closes and removes a live game', async () => {
    const fixture = createFixture();
    const game = { status: 'active' };
    fixture.setLiveGame(game);
    const key = '2348000000001:group@g.us';
    fixture.tttGames.set(key, game);
    fixture.context.args = ['close'];
    await fixture.registry.execute('.ttt', fixture.context);
    assert.equal(fixture.tttGames.has(key), false);
    assert.match(fixture.sends[0][1].text, /ARENA_CLOSED/);
});

test('board redraw resets board key while missing arena reports guidance', async () => {
    const missing = createFixture();
    missing.context.args = ['board'];
    await missing.registry.execute('.ttt', missing.context);
    assert.match(missing.sends[0][1].text, /No live arena/);

    const active = createFixture();
    const game = { status: 'active', boardKey: { id: 'old-board' } };
    active.setLiveGame(game);
    active.context.args = ['show'];
    await active.registry.execute('.ttt', active.context);
    assert.equal(game.boardKey, null);
    assert.equal(callsNamed(active, 'tttPaint').length, 1);
});

test('numeric move requires a reply to the current board', async () => {
    const fixture = createFixture();
    fixture.setLiveGame({ status: 'active' });
    fixture.context.args = ['5'];
    await fixture.registry.execute('.ttt', fixture.context);
    assert.match(fixture.sends[0][1].text, /Reply to the \*board\*/);
    assert.equal(callsNamed(fixture, 'tttTryMove').length, 0);
});

test('valid numeric reply converts board position to zero-based move', async () => {
    const fixture = createFixture();
    fixture.setLiveGame({ status: 'active' });
    fixture.setReplyToBoard(true);
    fixture.context.args = ['9'];
    await fixture.registry.execute('.ttt', fixture.context);
    const move = callsNamed(fixture, 'tttTryMove')[0];
    assert.deepEqual(move.slice(1), [
        fixture.context.sock,
        fixture.context.phoneNumber,
        fixture.context.remoteJid,
        fixture.context.senderJid,
        8,
        fixture.context.message
    ]);
});

test('non-move input during active game returns arena guidance', async () => {
    const fixture = createFixture();
    fixture.setLiveGame({ status: 'active' });
    fixture.context.args = ['hello'];
    await fixture.registry.execute('.ttt', fixture.context);
    assert.match(fixture.sends[0][1].text, /ARENA_LIVE/);
    assert.equal(callsNamed(fixture, 'resolveTargetJid').length, 0);
});

test('resolved rival starts human challenge before bot setup', async () => {
    const fixture = createFixture();
    fixture.setTarget('2348222222222@s.whatsapp.net');
    fixture.context.args = ['@rival'];
    await fixture.registry.execute('.ttt', fixture.context);
    assert.deepEqual(callsNamed(fixture, 'tttOfferChallenge')[0].slice(1), [
        fixture.context.sock,
        fixture.context.phoneNumber,
        fixture.context.remoteJid,
        fixture.context.senderJid,
        '2348222222222@s.whatsapp.net'
    ]);
    assert.equal(callsNamed(fixture, 'tttStart').length, 0);
});

test('bot modes preserve requested difficulty and void defaults to medium', async () => {
    for (const [input, expected] of [['easy', 'easy'], ['medium', 'medium'], ['hard', 'hard'], ['bot', 'medium'], ['void', 'medium']]) {
        const fixture = createFixture();
        fixture.context.args = [input];
        await fixture.registry.execute('.ttt', fixture.context);
        const options = callsNamed(fixture, 'tttStart')[0][4];
        assert.deepEqual(options, {
            x: fixture.context.senderJid,
            o: 'BOT',
            vsBot: true,
            difficulty: expected,
            xLabel: 'Player Label',
            oLabel: 'VOID',
            xIds: ['player-id']
        });
    }
});

test('bare command creates setup session, sends instructions, and tracks poll key', async () => {
    const fixture = createFixture();
    await fixture.registry.execute('.ttt', fixture.context);
    assert.match(fixture.sends[0][1].text, /EVENTIDE ARENA/);
    assert.deepEqual(callsNamed(fixture, 'sendMenuPoll')[0].slice(1), [
        fixture.context.sock,
        fixture.context.remoteJid,
        fixture.context.phoneNumber,
        'OPEN THE GRID',
        ['Play vs Bot', 'Play vs Human'],
        ['ttt_vs_bot', 'ttt_vs_p']
    ]);
    assert.deepEqual(fixture.tttSetupSessions.get(fixture.context.phoneNumber), {
        step: 'mode',
        chat: fixture.context.remoteJid,
        host: fixture.context.senderJid,
        hostLabel: 'Player Label',
        hostIds: ['player-id'],
        modePollKey: { id: 'mode-poll' }
    });
});

test('command errors are contained, logged, and reported safely', async () => {
    const fixture = createFixture();
    fixture.setTarget('rival@s.whatsapp.net');
    const failure = new Error('challenge failed');
    const original = fixture.calls.push.bind(fixture.calls);
    fixture.calls.push = (...items) => {
        if (items[0]?.[0] === 'tttOfferChallenge') throw failure;
        return original(...items);
    };
    await fixture.registry.execute('.ttt', fixture.context);
    assert.deepEqual(fixture.errors[0].slice(0, 2), ['TTT', '2348000000001: .ttt failed']);
    assert.match(fixture.replies[0].text, /Arena failed to open/);
    assert.match(fixture.replies[0].text, /challenge failed/);
});

test('tic-tac-toe module registers its primary command and aliases', () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.registry.list(), ['.tictactoe']);
    assert.equal(fixture.registry.has('.ttt'), true);
    assert.equal(fixture.registry.has('.xo'), true);
});
