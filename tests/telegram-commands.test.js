import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramCommandService } from '../src/telegram/commands.js';

function createFixture({ isAdmin = true } = {}) {
    const sent = [];
    const logs = [];
    const errors = [];
    const stateCalls = [];
    const clearCalls = [];
    const pairingCalls = [];
    const deletedSupabase = [];
    const removedPaths = [];
    const delays = [];
    const sockEnds = [];
    const sendMessages = [];
    let pairingError = null;
    let supabaseEnabled = false;
    let storedSessionsCount = 3;

    const telegramUsers = new Map();
    const waSessions = new Map();
    const bugSendsByNumber = new Map();

    const service = createTelegramCommandService({
        authDirRoot: '/auth',
        maxUsers: 10,
        telegramUsers,
        waSessions,
        safeTgSend: async (chatId, text) => { sent.push({ chatId, text }); },
        setTelegramUserState: (chatId, state) => {
            stateCalls.push({ chatId, state });
            telegramUsers.set(chatId, { ...(telegramUsers.get(chatId) || {}), ...state });
        },
        saveUserMap: () => {},
        clearTelegramUser: chatId => { clearCalls.push(chatId); telegramUsers.delete(chatId); },
        initiatePairing: async (chatId, phoneNumber) => {
            pairingCalls.push({ chatId, phoneNumber });
            if (pairingError) throw pairingError;
        },
        requireAdminOrExplain: async chatId => {
            if (isAdmin) return true;
            sent.push({ chatId, text: '⛔ Admins only.' });
            return false;
        },
        countStoredSessions: () => storedSessionsCount,
        formatUptime: seconds => `${Math.round(seconds)}s`,
        isSupabaseEnabled: () => supabaseEnabled,
        deleteSessionFromSupabase: async phoneNumber => { deletedSupabase.push(phoneNumber); },
        loadBugSends: phoneNumber => bugSendsByNumber.get(phoneNumber) || [],
        saveBugSends: (phoneNumber, entries) => { bugSendsByNumber.set(phoneNumber, entries); },
        safeRm: targetPath => { removedPaths.push(targetPath); },
        delay: async ms => { delays.push(ms); },
        trimForLog: (value, max) => String(value).slice(0, max),
        log: (...args) => logs.push(args),
        logError: (...args) => errors.push(args)
    });

    function makeSock(phoneNumber, { groupInvite = null, groupInviteError = null, sendError = null, endError = null } = {}) {
        return {
            user: { id: `${phoneNumber}:1@s.whatsapp.net` },
            async groupGetInviteInfo(code) {
                if (groupInviteError) throw groupInviteError;
                return groupInvite;
            },
            async sendMessage(jid, payload) {
                sendMessages.push({ jid, payload });
                if (sendError) throw sendError;
            },
            async end() {
                sockEnds.push(phoneNumber);
                if (endError) throw endError;
            }
        };
    }

    return {
        service, telegramUsers, waSessions, bugSendsByNumber,
        sent, logs, errors, stateCalls, clearCalls, pairingCalls,
        deletedSupabase, removedPaths, delays, sockEnds, sendMessages,
        makeSock,
        setPairingError(v) { pairingError = v; },
        setSupabaseEnabled(v) { supabaseEnabled = v; },
        setStoredSessionsCount(v) { storedSessionsCount = v; }
    };
}

test('constructor requires every dependency', () => {
    assert.throws(() => createTelegramCommandService({}), /require/);
});

test('register attaches all seven handlers to a bot instance', () => {
    const fixture = createFixture();
    const registered = { onText: [], on: [] };
    const fakeBot = {
        onText: (pattern, cb) => registered.onText.push({ pattern, cb }),
        on: (event, cb) => registered.on.push({ event, cb })
    };
    fixture.service.register(fakeBot);
    assert.equal(registered.onText.length, 6);
    assert.equal(registered.on.length, 1);
    assert.equal(registered.on[0].event, 'message');
});

test('register is a no-op when bot is falsy', () => {
    const fixture = createFixture();
    assert.doesNotThrow(() => fixture.service.register(null));
});

test('/start welcomes a new user', async () => {
    const fixture = createFixture();
    await fixture.service.handleStart({ chat: { id: 1 } });
    assert.match(fixture.sent[0].text, /WhatsApp Multi-Bot/);
});

test('/start shows connected status for an existing connected user', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { status: 'connected', phoneNumber: '234800000001' });
    await fixture.service.handleStart({ chat: { id: 1 } });
    assert.match(fixture.sent[0].text, /Connected!/);
    assert.match(fixture.sent[0].text, /234800000001/);
});

