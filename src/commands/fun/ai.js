/**
 * AI-generated social/fun commands with scored-output retry handling.
 */
export function createAiFunCommands(deps) {
    const {
        resolveTargetJid,
        extractQuotedPlainText,
        getQuotedContext,
        normalizeJid,
        funRoastSystem,
        generateScoredFun,
        loadBotConfig,
        logError,
        safeWaReply
    } = deps || {};

    for (const [name, value] of Object.entries({
        resolveTargetJid,
        extractQuotedPlainText,
        getQuotedContext,
        normalizeJid,
        funRoastSystem,
        generateScoredFun,
        loadBotConfig,
        logError,
        safeWaReply
    })) {
        if (typeof value !== 'function') throw new Error(`AI fun commands require ${name}()`);
    }

    async function execute(context, command) {
        const { sock, remoteJid, message, phoneNumber, senderJid, args, pushName } = context;
        const target = resolveTargetJid(message, args);
        const quotedText = extractQuotedPlainText(message);
        const targetJid = target || (quotedText ? (getQuotedContext(message)?.participant || null) : null);
        const targetNumber = targetJid ? String(normalizeJid(targetJid)).split('@')[0] : '';
        const extra = args
            .filter(argument => !argument.startsWith('@') && !/^\d{7,}$/.test(argument.replace(/\D/g, '')))
            .join(' ')
            .trim();
        const mentions = [];
        if (targetJid) mentions.push(normalizeJid(targetJid));

        let system = '';
        let prompt = '';
        let header = '';
        let minScore = 7;

        if (command === 'roast') {
            header = '🔥 *ROAST*';
            system = funRoastSystem();
            prompt =
                `Target name/number: ${targetNumber || pushName || 'this person'}\n` +
                (quotedText
                    ? `They said (USE THIS): """${quotedText.slice(0, 400)}"""\n`
                    : 'No quoted message — roast their existence generally.\n') +
                (extra ? `Extra context from the commander: ${extra}\n` : '') +
                `Write a roast that would make a WhatsApp group screenshot it. Then score it.`;
        } else if (command === 'pickupline') {
            header = '💋 *PICKUP LINE*';
            system = `You write pickup lines that actually sound clever, a little dirty, a little sweet — the kind someone would really send. West African chat energy is welcome. No slurs. No non-con. 1-3 lines.\nOUTPUT EXACTLY:\nLINE: <the line>\nSCORE: <1-10>`;
            prompt = `Write a fresh pickup line${targetNumber ? ` aimed at +${targetNumber}` : ''}${quotedText ? ` inspired by them saying: "${quotedText.slice(0, 200)}"` : ''}${extra ? ` about: ${extra}` : ''}. Score it.`;
        } else if (command === 'joke') {
            header = '😂 *JOKE*';
            system = `You tell short jokes that land in a group chat. Observational or dark-lite. No slurs. 2-6 lines max.\nOUTPUT EXACTLY:\nJOKE: <the joke>\nSCORE: <1-10>`;
            prompt = `Tell a fresh joke${extra ? ` about: ${extra}` : ''}${quotedText ? ` riffing on: "${quotedText.slice(0, 200)}"` : ''}. Score it.`;
        } else if (command === 'compliment') {
            header = '✨ *COMPLIMENT*';
            system = `You give compliments that feel specific and a bit poetic, not cringe. 1-3 lines.\nOUTPUT EXACTLY:\nTEXT: <the compliment>\nSCORE: <1-10>`;
            prompt = `Compliment ${targetNumber || 'this person'}${quotedText ? ` based on them saying: "${quotedText.slice(0, 200)}"` : ''}${extra ? `: ${extra}` : ''}. Score it.`;
            minScore = 6;
        } else if (command === 'flirt') {
            header = '😉 *FLIRT*';
            system = `You flirt in a WhatsApp voice — confident, funny, a little dangerous. 1-3 lines. No slurs. No non-con.\nOUTPUT EXACTLY:\nLINE: <the flirt>\nSCORE: <1-10>`;
            prompt = `Flirt with ${targetNumber || 'them'}${quotedText ? ` they said: "${quotedText.slice(0, 200)}"` : ''}${extra ? ` vibe: ${extra}` : ''}. Score it.`;
        } else if (command === 'rate') {
            header = '📊 *RATE*';
            system = `You rate things out of 10 with a savage or funny one-liner explaining why. Be honest.\nOUTPUT EXACTLY:\nTEXT: <one or two lines ending with X/10>\nSCORE: <same number>`;
            prompt = quotedText
                ? `Rate this message out of 10 and explain in one savage/funny line:\n"""${quotedText.slice(0, 400)}"""`
                : `Rate ${targetNumber || extra || 'this person'} out of 10 with one funny line.`;
            minScore = 1;
        } else if (command === 'ship') {
            header = '💘 *SHIP*';
            const quotedContext = getQuotedContext(message);
            const mentioned = (
                quotedContext?.mentionedJid ||
                message.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
                []
            ).slice(0, 2);
            const first = mentioned[0] || senderJid;
            const second = mentioned[1] || targetJid || remoteJid;
            mentions.length = 0;
            mentions.push(normalizeJid(first));
            if (second) mentions.push(normalizeJid(second));
            system = `You ship two people like a chaotic group admin. Give them a couple name, a percentage, and one unhinged sentence why. No slurs.\nOUTPUT EXACTLY:\nTEXT: <the ship>\nSCORE: <1-10>`;
            prompt = `Ship +${String(first).split('@')[0]} with +${String(second || first).split('@')[0]}. Score the take.`;
        }

        try {
            await sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
            const output = await generateScoredFun(prompt, system, {
                minScore,
                tries: command === 'roast' ? 3 : 2,
                temperature: 0.95,
                geminiKey: String(loadBotConfig(phoneNumber).geminiApiKey || '').trim()
            });
            const mentionLine = targetNumber && command !== 'ship' ? `@${targetNumber}\n\n` : '';
            await sock.sendMessage(remoteJid, {
                text: `${header}\n\n${mentionLine}${output.body}`,
                mentions
            }, { quoted: message });
        } catch (error) {
            logError('FUN', `.${command} failed`, error);
            await safeWaReply(
                sock,
                remoteJid,
                `❌ The void refused to cook.\n${error?.message || error}\n\nSet GEMINI_API_KEY on Render if this keeps happening.`,
                message
            );
        }
    }

    return Object.freeze([
        { name: 'roast', execute: context => execute(context, 'roast') },
        { name: 'pickupline', aliases: ['pickup', 'rizz'], execute: context => execute(context, 'pickupline') },
        { name: 'joke', execute: context => execute(context, 'joke') },
        { name: 'compliment', execute: context => execute(context, 'compliment') },
        { name: 'flirt', execute: context => execute(context, 'flirt') },
        { name: 'rate', execute: context => execute(context, 'rate') },
        { name: 'ship', execute: context => execute(context, 'ship') }
    ]);
}
