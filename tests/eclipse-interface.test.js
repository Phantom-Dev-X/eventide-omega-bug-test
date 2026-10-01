import test from 'node:test';
import assert from 'node:assert/strict';

import { createEclipseInterface } from '../src/personas/eclipse-interface.js';

function createFixture(overrides = {}) {
    const sent = [];
    const logs = [];
    const errorLogs = [];
    const delays = [];
    const pollCalls = [];

    const sock = {
        async sendMessage(jid, payload) {
            sent.push({ jid, payload });
            return { key: { id: `msg-${sent.length}`, remoteJid: jid } };
        }
    };

    const eclipse = createEclipseInterface({
        groupChannelLink: 'https://whatsapp.com/channel/fake-link',
        menuBannerPath: '/tmp/fake-banner.png',
        delay: async ms => { delays.push(ms); },
        sendMenuPoll: async (s, remoteJid, phoneNumber, question, options, ids) => {
            pollCalls.push({ remoteJid, phoneNumber, question, options, ids });
        },
        log: (...args) => logs.push(args),
        logError: (...args) => errorLogs.push(args),
        ...overrides
    });

    return { eclipse, sock, sent, logs, errorLogs, delays, pollCalls };
}

test('constructor requires every function dependency', () => {
    assert.throws(
        () => createEclipseInterface({ groupChannelLink: 'x', menuBannerPath: 'y' }),
        /require/
    );
});

test('constructor requires groupChannelLink', () => {
    assert.throws(
        () => createEclipseInterface({
            menuBannerPath: 'y',
            delay: async () => {},
            sendMenuPoll: async () => {},
            log: () => {},
            logError: () => {}
        }),
        /groupChannelLink/
    );
});

test('constructor requires menuBannerPath', () => {
    assert.throws(
        () => createEclipseInterface({
            groupChannelLink: 'x',
            delay: async () => {},
            sendMenuPoll: async () => {},
            log: () => {},
            logError: () => {}
        }),
        /menuBannerPath/
    );
});

test('generateLoadingFrame renders percent, bar fill, and status glyphs', () => {
    const { eclipse } = createFixture();
    const frame = eclipse.generateLoadingFrame({
        percent: 50, bar: 6, text: '◑ collapsing quantum states', core: '✔', cipher: '◌', void: '◌'
    });
    assert.match(frame, /50%/);
    assert.match(frame, /▰{6}▱{6}/);
    assert.match(frame, /◑ collapsing quantum states/);
    assert.match(frame, /✔ core    ◌ cipher    ◌ void/);
});

test('POLL_QUESTION/POLL_OPTIONS/MENU_POLL_IDS stay aligned (Owners/Group/Fun/Bug)', () => {
    const { eclipse } = createFixture();
    assert.equal(eclipse.POLL_OPTIONS.length, eclipse.MENU_POLL_IDS.length);
    assert.deepEqual(eclipse.MENU_POLL_IDS, ['owners', 'group', 'fun', 'bug']);
    assert.match(eclipse.POLL_OPTIONS[0], /OWNERS MENU/);
    assert.match(eclipse.POLL_OPTIONS[1], /GROUP MENU/);
    assert.match(eclipse.POLL_OPTIONS[2], /FUN MENU/);
    assert.match(eclipse.POLL_OPTIONS[3], /BUG MENU/);
    assert.match(eclipse.POLL_QUESTION, /EVENTIDE OMEGA/);
});

test('sendEclipseMenu animates 12 frames, stage texts, banner image, then poll', async () => {
    const { eclipse, sock, sent, delays, pollCalls } = createFixture();
    await eclipse.sendEclipseMenu(sock, '123@s.whatsapp.net', '2348000000001');

    // First message is the initial loading frame (step 1 of 12), the rest are
    // edits to the same message key until stage2/stage3 text + the arrows text.
    const textEdits = sent.filter(m => typeof m.payload.text === 'string' && m.payload.edit);
    // 11 edits (steps 2..12) + stage2 text + arrows text = 13 edits
    assert.equal(textEdits.length, 13);

    const firstMsg = sent[0];
    assert.equal(firstMsg.payload.edit, undefined);
    assert.match(firstMsg.payload.text, /08%/);

    const lastEdit = textEdits[textEdits.length - 1];
    assert.match(lastEdit.payload.text, /gaze below, keeper/);

    // The banner image send (caption carries the full STAGE3_TEXT terminal copy).
    const imageMsg = sent.find(m => m.payload.image);
    assert.ok(imageMsg, 'expected an image message to be sent');
    assert.equal(imageMsg.payload.image.url, '/tmp/fake-banner.png');
    assert.match(imageMsg.payload.caption, /https:\/\/whatsapp\.com\/channel\/fake-link/);
    assert.match(imageMsg.payload.caption, /E C L I P S E/);

    // Poll fired last, with the right ids.
    assert.equal(pollCalls.length, 1);
    assert.deepEqual(pollCalls[0].ids, ['owners', 'group', 'fun', 'bug']);
    assert.equal(pollCalls[0].remoteJid, '123@s.whatsapp.net');
    assert.equal(pollCalls[0].phoneNumber, '2348000000001');

    // Delay sequencing included the animation steps (150ms x11) plus the
    // 400/800/300/400 stage transition delays.
    assert.ok(delays.filter(ms => ms === 150).length === 11);
    assert.ok(delays.includes(400));
    assert.ok(delays.includes(800));
    assert.ok(delays.includes(300));
});

test('sendEclipseMenu logs and swallows errors from sock.sendMessage', async () => {
    const { eclipse, sock, errorLogs } = createFixture();
    sock.sendMessage = async () => { throw new Error('network blip'); };

    await assert.doesNotReject(eclipse.sendEclipseMenu(sock, '123@s.whatsapp.net', '2348000000001'));
    assert.equal(errorLogs.length, 1);
    assert.match(errorLogs[0][0], /WA-CMD/);
});

test('interface is frozen (no accidental mutation of exported surface)', () => {
    const { eclipse } = createFixture();
    assert.throws(() => { eclipse.POLL_QUESTION = 'nope'; }, TypeError);
});
