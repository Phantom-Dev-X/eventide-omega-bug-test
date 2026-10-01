import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry } from '../src/commands/registry.js';

test('registry executes primary command names and aliases case-insensitively', async () => {
    const calls = [];
    const registry = createCommandRegistry([{
        name: 'ping',
        aliases: ['latency'],
        execute: async context => calls.push(context)
    }]);

    assert.equal(await registry.execute('.PING', { source: 'primary' }), true);
    assert.equal(await registry.execute('LATENCY', { source: 'alias' }), true);
    assert.deepEqual(calls, [{ source: 'primary' }, { source: 'alias' }]);
    assert.deepEqual(registry.list(), ['.ping']);
});

test('registry returns false without side effects for unknown commands', async () => {
    const registry = createCommandRegistry();
    assert.equal(await registry.execute('.unknown', {}), false);
    assert.equal(registry.has('.unknown'), false);
});

test('registry rejects duplicate command tokens', () => {
    assert.throws(() => createCommandRegistry([
        { name: 'ping', execute: async () => {} },
        { name: 'other', aliases: ['ping'], execute: async () => {} }
    ]), /Duplicate command token: \.ping/);
});

test('registry validates command definitions', () => {
    assert.throws(() => createCommandRegistry([{ name: 'broken' }]), /requires execute/);
    assert.throws(() => createCommandRegistry([{ execute: async () => {} }]), /requires a name/);
});