test('/pair rejects when already connected', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { status: 'connected' });
    await fixture.service.handlePair({ chat: { id: 1 } });
    assert.match(fixture.sent[0].text, /already connected/);
    assert.equal(fixture.stateCalls.length, 0);
});

test('/pair rejects when pairing already in progress', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { status: 'waiting_number' });
    await fixture.service.handlePair({ chat: { id: 1 } });
    assert.match(fixture.sent[0].text, /already in progress/);
});

test('/pair starts a fresh pairing session', async () => {
    const fixture = createFixture();
    await fixture.service.handlePair({ chat: { id: 1 } });
    assert.equal(fixture.stateCalls[0].state.status, 'waiting_number');
    assert.match(fixture.sent[0].text, /Enter your number/);
});

test('plain text message ignored for group chats', async () => {
    const fixture = createFixture();
    await fixture.service.handleMessage({ chat: { id: 1, type: 'group' }, text: '2348012345678' });
    assert.equal(fixture.sent.length, 0);
});

test('plain text message ignored when it starts with a slash', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { status: 'waiting_number' });
    await fixture.service.handleMessage({ chat: { id: 1, type: 'private' }, text: '/pair' });
    assert.equal(fixture.sent.length, 0);
});

test('plain text message prompts /start for unknown users', async () => {
    const fixture = createFixture();
    await fixture.service.handleMessage({ chat: { id: 1, type: 'private' }, text: '2348012345678' });
    assert.match(fixture.sent[0].text, /Use \/start/);
});

test('plain text message is ignored when user is not waiting for a number', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { status: 'connected' });
    await fixture.service.handleMessage({ chat: { id: 1, type: 'private' }, text: '2348012345678' });
    assert.equal(fixture.sent.length, 0);
});

test('plain text message rejects an invalid phone number', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { status: 'waiting_number' });
    await fixture.service.handleMessage({ chat: { id: 1, type: 'private' }, text: '123' });
    assert.match(fixture.sent[0].text, /Invalid number/);
    assert.equal(fixture.pairingCalls.length, 0);
});

test('plain text message initiates pairing for a valid number', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { status: 'waiting_number' });
    await fixture.service.handleMessage({ chat: { id: 1, type: 'private' }, text: '2348012345678' });
    assert.equal(fixture.pairingCalls.length, 1);
    assert.match(fixture.sent.at(-1).text, /Connecting/);
});

test('plain text message reports a pairing failure', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { status: 'waiting_number' });
    fixture.setPairingError(new Error('device limit'));
    await fixture.service.handleMessage({ chat: { id: 1, type: 'private' }, text: '2348012345678' });
    assert.match(fixture.sent.at(-1).text, /Pairing failed/);
    assert.match(fixture.sent.at(-1).text, /device limit/);
});

test('/status requires admin', async () => {
    const fixture = createFixture({ isAdmin: false });
    await fixture.service.handleStatus({ chat: { id: 1 } });
    assert.match(fixture.sent[0].text, /Admins only/);
});

test('/status reports session and sync state', async () => {
    const fixture = createFixture();
    fixture.waSessions.set('234800000001', {});
    fixture.telegramUsers.set(1, { status: 'connected', phoneNumber: '234800000001' });
    fixture.setSupabaseEnabled(true);
    await fixture.service.handleStatus({ chat: { id: 1 } });
    assert.match(fixture.sent[0].text, /Active sockets: 1/);
    assert.match(fixture.sent[0].text, /Supabase Sync: ✅ Enabled/);
});

test('/unbug with no args shows usage', async () => {
    const fixture = createFixture();
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug' });
    assert.match(fixture.sent[0].text, /Unbug — remove sent bug messages/);
});

test('/unbug requires admin', async () => {
    const fixture = createFixture({ isAdmin: false });
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug all' });
    assert.match(fixture.sent[0].text, /Admins only/);
});

test('/unbug all sweeps every tracked session', async () => {
    const fixture = createFixture();
    const sock1 = fixture.makeSock('234800000001');
    fixture.waSessions.set('234800000001', { sock: sock1 });
    fixture.bugSendsByNumber.set('234800000001', [
        { id: 'm1', jid: 'target@s.whatsapp.net' },
        { id: 'm2', jid: 'target@s.whatsapp.net' }
    ]);
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug all' });
    assert.equal(fixture.sendMessages.length, 2);
    assert.match(fixture.sent.at(-1).text, /deleted 2\/2/);
    assert.equal(fixture.bugSendsByNumber.get('234800000001').length, 0);
    assert.equal(fixture.delays.length, 1);
});

