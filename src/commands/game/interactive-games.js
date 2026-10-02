/**
 * Interactive native-flow games (WhatsApp buttons & menus).
 *
 * Replaces the legacy poll-based games (hangman/word-chain/trivia/riddle).
 * Instead of "reply to this poll to play", games are WhatsApp-native
 * interactive messages: a card with a header/body/footer, a single_select
 * dropdown (each row's id is a command the phone sends back on tap) and
 * quick_reply buttons — plus the biz/interactive native_flow framing nodes
 * WhatsApp needs to actually render the card.
 *
 * Commands:
 *   .games / .gamehub — the hub card (dropdown menu + quick replies)
 *   .rps [move]       — rock-paper-scissors; no arg = button picker,
 *                       with arg = instant round vs the bot
 *   .roll / .dice     — dice roll
 */
import crypto from 'crypto';

const MOVES = ['rock', 'paper', 'scissors'];
const EMOJI = { rock: '🪨', paper: '📄', scissors: '✂️' };

export function createInteractiveGamesCommands(deps) {
    const {
        generateWAMessageFromContent,
        generateMessageID,
        jidNormalizedUser,
        buildOmegaTerminal,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        generateWAMessageFromContent,
        generateMessageID,
        jidNormalizedUser,
        buildOmegaTerminal,
        log,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Interactive games commands require ${name}`);
        }
    }

    // ── core sender: interactiveMessage + native_flow framing ──────────────
    // This is the exact envelope WhatsApp clients render as a card with
    // buttons: interactiveMessage content via generateWAMessageFromContent,
    // relayed with the biz/interactive additionalNodes (native_flow v9
    // "mixed"). Without those nodes the card is silently not rendered.
    async function sendInteractiveCard(sock, remoteJid, userJid, interactive) {
        const msg = generateWAMessageFromContent(
            remoteJid,
            { interactiveMessage: interactive },
            { userJid, messageId: generateMessageID() }
        );
        await sock.relayMessage(
            remoteJid,
            msg.message,
            {
                messageId: msg.key.id,
                additionalNodes: [
                    {
                        tag: 'biz',
                        attrs: {},
                        content: [
                            {
                                tag: 'interactive',
                                attrs: { type: 'native_flow', v: '1' },
                                content: [
                                    { tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }
                                ]
                            }
                        ]
                    }
                ]
            }
        );
        return msg;
    }

    async function reactTo(sock, key, emoji) {
        try {
            if (key) await sock.sendMessage(key.remoteJid || undefined, { react: { text: emoji, key } });
        } catch (_) {}
    }

    // ── .games — the hub card ───────────────────────────────────────────────
    async function sendGamesHub(sock, remoteJid, userJid) {
        return sendInteractiveCard(sock, remoteJid, userJid, {
            header: { title: 'EVENTIDE • GAME CENTER', hasMediaAttachment: false },
            body: {
                text: '🎮 Pick your poison.\n\nTic-tac-toe — the poll arena.\nRPS — instant rock · paper · scissors.\nDice — let fate decide.\n\nTap a menu row or a button below.'
            },
            footer: { text: 'eventide omega • games' },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: 'single_select',
                        buttonParamsJson: JSON.stringify({
                            title: '🎮 Game Center',
                            sections: [
                                {
                                    title: 'Pick a game',
                                    rows: [
                                        {
                                            header: 'Arena',
                                            title: 'Tic-Tac-Toe',
                                            description: 'Challenge someone — poll-based arena',
                                            id: '.ttt'
                                        },
                                        {
                                            header: 'Instant',
                                            title: 'Rock Paper Scissors',
                                            description: 'Best of one vs the bot',
                                            id: '.rps'
                                        },
                                        {
                                            header: 'Instant',
                                            title: 'Roll Dice',
                                            description: '1–6, fate decides',
                                            id: '.roll'
                                        }
                                    ]
                                }
                            ]
                        })
                    },
                    {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({ display_text: '✊ Rock', id: '.rps rock' })
                    },
                    {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({ display_text: '📄 Paper', id: '.rps paper' })
                    },
                    {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({ display_text: '✂️ Scissors', id: '.rps scissors' })
                    }
                ]
            }
        });
    }

    // ── .rps — rock paper scissors ─────────────────────────────────────────
    function rpsOutcome(user, bot) {
        if (user === bot) return 'draw';
        const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
        return beats[user] === bot ? 'win' : 'lose';
    }

    const RPS_TEXT = {
        win: '✅ *YOU WIN* — the void bows.',
        lose: '💀 *YOU LOSE* — the void grins.',
        draw: '🤝 *DRAW* — the void nods.'
    };

    async function sendRpsPicker(sock, remoteJid, userJid) {
        return sendInteractiveCard(sock, remoteJid, userJid, {
            header: { title: 'ROCK · PAPER · SCISSORS', hasMediaAttachment: false },
            body: { text: '✊ 📄 ✂️\n\nPick your move — the void already chose.' },
            footer: { text: 'eventide omega • rps' },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: 'single_select',
                        buttonParamsJson: JSON.stringify({
                            title: 'Your move',
                            sections: [
                                {
                                    title: 'Moves',
                                    rows: MOVES.map((move) => ({
                                        header: move.toUpperCase(),
                                        title: `${EMOJI[move]} ${move}`,
                                        description: `Play ${move}`,
                                        id: `.rps ${move}`
                                    }))
                                }
                            ]
                        })
                    },
                    ...MOVES.map((move) => ({
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({ display_text: `${EMOJI[move]} ${move}`, id: `.rps ${move}` })
                    }))
                ]
            }
        });
    }

    // ── commands ────────────────────────────────────────────────────────────
    return Object.freeze([
        {
            name: 'games',
            aliases: ['gamehub'],
            async execute(context) {
                const { sock, remoteJid, senderJid, message } = context;
                try {
                    const userJid = jidNormalizedUser(senderJid || sock.user?.id);
                    await sendGamesHub(sock, remoteJid, userJid);
                    await reactTo(sock, message?.key, '🎮');
                } catch (err) {
                    logError('GAMES', 'games hub failed', err);
                    await sock.sendMessage(remoteJid, { text: `❌ Game hub failed: ${String(err?.message || err)}` }).catch(() => {});
                }
            }
        },
        {
            name: 'rps',
            async execute(context) {
                const { sock, remoteJid, senderJid, args, message } = context;
                try {
                    const userJid = jidNormalizedUser(senderJid || sock.user?.id);
                    const move = String(args[0] || '').toLowerCase().trim();
                    if (!MOVES.includes(move)) {
                        await sendRpsPicker(sock, remoteJid, userJid);
                        await reactTo(sock, message?.key, '✂️');
                        return;
                    }
                    const botMove = MOVES[crypto.randomInt(MOVES.length)];
                    const outcome = rpsOutcome(move, botMove);
                    await sendInteractiveCard(sock, remoteJid, userJid, {
                        header: { title: 'RPS — RESULT', hasMediaAttachment: false },
                        body: {
                            text:
                                `you  :: ${EMOJI[move]} ${move}\n` +
                                `void :: ${EMOJI[botMove]} ${botMove}\n\n` +
                                RPS_TEXT[outcome]
                        },
                        footer: { text: 'eventide omega • rps' },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: 'quick_reply',
                                    buttonParamsJson: JSON.stringify({ display_text: '🔁 Play again', id: '.rps' })
                                },
                                {
                                    name: 'quick_reply',
                                    buttonParamsJson: JSON.stringify({ display_text: '🎮 Game hub', id: '.games' })
                                }
                            ]
                        }
                    });
                    await reactTo(sock, message?.key, outcome === 'win' ? '🏆' : outcome === 'lose' ? '💀' : '🤝');
                } catch (err) {
                    logError('GAMES', 'rps failed', err);
                    await sock.sendMessage(remoteJid, { text: `❌ RPS failed: ${String(err?.message || err)}` }).catch(() => {});
                }
            }
        },
        {
            name: 'roll',
            aliases: ['dice'],
            async execute(context) {
                const { sock, remoteJid } = context;
                try {
                    const n = crypto.randomInt(1, 7);
                    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
                    await sock.sendMessage(remoteJid, {
                        text: buildOmegaTerminal(`   🎲 *THE VOID ROLLS*\n\n   ${faces[n - 1]}  ⟶  *${n}*`)
                    });
                } catch (err) {
                    logError('GAMES', 'roll failed', err);
                    await sock.sendMessage(remoteJid, { text: `❌ Roll failed: ${String(err?.message || err)}` }).catch(() => {});
                }
            }
        }
    ]);
}
