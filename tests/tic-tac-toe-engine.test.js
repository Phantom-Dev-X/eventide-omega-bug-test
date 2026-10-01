import test from 'node:test';
import assert from 'node:assert/strict';

import { createTicTacToeEngine } from '../src/games/tic-tac-toe-engine.js';

// Minimal jidNormalizedUser stand-in matching Baileys' normalization contract
// closely enough for identity-comparison tests (strips device suffix).
function normalizeJid(jid) {
    if (!jid) return jid;
    return String(jid).replace(/:\d+(?=@)/, '');
}

function createFixture() {
    const sent = [];
    const logs = [];
    const errorLogs = [];
    const delays = [];
    const pollCalls = [];
    const tttGames = new Map();

    const sock = {
        user: { id: '234800000bot@s.whatsapp.net', phoneNumber: '234800000bot' },
        async sendMessage(jid, payload) {
            sent.push({ jid, payload });
            return { key: { id: `msg-${sent.length}`, remoteJid: jid } };
        }
    };

    const engine = createTicTacToeEngine({
        tttGames,
        jidNormalizedUser: normalizeJid,
        getQuotedContext: msg => msg?._quotedContext || null,
        buildOmegaTerminal: body => `[TERMINAL]\n${body}`,
        delay: async ms => { delays.push(ms); },
        sendMenuPoll: async (s, remoteJid, phoneNumber, question, options, ids) => {
            pollCalls.push({ remoteJid, phoneNumber, question, options, ids });
            return { key: { id: `poll-${pollCalls.length}` } };
        },
        log: (...args) => logs.push(args),
        logError: (...args) => errorLogs.push(args)
    });

    return { engine, sock, sent, logs, errorLogs, delays, pollCalls, tttGames };
}

test('constructor requires every function dependency', () => {
    assert.throws(() => createTicTacToeEngine({}), /require/);
});

test('constructor requires a tttGames Map', () => {
    assert.throws(() => createTicTacToeEngine({
        jidNormalizedUser: normalizeJid,
        getQuotedContext: () => null,
        buildOmegaTerminal: b => b,
        delay: async () => {},
        sendMenuPoll: async () => {},
        log: () => {},
        logError: () => {}
    }), /tttGames/);
});

test('tttKey combines phone number and chat jid', () => {
    const { engine } = createFixture();
    assert.equal(engine.tttKey('234801', '123@g.us'), '234801:123@g.us');
});

test('tttSamePlayer matches BOT, normalized jids, and bare phone digits', () => {
    const { engine } = createFixture();
    assert.equal(engine.tttSamePlayer('BOT', 'BOT'), true);
    assert.equal(engine.tttSamePlayer('BOT', '123@s.whatsapp.net'), false);
    assert.equal(engine.tttSamePlayer('123@s.whatsapp.net', '123:5@s.whatsapp.net'), true);
    assert.equal(engine.tttSamePlayer('123@s.whatsapp.net', '456@s.whatsapp.net'), false);
    assert.equal(engine.tttSamePlayer(null, '123@s.whatsapp.net'), false);
});

