/**
 * Premium tic-tac-toe arena command lifecycle.
 *
 * Board mechanics remain in the shared game service; this module owns command
 * routing, challenge lifecycle, and setup-poll orchestration.
 */
export function createTicTacToeCommands(deps) {
    const {
        getTttGame,
        tttSamePlayer,
        tttClearTimer,
        tttDeletePoll,
        tttPaint,
        tttArmTimer,
        tttGames,
        tttKey,
        buildOmegaTerminal,
        tttIsReplyToBoard,
        tttTryMove,
        resolveTargetJid,
        tttOfferChallenge,
        tttStart,
        tttResolveLabel,
        tttCollectIds,
        tttSetupSessions,
        sendMenuPoll,
        logError,
        safeWaReply
    } = deps || {};

    for (const [name, value] of Object.entries({
        getTttGame,
        tttSamePlayer,
        tttClearTimer,
        tttDeletePoll,
        tttPaint,
        tttArmTimer,
        tttKey,
        buildOmegaTerminal,
        tttIsReplyToBoard,
        tttTryMove,
        resolveTargetJid,
        tttOfferChallenge,
        tttStart,
        tttResolveLabel,
        tttCollectIds,
        sendMenuPoll,
        logError,
        safeWaReply
    })) {
        if (typeof value !== 'function') throw new Error(`Tic-tac-toe commands require ${name}()`);
    }
    for (const [name, value] of Object.entries({ tttGames, tttSetupSessions })) {
        if (!value || typeof value.get !== 'function' || typeof value.set !== 'function' || typeof value.delete !== 'function') {
            throw new Error(`Tic-tac-toe commands require ${name}`);
        }
    }

    return Object.freeze([
        {
            name: 'tictactoe',
            aliases: ['ttt', 'xo'],
            async execute(context) {
                const { sock, phoneNumber, remoteJid, senderJid, args, message } = context;
                try {
                    const subcommand = (args[0] || '').toLowerCase();
                    const liveGame = getTttGame(phoneNumber, remoteJid);

                    if (subcommand === 'yes' || subcommand === 'accept') {
                        const game = getTttGame(phoneNumber, remoteJid);
                        if (!game || game.status !== 'pending') {
                            await sock.sendMessage(remoteJid, { text: '❌ No pending challenge.' });
                            return;
                        }
                        if (!tttSamePlayer(senderJid, game.o) && !context.isSenderOwner) {
                            await sock.sendMessage(remoteJid, { text: '❌ Only the challenged soul may accept.' });
                            return;
                        }
                        game.status = 'active';
                        tttClearTimer(game);
                        game.boardKey = null;
                        await tttDeletePoll(sock, game);
                        await tttPaint(sock, phoneNumber, game);
                        tttArmTimer(sock, phoneNumber, game);
                        return;
                    }

                    if (subcommand === 'no' || subcommand === 'decline') {
                        const game = getTttGame(phoneNumber, remoteJid);
                        if (game && game.status === 'pending') {
                            tttClearTimer(game);
                            await tttDeletePoll(sock, game);
                            tttGames.delete(tttKey(phoneNumber, remoteJid));
                            await sock.sendMessage(remoteJid, {
                                text: '🕊 Challenge declined. The grid sleeps.'
                            });
                        }
                        return;
                    }

                    if (['quit', 'end', 'stop', 'close'].includes(subcommand)) {
                        if (liveGame) {
                            tttClearTimer(liveGame);
                            await tttDeletePoll(sock, liveGame);
                            tttGames.delete(tttKey(phoneNumber, remoteJid));
                        }
                        await sock.sendMessage(remoteJid, {
                            text: buildOmegaTerminal(
                                `   ✦ *ARENA_CLOSED*\n\n   " You folded the grid. "`
                            )
                        });
                        return;
                    }

                    if (subcommand === 'board' || subcommand === 'show') {
                        if (!liveGame) {
                            await sock.sendMessage(remoteJid, {
                                text: '❌ No live arena. *.ttt* to open one.'
                            });
                            return;
                        }
                        liveGame.boardKey = null;
                        await tttPaint(sock, phoneNumber, liveGame);
                        return;
                    }

                    if (liveGame && liveGame.status === 'active' && /^[1-9]$/.test(subcommand)) {
                        if (!tttIsReplyToBoard(message, liveGame)) {
                            await sock.sendMessage(remoteJid, {
                                text: '↪ Reply to the *board* with the number. A loose 5 in chat is just chat.'
                            });
                            return;
                        }
                        await tttTryMove(
                            sock,
                            phoneNumber,
                            remoteJid,
                            senderJid,
                            parseInt(subcommand, 10) - 1,
                            message
                        );
                        return;
                    }

                    if (liveGame && liveGame.status === 'active') {
                        await sock.sendMessage(remoteJid, {
                            text: buildOmegaTerminal(
                                `   ░▒▓█ *ARENA_LIVE* █▓▒░\n\n` +
                                `   A grid is already breathing here.\n` +
                                `   *Reply to the board* with 1–9.\n` +
                                `   *.ttt quit*  folds it.\n` +
                                `   *.ttt board*  redraws it.`
                            )
                        });
                        return;
                    }

                    const rival = resolveTargetJid(message, args);
                    if (rival) {
                        await tttOfferChallenge(sock, phoneNumber, remoteJid, senderJid, rival);
                        return;
                    }

                    if (['bot', 'easy', 'medium', 'hard', 'void'].includes(subcommand)) {
                        const difficulty = ['easy', 'medium', 'hard'].includes(subcommand)
                            ? subcommand
                            : 'medium';
                        await tttStart(sock, phoneNumber, remoteJid, {
                            x: senderJid,
                            o: 'BOT',
                            vsBot: true,
                            difficulty,
                            xLabel: await tttResolveLabel(sock, phoneNumber, senderJid, message),
                            oLabel: 'VOID',
                            xIds: tttCollectIds(sock, phoneNumber, senderJid, message)
                        });
                        return;
                    }

                    tttSetupSessions.set(phoneNumber, {
                        step: 'mode',
                        chat: remoteJid,
                        host: senderJid,
                        hostLabel: await tttResolveLabel(sock, phoneNumber, senderJid, message),
                        hostIds: tttCollectIds(sock, phoneNumber, senderJid, message)
                    });
                    await sock.sendMessage(remoteJid, {
                        text: buildOmegaTerminal(
                            `   ░▒▓█ *EVENTIDE ARENA* █▓▒░\n\n` +
                            `   TIC · TAC · TOE\n\n` +
                            `   Pick a path below.\n` +
                            `   • Void = 3 levels (easy / mid / hard)\n` +
                            `   • Human = first Accept sits\n` +
                            `   • Or *.ttt @user* to invite one soul\n\n` +
                            `   Moves: *reply to the board* with 1–9.\n` +
                            `   1 min a turn · 3 min of silence kills it.`
                        )
                    });
                    const pollMessage = await sendMenuPoll(
                        sock,
                        remoteJid,
                        phoneNumber,
                        'OPEN THE GRID',
                        ['Play vs Bot', 'Play vs Human'],
                        ['ttt_vs_bot', 'ttt_vs_p']
                    );
                    const session = tttSetupSessions.get(phoneNumber) || {};
                    session.modePollKey = pollMessage?.key || null;
                    tttSetupSessions.set(phoneNumber, session);
                } catch (error) {
                    logError('TTT', `${phoneNumber}: .ttt failed`, error);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Arena failed to open.\n${error?.message || error}\n\nTry *.ttt* again.`,
                        message
                    ).catch(() => {});
                }
            }
        }
    ]);
}
