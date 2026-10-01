import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevHelpers } from '../src/core/dev-helpers.js';

test('createDevHelpers requires a devIds array', () => {
    assert.throws(() => createDevHelpers({}), /devIds/);
    assert.throws(() => createDevHelpers({ devIds: 'nope' }), /devIds/);
});

test('isDev treats everyone as dev when the list is empty (upstream behaviour)', () => {
    const { isDev } = createDevHelpers({ devIds: [] });
    assert.equal(isDev('12345'), true);
    assert.equal(isDev(999), true);
});

test('isDev matches ids numerically', () => {
    const { isDev } = createDevHelpers({ devIds: [111, 222] });
    assert.equal(isDev('111'), true);
    assert.equal(isDev(222), true);
    assert.equal(isDev('333'), false);
});

test('isDevNumber matches the DEV_NUMBERS env var against jid digits', () => {
    const prev = process.env.DEV_NUMBERS;
    try {
        const { isDevNumber } = createDevHelpers({ devIds: [] });
        process.env.DEV_NUMBERS = '';
        assert.equal(isDevNumber('2348012345678@s.whatsapp.net'), false);

        process.env.DEV_NUMBERS = '+234 801 234 5678, 999';
        assert.equal(isDevNumber('2348012345678:9@s.whatsapp.net'), true);
        assert.equal(isDevNumber('999@lid'), true);
        assert.equal(isDevNumber('888@s.whatsapp.net'), false);
        assert.equal(isDevNumber(null), false);
    } finally {
        if (prev === undefined) delete process.env.DEV_NUMBERS;
        else process.env.DEV_NUMBERS = prev;
    }
});

test('countSystemCommands reports the known-command count', () => {
    const { countSystemCommands } = createDevHelpers({ devIds: [] });
    const n = countSystemCommands();
    assert.equal(typeof n, 'number');
    assert.ok(n > 50, `expected a meaningful list, got ${n}`);
});

test('returned interface is frozen', () => {
    const engine = createDevHelpers({ devIds: [] });
    assert.ok(Object.isFrozen(engine));
});
