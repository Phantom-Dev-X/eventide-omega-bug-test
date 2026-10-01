/**
 * General-purpose media and text utilities. Runtime-specific libraries are
 * injected so conversion and failure paths can be tested without native I/O.
 */
export function createUtilitySystemCommands(deps) {
    const {
        safeWaReply,
        buildOmegaTerminal,
        loadSharp,
        loadQrcode,
        downloadMediaMessage,
        createSilentLogger,
        groupChannelLink,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({
        safeWaReply,
        buildOmegaTerminal,
        loadSharp,
        loadQrcode,
        downloadMediaMessage,
        createSilentLogger,
        logError
    })) {
        if (typeof value !== 'function') {
            throw new Error(`Utility system commands require ${name}()`);
        }
    }
    if (typeof groupChannelLink !== 'string') {
        throw new Error('Utility system commands require groupChannelLink');
    }

    return Object.freeze([
        {
            name: 'sticker',
            async execute(context) {
                const { sock, remoteJid, message } = context;
                const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const quotedImage = quoted?.imageMessage;
                const quotedVideo = quoted?.videoMessage;
                if (!quotedImage && !quotedVideo) {
                    await safeWaReply(sock, remoteJid, '❌ Reply to an image/video with .sticker to make a sticker.', message);
                    return;
                }
                try {
                    const sourceMessage = quotedImage
                        ? { imageMessage: quotedImage }
                        : { videoMessage: quotedVideo };
                    const sharp = loadSharp();
                    if (!sharp) {
                        await safeWaReply(sock, remoteJid, '❌ Sticker processing unavailable on this host.', message);
                        return;
                    }
                    const buffer = await downloadMediaMessage(
                        { message: sourceMessage },
                        'buffer',
                        {},
                        { logger: createSilentLogger() }
                    );
                    const pipeline = quotedImage
                        ? sharp(buffer)
                        : sharp(buffer, { animated: true });
                    const webp = await pipeline
                        .resize(512, 512, {
                            fit: 'contain',
                            background: { r: 0, g: 0, b: 0, alpha: 0 }
                        })
                        .webp()
                        .toBuffer();
                    await sock.sendMessage(remoteJid, { sticker: webp }, { quoted: message });
                } catch (error) {
                    logError('STICKER', 'sticker failed', error);
                    await safeWaReply(sock, remoteJid, `❌ Could not make sticker. Error: ${error?.message}`, message);
                }
            }
        },
        {
            name: 'toimg',
            async execute(context) {
                const { sock, remoteJid, message } = context;
                const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const quotedSticker = quoted?.stickerMessage;
                if (!quotedSticker) {
                    await safeWaReply(sock, remoteJid, '❌ Reply to a sticker with .toimg.', message);
                    return;
                }
                try {
                    const sharp = loadSharp();
                    if (!sharp) {
                        await safeWaReply(sock, remoteJid, '❌ Image processing unavailable on this host.', message);
                        return;
                    }
                    const buffer = await downloadMediaMessage(
                        { message: { stickerMessage: quotedSticker } },
                        'buffer',
                        {},
                        { logger: createSilentLogger() }
                    );
                    const png = await sharp(buffer).png().toBuffer();
                    await sock.sendMessage(remoteJid, { image: png }, { quoted: message });
                } catch (error) {
                    logError('TOIMG', 'toimg failed', error);
                    await safeWaReply(sock, remoteJid, `❌ Could not convert sticker. Error: ${error?.message}`, message);
                }
            }
        },
        {
            name: 'qr',
            async execute(context) {
                const { sock, remoteJid, message, args } = context;
                const data = args.join(' ').trim();
                if (!data) {
                    await safeWaReply(sock, remoteJid, '❌ use: .qr <text-or-url>', message);
                    return;
                }
                try {
                    const qrcode = loadQrcode();
                    if (!qrcode) {
                        await safeWaReply(sock, remoteJid, '❌ QR generation unavailable on this host.', message);
                        return;
                    }
                    const png = await qrcode.toBuffer(data, { width: 512, margin: 1 });
                    await sock.sendMessage(
                        remoteJid,
                        { image: png, caption: `${groupChannelLink}\n\n*QR GENERATED*` },
                        { quoted: message }
                    );
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ Could not generate QR. Error: ${error?.message}`, message);
                }
            }
        },
        {
            name: 'calc',
            async execute(context) {
                const { sock, remoteJid, message, args } = context;
                const expression = args.join(' ').trim();
                if (!expression) {
                    await safeWaReply(sock, remoteJid, '❌ use: .calc 5 + 3 * 2', message);
                    return;
                }
                try {
                    const clean = expression.replace(/[^0-9+\-*/(). %^]/g, '');
                    const result = Function(`"use strict"; return (${clean});`)();
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *CALC_ENGINE* █▓▒░\n\n` +
                            `   ✦ *INPUT* :: ${expression}\n` +
                            `   ✦ *RESULT* :: ${result}\n\n` +
                            `   " Numbers bend to my\n     will. "`
                        ),
                        message
                    );
                } catch {
                    await safeWaReply(sock, remoteJid, '❌ Invalid expression.', message);
                }
            }
        },
        {
            name: 'base64',
            async execute(context) {
                const { sock, remoteJid, message, args } = context;
                const mode = args[0]?.toLowerCase();
                const data = args.slice(1).join(' ');
                if (!['enc', 'dec'].includes(mode) || !data) {
                    await safeWaReply(
                        sock,
                        remoteJid,
                        '❌ use: .base64 enc <text>  |  .base64 dec <base64>',
                        message
                    );
                    return;
                }
                try {
                    const output = mode === 'enc'
                        ? Buffer.from(data).toString('base64')
                        : Buffer.from(data, 'base64').toString('utf8');
                    await safeWaReply(
                        sock,
                        remoteJid,
                        buildOmegaTerminal(
                            `   ░▒▓█ *BASE64_ENGINE* █▓▒░\n\n` +
                            `   ✦ *MODE* :: ${mode.toUpperCase()}\n` +
                            `   ✦ *OUTPUT* :: ${output.slice(0, 200)}\n\n` +
                            `   " Encoding is but\n     a veil. "`
                        ),
                        message
                    );
                } catch (error) {
                    await safeWaReply(sock, remoteJid, `❌ Could not ${mode}ode. Error: ${error?.message}`, message);
                }
            }
        }
    ]);
}
