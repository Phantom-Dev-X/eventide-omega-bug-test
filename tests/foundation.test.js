import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentConfig, isEnabled, parseNumberList } from '../src/config/env.js';
import { createAppContext } from '../src/core/context.js';
import { runtimeState } from '../src/core/state.js';
import { log, logError } from '../src/core/logger.js';

const rootDir = '/tmp/eventide-test';

test('boolean environment values are normalized', () => {
    assert.equal(isEnabled('YES'), true);
    assert.equal(isEnabled('true'), true);
    assert.equal(isEnabled('off'), false);
});

test('developer Telegram IDs are parsed safely', () => {
    assert.deepEqual(parseNumberList('123, 456, nope'), [123, 456]);
});

test('panel environment enables runtime and keeps Supabase-independent paths', () => {
    const config = createEnvironmentConfig({
        rootDir,
        env: {
            PANEL_BOT_ENABLED: 'true',
            MAX_USERS: '15',
            SERVER_PORT: '8080',
            DEV_TELEGRAM_IDS: '123,456'
        }
    });

    assert.equal(config.BOT_RUNTIME_ALLOWED, true);
    assert.equal(config.MAX_USERS, 15);
    assert.equal(config.PORT, 8080);
    assert.deepEqual(config.DEV_IDS, [123, 456]);
    assert.equal(config.AUTH_DIR, '/tmp/eventide-test/sessions');
});

test('Render runtime and the duplicate-service kill switch preserve existing behavior', () => {
    const render = createEnvironmentConfig({
        rootDir,
        env: { RENDER_SERVICE_ID: 'srv-current-service' }
    });
    const blocked = createEnvironmentConfig({
        rootDir,
        env: { RENDER_SERVICE_ID: 'srv-da3bgc0u01pc738bjg1g' }
    });

    assert.equal(render.IS_RENDER_RUNTIME, true);
    assert.equal(render.BOT_RUNTIME_ALLOWED, true);
    assert.equal(blocked.IS_BLOCKED_RENDER_SERVICE, true);
    assert.equal(blocked.BOT_RUNTIME_ALLOWED, false);
});

test('application context exposes explicit dependencies', () => {
    const config = createEnvironmentConfig({ rootDir, env: { PANEL_BOT_ENABLED: 'true' } });
    const context = createAppContext({
        config,
        state: runtimeState,
        logger: { log, logError }
    });

    assert.equal(context.config, config);
    assert.equal(context.state, runtimeState);
    assert.equal(typeof context.logger.log, 'function');
    assert.equal(Object.isFrozen(context), true);
});
