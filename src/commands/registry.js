function normalizeCommandToken(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) return '';
    return token.startsWith('.') ? token : `.${token}`;
}

/**
 * Small command registry used during the incremental migration away from the
 * monolithic command chain.
 */
export function createCommandRegistry(definitions = []) {
    const commands = new Map();

    function register(definition) {
        if (!definition || typeof definition.execute !== 'function') {
            throw new Error('Command definition requires execute()');
        }
        const primaryToken = normalizeCommandToken(definition.name);
        if (!primaryToken) throw new Error('Command definition requires a name');
        const tokens = [primaryToken, ...(definition.aliases || []).map(normalizeCommandToken)];

        for (const token of tokens) {
            if (!token) continue;
            if (commands.has(token)) throw new Error(`Duplicate command token: ${token}`);
            commands.set(token, Object.freeze({ ...definition, token: primaryToken }));
        }
        return registry;
    }

    async function execute(token, context) {
        const command = commands.get(normalizeCommandToken(token));
        if (!command) return false;
        await command.execute(context);
        return true;
    }

    function has(token) {
        return commands.has(normalizeCommandToken(token));
    }

    function list() {
        return [...new Set([...commands.values()].map(command => command.token))].sort();
    }

    const registry = Object.freeze({ register, execute, has, list });
    for (const definition of definitions) register(definition);
    return registry;
}
