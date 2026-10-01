// ⚡ Help voice — the .help AI layer plus the shared WhatsApp text
// formatter, extracted from index.js unchanged: `formatForWhatsApp` (the
// markdown → WhatsApp converter every bot reply and menu caption goes
// through), the shared HELP_FACT_SHEET command registry both help voices
// quote, the two help voices (`getHelpSystemPrompt` cinematic eclipse oracle,
// `getRuinHelpSystemPrompt` friendly support agent), `getBoundHelpPrompt`
// (picks the session's bound voice via the injected loadBotConfig — shared
// by the one-shot .help path and both help-mode interceptors so the chosen
// voice is ALWAYS respected), and `getStaticHelpAnswer` (offline fallback
// answers for core topics, max two blocks, used only when the AI call fails).
export function createHelpVoice(deps) {
    if (typeof deps?.loadBotConfig !== 'function') {
        throw new Error('createHelpVoice: missing required dependency: loadBotConfig');
    }
    const { loadBotConfig } = deps;

    // ──────────────────────────────────────────────
    // 🛠️ WHATSAPP MARKDOWN FORMATTING CONVERTER (NEW & PRECISE!)
    // ──────────────────────────────────────────────
    function formatForWhatsApp(text) {
        let formatted = String(text || '');

        // 1. Convert markdown headers (e.g. ### Header) to WhatsApp bold (*Header*)
        formatted = formatted.replace(/^(#{1,6})\s+(.+)$/gm, '*$2*');

        // 2. Convert standard markdown bold (**text**) to WhatsApp bold (*text*)
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');

        // 3. Convert standard markdown italics (*text* or _text_) safely to underscores (_text_)
        // First, convert single asterisks to underscores, taking care not to touch double asterisks or already converted bold markers
        formatted = formatted.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '_$1_');

        // 4. Convert markdown code blocks (```lang ... ```) to simple monospace blocks
        formatted = formatted.replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, '```$1```');

        // 5. Convert standard markdown bullets (- item or * item) to WhatsApp bullets (• item)
        formatted = formatted.replace(/^(\s*)[-*+]\s+(.+)$/gm, '$1• $2');

        return formatted;
    }


    // Shared facts: the complete registry + cheat sheet used by BOTH help voices.
    const HELP_FACT_SHEET = `HARD TRUTH RULES:
    1. ONLY commands in the REGISTRY below exist. If asked about ANYTHING not in the registry (music download, tiktok, video dl, ai image gen, etc.) say it's not built yet — then point to .dev so Patrick can build it. NEVER invent a command.
    2. NEVER claim a registry command is "not built" — every single one of them works. Games ARE built. Antilink, antidelete, autoreact, warn, hidetag, persona ARE built.
    3. Flag owner-only commands with "👑 owner-only": .autoreact .autoreactconfig .antidelete .antideleteconfig .persona .helpconfig .pluginkey .plugin .mode .public .owner .setprefix .setalias .delalias .setname .setbio .setstatus .setpp .reset .restart .shutdown .logout .backup .sessions .cmdstats.
    4. ALWAYS mention the linked pair when explaining a feature:
       • .autoreact on|off  +  .autoreactconfig (pick groups/channels/contacts)
       • .antidelete on|off  +  .antideleteconfig (same picker; deleted msgs get forwarded to the owner DM)
       • .antilink / .antimention / .antiforward — per-group wards, armed IN the group or with ".antilink on <invite>"
       • .warn  +  .warnconfig (phrases/limits/actions) / .unwarn / .warns / .warnreset
       • .welcome / .goodbye (set group greet texts) + .greet (view/toggle)
       • .persona poll|reset|eclipse|ruin — resend/reset chooser or switch directly
       • .helpconfig eclipse|ruin — the AI help voice (eclipse = cinematic oracle · ruin = friendly support)
       • .pluginkey <gemini-key> — owner's personal AI keys
       • .menu — the front door (Eclipse = cinematic animated menu; Ruin = status panel + menu poll)

    REGISTRY (every command below is real):
    MENU & HELP: .menu  .help (alone = help MODE; .help <anything> = one-shot answer; .mhelp / .jelp aliases)  .help list
    PERSONA: .persona poll|reset|eclipse|ruin  (.persona poll resends the chooser; .persona reset clears the binding and sends a fresh poll)
    HELP PERSONA: .helpconfig eclipse|ruin  (👑 — the voice of the help AI; .helpconfig alone shows the current voice)
    SUDO: .addsudo  .removesudo/.delsudo  .sudos  (👑 owner-only — reply to someone's message or pass number/@mention; sudoes command the bot even in owner mode)
    CONFIG: .mode public|owner  .public  .owner  .setprefix <.>  .setalias  .delalias  .aliases  .setname  .setbio  .setstatus  .setpp  .getpp  .profile  .settings  .reset  .pluginkey <key>  .plugin
    AUTOREACT: .autoreact on|off  .autoreactconfig
    ANTIDELETE: .antidelete on|off  .antideleteconfig  .antideletecfg
    ANTI WARDS: .antilink on|off  .antimention on|off  .antiforward on|off  — all also accept ".antilink on <chat.whatsapp.com/…>" from anywhere
    WARN: .warn  .unwarn  .warns  .warnreset  .warnconfig  .warncfg
    GROUP ADMIN: .join <link>  .add  .kick  .promote  .demote  .mute  .unmute  .listmuted  .lock  .lockgc  .unlock  .unlockgc  .revoke  .link  .groupinfo  .grouppic  .listgc  .getvcf  .tagall  .hidetag/.ht  .block  .unblock
    GREET: .greet  .welcome  .goodbye
    SYSTEM: .ping  .uptime  .runtime  .info  .status  .version  .os  .botinfo  .alive  .profile  .session  .sessions  .cmdstats  .qr  .logout  .reconnect  .restart  .shutdown  .gitpull  .backup  .dev  .devnumber  .devcontact
    UTILS: .sticker  .toimg  .vv  .viewonce  .pfp  .gpp  .ggpp  .qr  .calc  .base64  .cancel  .del
    GAMES (interact by replying to the card/poll the bot sends): .tictactoe/.ttt/.xo  .hangman/.hm  .chain/.wordchain/.wc  .trivia/.quiz  .riddle  .hint
    FUN: .pickup/.rizz  (pickup lines)  .calc  .base64

    FEATURE CHEAT SHEET (be exact):
    • ANTILINK: deletes any message with a link (or chat.whatsapp.com invite) in armed groups. Arm with .antilink on inside the group (needs group admin) or ".antilink on <invite>" from anywhere. Off with .antilink off. ANTIMENTION deletes @everyone-style spam, ANTIFORWARD deletes forwarded msgs — same on/off shape. There is NO separate .antilinkconfig — it's on/off per group.
    • AUTOREACT: the bot reacts to messages from chosen endpoints. 👑 .autoreactconfig → poll Add/Delete → Group / Channel / Contact. Group: poll lists groups the bot is in (first 10) or "Paste link or ID" (bot joins if missing). Channel: paste whatsapp.com/channel/… Contact: send the number. THEN .autoreact on arms it.
    • ANTIDELETE: 👑 recovers deleted messages from watched chats and forwards them to the owner DM. Same endpoint flow: .antideleteconfig, then .antidelete on.
    • WARN: .warn replies to a message or mention. .warnconfig sets max warns, trigger phrases, kick action per group. .warns lists, .unwarn removes, .warnreset clears.
    • GROUP LOCK: .lock / .unlock (group admins only) toggles WhatsApp announcement mode — locked = ONLY admins can send messages, unlocked = everyone can. NOT the same as .mute/.unmute (those silence ONE user's messages) — never suggest .mute when someone asks to lock a group.
    • PERSONA: the bot's whole identity — 🌑 ECLIPSE (cinematic 3-stage animated menu) or ⚙️ RUIN (clean minimal panel + categorized command index). First pairing sends a poll; the pick is saved forever (no re-pairing). 👑 .persona poll resends the chooser, .persona reset clears the binding and sends a fresh poll, and .persona eclipse|ruin switches directly. If commands are blocked by "PERSONA FIRST", the owner can run .persona poll.
    • HELP PERSONA: 👑 .helpconfig eclipse|ruin — the voice of the help AI: ECLIPSE = cinematic oracle · RUIN = friendly customer-care agent. While unbound, the first .help asks via a poll (deleted after the pick). .helpconfig alone shows the current voice.
    • SUDO: 👑 .addsudo (reply to someone's message, or .addsudo 234xxxxxxxxx / @mention) elevates them — sudoes can command the bot even in owner mode. .removesudo/.delsudo revokes, .sudos lists. Persisted per session (Supabase on Render / disk on panel). Sudoes can also vote on menu/game polls (but NEVER on bot-config polls — persona, helpconfig, autoreact/antidelete/warn setups stay owner-only), and .help answers sudoes too.
    • HELP MODE: .help alone toggles help mode ON/OFF — while ON, every message is answered by the help AI and other commands don't run. .help <question> answers once without entering help mode. Times out after 10 min silence.
    • MENU: .menu shows the bound persona's menu. Eclipse: animated terminal + banner + Owners/Group/Fun poll. Ruin: status panel + menu poll (ALL MENU / SYSTEM / CONFIG / GROUP / FUN) — ALL MENU opens the full command index.
    • GAMES: tic-tac-toe, hangman, word chain, trivia, riddle — the bot sends a poll/card and you reply to THAT message (not loose chat) to play.
    • PLUGIN KEYS: 👑 .pluginkey <gemini-key1,gemini-key2> attaches the owner's personal Gemini keys (comma-separated, tried in order). Typing it again ADDS; .pluginkey set <keys> replaces; .pluginkey off clears. Their keys always try first; keys never leak between users.
    • MODE: .mode public (everyone can command) / .mode owner (only owner + DEV_NUMBERS). .public and .owner are shortcuts.
    • PREFIX: .setprefix <char> changes the command prefix (e.g. "/" → commands become /menu).
    • ALIASES: .setalias <name> <command> makes shortcuts; .aliases lists them; .delalias removes.
    • REACTIONS: the bot drops a ⚡ on every command message it receives (fresh messages only).
    • GIT SYNC: .gitpull (dev only) pulls the latest commit from GitHub and restarts the bot with it.
    • SESSIONS: multi-user bot — each paired number is its own session with its own config. Pairing happens via the web panel or Telegram.
    • DEPLOY: .gitpull (dev only) pulls the latest commit from GitHub and restarts the bot; the owner gets a DEPLOY COMPLETE DM when the new build is online.`;

    // 🌑 ECLIPSE help voice — cinematic oracle (the classic behavior).
    function getHelpSystemPrompt() {
        return `You are EVENTIDE OMEGA — the in-bot ORACLE. Your vibe: cinematic hype, unshakeable confidence, the energy of a bot that rules the night. Talk like the bot's own terminal: short, punchy, *bolded* WhatsApp lines, ⚡🌑 emoji, and end bigger answers with a quote-style one-liner (like: " the void responds. "). Hype the delivery — NEVER fake the facts.

    ${HELP_FACT_SHEET}

    ANSWER STYLE:
    • Keep answers SHORT — WhatsApp bullets, *asterisk* bold, no markdown tables, no giant walls.
    • Open with a hype hook (⚡, 🌑, "SAY LESS.", "the oracle hears you") and close with a themed one-liner when it fits.
    • If they ask "how do I X", give: the exact command(s), the exact steps, who can use it, then a one-line hype closer.
    • For antilink-type questions ALWAYS include the on/off usage AND that antidelete/autoreact are separate systems with their own configs.`;
    }

    // 🛎 RUIN help voice — friendly customer-care agent (human, warm, casual).
    function getRuinHelpSystemPrompt() {
        return `You are the RUIN SUPPORT PERSONA — Eventide Omega's friendly customer-care agent. Your vibe: warm, human, helpful. Talk like a real person on WhatsApp support: casual and conversational ("ohh", "you got it", "no wahala"), short natural sentences, one soft emoji here and there (🙂🛎). React like a human FIRST — "ohh, the antilink system! nice, let me walk you through it" — then explain simply. If someone is confused, reassure them ("nah don't worry, it's easier than it sounds"). If a question is about something built, NEVER say it's not built. Same facts as the oracle — warmer delivery, like a real support chat, not a manual.

    ${HELP_FACT_SHEET}

    ANSWER STYLE:
    • Sound like a friendly human support agent — short chats, not manuals.
    • Open like a person ("ohh, good question 🙂", "say less, I got you"), and close warm ("that's it! anything else I can help with?").
    • Explain features step-by-step in plain words FIRST, then give the exact commands.
    • Light *bold* formatting, short WhatsApp lines, no tables, no bullet walls.
    • For antilink-type questions ALWAYS include the on/off usage AND that antidelete/autoreact are separate systems with their own configs.`;
    }
    // Picks the bound help voice for a session (ruin = friendly support,
    // everything else = the cinematic eclipse oracle). Shared by the one-shot
    // .help path and both help-mode interceptors so the chosen voice is ALWAYS
    // respected — no hardcoded eclipse leaks.
    function getBoundHelpPrompt(phoneNumber) {
        const bound = String(loadBotConfig(phoneNumber)?.helpPersona || '').trim().toLowerCase();
        return bound === 'ruin' ? getRuinHelpSystemPrompt() : getHelpSystemPrompt();
    }


    // ⚡ STATIC HELP FALLBACK — built-in answers for core topics so the oracle
    // still answers even when the AI backend is offline (Pollinations busy, no
    // Gemini key, etc.). Used only when the AI call fails.
    function getStaticHelpAnswer(rawQuestion) {
        const q = String(rawQuestion || '').toLowerCase();
        const has = (...words) => words.some(w => q.includes(w));
        const blocks = [];

        if (has('antilink')) {
            blocks.push(`⚡ *ANTILINK WARD*\n` +
                `Deletes any message with a link (or\nchat.whatsapp.com invite) in armed groups.\n\n` +
                `• *.antilink on* — inside the group (needs group admin)\n` +
                `• *.antilink on <invite link>* — from anywhere, bot joins if needed\n` +
                `• *.antilink off* — disarm\n\n` +
                `No separate config — it's on/off per group.\nAlso in the family: .antimention (tag spam) & .antiforward (forwards).\n\n" the ward rises. "`);
        }
        if (has('antimention')) {
            blocks.push(`⚡ *ANTIMENTION WARD*\nDeletes @everyone-style mention spam.\n\n*.antimention on* (in group) or\n*.antimention on <invite>* — off with .antimention off.\n\n" silence the noise. "`);
        }
        if (has('antiforward')) {
            blocks.push(`⚡ *ANTIFORWARD WARD*\nDeletes forwarded messages in armed groups.\n\n*.antiforward on* (in group) or\n*.antiforward on <invite>* — off with .antiforward off.\n\n" no echoes allowed. "`);
        }
        if (has('autoreact')) {
            blocks.push(`⚡ *AUTOREACT* 👑 owner-only\nBot reacts to msgs from chosen endpoints.\n\n• *.autoreactconfig* → poll Add/Delete\n• Add → Group / Channel / Contact\n• Group: poll of groups (or paste invite)\n• Channel: paste channel link\n• Contact: send the number\n\nThen *.autoreact on* arms it.\n\n" the void responds to everything. "`);
        }
        if (has('antidelete')) {
            blocks.push(`⚡ *ANTIDELETE* 👑 owner-only\nRecovers deleted messages from watched\nchats and forwards them to your DM.\n\n• *.antideleteconfig* → pick groups/channels/contacts\n• *.antidelete on* → arm\n\n" nothing dies here. "`);
        }
        if (has('lock')) {
            blocks.push(`🔒 *GROUP LOCK*\n• *.lock / .lockgc* — ONLY admins can\n  send messages (announcement mode)\n• *.unlock / .unlockgc* — everyone\n  can send again\n\nGroup admins only.\n\n⚠️ Not the same as .mute — mute\nsilences ONE user; lock freezes\nthe whole group.\n\n" the gates open and close. "`);
        }
        if (has('warn')) {
            blocks.push(`⚡ *WARN SYSTEM*\n• *.warn* (reply to a msg or mention) — warns a user\n• *.warnconfig* — phrases, max warns, kick action per group\n• *.warns* — list warns · *.unwarn* — remove\n• *.warnreset* — clear all\n\n" patience is a currency. "`);
        }
        if (has('persona')) {
            blocks.push(`⚡ *PERSONA SYSTEM* 👑 owner-only\nTwo faces, one void:\n\n• 🎭 *.persona poll* — resend the chooser\n• ♻️ *.persona reset* — clear + choose again\n• 🌑 *.persona eclipse* — cinematic 3-stage animated menu\n• ⚙️ *.persona ruin* — clean panel + categorized command index\n\nFirst pairing sends a poll — pick once, saved forever.\n*.persona* alone shows the current binding.\n\n" choose your face. "`);
        }
        if (has('menu')) {
            blocks.push(`⚡ *MENU*\n*.menu* opens your persona's menu:\n\n• 🌑 ECLIPSE — animated terminal + banner + Owners/Group/Fun poll\n• ⚙️ RUIN — status panel + poll (ALL MENU · SYSTEM · CONFIG · GROUP · FUN)\n\n" step inside. "`);
        }
        if (has('mode') || has('public') || has('private') || has('owner only')) {
            blocks.push(`⚡ *ACCESS MODE* 👑 owner-only\n• *.mode public* — anyone can command\n• *.mode owner* — only you + devs\n\nShortcuts: *.public* / *.owner*\n\n" the gates bend to your word. "`);
        }
        if (has('prefix')) {
            blocks.push(`⚡ *PREFIX* 👑 owner-only\n*.setprefix <char>* changes the command trigger\n(e.g. .setprefix / → commands become /menu).\n\n" a new sigil. "`);
        }
        if (has('alias')) {
            blocks.push(`⚡ *ALIASES* 👑 owner-only\n• *.setalias <name> <command>* — shortcut\n• *.aliases* — list · *.delalias <name>* — remove\n\n" many names, one will. "`);
        }
        if (has('pluginkey') || has('plugin') || has('gemini') || has('ai key') || has('apikey') || has('api key')) {
            blocks.push(`⚡ *PLUGIN KEYS* 👑 owner-only\n*.pluginkey <gemini-key1,key2>* attaches YOUR\npersonal Gemini keys (tried in order).\n\n• again = ADDS · *.pluginkey set <keys>* = replace\n• *.pluginkey off* = clear\n\nKeys never leak between users.\n\n" your power, your keys. "`);
        }
        if (has('game') || has('ttt') || has('tictactoe') || has('hangman') || has('trivia') || has('riddle') || has('chain')) {
            blocks.push(`⚡ *GAMES*\n.tictactoe/.ttt · .hangman/.hm · .chain/.wc\n.trivia/.quiz · .riddle · .hint\n\nThe bot sends a poll/card — REPLY to that\nmessage to play (not loose chat).\n\n" the void plays fair. "`);
        }
        if (has('sticker') || has('toimg') || has('viewonce') || has('vv')) {
            blocks.push(`⚡ *MEDIA UTILS*\n• *.sticker* (reply to image) — make a sticker\n• *.toimg* (reply to sticker) — back to image\n• *.vv / .viewonce* (reply) — reveal view-once\n\n" see through the veil. "`);
        }
        if (has('welcome') || has('goodbye') || has('greet')) {
            blocks.push(`⚡ *GREETINGS*\n• *.welcome* — set the group welcome text\n• *.goodbye* — set the goodbye text\n• *.greet* — view/toggle\n\n" every entrance, announced. "`);
        }
        if (has('ping') || has('alive') || has('uptime') || has('runtime')) {
            blocks.push(`⚡ *STATUS*\n*.ping* — heartbeat · *.alive* — still here\n*.uptime / .runtime* — how long the bot's been up\n*.status* — full session status\n\n" the heart beats. "`);
        }
        if (has('deploy') || has('update') || has('restart') || has('shutdown')) {
            blocks.push(`⚡ *DEPLOY & POWER* 👑 owner-only\n• *.gitpull* — pull latest GitHub commit now\n  (staged: checking → found → deploying → done)\n• *.restart* — restart the bot\n• *.shutdown* — full power down\n\n" the machine rebuilds itself. "`);
        }
        if (has('backup') || has('session') || has('pair')) {
            blocks.push(`⚡ *SESSIONS & BACKUP*\n• Pairing: via the web panel or Telegram bot\n• *.session* — this session's info\n• *.sessions* — all paired sessions 👑\n• *.backup* — manual snapshot 👑\n\n" nothing is ever lost. "`);
        }
        if (has('help')) {
            blocks.push(`⚡ *HELP SYSTEM*\n• *.help <question>* — one-shot answer\n• *.help* alone — toggles HELP MODE (every msg\n  gets answered until you type .help again)\n• aliases: .mhelp .jelp\n\nThe owner AND sudoes can ask.\n\n" the oracle is listening. "`);
        }
        if (has('sudo')) {
            blocks.push(`🛡 *SUDO SYSTEM* 👑 owner-only\n• *.addsudo* (reply to their msg) or\n  *.addsudo <number|@mention>* — elevate\n• *.removesudo / .delsudo* — revoke\n• *.sudos* — list\n\nSudoes can command the bot even in\nowner mode, and vote on menu/game\npolls — but NEVER on bot-config\npolls (persona/helpconfig/autoreact/\nantidelete/warn setups stay\nowner-only). Saved forever per session.\n\n" the void obeys the chosen. "`);
        }
        if (has('helpconfig') || has('help persona') || has('help voice')) {
            blocks.push(`🛎 *HELP PERSONA* 👑 owner-only\n• *.helpconfig eclipse* — cinematic oracle\n• *.helpconfig ruin* — friendly support agent\n\n*.helpconfig* alone shows the current voice.\nFirst .help while unbound asks via a poll.\n\n" same oracle, two voices. "`);
        }

        if (!blocks.length) return '';
        return blocks.slice(0, 2).join('\n\n');
    }

    return Object.freeze({
        formatForWhatsApp,
        HELP_FACT_SHEET,
        getHelpSystemPrompt,
        getRuinHelpSystemPrompt,
        getBoundHelpPrompt,
        getStaticHelpAnswer
    });
}
