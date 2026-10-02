import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractiveGamesCommands } from '../src/commands/game/interactive-games.js';

function makeHarness() {
    const relays = [];
    const sends = [];
    const errors = [];
    const sock = {
        user: { id: 'bot@s.whatsapp.net' },
        relayMessage: async (jid, message, opts) => { relays.push({ jid, message, opts }); },
        sendMessage: async (jid, content) => {
            sends.push({ jid, content });
            return { key: { id: 'SM' } };
        }
    };
    const commands = createInteractiveGamesCommands({
        generateWAMessageFromContent: (remoteJid, content, opts) => ({
            key: { id: opts.messageId, remoteJid },
            message: content,
            __opts: opts
        }),
        generateMessageID: (() => { let n = 0; return () => `MSG-${++n}`; })(),
        jidNormalizedUser: (jid) => String(jid || '').split(':')[0],
        buildOmegaTerminal: (s) => `term(${s})`,
        log: () => {},
        logError: (...a) => errors.push(a)
    });
    const ctx = (extra = {}) => ({
        sock,
        phoneNumber: '2348012345678',
        remoteJid: 'chat@s.whatsapp.net',
        senderJid: 'player@s.whatsapp.net',
        args: [],
        message: { key: { id: 'TRIG', remoteJid: 'chat@s.whatsapp.net' } },
        ...extra
    });
    return { commands, sock, relays, sends, errors, ctx };
}

const findCommand = (commands, name) => commands.find((c) => c.name === name);

// --- factory ------------------------------------------------------------

test('createInteractiveGamesCommands validates its dependencies', () => {
    const good = {
        generateWAMessageFromContent: () => ({}), generateMessageID: () => 'x',
        jidNormalizedUser: () => '', buildOmegaTerminal: () => '', log: () => {}, logError: () => {}
    };
    for (const key of Object.keys(good)) {
        const broken = { ...good };
        delete broken[key];
        assert.throws(() => createInteractiveGamesCommands(broken), new RegExp(key));
    }
});

test('exposes games, rps and roll commands', () => {
    const { commands } = makeHarness();
    assert.deepEqual(commands.map((c) => c.name).sort(), ['games', 'roll', 'rps']);
    assert.deepEqual(findCommand(commands, 'games').aliases, ['gamehub']);
    assert.deepEqual(findCommand(commands, 'roll').aliases, ['dice']);
    assert.ok(Object.isFrozen(commands));
});

// --- native-flow framing (the part that makes cards render) ------------------

test('.games relays an interactiveMessage with the biz/native_flow framing nodes', async () => {
    const { commands, relays, ctx } = makeHarness();
    await findCommand(commands, 'games').execute(ctx());

    assert.equal(relays.length, 1);
    const { jid, message, opts } = relays[0];
    assert.equal(jid, 'chat@s.whatsapp.net');
    assert.ok(message.interactiveMessage, 'content is an interactiveMessage');
    assert.ok(message.interactiveMessage.nativeFlowMessage.buttons.length >= 3);

    // the exact additionalNodes framing from the Kord-V2 pattern
    const biz = opts.additionalNodes[0];
    assert.equal(biz.tag, 'biz');
    const interactive = biz.content[0];
    assert.equal(interactive.tag, 'interactive');
    assert.deepEqual(interactive.attrs, { type: 'native_flow', v: '1' });
    const flow = interactive.content[0];
    assert.equal(flow.tag, 'native_flow');
    assert.deepEqual(flow.attrs, { v: '9', name: 'mixed' });
    assert.equal(opts.messageId, 'MSG-1');
});

test('.games menu rows carry command ids the phone sends back on tap', async () => {
    const { commands, relays, ctx } = makeHarness();
    await findCommand(commands, 'games').execute(ctx());
    const buttons = relays[0].message.interactiveMessage.nativeFlowMessage.buttons;
    const select = buttons.find((b) => b.name === 'single_select');
    const params = JSON.parse(select.buttonParamsJson);
    const ids = params.sections[0].rows.map((r) => r.id);
    assert.deepEqual(ids, ['.ttt', '.rps', '.roll']);
    const quick = buttons.filter((b) => b.name === 'quick_reply').map((b) => JSON.parse(b.buttonParamsJson).id);
    assert.deepEqual(quick, ['.rps rock', '.rps paper', '.rps scissors']);
});

// --- rps -----------------------------------------------------------------------

test('.rps without a move sends the button picker', async () => {
    const { commands, relays, ctx } = makeHarness();
    await findCommand(commands, 'rps').execute(ctx());
    assert.equal(relays.length, 1);
    const buttons = relays[0].message.interactiveMessage.nativeFlowMessage.buttons;
    const ids = buttons
        .filter((b) => b.name === 'quick_reply')
        .map((b) => JSON.parse(b.buttonParamsJson).id);
    assert.deepEqual(ids, ['.rps rock', '.rps paper', '.rps scissors']);
});

test('.rps <move> plays a round and the result card offers a rematch', async () => {
    for (const userMove of ['rock', 'paper', 'scissors']) {
        const { commands, relays, ctx } = makeHarness();
        await findCommand(commands, 'rps').execute(ctx({ args: [userMove] }));
        assert.equal(relays.length, 1, `${userMove}: result card relayed`);
        const body = relays[0].message.interactiveMessage.body.text;
        assert.ok(body.includes(userMove), `${userMove}: body shows the user move`);
        // extract the bot's move and verify the outcome logic
        const botMatch = /void :: \S+ (rock|paper|scissors)/.exec(body);
        assert.ok(botMatch, `${userMove}: body shows the bot move`);
        const botMove = botMatch[1];
        const expected = userMove === botMove ? 'DRAW'
            : ({ rock: 'scissors', paper: 'rock', scissors: 'paper' }[userMove] === botMove ? 'YOU WIN' : 'YOU LOSE');
        assert.ok(body.includes(expected), `${userMove} vs ${botMove}: expects ${expected}`);
        const quickIds = relays[0].message.interactiveMessage.nativeFlowMessage.buttons
            .filter((b) => b.name === 'quick_reply')
            .map((b) => JSON.parse(b.buttonParamsJson).id);
        assert.deepEqual(quickIds, ['.rps', '.games']);
    }
});

test('.rps invalid input falls back to the picker, errors are caught', async () => {
    const { commands, relays, errors, ctx } = makeHarness();
    await findCommand(commands, 'rps').execute(ctx({ args: ['banana'] }));
    assert.equal(relays.length, 1); // picker, not an error

    const broken = makeHarness();
    broken.sock.relayMessage = async () => { throw new Error('relay down'); };
    await findCommand(broken.commands, 'rps').execute(broken.ctx({ args: ['rock'] }));
    assert.equal(broken.errors.length, 1);
    assert.ok(broken.sends.some((s) => String(s.content.text).includes('RPS failed')));
});

// --- roll ------------------------------------------------------------------------

test('.roll returns a dice face and number between 1 and 6', async () => {
    const { commands, sends, ctx } = makeHarness();
    for (let i = 0; i < 20; i++) {
        sends.length = 0;
        await findCommand(commands, 'roll').execute(ctx());
        const m = /⟶\s+\*(\d)\*/.exec(sends[0].content.text);
        assert.ok(m, 'roll text contains the number');
        const n = Number(m[1]);
        assert.ok(n >= 1 && n <= 6, `roll in range: ${n}`);
    }
});
