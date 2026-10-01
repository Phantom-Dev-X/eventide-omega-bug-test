/**
 * Context-sensitive `.del` command used by warning, antidelete, and autoreact
 * configuration flows.
 */
export function createConfigDeleteCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        warnConfigSessions,
        antiConfigSessions,
        autoreactSessions,
        ensureWarnGroup,
        getWarnState,
        saveWarnState,
        getAntideleteState,
        listAntideleteEndpoints,
        saveAntideleteState,
        saveBotConfig
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        ensureWarnGroup,
        getWarnState,
        saveWarnState,
        getAntideleteState,
        listAntideleteEndpoints,
        saveAntideleteState,
        saveBotConfig
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Config delete commands require ${name}()`);
        }
    }
    for (const [name, value] of Object.entries({
        warnConfigSessions,
        antiConfigSessions,
        autoreactSessions
    })) {
        if (!value || typeof value.get !== 'function' || typeof value.set !== 'function' || typeof value.delete !== 'function') {
            throw new Error(`Config delete commands require ${name}`);
        }
    }

    function parseIndices(args, max) {
        return args
            .map(argument => parseInt(argument, 10))
            .filter(index => Number.isFinite(index) && index >= 1 && index <= max)
            .sort((left, right) => right - left);
    }

    return Object.freeze([
        {
            name: 'del',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, senderJid, args, botConfig } = context;
                if (!context.isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }

                const warningSession = warnConfigSessions.get(phoneNumber);
                if (warningSession?.step === 'delete') {
                    const group = warningSession.group;
                    const groupConfig = ensureWarnGroup(phoneNumber, group);
                    const phrases = groupConfig.phrases || [];
                    const indices = parseIndices(args, phrases.length);
                    if (!indices.length) {
                        await safeWaReply(
                            sock,
                            remoteJid,
                            '❌ Invalid indices. use: .del 1 3 (from the phrase list)',
                            message
                        );
                        return;
                    }
                    for (const index of indices) phrases.splice(index - 1, 1);
                    groupConfig.phrases = phrases;
                    const warningState = getWarnState(phoneNumber);
                    warningState.groups[group] = groupConfig;
                    saveWarnState(phoneNumber, warningState);
                    warnConfigSessions.set(phoneNumber, { step: 'matrix', group });
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *PHRASES_PRUNED* █▓▒░\n\n` +
                            `   ✦ *REMOVED* :: ${indices.length}\n` +
                            `   ✦ *LEFT* :: ${phrases.length}`
                        ),
                        message
                    );
                    return;
                }

                const antideleteSession = antiConfigSessions.get(phoneNumber);
                if (antideleteSession?.step === 'delete') {
                    const state = getAntideleteState(phoneNumber);
                    const { rows } = listAntideleteEndpoints(state);
                    const indices = parseIndices(args, rows.length);
                    if (!indices.length) {
                        await safeWaReply(
                            sock,
                            remoteJid,
                            '❌ Invalid indices. use: .del 2 5 6 9 (numbers from the antidelete list)',
                            message
                        );
                        return;
                    }
                    for (const index of indices) {
                        const entry = rows[index - 1];
                        const bucketName = `${entry.type.toLowerCase()}s`;
                        const bucket = state.endpoints[bucketName] || [];
                        const position = bucket.indexOf(entry.v);
                        if (position >= 0) bucket.splice(position, 1);
                    }
                    saveAntideleteState(phoneNumber, state);
                    antiConfigSessions.delete(phoneNumber);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *ENDPOINTS_PRUNED* █▓▒░\n\n` +
                            `   ✦ *REMOVED* :: ${indices.length}\n\n` +
                            `   " Those chats are no longer\n     watched for deletions. "`
                        ),
                        message
                    );
                    return;
                }

                const config = botConfig.autoreact || {
                    enabled: false,
                    endpoints: { groups: [], channels: [], contacts: [] }
                };
                const all = [
                    ...(config.endpoints?.groups || []).map(value => ({ type: 'GROUP', v: value })),
                    ...(config.endpoints?.channels || []).map(value => ({ type: 'CHANNEL', v: value })),
                    ...(config.endpoints?.contacts || []).map(value => ({ type: 'CONTACT', v: value }))
                ];
                const indices = parseIndices(args, all.length);
                if (!indices.length) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ Invalid indices. use: .del 2 5 6 9 (numbers from the list)',
                        message
                    );
                    return;
                }
                for (const index of indices) {
                    const entry = all[index - 1];
                    const bucket = config.endpoints[`${entry.type.toLowerCase()}s`] || [];
                    const position = bucket.indexOf(entry.v);
                    if (position >= 0) bucket.splice(position, 1);
                }
                saveBotConfig(phoneNumber, botConfig);
                autoreactSessions.delete(phoneNumber);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *ENDPOINTS_PRUNED* █▓▒░\n\n` +
                        `   ✦ *REMOVED* :: ${indices.length}\n\n` +
                        `   " The void no longer\n     watches those paths. "`
                    ),
                    message
                );
            }
        }
    ]);
}
