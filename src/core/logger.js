/**
 * Small shared logger used by every runtime module.
 * Keeping the output format stable preserves existing panel log searches.
 */
export function log(scope, message, extra) {
    const prefix = `[${new Date().toISOString()}] [${scope}]`;
    if (typeof extra === 'undefined') console.log(`${prefix} ${message}`);
    else console.log(`${prefix} ${message}`, extra);
}

export function logError(scope, message, error) {
    const prefix = `[${new Date().toISOString()}] [${scope}]`;
    console.error(`${prefix} ${message}: ${error?.message || error}`);
    if (error?.stack) console.error(error.stack);
}
