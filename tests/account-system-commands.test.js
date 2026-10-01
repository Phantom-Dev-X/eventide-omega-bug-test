import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';
import { createAccountSystemCommands } from '../src/commands/system/account.js';

function createFixture({ dev = false, groupError = null } = {}) {
    const replies = [];
    const errors = [];
    const sock = {
        user: { id: '2348000000001:1@s.whatsapp.net' },
        groupFetchAllParticipating: async () => {
            if (groupError) throw groupError;
            return {
                one: { subject: 'First Group' },
                two: { subject: 'Second Group' },
                hidden: { subject: '' }
            };
        },
        profilePictureUrl: async () => 'https://example.test/profile.jpg',
        fetchStatus: async () => [{ status: 'Into the void' }]
    };
    const registry = createCommandRegistry(createAccountSystemCommands({
        safeWaReply: async (_sock, jid, text, message) => replies.push({ jid, text, message }),
        buildOmegaTerminal: text => `terminal:${text}`,
        normalizeJid: jid => String(jid).replace(/:\d+@/, '@'),
        isDevNumber: () => dev,
        logError: (...args) => errors.push(args),
        environment: { DEV_NUMBERS: '2348999999999,2348888888888' }
    }));
    const message = { key: { id: 'command-message' } };
    const context = {
        sock,
        remoteJid: 'chat@s.whatsapp.net',
        message,
        phoneNumber: '2348000000001',
        senderJid: 'sender@s.whatsapp.net',
        isSenderOwner: false,
        botConfig: { name: 'Omega', bio: 'Fallback bio' }
    };
    return { registry, replies, errors, sock, context };
}

test('developer contact aliases preserve the configured primary number', async () => {
    const fixture = createFixture();

    await fixture.registry.execute('.devcontact', fixture.context);

    assert.match(fixture.replies[0].text, /THE ARCHITECT/);
    assert.match(fixture.replies[0].text, /wa\.me\/2348999999999/);
});

test('listgc returns participating group names and count', async () => {
    const fixture = createFixture();

    await fixture.registry.execute('.listgc', fixture.context);

    assert.match(fixture.replies[0].text, /DOMINIONS/);
    assert.match(fixture.replies[0].text, /COUNT.*2/);
    assert.match(fixture.replies[0].text, /First Group/);
    assert.match(fixture.replies[0].text, /Second Group/);
});

test('listgc reports fetch failures without throwing out of dispatch', async () => {
    const fixture = createFixture({ groupError: new Error('network unavailable') });

    await fixture.registry.execute('.listgc', fixture.context);

    assert.equal(fixture.errors.length, 1);
    assert.match(fixture.replies[0].text, /Could not fetch groups/);
    assert.match(fixture.replies[0].text, /network unavailable/);
});

test('profile remains restricted to owner or developer', async () => {
    const fixture = createFixture();

    await fixture.registry.execute('.profile', fixture.context);

    assert.equal(fixture.replies[0].text, '❌ Owner/Dev only.');
});

test('authorized profile reports account picture, name, and bio', async () => {
    const fixture = createFixture({ dev: true });

    await fixture.registry.execute('.profile', fixture.context);

    assert.match(fixture.replies[0].text, /VESSEL_IDENTITY/);
    assert.match(fixture.replies[0].text, /NUMBER.*2348000000001/);
    assert.match(fixture.replies[0].text, /NAME.*Omega/);
    assert.match(fixture.replies[0].text, /PP.*set/);
    assert.match(fixture.replies[0].text, /BIO.*Into the void/);
});

test('account command group exposes three primary commands and developer aliases', () => {
    const fixture = createFixture();

    assert.deepEqual(fixture.registry.list(), ['.dev', '.listgc', '.profile']);
    assert.equal(fixture.registry.has('.devnumber'), true);
    assert.equal(fixture.registry.has('.devcontact'), true);
});
