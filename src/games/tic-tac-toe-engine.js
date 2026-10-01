/**
 * Tic-tac-toe board/session engine: game-state keying, player identity
 * resolution (JID/LID/phone-number reconciliation), the minimax bot AI,
 * board rendering, timers, and the full lifecycle (challenge, open lobby,
 * moves, bot turns). Command routing, challenge-argument parsing, and
 * setup-poll orchestration stay in src/commands/game/tic-tac-toe.js; the
 * shared poll-vote dispatcher (`handleMenuVote`, in
 * src/whatsapp/menu-vote-service.js) uses the functions returned here
 * directly.
 */
export function createTicTacToeEngine(deps) {
    const {
        tttGames,
        jidNormalizedUser,
        getQuotedContext,
        buildOmegaTerminal,
        sendMenuPoll,
        delay,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        jidNormalizedUser, getQuotedContext, buildOmegaTerminal, sendMenuPoll, delay, log, logError
    })) {
        if (typeof value !== 'function') throw new Error(`Tic-tac-toe engine requires ${name}()`);
    }
    if (!tttGames || typeof tttGames.get !== 'function' || typeof tttGames.set !== 'function') {
        throw new Error('Tic-tac-toe engine requires a tttGames Map');
    }

    const TTT_WINS = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    const TTT_LABELS = [
        '1 · top left', '2 · top', '3 · top right',
        '4 · mid left', '5 · center', '6 · mid right',
        '7 · bot left', '8 · bottom', '9 · bot right'
    ];

    function tttKey(phoneNumber, chatJid) {
        return `${phoneNumber}:${chatJid}`;
    }

    function tttSamePlayer(a, b) {
        if (!a || !b) return false;
        if (a === 'BOT' || b === 'BOT') return a === b;
        if (jidNormalizedUser(a) === jidNormalizedUser(b)) return true;
        const da = String(a).split('@')[0].replace(/\D/g, '');
        const db = String(b).split('@')[0].replace(/\D/g, '');
        return !!(da && db && da === db);
    }

    function tttOwnerPn(sock, phoneNumber) {
        const cands = [
            sock?.user?.phoneNumber,
            sock?.authState?.creds?.me?.phoneNumber,
            sock?.user?.id && String(sock.user.id).includes('@s.whatsapp.net') ? sock.user.id : '',
            phoneNumber
        ];
        for (const c of cands) {
            const d = String(c || '').split(':')[0].split('@')[0].replace(/\D/g, '');
            if (d.length >= 7) return d;
        }
        return '';
    }

    function tttJidDigits(jid) {
        return String(jid || '').split(':')[0].split('@')[0].replace(/\D/g, '');
    }

    function tttIsLid(jid) {
        return String(jid || '').includes('@lid');
    }

    function tttIsOwnerJid(sock, phoneNumber, jid) {
        if (!jid || jid === 'BOT') return false;
        if (tttSamePlayer(jid, sock?.user?.id) || tttSamePlayer(jid, sock?.user?.lid) || tttSamePlayer(jid, sock?.user?.phoneNumber)) return true;
        const d = tttJidDigits(jid);
        const own = tttOwnerPn(sock, phoneNumber);
        return !!(d && own && d === own);
    }

    function tttPnFromMsg(msg) {
        const k = msg?.key || {};
        for (const c of [k.participantAlt, k.remoteJidAlt, k.participantPn, k.senderPn]) {
            if (!c) continue;
            const s = String(c);
            if (s.includes('@lid')) continue;
            const d = s.split(':')[0].split('@')[0].replace(/\D/g, '');
            if (d.length >= 7 && d.length <= 15) return d;
        }
        return '';
    }

    function tttCollectIds(sock, phoneNumber, jid, msg) {
        const ids = new Set();
        if (jid && jid !== 'BOT') ids.add(jid);
        const k = msg?.key || {};
        for (const c of [k.participant, k.participantAlt, k.remoteJidAlt]) {
            if (c && !String(c).endsWith('@g.us') && !String(c).endsWith('@broadcast')) ids.add(c);
        }
        if (msg?.key?.fromMe || tttIsOwnerJid(sock, phoneNumber, jid)) {
            for (const c of [sock?.user?.id, sock?.user?.lid, sock?.user?.phoneNumber]) {
                if (c) ids.add(c);
            }
            const pn = tttOwnerPn(sock, phoneNumber);
            if (pn) ids.add(pn + '@s.whatsapp.net');
        }
        return [...ids].filter(Boolean);
    }

    async function tttResolveLabel(sock, phoneNumber, jid, msg) {
        if (!jid || jid === 'BOT') return 'VOID';
        if (msg?.key?.fromMe || tttIsOwnerJid(sock, phoneNumber, jid)) {
            const pn = tttOwnerPn(sock, phoneNumber);
            if (pn) return '+' + pn;
        }
        const fromMsg = tttPnFromMsg(msg);
        if (fromMsg) return '+' + fromMsg;
        if (String(jid).includes('@s.whatsapp.net') || String(jid).includes('@c.us')) {
            const d = tttJidDigits(jid);
            if (d) return '+' + d;
        }
        try {
            const map = sock?.signalRepository?.lidMapping;
            if (map?.getPNForLID && tttIsLid(jid)) {
                const pn = await map.getPNForLID(jid);
                const d = String(pn || '').split(':')[0].split('@')[0].replace(/\D/g, '');
                if (d.length >= 7) return '+' + d;
            }
        } catch (_) {}
        const name = String(msg?.pushName || '').trim();
        if (name && name.toLowerCase() !== 'unknown') return name;
        return 'player';
    }

    function tttPlayerMatches(game, slot, jid, sock, phoneNumber) {
        if (!game) return false;
        if (game[slot] === 'BOT') return jid === 'BOT';
        const pool = [game[slot], ...(game[slot + 'Ids'] || [])];
        if (pool.some(id => tttSamePlayer(id, jid))) return true;
        if (sock && tttIsOwnerJid(sock, phoneNumber, game[slot]) && tttIsOwnerJid(sock, phoneNumber, jid)) return true;
        return false;
    }

    function tttName(game, slot) {
        if (!game) return 'player';
        if (game[slot] === 'BOT') return 'VOID';
        const stored = game[slot + 'Label'];
        if (stored) return stored;
        const jid = game[slot];
        if (!jid) return 'open';
        if (String(jid).includes('@s.whatsapp.net') || String(jid).includes('@c.us')) {
            const d = tttJidDigits(jid);
            return d ? '+' + d : 'player';
        }
        return 'player';
    }

    function tttShort(jid, game, sock, phoneNumber) {
        if (!jid || jid === 'BOT') return 'VOID';
        if (game) {
            if (tttSamePlayer(jid, game.x) && game.xLabel) return game.xLabel;
            if (tttSamePlayer(jid, game.o) && game.oLabel) return game.oLabel;
        }
        if (sock && tttIsOwnerJid(sock, phoneNumber, jid)) {
            const pn = tttOwnerPn(sock, phoneNumber);
            if (pn) return '+' + pn;
        }
        if (String(jid).includes('@s.whatsapp.net') || String(jid).includes('@c.us')) {
            const d = tttJidDigits(jid);
            if (d) return '+' + d;
        }
        if (tttIsLid(jid)) return 'player';
        const d = tttJidDigits(jid);
        return d ? '+' + d : 'player';
    }

    function tttWinner(board) {
        for (const line of TTT_WINS) {
            const [a, b, c] = line;
            if (board[a] && board[a] === board[b] && board[b] === board[c]) {
                return { mark: board[a], line };
            }
        }
        if (board.every(Boolean)) return { mark: 'DRAW', line: [] };
        return null;
    }

    function tttMinimax(board, ai, human, isMax) {
        const w = tttWinner(board);
        if (w?.mark === ai) return 10;
        if (w?.mark === human) return -10;
        if (w?.mark === 'DRAW') return 0;
        let best = isMax ? -Infinity : Infinity;
        for (let i = 0; i < 9; i++) {
            if (board[i]) continue;
            board[i] = isMax ? ai : human;
            const score = tttMinimax(board, ai, human, !isMax);
            board[i] = null;
            best = isMax ? Math.max(best, score) : Math.min(best, score);
        }
        return best;
    }

    function tttBotMove(board, aiMark, difficulty) {
        const empty = [];
        for (let i = 0; i < 9; i++) if (!board[i]) empty.push(i);
        if (!empty.length) return -1;
        const human = aiMark === 'X' ? 'O' : 'X';
        const roll = Math.random();
        if (difficulty === 'easy' && roll < 0.8) return empty[Math.floor(Math.random() * empty.length)];
        if (difficulty === 'medium' && roll < 0.45) return empty[Math.floor(Math.random() * empty.length)];
        let bestScore = -Infinity;
        let best = empty[0];
        for (const i of empty) {
            board[i] = aiMark;
            const score = tttMinimax(board, aiMark, human, false);
            board[i] = null;
            if (score > bestScore) { bestScore = score; best = i; }
        }
        return best;
    }

    function renderTttBoard(game, extra = '') {
        // Exact grid the owner pasted. Do not "fix" spacing.
        const EMPTY = [
            '         1      ',
            '        2      ',
            '        3        ',
            '         4      ',
            '        5      ',
            '       6        ',
            '         7       ',
            '        8      ',
            '        9        '
        ];
        const cell = (i) => {
            const raw = EMPTY[i];
            // Sticker is 2 cols on WhatsApp: drop the digit AND two spaces.
            if (game.board[i] === 'X') return raw.replace(String(i + 1) + '  ', '❌');
            if (game.board[i] === 'O') return raw.replace(String(i + 1) + '  ', '⭕');
            return raw;
        };
        const win = tttWinner(game.board);
        const xName = tttName(game, 'x');
        const oName = tttName(game, 'o');
        const oLine = game.difficulty ? (oName + '  ·  ' + String(game.difficulty).toUpperCase()) : oName;
        const turnMark = game.turn === 'X' ? '❌' : '⭕';
        const turnName = game.turn === 'X' ? xName : oName;
        let footer;
        if (game.status === 'pending') {
            footer = '   waiting for accept…';
        } else if (win?.mark === 'DRAW') {
            footer = '   ●  draw. the grid holds.';
        } else if (win?.mark) {
            const champ = win.mark === 'X' ? xName : oName;
            footer = '   ●  ' + (win.mark === 'X' ? '❌' : '⭕') + '  ' + champ + '  wins';
        } else {
            footer = (
                '   ●  ' + turnMark + '  ' + turnName + '  to move\n' +
                '   reply to THIS board with 1–9\n' +
                '   1 min a turn'
            );
        }
        const note = extra ? ('\n' + String(extra).replace(/^\n+/, '')) : '';

        return (
            '      ✦ EVENTIDE ARENA ✦\n' +
            '         TIC · TAC · TOE\n' +
            '\n' +
            '╭──────┬──────┬──────╮\n' +
            '│' + cell(0) + '│' + cell(1) + '│' + cell(2) + '│\n' +
            '├──────┼──────┼──────┤\n' +
            '│' + cell(3) + '│' + cell(4) + '│' + cell(5) + '│ ├──────┼──────┼──────┤\n' +
            '│' + cell(6) + '│' + cell(7) + '│' + cell(8) + '│\n' +
            '╰──────┴──────┴──────╯\n' +
            '\n' +
            '❌  ' + xName + '\n' +
            '⭕  ' + oLine + '\n' +
            '\n' +
            footer +
            note
        );
    }

    function getTttGame(phoneNumber, chatJid) {
        return tttGames.get(tttKey(phoneNumber, chatJid)) || null;
    }

    function tttClearTimer(game) {
        if (game?.timer) { clearTimeout(game.timer); game.timer = null; }
        if (game?.idleTimer) { clearTimeout(game.idleTimer); game.idleTimer = null; }
    }

    async function tttDeletePoll(sock, game) {
        if (!game?.pollKey) return;
        try { await sock.sendMessage(game.pollKey.remoteJid || game.chatJid, { delete: game.pollKey }); } catch (_) {}
        game.pollKey = null;
    }

    async function tttDeleteVotedPoll(sock, remoteJid, pollId) {
        if (!pollId) return;
        try { await sock.sendMessage(remoteJid, { delete: { remoteJid, id: pollId, fromMe: true } }); } catch (_) {}
    }

    function tttIsReplyToBoard(msg, game) {
        if (!game?.boardKey?.id) return false;
        const ctx = getQuotedContext(msg);
        const qid = ctx?.stanzaId || ctx?.quotedMessage?.key?.id || null;
        return !!(qid && qid === game.boardKey.id);
    }

    async function tttPaint(sock, phoneNumber, game, { extra = '', rematch = false } = {}) {
        const body = renderTttBoard(game, extra);
        try {
            if (game.boardKey?.id) {
                await sock.sendMessage(game.chatJid, { text: body, edit: game.boardKey });
                log('TTT', `${phoneNumber}: edited board ${game.boardKey.id}`);
            } else {
                const sent = await sock.sendMessage(game.chatJid, { text: body });
                game.boardKey = sent?.key || null;
                log('TTT', `${phoneNumber}: sent fresh board ${game.boardKey?.id || 'none'}`);
            }
        } catch (err) {
            logError('TTT', `${phoneNumber}: board edit failed, sending new card`, err);
            const sent = await sock.sendMessage(game.chatJid, { text: body });
            game.boardKey = sent?.key || null;
        }
        await tttDeletePoll(sock, game);
        if ((rematch || tttWinner(game.board)) && game.status === 'done') {
            const poll = await sendMenuPoll(sock, game.chatJid, phoneNumber, 'ARENA', ['Rematch', 'Leave the grid'], ['ttt_again', 'ttt_close']);
            game.pollKey = poll?.key || null;
        }
    }

    function tttArmTimer(sock, phoneNumber, game) {
        if (game?.timer) { clearTimeout(game.timer); game.timer = null; }
        if (!game || game.status !== 'active') return;
        game.timer = setTimeout(async () => {
            const live = getTttGame(phoneNumber, game.chatJid);
            if (!live || live !== game || live.status !== 'active') return;
            live.status = 'done';
            const sleeper = live.turn === 'X' ? live.x : live.o;
            tttClearTimer(live);
            await tttPaint(sock, phoneNumber, live, {
                extra: `\n⏳ *1 MIN.* ${sleeper === 'BOT' ? 'VOID' : tttShort(sleeper)} froze. Forfeit.`,
                rematch: true
            });
        }, 60 * 1000);
    }

    function tttArmDeadGame(sock, phoneNumber, game, ms = 3 * 60 * 1000) {
        if (game?.idleTimer) { clearTimeout(game.idleTimer); game.idleTimer = null; }
        game.idleTimer = setTimeout(async () => {
            const live = getTttGame(phoneNumber, game.chatJid);
            if (!live || live !== game) return;
            if (live.status === 'active' && (live.moveCount || 0) > 0) return;
            tttClearTimer(live);
            await tttDeletePoll(sock, live);
            tttGames.delete(tttKey(phoneNumber, live.chatJid));
            await sock.sendMessage(live.chatJid, {
                text: buildOmegaTerminal(
                    `   ░▒▓█ *ARENA_DIED* █▓▒░\n\n` +
                    `   3 minutes. Nobody played.\n` +
                    `   The grid went dark.`
                )
            }).catch(() => {});
        }, ms);
    }

    async function tttStart(sock, phoneNumber, chatJid, { x, o, vsBot = false, difficulty = 'medium', xLabel = '', oLabel = '', xIds = [], oIds = [], boardKey = null } = {}) {
        const prev = getTttGame(phoneNumber, chatJid);
        if (prev) { tttClearTimer(prev); await tttDeletePoll(sock, prev); }
        if (x !== 'BOT' && !xLabel) xLabel = await tttResolveLabel(sock, phoneNumber, x, null);
        if (o !== 'BOT' && !oLabel) oLabel = await tttResolveLabel(sock, phoneNumber, o, null);
        if (x === 'BOT') xLabel = 'VOID';
        if (o === 'BOT') oLabel = 'VOID';
        const game = {
            chatJid, x, o, vsBot, difficulty: vsBot ? difficulty : '',
            xLabel, oLabel,
            xIds: x === 'BOT' ? [] : [...new Set((xIds || []).filter(Boolean))],
            oIds: o === 'BOT' ? [] : [...new Set((oIds || []).filter(Boolean))],
            board: Array(9).fill(null),
            turn: 'X',
            status: 'active',
            boardKey: boardKey || null,
            pollKey: null,
            timer: null,
            idleTimer: null,
            moveCount: 0,
            openSeat: false,
            startedAt: Date.now()
        };
        tttGames.set(tttKey(phoneNumber, chatJid), game);
        await tttPaint(sock, phoneNumber, game);
        tttArmTimer(sock, phoneNumber, game);
        tttArmDeadGame(sock, phoneNumber, game);
        if (vsBot && game.x === 'BOT') await tttPlayBot(sock, phoneNumber, game);
        return game;
    }

    async function tttPlayBot(sock, phoneNumber, game) {
        if (!game.vsBot || game.status !== 'active') return;
        const botMark = game.x === 'BOT' ? 'X' : 'O';
        if (game.turn !== botMark) return;
        await delay(250);
        const idx = tttBotMove(game.board, botMark, game.difficulty || 'medium');
        if (idx < 0) return;
        game.board[idx] = botMark;
        game.moveCount = (game.moveCount || 0) + 1;
        if (game.idleTimer) { clearTimeout(game.idleTimer); game.idleTimer = null; }
        const win = tttWinner(game.board);
        if (win) {
            game.status = 'done';
            tttClearTimer(game);
            await tttPaint(sock, phoneNumber, game, { rematch: true });
            return;
        }
        game.turn = botMark === 'X' ? 'O' : 'X';
        await tttPaint(sock, phoneNumber, game);
        tttArmTimer(sock, phoneNumber, game);
    }

    async function tttTryMove(sock, phoneNumber, chatJid, playerJid, idx, msg = null) {
        const game = getTttGame(phoneNumber, chatJid);
        if (!game || game.status !== 'active') {
            await sock.sendMessage(chatJid, { text: '❌ No live arena here. Type *.ttt* to open one.' });
            return;
        }
        if (idx < 0 || idx > 8 || game.board[idx]) {
            await sock.sendMessage(chatJid, { text: '❌ That cell is sealed. Pick an open number.' });
            return;
        }
        const slot = game.turn === 'X' ? 'x' : 'o';
        const expected = game[slot];
        if (expected === 'BOT') return;
        const who = (!playerJid || playerJid === 'me') ? (sock.user?.id || sock.user?.phoneNumber || '') : playerJid;
        if (!tttPlayerMatches(game, slot, who, sock, phoneNumber) && !tttPlayerMatches(game, slot, playerJid, sock, phoneNumber)) {
            await sock.sendMessage(chatJid, { text: `⏳ Not your turn. Waiting on ${tttName(game, slot)}.` });
            return;
        }
        game.board[idx] = game.turn;
        game.moveCount = (game.moveCount || 0) + 1;
        if (game.idleTimer) { clearTimeout(game.idleTimer); game.idleTimer = null; }
        if (msg) {
            const fresh = await tttResolveLabel(sock, phoneNumber, who, msg);
            if (fresh && fresh !== 'player') game[slot + 'Label'] = fresh;
            const more = tttCollectIds(sock, phoneNumber, who, msg);
            game[slot + 'Ids'] = [...new Set([...(game[slot + 'Ids'] || []), ...more])];
        }
        const win = tttWinner(game.board);
        if (win) {
            game.status = 'done';
            tttClearTimer(game);
            await tttPaint(sock, phoneNumber, game, { rematch: true });
            return;
        }
        game.turn = game.turn === 'X' ? 'O' : 'X';
        await tttPaint(sock, phoneNumber, game);
        tttArmTimer(sock, phoneNumber, game);
        if (game.vsBot) await tttPlayBot(sock, phoneNumber, game);
    }

    async function tttOfferChallenge(sock, phoneNumber, chatJid, challenger, target) {
        if (tttSamePlayer(challenger, target)) {
            await sock.sendMessage(chatJid, { text: '❌ You cannot duel your own shadow.' });
            return;
        }
        const prev = getTttGame(phoneNumber, chatJid);
        if (prev && (prev.status === 'active' || prev.status === 'pending')) {
            await sock.sendMessage(chatJid, { text: '❌ An arena is already open here. *.ttt quit* to fold it.' });
            return;
        }
        const xLabel = await tttResolveLabel(sock, phoneNumber, challenger, null);
        const oLabel = await tttResolveLabel(sock, phoneNumber, target, null);
        const game = {
            chatJid, x: challenger, o: target, vsBot: false, difficulty: '',
            xLabel, oLabel,
            xIds: tttCollectIds(sock, phoneNumber, challenger, null),
            oIds: tttCollectIds(sock, phoneNumber, target, null),
            board: Array(9).fill(null), turn: 'X', status: 'pending',
            boardKey: null, pollKey: null, timer: null, idleTimer: null,
            moveCount: 0, openSeat: false, startedAt: Date.now()
        };
        tttGames.set(tttKey(phoneNumber, chatJid), game);
        const card = buildOmegaTerminal(
            `   ░▒▓█ *ARENA_CHALLENGE* █▓▒░\n\n` +
            `   ✦ *HOST* :: ${xLabel}  ❌\n` +
            `   ✦ *INVITED* :: ${oLabel}  ⭕\n\n` +
            `   Only ${oLabel} can sit.\n` +
            `   3 minutes to accept.`
        );
        await sock.sendMessage(chatJid, { text: card, mentions: [target, challenger].filter(j => j && j !== 'BOT') });
        const poll = await sendMenuPoll(sock, chatJid, phoneNumber, 'DUEL', ['Accept', 'Decline'], ['ttt_yes', 'ttt_no']);
        game.pollKey = poll?.key || null;
        tttArmDeadGame(sock, phoneNumber, game, 3 * 60 * 1000);
    }

    async function tttOpenLobby(sock, phoneNumber, chatJid, host) {
        const prev = getTttGame(phoneNumber, chatJid);
        if (prev && (prev.status === 'active' || prev.status === 'pending')) {
            await sock.sendMessage(chatJid, { text: '❌ An arena is already open here. *.ttt quit* to fold it.' });
            return;
        }
        const xLabel = await tttResolveLabel(sock, phoneNumber, host, null);
        const game = {
            chatJid, x: host, o: null, vsBot: false, difficulty: '',
            xLabel, oLabel: 'open',
            xIds: tttCollectIds(sock, phoneNumber, host, null),
            oIds: [],
            board: Array(9).fill(null), turn: 'X', status: 'pending',
            boardKey: null, pollKey: null, timer: null, idleTimer: null,
            moveCount: 0, openSeat: true, startedAt: Date.now()
        };
        tttGames.set(tttKey(phoneNumber, chatJid), game);
        await sock.sendMessage(chatJid, {
            text: buildOmegaTerminal(
                `   ░▒▓█ *OPEN SEAT* █▓▒░\n\n` +
                `   ✦ *HOST* :: ${xLabel}  ❌\n` +
                `   ✦ *SEAT* :: first soul who claims ⭕\n\n` +
                `   Anyone can sit. First Accept wins.\n` +
                `   3 minutes or the chair vanishes.`
            ),
            mentions: host && host !== 'BOT' ? [host] : []
        });
        const poll = await sendMenuPoll(sock, chatJid, phoneNumber, 'OPEN SEAT', ['Claim seat', 'Cancel (host)'], ['ttt_yes', 'ttt_no']);
        game.pollKey = poll?.key || null;
        tttArmDeadGame(sock, phoneNumber, game, 3 * 60 * 1000);
    }

    return Object.freeze({
        TTT_WINS,
        TTT_LABELS,
        tttKey,
        tttSamePlayer,
        tttOwnerPn,
        tttJidDigits,
        tttIsLid,
        tttIsOwnerJid,
        tttPnFromMsg,
        tttCollectIds,
        tttResolveLabel,
        tttPlayerMatches,
        tttName,
        tttShort,
        tttWinner,
        tttMinimax,
        tttBotMove,
        renderTttBoard,
        getTttGame,
        tttClearTimer,
        tttDeletePoll,
        tttDeleteVotedPoll,
        tttIsReplyToBoard,
        tttPaint,
        tttArmTimer,
        tttArmDeadGame,
        tttStart,
        tttPlayBot,
        tttTryMove,
        tttOfferChallenge,
        tttOpenLobby
    });
}
