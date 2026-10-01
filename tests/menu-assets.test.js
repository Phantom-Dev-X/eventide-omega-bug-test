import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenuAssets } from '../src/personas/menu-assets.js';

const LINK = 'https://whatsapp.com/channel/0029VbCrFiK17En02cax3r02';

function makeEngine(overrides = {}) {
    return { engine: createMenuAssets({ groupChannelLink: LINK, ...overrides }) };
}

// --- constructor guards ---------------------------------------------------

test('createMenuAssets throws when groupChannelLink is missing, empty, or not a string', () => {
    assert.throws(() => createMenuAssets({}), /groupChannelLink/);
    assert.throws(() => createMenuAssets({ groupChannelLink: '' }), /groupChannelLink/);
    assert.throws(() => createMenuAssets({ groupChannelLink: 42 }), /groupChannelLink/);
});

test('returned interface is frozen', () => {
    const { engine } = makeEngine();
    assert.ok(Object.isFrozen(engine));
});

// --- TERMINAL_HEADER --------------------------------------------------------

test('TERMINAL_HEADER is the EVENTIDE OMEGA terminal banner', () => {
    const { engine } = makeEngine();
    assert.ok(engine.TERMINAL_HEADER.includes('EVENTIDE OMEGA'));
    assert.ok(engine.TERMINAL_HEADER.includes('TERMINAL ACCESS'));
    assert.ok(engine.TERMINAL_HEADER.endsWith('\n\n'));
});

// --- channel preview ---------------------------------------------------------

test('attachChannelPreview attaches the embedded preview only when the text carries the channel link', () => {
    const { engine } = makeEngine();
    const withLink = { text: `follow ${LINK} for updates` };
    const patched = engine.attachChannelPreview(withLink);
    assert.equal(patched, withLink);
    assert.ok(patched.linkPreview);
    assert.equal(patched.linkPreview['matched-text'].includes('whatsapp.com/channel/'), true);
    assert.ok(Buffer.isBuffer(patched.linkPreview.jpegThumbnail));
    assert.ok(patched.linkPreview.jpegThumbnail.length > 100);

    const withoutLink = { text: 'nothing to see here' };
    assert.equal(engine.attachChannelPreview(withoutLink), withoutLink);
    assert.equal(withoutLink.linkPreview, undefined);

    assert.equal(engine.attachChannelPreview(null), null);
    assert.deepEqual(engine.attachChannelPreview({}), {});
});

test('channelContextInfo builds the externalAdReply card pointing at the channel', () => {
    const { engine } = makeEngine();
    const ctx = engine.channelContextInfo();
    assert.equal(ctx.externalAdReply.sourceUrl, LINK);
    assert.ok(ctx.externalAdReply.title.length > 0);
    assert.ok(ctx.externalAdReply.body.length > 0);
    assert.ok(Buffer.isBuffer(ctx.externalAdReply.thumbnail));
    assert.equal(ctx.externalAdReply.mediaType, 1);
    assert.equal(ctx.externalAdReply.renderLargerThumbnail, true);
    assert.equal(ctx.externalAdReply.showAdAttribution, false);
});

// --- poll definitions ----------------------------------------------------------

test('persona poll constants define the Eclipse/Ruin choice', () => {
    const { engine } = makeEngine();
    assert.ok(engine.PERSONA_POLL_QUESTION.includes('EVENTIDE OMEGA'));
    assert.ok(engine.PERSONA_POLL_QUESTION.includes('CHOOSE PERSONA'));
    assert.ok(Array.isArray(engine.PERSONA_POLL_OPTIONS));
    assert.equal(engine.PERSONA_POLL_OPTIONS.length, 2);
    assert.deepEqual(engine.PERSONA_POLL_IDS, ['persona_eclipse', 'persona_ruin']);
});

test('help-persona poll constants define the help AI choice', () => {
    const { engine } = makeEngine();
    assert.ok(engine.HELP_PERSONA_POLL_QUESTION.includes('CHOOSE HELP AI'));
    assert.equal(engine.HELP_PERSONA_POLL_OPTIONS.length, 2);
    assert.deepEqual(engine.HELP_PERSONA_POLL_IDS, ['helpp_eclipse', 'helpp_ruin']);
});

test('domain poll constants define the system/config domains', () => {
    const { engine } = makeEngine();
    assert.ok(engine.DOMAIN_POLL_QUESTION.includes('CHOOSE YOUR DOMAIN'));
    assert.equal(engine.DOMAIN_POLL_OPTIONS.length, 2);
    assert.deepEqual(engine.DOMAIN_POLL_IDS, ['system', 'config']);
});

// --- menu texts -------------------------------------------------------------------

test('every menu text leads with the channel link and the EVENTIDE OMEGA banner', () => {
    const { engine } = makeEngine();
    const texts = [
        engine.OWNERS_WELCOME_TEXT,
        engine.GROUP_MENU_TEXT,
        engine.SYSTEM_MENU_TEXT,
        engine.CONFIG_MENU_TEXT,
        engine.FUN_PLACEHOLDER_TEXT,
        engine.BUG_PLACEHOLDER_TEXT
    ];
    for (const text of texts) {
        assert.ok(text.startsWith(LINK), `starts with channel link: ${text.slice(0, 40)}...`);
        assert.ok(text.includes('EVENTIDE OMEGA'));
        assert.ok(text.length > 200);
    }
});

test('menu texts are distinct and non-trivial', () => {
    const { engine } = makeEngine();
    const texts = new Set([
        engine.OWNERS_WELCOME_TEXT,
        engine.GROUP_MENU_TEXT,
        engine.SYSTEM_MENU_TEXT,
        engine.CONFIG_MENU_TEXT,
        engine.FUN_PLACEHOLDER_TEXT,
        engine.BUG_PLACEHOLDER_TEXT
    ]);
    assert.equal(texts.size, 6);
    assert.ok(engine.OWNERS_WELCOME_TEXT.length > 500);
});
