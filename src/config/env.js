import path from 'node:path';

const TRUE_VALUES = new Set(['1', 'true', 'on', 'yes', 'enabled']);
const BLOCKED_RENDER_SERVICE_IDS = new Set([
    'srv-da3bgc0u01pc738bjg1g'
]);

export function isEnabled(value) {
    return TRUE_VALUES.has(String(value || '').trim().toLowerCase());
}

export function parseNumberList(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite);
}

/**
 * Read and normalize process environment values in one place.
 * Passing env/rootDir explicitly keeps the function easy to test.
 */
export function createEnvironmentConfig({ rootDir, env = process.env } = {}) {
    if (!rootDir) throw new Error('createEnvironmentConfig requires rootDir');

    const isRenderRuntime = isEnabled(env.RENDER)
        || Boolean(env.RENDER_SERVICE_ID)
        || Boolean(env.RENDER_INSTANCE_ID)
        || Boolean(env.RENDER_EXTERNAL_URL);
    const currentRenderServiceId = String(env.RENDER_SERVICE_ID || '').trim();
    const isBlockedRenderService = isRenderRuntime
        && BLOCKED_RENDER_SERVICE_IDS.has(currentRenderServiceId);
    const panelBotEnabled = isEnabled(env.PANEL_BOT_ENABLED);

    return Object.freeze({
        TELEGRAM_TOKEN: env.TELEGRAM_TOKEN,
        MAX_USERS: Math.max(1, parseInt(env.MAX_USERS || '10', 10) || 10),
        DEV_IDS: parseNumberList(env.DEV_TELEGRAM_IDS),
        PORT: parseInt(env.PORT || env.SERVER_PORT || '3000', 10) || 3000,
        AUTH_DIR: path.join(rootDir, 'sessions'),
        USER_MAP_FILE: path.join(rootDir, 'user_map.json'),
        KEEP_ALIVE_INTERVAL: 4 * 60 * 1000,
        RECENT_APPEND_WINDOW_SECONDS: 120,
        RENDER_ONLY_BUILD: true,
        IS_RENDER_RUNTIME: isRenderRuntime,
        PANEL_BOT_ENABLED: panelBotEnabled,
        CURRENT_RENDER_SERVICE_ID: currentRenderServiceId,
        IS_BLOCKED_RENDER_SERVICE: isBlockedRenderService,
        BOT_RUNTIME_ALLOWED: (isRenderRuntime || panelBotEnabled) && !isBlockedRenderService,
        GROUP_CHANNEL_LINK: String(
            env.GROUP_CHANNEL_LINK || 'https://whatsapp.com/channel/0029VbCrFiK17En02cax3r02'
        ).trim(),
        VERBOSE_LOGS: isEnabled(env.VERBOSE_LOGS)
    });
}