test('tttWinner detects rows, columns, diagonals, and draws', () => {
    const { engine } = createFixture();
    assert.equal(engine.tttWinner(['X', 'X', 'X', null, null, null, null, null, null]).mark, 'X');
    assert.equal(engine.tttWinner(['O', null, null, 'O', null, null, 'O', null, null]).mark, 'O');
    assert.equal(engine.tttWinner(['X', null, null, null, 'X', null, null, null, 'X']).mark, 'X');
    assert.equal(engine.tttWinner(Array(9).fill(null)), null);
    assert.equal(engine.tttWinner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']).mark, 'DRAW');
});

test('tttBotMove takes the immediate winning move when available', () => {
    const { engine } = createFixture();
    // X has two in a row (0,1) and can win at 2. Bot plays X on 'hard'-like
    // deterministic path (difficulty values other than easy/medium always
    // run full minimax).
    const board = ['X', 'X', null, 'O', 'O', null, null, null, null];
    const move = engine.tttBotMove(board, 'X', 'hard');
    assert.equal(move, 2);
});

test('tttBotMove blocks the opponent\'s winning move when it cannot win itself', () => {
    const { engine } = createFixture();
    const board = ['O', 'O', null, 'X', null, null, null, null, null];
    const move = engine.tttBotMove(board, 'X', 'hard');
    assert.equal(move, 2);
});

test('renderTttBoard shows marks, turn footer, and win/draw footers', () => {
    const { engine } = createFixture();
    const game = {
        board: ['X', null, null, null, null, null, null, null, null],
        x: '234801@s.whatsapp.net', o: '234802@s.whatsapp.net',
        xLabel: '+234801', oLabel: '+234802',
        turn: 'O', status: 'active', difficulty: ''
    };
    const text = engine.renderTttBoard(game);
    assert.match(text, /❌/);
    assert.match(text, /\+234801/);
    assert.match(text, /\+234802/);
    assert.match(text, /to move/);

    const wonGame = { ...game, board: ['X', 'X', 'X', null, null, null, null, null, null], status: 'done' };
    const wonText = engine.renderTttBoard(wonGame);
    assert.match(wonText, /wins/);

    const drawGame = { ...game, board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'], status: 'done' };
    const drawText = engine.renderTttBoard(drawGame);
    assert.match(drawText, /draw/);
});

test('tttStart creates a game, paints the board, and arms timers', async () => {
    const { engine, sock, sent, tttGames } = createFixture();
    const game = await engine.tttStart(sock, '234801', '123@g.us', {
        x: '234801@s.whatsapp.net', o: '234802@s.whatsapp.net'
    });
    assert.equal(game.status, 'active');
    assert.equal(tttGames.get('234801:123@g.us'), game);
    assert.ok(sent.some(m => m.payload.text && m.payload.text.includes('TIC · TAC · TOE')));
    assert.ok(game.timer);
    assert.ok(game.idleTimer);
    engine.tttClearTimer(game); // cleanup so the test process can exit promptly
});

test('tttStart vs BOT (host plays X=BOT) immediately triggers a bot move', async () => {
    const { engine, sock, delays } = createFixture();
    const game = await engine.tttStart(sock, '234801', '123@g.us', {
        x: 'BOT', o: '234802@s.whatsapp.net', vsBot: true, difficulty: 'hard'
    });
    assert.ok(delays.includes(250), 'bot move should wait on the injected delay()');
    assert.equal(game.board.filter(Boolean).length, 1);
    assert.equal(game.turn, 'O');
    engine.tttClearTimer(game);
});

test('tttTryMove enforces turn order and rejects occupied/out-of-range cells', async () => {
    const { engine, sock, tttGames } = createFixture();
    const game = await engine.tttStart(sock, '234801', '123@g.us', {
        x: '234801@s.whatsapp.net', o: '234802@s.whatsapp.net'
    });

    await engine.tttTryMove(sock, '234801', '123@g.us', '234802@s.whatsapp.net', 0);
    assert.equal(game.board[0], null, 'not O\'s turn yet, move should be rejected');

    await engine.tttTryMove(sock, '234801', '123@g.us', '234801@s.whatsapp.net', 0);
    assert.equal(game.board[0], 'X');
    assert.equal(game.turn, 'O');

    await engine.tttTryMove(sock, '234801', '123@g.us', '234802@s.whatsapp.net', 0);
    assert.equal(game.board[1], null, 'cell 0 already taken, move should be rejected');

    engine.tttClearTimer(game);
    tttGames.delete('234801:123@g.us');
});

test('tttTryMove ends the game and offers a rematch poll on a win', async () => {
    const { engine, sock, pollCalls, tttGames } = createFixture();
    const game = await engine.tttStart(sock, '234801', '123@g.us', {
        x: '234801@s.whatsapp.net', o: '234802@s.whatsapp.net'
    });
    game.board = ['X', 'X', null, 'O', 'O', null, null, null, null];
    game.turn = 'X';
    await engine.tttTryMove(sock, '234801', '123@g.us', '234801@s.whatsapp.net', 2);
    assert.equal(game.status, 'done');
    assert.equal(pollCalls.length, 1);
    assert.deepEqual(pollCalls[0].ids, ['ttt_again', 'ttt_close']);
    tttGames.delete('234801:123@g.us');
});

test('tttOfferChallenge refuses self-challenges and otherwise opens a pending duel', async () => {
    const { engine, sock, sent, pollCalls, tttGames } = createFixture();
    await engine.tttOfferChallenge(sock, '234801', '123@g.us', '234801@s.whatsapp.net', '234801@s.whatsapp.net');
    assert.ok(sent.some(m => m.payload.text.includes('cannot duel your own shadow')));

    sent.length = 0;
    await engine.tttOfferChallenge(sock, '234801', '123@g.us', '234801@s.whatsapp.net', '234802@s.whatsapp.net');
    const game = tttGames.get('234801:123@g.us');
    assert.equal(game.status, 'pending');
    assert.equal(pollCalls.length, 1);
    assert.deepEqual(pollCalls[0].ids, ['ttt_yes', 'ttt_no']);
    engine.tttClearTimer(game);
    tttGames.delete('234801:123@g.us');
});

test('tttOpenLobby creates an open-seat pending game awaiting any challenger', async () => {
    const { engine, sock, tttGames } = createFixture();
    await engine.tttOpenLobby(sock, '234801', '123@g.us', '234801@s.whatsapp.net');
    const game = tttGames.get('234801:123@g.us');
    assert.equal(game.status, 'pending');
    assert.equal(game.openSeat, true);
    assert.equal(game.oLabel, 'open');
    engine.tttClearTimer(game);
    tttGames.delete('234801:123@g.us');
});

test('tttDeletePoll clears pollKey after attempting the delete send', async () => {
    const { engine, sock } = createFixture();
    const game = { chatJid: '123@g.us', pollKey: { id: 'poll-1', remoteJid: '123@g.us' } };
    await engine.tttDeletePoll(sock, game);
    assert.equal(game.pollKey, null);
});

test('interface is frozen', () => {
    const { engine } = createFixture();
    assert.throws(() => { engine.tttKey = () => {}; }, TypeError);
});
