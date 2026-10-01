/**
 * Read-only developer, group-list, and host-account profile commands.
 */
export function createAccountSystemCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        normalizeJid,
        isDevNumber,
        logError,
        environment = process.env
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        normalizeJid,
        isDevNumber,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Account system commands require ${name}()`);
        }
    }

    return Object.freeze([
        {
            name: 'dev',
            aliases: ['devnumber', 'devcontact'],
            async execute({ sock, remoteJid, message }) {
                const developerNumber = (environment.DEV_NUMBERS || '2348102756072')
                    .split(',')[0]
                    .trim();
                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `      ◢◤ *THE ARCHITECT* ◢◤\n\n` +
                        `      [ 👤 ] : Phantom dev x\n` +
                        `      [ 🌐 ] : wa.me/${developerNumber}\n` +
                        `      [ 🏮 ] : *PRIMARY_VESSEL_01*\n\n` +
                        `   " *Creation is the first step*\n     *toward destruction* ."`
                    ),
                    message
                );
            }
        },
        {
            name: 'listgc',
            async execute({ sock, remoteJid, message }) {
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    const names = Object.values(groups).map(group => group.subject).filter(Boolean);
                    const list = names.length
                        ? names.map(name => `   • ${name}`).join('\n')
                        : '   • _no groups_';
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *DOMINIONS* █▓▒░\n\n` +
                            `   🌐 *COUNT* :: ${names.length}\n\n` +
                            `${list}\n\n` +
                            `   " *Every group is a domain*\n     *under the eclipse.* "`
                        ),
                        message
                    );
                } catch (error) {
                    logError('SYSTEM', 'Failed to fetch groups', error);
                    await safeWaReply(
                        sock,
                        remoteJid,
                        `❌ Could not fetch groups. Error: ${error?.message}`,
                        message
                    );
                }
            }
        },
        {
            name: 'profile',
            async execute(context) {
                const {
                    sock,
                    remoteJid,
                    message,
                    phoneNumber,
                    senderJid,
                    isSenderOwner,
                    botConfig
                } = context;
                if (!isSenderOwner && !isDevNumber(senderJid)) {
                    await safeWaReply(sock, remoteJid, '❌ Owner/Dev only.', message);
                    return;
                }

                const ownJid = sock.user?.id ? normalizeJid(sock.user.id) : phoneNumber;
                let profilePicture = 'unknown';
                let about = '';
                try {
                    const pictureUrl = await sock.profilePictureUrl(ownJid, 'image');
                    profilePicture = pictureUrl ? 'set' : 'none';
                } catch {
                    profilePicture = 'none';
                }
                try {
                    const status = await sock.fetchStatus(ownJid);
                    about = (status && status[0]?.status) || '';
                } catch {
                    // Account bio remains optional.
                }

                await safeWaReply(
                    sock,
                    remoteJid,
                    buildOmegaTerminal(
                        `   ░▒▓█ *VESSEL_IDENTITY* █▓▒░\n\n` +
                        `   📱 *NUMBER* :: ${phoneNumber}\n` +
                        `   👤 *NAME* :: ${botConfig.name || '(account default)'}\n` +
                        `   🖼️ *PP* :: ${profilePicture}\n` +
                        `   📝 *BIO* :: ${about || botConfig.bio || '(none)'}\n\n` +
                        `   " This is the face the\n     void shows the world. "`
                    ),
                    message
                );
            }
        }
    ]);
}
