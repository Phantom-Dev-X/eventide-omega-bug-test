function megabytes(bytes) {
    return (bytes / 1024 / 1024).toFixed(0);
}

/**
 * Session and health information commands. Sensitive deployment/session data
 * remains limited to the owner or configured developer numbers.
 */
export function createSessionSystemCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        runtimeUptime,
        loadBotMode,
        waSessions,
        isDevNumber,
        countSystemCommands,
        isRenderRuntime,
        environment = process.env,
        memoryUsage = () => process.memoryUsage()
    } = deps || {};

    if (!waSessions) throw new Error('Session system commands require waSessions');
    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        runtimeUptime,
        loadBotMode,
        isDevNumber,
        countSystemCommands,
        memoryUsage
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Session system commands require ${name}()`);
        }
    }

    return Object.freeze([
        {
            name: 'status',
            async execute(context) {
                const {
                    sock,
                    remoteJid,
                    message,
                    phoneNumber,
                    senderJid,
                    isSenderOwner
                } = context;
                const heapUsed = megabytes(memoryUsage().heapUsed);
                const isDevOrOwner = isSenderOwner || isDevNumber(senderJid);
                const serviceName = environment.RENDER_SERVICE_NAME || '(unknown)';
                const serviceId = environment.RENDER_SERVICE_ID || '(unknown)';
                const instanceId = environment.RENDER_INSTANCE_ID || '(unknown)';
                const externalUrl = environment.RENDER_EXTERNAL_URL
                    || (environment.RENDER_EXTERNAL_HOSTNAME
                        ? `https://${environment.RENDER_EXTERNAL_HOSTNAME}`
                        : '(none)');
                const renderCommit = String(environment.RENDER_GIT_COMMIT || '').slice(0, 7)
                    || '(unknown)';
                const deploymentIdentity = isDevOrOwner
                    ? `   🌐 *HOST* :: ${isRenderRuntime ? 'RENDER' : 'NON_RENDER'}\n` +
                        `   🛰️ *SERVICE* :: ${serviceName}\n` +
                        `   🆔 *SERVICE_ID* :: ${serviceId}\n` +
                        `   🧬 *INSTANCE* :: ${instanceId}\n` +
                        `   📦 *COMMIT* :: ${renderCommit}\n` +
                        `   🔗 *URL* :: ${externalUrl}\n`
                    : '';

                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *SYSTEM_STATUS* █▓▒░\n\n` +
                        `   🔋 *MODE* :: ${loadBotMode(phoneNumber) === 'owner' ? 'OWNER_ONLY' : 'PUBLIC'}\n` +
                        `   ⏱️ *UPTIME* :: ${runtimeUptime()}\n` +
                        (isDevOrOwner ? `   👥 *SESSIONS* :: ${waSessions.size}\n` : '') +
                        deploymentIdentity +
                        `   💾 *MEMORY* :: ${heapUsed}MB\n\n` +
                        `   " *The machine does not sleep.*\n     *The machine only waits.* "`
                    ),
                    message
                );
            }
        },
        {
            name: 'session',
            async execute({ sock, remoteJid, message, phoneNumber, senderJid, isSenderOwner }) {
                const isDevOrOwner = isSenderOwner || isDevNumber(senderJid);
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *ACTIVE_SESSION* █▓▒░\n\n` +
                        `   📱 *PHONE* :: ${phoneNumber}\n` +
                        `   📡 *JID* :: ${sock.user?.id || 'unknown'}\n` +
                        (isDevOrOwner ? `   🔗 *SOCKETS* :: ${waSessions.size}\n` : '') +
                        `   " *This is but one of many*\n     *eyes in the void.* "`
                    ),
                    message
                );
            }
        },
        {
            name: 'sessions',
            async execute({ sock, remoteJid, message, senderJid, isSenderOwner }) {
                if (!isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ╾━━━ ACCESS_DENIED ━━━╼\n\n` +
                            `   🔒  *YOU ARE NOT THE ARCHITECT.*\n\n` +
                            `   The linked-session registry is\n` +
                            `   reserved for developers only.\n\n` +
                            `   " You do not hold the key\n` +
                            `     to this room. "`
                        ),
                        message
                    );
                    return;
                }

                const phoneNumbers = [...waSessions.keys()];
                const list = phoneNumbers.length
                    ? phoneNumbers.map(number => `   • ${number}`).join('\n')
                    : '   • _none linked_';
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *LINKED_SESSIONS* █▓▒░\n\n` +
                        `   🔢 *COUNT* :: ${phoneNumbers.length}\n\n` +
                        `${list}\n\n` +
                        `   " *Every vessel is a voice*\n     *in the choir of night.* "`
                    ),
                    message
                );
            }
        },
        {
            name: 'botinfo',
            async execute({ sock, remoteJid, message }) {
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CORE_IDENTITY* █▓▒░\n\n` +
                        `   ⧓ *NAME* :: EVENTIDE OMEGA\n` +
                        `   ⧓ *VERSION* :: v1.0.0_STABLE\n` +
                        `   ⧓ *UPTIME* :: ${runtimeUptime()}\n` +
                        `   ⧓ *COMMANDS* :: ${countSystemCommands()}\n` +
                        `   ⧓ *CORE* :: WA-MULTI-BOT\n\n` +
                        `   " The eclipse does not\n     end. It only waits. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'alive',
            async execute({ sock, remoteJid, message }) {
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *VESSEL_STATUS* █▓▒░\n\n` +
                        `   💓 *STATE* :: ALIVE\n` +
                        `   ⏱️ *UPTIME* :: ${runtimeUptime()}\n\n` +
                        `   " The machine lives.\n     The void holds. "`
                    ),
                    message
                );
            }
        },
        {
            name: 'cmdstats',
            async execute({ sock, remoteJid, message, senderJid, isSenderOwner }) {
                if (!isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CMD_STATS* █▓▒░\n\n` +
                        `   ✦ *COMMANDS* :: ${countSystemCommands()}\n\n` +
                        `   " A growing arsenal. "`
                    ),
                    message
                );
            }
        }
    ]);
}
