/**
 * In-place Git deployment command with injected process and repository
 * boundaries. The busy guard is shared with the composition root.
 */
export function createDeploymentCommands(deps) {
    const {
        safeWaReply,
        isDevNumber,
        getGitSyncBusy,
        setGitSyncBusy,
        gitCheck,
        pullLatestCode,
        truncateCommitName,
        log,
        logError,
        schedule = setTimeout,
        isSupervised = () => String(process.env.EVENTIDE_SUPERVISED || '') === '1',
        exitProcess = code => process.exit(code),
        relaunchSelf
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        isDevNumber,
        getGitSyncBusy,
        setGitSyncBusy,
        gitCheck,
        pullLatestCode,
        truncateCommitName,
        log,
        logError,
        schedule,
        isSupervised,
        exitProcess,
        relaunchSelf
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Deployment commands require ${name}()`);
        }
    }

    return Object.freeze([
        {
            name: 'gitpull',
            aliases: ['gitupdate'],
            async execute(context) {
                const { sock, remoteJid, message, phoneNumber, senderJid } = context;
                if (!context.isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(sock, remoteJid, '❌ Dev only.', message);
                    return;
                }
                if (getGitSyncBusy()) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '⏳ *GIT SYNC* :: already running — one sec...',
                        message
                    );
                    return;
                }
                setGitSyncBusy(true);
                try {
                    await safeWaReply(sock, remoteJid, '⏳ *GIT SYNC* :: checking git...', message);
                    const check = await gitCheck();
                    if (!check.changed) {
                        await safeWaReply(
                            sock,
                            remoteJid,
                            `✅ *GIT SYNC* :: already on the latest commit\n` +
                            `   "${truncateCommitName(check.name)}"\n\n` +
                            `   nothing to deploy.`,
                            message
                        );
                        log('GIT', `${phoneNumber}: .gitpull check — already latest (${check.name}).`);
                    } else {
                        await safeWaReply(
                            sock,
                            remoteJid,
                            `🚀 *GIT SYNC* :: found a new commit!\n` +
                            `   "${truncateCommitName(check.name)}"\n\n` +
                            `   deploying...`,
                            message
                        );
                        log('GIT', `${phoneNumber}: .gitpull deploying commit "${check.name}".`);
                        const result = await pullLatestCode();
                        await safeWaReply(
                            sock,
                            remoteJid,
                            `✅ *COMMIT DEPLOYED SUCCESSFULLY*\n` +
                            `   "${truncateCommitName(result.name)}"\n` +
                            `   (${(result.commit || '').slice(0, 7)})\n\n` +
                            `   ⚡ restarting with the new build...`,
                            message
                        );
                        log(
                            'GIT',
                            `${phoneNumber}: .gitpull deployed "${result.name}" (${(result.commit || '').slice(0, 7)}) — restarting.`
                        );
                        schedule(() => {
                            if (isSupervised()) exitProcess(0);
                            else relaunchSelf();
                        }, 1500);
                    }
                } catch (error) {
                    logError('GIT', `${phoneNumber}: .gitpull failed`, error);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ GIT SYNC failed: ${error.message || error}`,
                        message
                    );
                } finally {
                    setGitSyncBusy(false);
                }
            }
        }
    ]);
}
