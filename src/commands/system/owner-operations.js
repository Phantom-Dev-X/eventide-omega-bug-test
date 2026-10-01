import path from 'node:path';

/**
 * Sensitive owner/developer operations with injected process and storage
 * boundaries so scheduling and cleanup can be tested without side effects.
 */
export function createOwnerOperationCommands(deps) {
    const {
        authDirRoot,
        waSessions,
        webPairSessions,
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        runLocalBackup,
        safeRm,
        isSupabaseEnabled,
        deleteSessionFromSupabase,
        shutdownBot,
        log,
        logError,
        schedule = setTimeout,
        exitProcess = code => process.exit(code)
    } = deps || {};

    if (!authDirRoot) throw new Error('Owner operation commands require authDirRoot');
    if (!waSessions || !webPairSessions) {
        throw new Error('Owner operation commands require session maps');
    }
    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        runLocalBackup,
        safeRm,
        isSupabaseEnabled,
        deleteSessionFromSupabase,
        shutdownBot,
        log,
        logError,
        schedule,
        exitProcess
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Owner operation commands require ${name}()`);
        }
    }

    function isAuthorized(context) {
        return context.isSenderOwner || isDevNumber(context.senderJid);
    }

    return Object.freeze([
        {
            name: 'backup',
            async execute(context) {
                const { sock, remoteJid, message } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                const destination = runLocalBackup('command', log, logError);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        destination
                            ? `   ░▒▓█ *BACKUP_OK* █▓▒░\n\n   ✦ *SNAP* :: ${path.basename(destination)}\n   ✦ *WHERE* :: backups/\n\n   \" The disk remembers. \"`
                            : `   ░▒▓█ *BACKUP_FAIL* █▓▒░\n\n   Check the panel console.`
                    ),
                    message
                );
            }
        },
        {
            name: 'restart',
            async execute(context) {
                const { sock, remoteJid, message } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Dev only.', message);
                    return;
                }
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CORE_REBOOT* █▓▒░\n\n` +
                        `   ⚡ *STATUS* :: RESTARTING\n` +
                        `   🔄 *ACTION* :: REINITIALIZE_CORE\n\n` +
                        `   " *Death is a door.*\n     *I step through and return.* "`
                    ),
                    message
                );
                schedule(() => exitProcess(0), 1500);
            }
        },
        {
            name: 'shutdown',
            async execute(context) {
                const { sock, remoteJid, message } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Dev only.', message);
                    return;
                }
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CORE_POWER_DOWN* █▓▒░\n\n` +
                        `   ⚡ *STATUS* :: SHUTDOWN\n` +
                        `   🔌 *ACTION* :: VOID_SLEEP\n\n` +
                        `   " *The machine sleeps.*\n     *But it always wakes.* "`
                    ),
                    message
                );
                schedule(() => shutdownBot('.shutdown command'), 1200);
            }
        },
        {
            name: 'reconnect',
            async execute(context) {
                const { sock, remoteJid, message } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CORE_RECONNECT* █▓▒░\n\n` +
                        `   ⚡ *ACTION* :: FORCE_RECONNECT\n\n` +
                        `   " The thread is severed\n     and rewoven. "`
                    ),
                    message
                );
                schedule(() => {
                    try {
                        sock.end(undefined);
                    } catch {
                        // Reconnect request is best effort.
                    }
                }, 800);
            }
        },
        {
            name: 'logout',
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber } = context;
                if (!isAuthorized(context)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CORE_LOGOUT* █▓▒░\n\n` +
                        `   🔌 *ACTION* :: UNLINK_SESSION\n` +
                        `   ⚠️ *NOTE* :: You will need to\n   re-pair this number after.\n\n` +
                        `   " The vessel is released\n     back to the void. "`
                    ),
                    message
                );
                schedule(() => {
                    try {
                        sock.logout().catch(() => {});
                    } catch {
                        // Continue local cleanup even if logout cannot start.
                    }
                    safeRm(path.join(authDirRoot, phoneNumber));
                    waSessions.delete(phoneNumber);
                    webPairSessions.delete(phoneNumber);
                    if (isSupabaseEnabled()) deleteSessionFromSupabase(phoneNumber);
                }, 1500);
            }
        }
    ]);
}
