/**
 * Public/owner-only access mode commands. Persistence is injected so mode
 * transitions and authorization can be verified without runtime storage.
 */
export function createAccessModeCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        loadBotMode,
        saveBotMode,
        terminalHeader
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        loadBotMode,
        saveBotMode
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Access mode commands require ${name}()`);
        }
    }
    if (typeof terminalHeader !== 'string') {
        throw new Error('Access mode commands require terminalHeader');
    }

    function denyUnauthorized(context) {
        if (context.isSenderOwner) return false;
        return safeWaReply(
            context.sock,
            context.remoteJid,
            '❌ Only the paired bot owner can modify the access mode.',
            context.message
        ).then(() => true);
    }

    return Object.freeze([
        {
            name: 'mode',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, args } = context;
                const targetMode = args[0]?.toLowerCase();
                const currentMode = loadBotMode(phoneNumber);
                if (!targetMode || !['public', 'owner'].includes(targetMode)) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `now: ${currentMode === 'owner' ? 'owner only' : 'public'}\n` +
                        `use: .mode public  |  .mode owner`,
                        message
                    );
                    return;
                }
                if (await denyUnauthorized(context)) return;
                saveBotMode(phoneNumber, targetMode);
                const bannerText = buildOmegaTerminal(
                    `   ░▒▓█ *SYSTEM_MODAL_SHIFT* █▓▒░\n\n` +
                    `   [ 💠 ] *PREVIOUS* : ${currentMode === 'owner' ? 'OWNER_ONLY' : 'PUBLIC'}\n` +
                    `   [ ⚡ ] *CURRENT* : ${targetMode === 'owner' ? 'OWNER_ONLY' : 'PUBLIC'}\n` +
                    `   [ 🛠️ ] *STATUS* : RECONFIGURED\n\n` +
                    (targetMode === 'owner'
                        ? `   " *I choose who breathes in*\n     *this space. The gates are*\n     *sealed at my command.* "`
                        : `   " *The gates have opened.*\n     *All who enter are seen.*\n     *Step carefully.* "`)
                );
                await safeWaReply(sock, remoteJid, bannerText, message);
            }
        },
        {
            name: 'public',
            async execute(context) {
                if (await denyUnauthorized(context)) return;
                const { sock, remoteJid, message, phoneNumber } = context;
                const currentMode = loadBotMode(phoneNumber);
                saveBotMode(phoneNumber, 'public');
                await safeWaReply(
                    sock,
                    remoteJid,
                    terminalHeader +
                    `   ░▒▓█ *SYSTEM_MODAL_SHIFT* █▓▒░\n\n` +
                    `   [ 💠 ] *PREVIOUS* : ${currentMode.toUpperCase()}\n` +
                    `   [ ⚡ ] *CURRENT* : PUBLIC\n` +
                    `   [ 🛠️ ] *STATUS* : GATES_OPEN\n\n` +
                    `   " *The gates have opened.*\n     *All who enter are seen.*\n     *Step carefully.* "`,
                    message
                );
            }
        },
        {
            name: 'owner',
            async execute(context) {
                if (await denyUnauthorized(context)) return;
                const { sock, remoteJid, message, phoneNumber } = context;
                const currentMode = loadBotMode(phoneNumber);
                saveBotMode(phoneNumber, 'owner');
                await safeWaReply(
                    sock,
                    remoteJid,
                    terminalHeader +
                    `   ░▒▓█ *SYSTEM_MODAL_SHIFT* █▓▒░\n\n` +
                    `   [ 💠 ] *PREVIOUS* : ${currentMode.toUpperCase()}\n` +
                    `   [ ⚡ ] *CURRENT* : OWNER_ONLY\n` +
                    `   [ 🛠️ ] *STATUS* : THRONE_SEALED\n\n` +
                    `   " *I choose who breathes in*\n     *this space. The gates are*\n     *sealed at my command.* "`,
                    message
                );
            }
        }
    ]);
}