test('/unbug with a single receiver filters by target jid', async () => {
    const fixture = createFixture();
    const sock1 = fixture.makeSock('234800000001');
    fixture.waSessions.set('234800000001', { sock: sock1 });
    fixture.bugSendsByNumber.set('234800000001', [
        { id: 'm1', jid: '2348099999999@s.whatsapp.net' },
        { id: 'm2', jid: 'other@s.whatsapp.net' }
    ]);
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug 2348099999999' });
    assert.equal(fixture.sendMessages.length, 1);
    assert.equal(fixture.sendMessages[0].jid, '2348099999999@s.whatsapp.net');
});

test('/unbug with sender and receiver targets only the named session', async () => {
    const fixture = createFixture();
    const sock1 = fixture.makeSock('234800000001');
    fixture.waSessions.set('234800000001', { sock: sock1 });
    fixture.bugSendsByNumber.set('234800000001', [
        { id: 'm1', jid: '2348099999999@s.whatsapp.net' }
    ]);
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug 234800000001 2348099999999' });
    assert.equal(fixture.sendMessages.length, 1);
});

test('/unbug reports when the named sender session is not active', async () => {
    const fixture = createFixture();
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug 234800000001 2348099999999' });
    assert.match(fixture.sent[0].text, /not a paired\/active bot session/);
});

test('/unbug reports when nothing matches the given target', async () => {
    const fixture = createFixture();
    fixture.waSessions.set('234800000001', { sock: fixture.makeSock('234800000001') });
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug 2348099999999' });
    assert.match(fixture.sent[0].text, /No tracked bug messages/);
});

test('/unbug resolves an invite link to the group jid', async () => {
    const fixture = createFixture();
    const sock1 = fixture.makeSock('234800000001', { groupInvite: { id: 'resolved@g.us' } });
    fixture.waSessions.set('234800000001', { sock: sock1 });
    fixture.bugSendsByNumber.set('234800000001', [
        { id: 'm1', jid: 'resolved@g.us' }
    ]);
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug https://chat.whatsapp.com/ABC123' });
    assert.equal(fixture.sendMessages.length, 1);
    assert.equal(fixture.sendMessages[0].jid, 'resolved@g.us');
});

test('/unbug reports when an invite link cannot be resolved', async () => {
    const fixture = createFixture();
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug https://chat.whatsapp.com/ABC123' });
    assert.match(fixture.sent[0].text, /Could not resolve that invite link/);
});

test('/unbug continues and records a failed delete', async () => {
    const fixture = createFixture();
    const sock1 = fixture.makeSock('234800000001', { sendError: new Error('delete boom') });
    fixture.waSessions.set('234800000001', { sock: sock1 });
    fixture.bugSendsByNumber.set('234800000001', [
        { id: 'm1', jid: 'target@s.whatsapp.net' }
    ]);
    await fixture.service.handleUnbug({ chat: { id: 1 }, text: '/unbug all' });
    assert.equal(fixture.errors.length, 1);
    assert.match(fixture.sent.at(-1).text, /deleted 0\/1/);
});

test('/disconnect with no active session reports nothing to disconnect', async () => {
    const fixture = createFixture();
    await fixture.service.handleDisconnect({ chat: { id: 1 } });
    assert.match(fixture.sent[0].text, /do not have an active session/);
});

test('/disconnect closes the socket, clears state, and removes the auth dir', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { phoneNumber: '234800000001' });
    const sock1 = fixture.makeSock('234800000001');
    fixture.waSessions.set('234800000001', { sock: sock1 });
    fixture.setSupabaseEnabled(true);
    await fixture.service.handleDisconnect({ chat: { id: 1 } });
    assert.equal(fixture.sockEnds.length, 1);
    assert.equal(fixture.waSessions.has('234800000001'), false);
    assert.deepEqual(fixture.removedPaths, ['/auth/234800000001']);
    assert.equal(fixture.deletedSupabase.length, 1);
    assert.equal(fixture.clearCalls.length, 1);
    assert.match(fixture.sent[0].text, /Disconnected 234800000001 successfully/);
});

test('/disconnect tolerates a socket close failure and still cleans up', async () => {
    const fixture = createFixture();
    fixture.telegramUsers.set(1, { phoneNumber: '234800000001' });
    const sock1 = fixture.makeSock('234800000001', { endError: new Error('close boom') });
    fixture.waSessions.set('234800000001', { sock: sock1 });
    await fixture.service.handleDisconnect({ chat: { id: 1 } });
    assert.equal(fixture.errors.length, 1);
    assert.equal(fixture.waSessions.has('234800000001'), false);
    assert.match(fixture.sent[0].text, /Disconnected/);
});

test('/help lists every command', async () => {
    const fixture = createFixture();
    await fixture.service.handleHelp({ chat: { id: 1 } });
    assert.match(fixture.sent[0].text, /\/start — Welcome message/);
    assert.match(fixture.sent[0].text, /\.ping/);
});
