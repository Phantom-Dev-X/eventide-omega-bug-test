import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSessionStore } from '../src/services/session-store.js';

function createFixture(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eventide-session-store-'));
    const authDir = path.join(root, 'sessions');
    const userMapFile = path.join(root, 'user_map.json');
    const telegramUsers = new Map();
    const calls = [];

    const store = createSessionStore({
        authDir,
        userMapFile,
        telegramUsers,
        ensureDir: directory => fs.mkdirSync(directory, { recursive: true }),
        safeRm: target => fs.rmSync(target, { recursive: true, force: true }),
        isSupabaseEnabled: () => false,
        saveUserToSupabase: (...args) => calls.push(['save', ...args]),
        deleteUserFromSupabase: (...args) => calls.push(['delete', ...args]),
        loadAllUsersFromSupabase: async () => null,
        log: (...args) => calls.push(['log', ...args]),
        logError: (...args) => calls.push(['error', ...args]),
        ...overrides
    });

    return {
        root,
        authDir,
        userMapFile,
        telegramUsers,
        calls,
        store,
        cleanup: () => fs.rmSync(root, { recursive: true, force: true })
    };
}

test('session store counts directories and flattens a legacy nested sessions directory', () => {
    const fixture = createFixture();
    try {
        const nested = path.join(fixture.authDir, 'sessions');
        fs.mkdirSync(path.join(nested, '2348012345678'), { recursive: true });
        fs.writeFileSync(path.join(nested, '2348012345678', 'creds.json'), '{}');

        fixture.store.normalizeAuthDirStructure();

        assert.equal(fs.existsSync(nested), false);
        assert.equal(fs.existsSync(path.join(fixture.authDir, '2348012345678', 'creds.json')), true);
        assert.equal(fixture.store.countStoredSessions(), 1);
    } finally {
        fixture.cleanup();
    }
});

test('session store persists only mapped users with phone numbers', async () => {
    const fixture = createFixture();
    try {
        fixture.telegramUsers.set(10, { phoneNumber: '2348000000001', status: 'connected', sock: {} });
        fixture.telegramUsers.set(20, { phoneNumber: null, status: 'disconnected', sock: null });

        fixture.store.saveUserMap();
        const saved = JSON.parse(fs.readFileSync(fixture.userMapFile, 'utf8'));
        assert.deepEqual(saved, {
            10: { phoneNumber: '2348000000001', status: 'connected' }
        });

        fixture.telegramUsers.clear();
        await fixture.store.loadUserMap();
        assert.deepEqual(fixture.telegramUsers.get(10), {
            phoneNumber: '2348000000001',
            status: 'connected',
            sock: null
        });
    } finally {
        fixture.cleanup();
    }
});

test('session store prefers Supabase and can replace existing in-memory users', async () => {
    const fixture = createFixture({
        isSupabaseEnabled: () => true,
        loadAllUsersFromSupabase: async () => ({
            42: { phoneNumber: '2348000000042', status: 'connected' },
            invalid: { phoneNumber: 'ignored', status: 'connected' }
        })
    });
    try {
        fixture.telegramUsers.set(1, { phoneNumber: 'old', status: 'connected', sock: {} });
        await fixture.store.loadUserMap({ clearExisting: true });

        assert.equal(fixture.telegramUsers.has(1), false);
        assert.equal(fixture.telegramUsers.has(Number.NaN), false);
        assert.deepEqual(fixture.telegramUsers.get(42), {
            phoneNumber: '2348000000042',
            status: 'connected',
            sock: null
        });
    } finally {
        fixture.cleanup();
    }
});

test('session store synchronizes Telegram user state when Supabase is enabled', () => {
    const calls = [];
    const fixture = createFixture({
        isSupabaseEnabled: () => true,
        saveUserToSupabase: (...args) => calls.push(['save', ...args]),
        deleteUserFromSupabase: (...args) => calls.push(['delete', ...args])
    });
    try {
        fixture.store.setTelegramUserState(99, {
            phoneNumber: '2348000000099',
            status: 'connected',
            sock: 'socket'
        });
        fixture.store.clearTelegramUser(99);

        assert.deepEqual(calls, [
            ['save', 99, '2348000000099', 'connected'],
            ['delete', 99]
        ]);
        assert.deepEqual(fixture.telegramUsers.get(99), {
            phoneNumber: null,
            status: 'disconnected',
            sock: null
        });
    } finally {
        fixture.cleanup();
    }
});
