/**
 * Eclipse persona menu — the original cinematic 3-stage loading animation,
 * banner image, and the Owners/Group/Fun/Bug poll. Unchanged from the
 * classic menu; this module only relocates the rendering/sending logic out
 * of index.js. The poll-vote dispatcher that reacts to the poll's answers
 * stays in index.js (shared across personas, out of scope here).
 */
export function createEclipseInterface(deps) {
    const {
        groupChannelLink,
        menuBannerPath,
        delay,
        sendMenuPoll,
        log,
        logError
    } = deps || {};

    for (const [name, value] of Object.entries({ delay, sendMenuPoll, log, logError })) {
        if (typeof value !== 'function') throw new Error(`Eclipse interface requires ${name}()`);
    }
    if (typeof groupChannelLink !== 'string' || !groupChannelLink) {
        throw new Error('Eclipse interface requires groupChannelLink');
    }
    if (typeof menuBannerPath !== 'string' || !menuBannerPath) {
        throw new Error('Eclipse interface requires menuBannerPath');
    }

    const animSteps = [
        { percent: 8,  bar: 1,  text: '◐ initiating umbral protocol', core: '◌', cipher: '◌', void: '◌' },
        { percent: 16, bar: 2,  text: '◐ initiating umbral protocol', core: '◌', cipher: '◌', void: '◌' },
        { percent: 25, bar: 3,  text: '◐ initiating umbral protocol', core: '◌', cipher: '◌', void: '◌' },
        { percent: 33, bar: 4,  text: '◑ collapsing quantum states',  core: '✔', cipher: '◌', void: '◌' },
        { percent: 41, bar: 5,  text: '◑ collapsing quantum states',  core: '✔', cipher: '◌', void: '◌' },
        { percent: 50, bar: 6,  text: '◑ collapsing quantum states',  core: '✔', cipher: '◌', void: '◌' },
        { percent: 58, bar: 7,  text: '◒ severing the last anchor',    core: '✔', cipher: '◌', void: '◌' },
        { percent: 66, bar: 8,  text: '◒ severing the last anchor',    core: '✔', cipher: '✔', void: '◌' },
        { percent: 75, bar: 9,  text: '◒ severing the last anchor',    core: '✔', cipher: '✔', void: '◌' },
        { percent: 83, bar: 10, text: '◓ anchoring to the void',       core: '✔', cipher: '✔', void: '◌' },
        { percent: 91, bar: 11, text: '◓ anchoring to the void',       core: '✔', cipher: '✔', void: '◌' },
        { percent: 100, bar: 12, text: '✔ synchronization complete',    core: '✔', cipher: '✔', void: '✔' }
    ];

    function generateLoadingFrame(step) {
        const totalBlocks = 12;
        const filled = '▰'.repeat(step.bar);
        const empty = '▱'.repeat(totalBlocks - step.bar);
        const pct = String(step.percent).padStart(2, '0') + '%';

        return `╔═◈═════════════◈═╗
   E V E N T I D E   O M E G A
        ⟁  *eclipse core*  ⟁
╚═◈═════════════◈═╗

   ${step.text}
   ⟢ ${filled}${empty} ⟣   ${pct}
   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
   ${step.core} core    ${step.cipher} cipher    ${step.void} void`;
    }

    const STAGE2_TEXT = `.
        ◢██◣
     ◢████◣.           ╔═════════
    ◢██  ██◣.          ║     T H E   V O I D ║ 
◢██   🌑   ██◣.    ║          E X S I T S  ║
    ◥██      ██◤.        ╚══════════╝.
     ◥██  ██◤
         ◢██◣

════════════════════════════════════
   even in your darkest hour...
════════════════════════════════════`;

    const STAGE3_TEXT = `${groupChannelLink}

╔════════╦════════╗
        ⚠ EVENTIDE OMEGA
               TERMINAL ACCESS
╚════════╩════════╝

                ═══ E C L I P S E ═══
             " i am what remains when 
              everything else is deleted ."

╔════════╦════════╗
║Void signature║SYS CORE║
║👤@Unknown.║ECLIPSE ║
║⚠ASCENDED║ABS ZERO║
╚════════╩════════╝

                   🌑 THE FINAL DUSK 🌑
            " when the last star dies, 
              i will still be typing ."

📡 SECURE │ Ω │ Vessels: ∞
 You have summoned what 
 cannot be unsummoned

📡 Use *.help* to explore the codex.

> _Developed by 【 亗 ᑭᗩTᖇIᑕK ᗪEᐯ 亗 】✧_`;

    // The animated loading message edits into this once it points down to the
    // banner image (the full STAGE3_TEXT is then sent as the image caption).
    const STAGE3_ARROWS_TEXT = `╔════════╦════════╗
        ⚠ EVENTIDE OMEGA
               TERMINAL ACCESS
╚════════╩════════╝

                ═══ E C L I P S E ═══

                 ▾
                ▾ ▾
               ▾ ▾ ▾
         gaze below, keeper...
               ▾ ▾ ▾
                ▾ ▾
                 ▾

📡 SECURE │ Ω │ VESSEL: ∞`;

    const POLL_QUESTION = `╔════════╦════════╗\n        ⚠ EVENTIDE OMEGA\n╚════════╩════════╝`;
    const POLL_OPTIONS = [
        '╰|...➤ [ 1. OWNERS MENU ]',
        '╰|...➤ [ 2. GROUP MENU ]',
        '╰|...➤ [ 3. FUN MENU ]',
        '╰|...➤ [ 4. BUG MENU ]'
    ];
    const MENU_POLL_IDS = ['owners', 'group', 'fun', 'bug'];

    // Sends the Eclipse persona menu: the original cinematic 3-stage animation,
    // banner image and the Owners/Group/Fun poll. Unchanged from the classic menu.
    async function sendEclipseMenu(sock, remoteJid, phoneNumber) {
        log('WA-CMD', `${phoneNumber}: Granular menu loading animation triggered.`);
        try {
            const personaConfig = {
                stages: {
                    stage1: animSteps,
                    stage2Text: STAGE2_TEXT,
                    stage3Text: STAGE3_TEXT
                }
            };

            // Send initial Step 1 (08%)
            const firstFrame = generateLoadingFrame(personaConfig.stages.stage1[0]);
            const sentMsg = await sock.sendMessage(remoteJid, { text: firstFrame });
            const messageKey = sentMsg.key;

            // Step through frames 2 to 12 with a snappy 150ms transition
            for (let i = 1; i < personaConfig.stages.stage1.length; i++) {
                await delay(150);
                const nextFrame = generateLoadingFrame(personaConfig.stages.stage1[i]);
                await sock.sendMessage(remoteJid, { text: nextFrame, edit: messageKey });
            }

            // Stage 2 (The Persona-specific Art/Message)
            await delay(400);
            await sock.sendMessage(remoteJid, { text: personaConfig.stages.stage2Text, edit: messageKey });

            // Edit the animated message to point down to the banner image below
            await delay(800);
            await sock.sendMessage(remoteJid, { text: STAGE3_ARROWS_TEXT, edit: messageKey });

            // Send the banner image as a NEW message, with the full terminal
            // text as its caption.
            await delay(300);
            await sock.sendMessage(remoteJid, {
                image: { url: menuBannerPath },
                caption: STAGE3_TEXT
                // contextInfo: channelContextInfo() // (commented: externalAdReply caused "no proper viewing app" error)
            });

            // Send native Poll Menu (Owners / Group / Fun / Bug)
            await delay(400);
            await sendMenuPoll(sock, remoteJid, phoneNumber, POLL_QUESTION, POLL_OPTIONS, MENU_POLL_IDS);

            log('WA-CMD', `${phoneNumber}: Menu animation & poll delivery completed successfully.`);
        } catch (err) {
            logError('WA-CMD', `${phoneNumber}: Failed executing Menu animation/poll`, err);
        }
    }

    return Object.freeze({
        POLL_QUESTION,
        POLL_OPTIONS,
        MENU_POLL_IDS,
        generateLoadingFrame,
        sendEclipseMenu
    });
}
