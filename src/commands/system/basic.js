function megabytes(bytes) {
    return (bytes / 1024 / 1024).toFixed(0);
}

/**
 * Low-risk informational commands migrated first to prove the registry path.
 */
export function createBasicSystemCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        runtimeUptime,
        now = Date.now,
        memoryUsage = () => process.memoryUsage(),
        processVersion = process.version,
        platform = process.platform,
        architecture = process.arch,
        pid = process.pid
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        runtimeUptime,
        now,
        memoryUsage
    })) {
        if (typeof value !== 'function') throw new Error(`Basic system commands require ${name}()`);
    }

    return Object.freeze([
        {
            name: 'ping',
            async execute({ sock, remoteJid, message }) {
                const startedAt = now();
                try {
                    await sock.sendMessage(
                        remoteJid,
                        { text: '⚡ _scanning signal...' },
                        { quoted: message }
                    );
                } catch {
                    // The final signal report is still attempted if the scan message fails.
                }
                const latency = now() - startedAt;
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `            — *S I G N A L* —\n\n` +
                        `   ⚡ *LATENCY* ──╼  [ ${latency}ms ]\n` +
                        `   📡 *RESONANCE* ──╼  [ ${latency < 300 ? 'STABLE' : latency < 800 ? 'MODERATE' : 'DEGRADED'} ]\n` +
                        `   ⏱️ *UPTIME* ──╼  [ ${runtimeUptime()} ]\n\n` +
                        `   " *An echo in the void is*\n     *the only proof you exist* ."`
                    ),
                    message
                );
            }
        },
        {
            name: 'uptime',
            async execute({ sock, remoteJid, message }) {
                const memory = memoryUsage();
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ┌── *TEMPORAL LOGS* ──┐\n` +
                        `   ╿\n` +
                        `   ┝  *ACTIVE* : ${runtimeUptime()}\n` +
                        `   ┝  *HEAP* : ${megabytes(memory.heapUsed)}MB / ${megabytes(memory.heapTotal)}MB\n` +
                        `   ┝  *RSS* : ${megabytes(memory.rss)}MB\n` +
                        `   ┝  *PID* : ${pid}\n` +
                        `   ╿\n` +
                        `   └── *STABILITY: OPERATIONAL* ──┘\n\n` +
                        `   " *I have survived the collapse.*\n     *My pulse keeps this realm*\n     *from drifting into the void.* "`
                    ),
                    message
                );
            }
        },
        {
            name: 'info',
            async execute({ sock, remoteJid, message }) {
                const memory = memoryUsage();
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CORE_MANIFEST* █▓▒░\n\n` +
                        `   ⧓ *VERSION* :: v1.0.0_STABLE\n` +
                        `   ⧓ *RUNTIME* :: NODE_JS v${processVersion.slice(1)}\n` +
                        `   ⧓ *UPTIME* :: ${runtimeUptime()}\n` +
                        `   ⧓ *MEMORY* :: ${megabytes(memory.heapUsed)}MB / ${megabytes(memory.heapTotal)}MB\n` +
                        `   ⧓ *SHIELD* :: BUG_SHIELD: ACTIVE\n\n` +
                        `   " *The machine does not sleep* .\n     *The machine only waits* ."`
                    ),
                    message
                );
            }
        },
        {
            name: 'runtime',
            async execute({ sock, remoteJid, message }) {
                const memory = memoryUsage();
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *RUNTIME_MANIFEST* █▓▒░\n\n` +
                        `   ⏱️ *UPTIME* :: ${runtimeUptime()}\n` +
                        `   🧠 *NODE* :: v${processVersion.slice(1)}\n` +
                        `   💾 *HEAP* :: ${megabytes(memory.heapUsed)}MB\n` +
                        `   📦 *RSS* :: ${megabytes(memory.rss)}MB\n` +
                        `   ⚙️ *PID* :: ${pid}\n\n` +
                        `   " *Every second awake is*\n     *a second the void fails.* "`
                    ),
                    message
                );
            }
        },
        {
            name: 'version',
            async execute({ sock, remoteJid, message }) {
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *CORE_VERSION* █▓▒░\n\n` +
                        `   ⧓ *BUILD* :: v1.0.0_STABLE\n` +
                        `   ⧓ *ENGINE* :: NODE_JS v${processVersion.slice(1)}\n` +
                        `   ⧓ *CORE* :: EVENTIDE OMEGA\n\n` +
                        `   " *I do not change.*\n     *I only sharpen.* "`
                    ),
                    message
                );
            }
        },
        {
            name: 'os',
            async execute({ sock, remoteJid, message }) {
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *HOST_OS* █▓▒░\n\n` +
                        `   🖥️ *PLATFORM* :: ${platform}\n` +
                        `   🏗️ *ARCH* :: ${architecture}\n` +
                        `   ⏱️ *UPTIME* :: ${runtimeUptime()}\n` +
                        `   📦 *NODE* :: v${processVersion.slice(1)}\n` +
                        `   ⚙️ *PID* :: ${pid}\n\n` +
                        `   " *This vessel is but a*\n     *shell for a greater will.* "`
                    ),
                    message
                );
            }
        }
    ]);
}
