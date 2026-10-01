/**
 * Build the dependency object that feature modules receive.
 * Modules should depend on this context instead of importing index.js.
 */
export function createAppContext({ config, state, logger, services = {} }) {
    if (!config) throw new Error('Application context requires config');
    if (!state) throw new Error('Application context requires state');
    if (!logger?.log || !logger?.logError) {
        throw new Error('Application context requires log and logError');
    }

    return Object.freeze({
        config,
        state,
        logger: Object.freeze(logger),
        services: Object.freeze({ ...services })
    });
}
