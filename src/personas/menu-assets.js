// 🖼️ Menu assets — the shared presentation constants for the bot's
// menus, polls, and channel branding, extracted from index.js unchanged:
// TERMINAL_HEADER (the EVENTIDE OMEGA terminal banner), the fully-embedded
// channel link-preview (metadata + base64 thumbnail baked in — zero HTTP
// requests) with attachChannelPreview/channelContextInfo builders, the
// persona / help-persona / domain poll definitions, and the six big menu
// texts (owners welcome, group/system/config menus, fun & bug placeholders).
// The banner-image filesystem paths stay in index.js (they are __dirname-
// based and injected into consumers there, per the eclipse-interface
// convention). The channel link is injected as groupChannelLink.
export function createMenuAssets(deps) {
    if (typeof deps?.groupChannelLink !== 'string' || !deps.groupChannelLink) {
        throw new Error('createMenuAssets: missing required dependency: groupChannelLink');
    }
    const { groupChannelLink } = deps;


    const TERMINAL_HEADER =
        '╔════════╦════════╗\n' +
        '        ⚠ EVENTIDE OMEGA\n' +
        '               TERMINAL ACCESS                                                                         \n' +
        '╚════════╩════════╝\n\n';

    // WhatsApp channel link), with a fallback default if unset.

    // 🖼️ FULLY EMBEDDED channel link-preview. The channel metadata + thumbnail are
    // baked into the code, so the bot NEVER makes an HTTP request for previews —
    // no delay, no repeated fetches. The thumbnail is stored as base64 and decoded
    // once at startup.
    const CHANNEL_PREVIEW_TITLE = "\u2500\u2500\u2500 \u4e97 \u1d18\u1d05\u1d20 \u1d1b\u1d07\u1d04\u029c\u0274\u1d0f\u029f\u1d0f\u0262\u026a\u1d07\ua731 \u4e97 \u2500\u2500\u2500";
    const CHANNEL_PREVIEW_DESC = "Follow \u2500\u2500\u2500 \u4e97 \u1d18\u1d05\u1d20 \u1d1b\u1d07\u1d04\u029c\u0274\u1d0f\u029f\u1d0f\u0262\u026a\u1d07\ua731 \u4e97 \u2500\u2500\u2500's WhatsApp Channel. Join 41 followers for the latest updates.";
    const CHANNEL_PREVIEW_MATCHED = "https://whatsapp.com/channel/0029VbCrFiK17En02cax3r02";

    // 📋 VERBOSE_LOGS=true turns on per-message tracing (upsert ids, parse trees,
    // send ids). Default OFF so Render logs stay readable — REACT, errors and
    // command-level logs always show.
    const CHANNEL_PREVIEW_THUMB_B64 = [
        "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBD",
        "ARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCADAAMAD",
        "ASIAAhEBAxEB/8QAGgABAQEBAQEBAAAAAAAAAAAAAAECBAMFBv/EAC0QAAICAQMCBQQCAgMAAAAAAAABAhEDEiExBAUTQVFhkRQi",
        "MnEVgWKhI7Hx/8QAFwEBAQEBAAAAAAAAAAAAAAAAAAECA//EABoRAQEBAQEBAQAAAAAAAAAAAAARAQISIRP/2gAMAwEAAhEDEQA/",
        "APwYBQgwAAKClEKABp8sybfLMgQFAEBQAXISFVuEgBGUNAZBRQEfoZNS5IBAARQo8gVAqBVyAAfJQACRpR/sBLkhXyQACgCUCgCA",
        "ofoBGQ0+aJ6ARkRaLsBmXLMno1e6MMCEKCBwUJl2RQSNxim93Rgtgakt3XBEvUiZXyBbF+hCgAAABQBAUAQPkpACHoAuQEtm0ZN5",
        "VWSX7MALJyKCQEocDcUBDT/FGTb/ABX6AgBQBp8/0IxcnsrN5o6ZpeyLCvMoBBQC0BAUtAQhogEBSAQAAWX3NswUfsCApAIQt/sg",
        "FSS5F2zJpAVK+OTcYXzsvcwjW7Kj1WXRHTjVe/meXLstFoqIWi0WiRWUi0aoUWJUoUaotCFYoUbolCFYojRuiUIVgGqFEisDc1Qo",
        "QrBGbZhoQT+0QMhFDSIjUIuUlGKbk3SSVtlwVG0ju6TtWTLq+p8fpqrTfSznq+Fse2ftWPDgnlXU5ZaVdPo8kU/7eyNZjnu4+akW",
        "j6WHt8MmFZFJPV07kryxjWS6Sq+KPOXR4/5DD0qyVrUE5bSqTXt7m/LHvHDRaPoLt2OlN53ocMkl/wAe/wBj3VX8Mke3xnieWOa4",
        "vFLLj+zeWl1JPfZr/onnT9OXDRUjolgh4kILMot49cnkWlR2uvg6ZdqyQlljLPg1YoOc1qdpJJ+n+SEaza+fRaO2Pb5trVlwxhLJ",
        "4cJyl9s5UnS28rVvyNw7blnPFFTxXlxyyxuT4jd3tzs/gsxPr59Eo+hLt2WMMU3PGseXE8sJ3s0lbXHK9DGTt+XGsik4a8UFPLjv",
        "7oRdbv5V+liYfXC0Ro7p9vzQ63L0rePXhTeSWr7YpK22yPt2XR4urH4Hh+J41/bpuv3d7VyZiuChR3fx83DJNZsDhBwTald6/wAa",
        "2/8ACz7XmjmniWTFKWPX4mlt6VD8nxuv0FcFEaO3D0kZdXLp55INqDlGUJqm9Nrdntl7dDHgeSU4rT0ym6yxleS6apP0LGd6zNj5",
        "TRln1sHasefBDK+oyx1K6XR5Jpf2tmePV9qyYtP03j9Rd3XSzhp+VuZ3Gs3HzGZZ6Ti4ycZJxknTTVNGGZdBGotxkpRbi07TTpow",
        "aQR34O5Z4X4uTPmvi+onGvhnpl7lLNiljePKlJVv1U5L4ezPnJm0zedOe8Za7sXU4ceNRUv3fTQl/tmVnhDq8eeCc9MlJrSobr2R",
        "ypizfpnxjqx9Xpz5Mk1kmpxlCnPdJmodbLHkwOEKx4bqDd6r/K/2cliyetPGPWcvElKUuZO2fR/lYvrup6pYssXnxeGtM1cdkruv",
        "8T5Vlslaj6WTuGLPhWHN0+SUIZHkg1kWpuSWrVtw2r24PTD3Z4lgiseVY8WCeJwWTaWrVvx5av8AR8rUXUPiR9GPcvD6eeCGKTxz",
        "wLG1OV6ZpNKa9Nm1XoM3c/En1GVYpLP1OPw8stS01tqaXq6/rc+dqJqL8H1MvdMWTqOqzLpZ31VxyJ5FtFrhbc2k79jz/lF9L9G8",
        "MvpfD0VqWu9WrVfHPl6HzmyWRX0cvcsc4ZYLp5RjN4q0tL8PN7cu2zeXu8cnVS6nR1Mc2qTxzWanit3UaXrfPqfKsWRXXl6uHUdd",
        "PqckfD1b0oKVuq3XG/P7GTqcOSDi5cry6aEf9o47DZrOpjO8Xa7MXcpYcUcahlaiq26qcV8LZHnn7lnyV4WTPhrmuonK/lnK2YbM",
        "71q5xlqTk5ScpNtt223bZllZlmHQKiFIrSZpMwi2WpG7RbPOy2WpG7FmLFkqx6WLPOy2WkemotnnYsVI3qFmNQsUjVjUYslikbsl",
        "kSb3ey9Q5JcfIFsWZu+SMlWK2TkLi2yavQA0ZYYv1IpZbM2WwLYsnJQLwLILAoAAosgApbMlAWAAAIANze0V7GDU3uYBijyIa20e",
        "9gR8Iyakvtj+jIAgAD9DcCyClJYsooIAKuQAAKQAUEKQAQFFICpWAuxXwXZIlu9gGyLV+yMktge0kpQS4aPFqi6tqfAu/cupjILS",
        "JZFEQAiqAAigAovuwSwBf2QvlZABRXqLAAXYaAGpOuDCLIA2FyiEApACAby454ZKM1TaTJiyyxZFOKTa9VZ0db1n1OmMYpRS81vZ",
        "RykZfIgAAEVR8EARfgfBABS+RAUXyNqoxujBX+KAN2QgAosgA0JEEgIACACAKAAC+RGPIBH/2Q==",
    ].join("");

    // Decode the embedded thumbnail once at startup and build the linkPreview
    // object that Baileys uses directly (no network request ever needed).
    const CHANNEL_LINK_PREVIEW = {
        'matched-text': CHANNEL_PREVIEW_MATCHED,
        jpegThumbnail: Buffer.from(CHANNEL_PREVIEW_THUMB_B64, 'base64'),
        description: CHANNEL_PREVIEW_DESC,
        title: CHANNEL_PREVIEW_TITLE,
        previewType: 0
    };

    // Attaches the embedded channel preview to a text content object if the text
    // contains the channel link. Purely local — zero HTTP requests.
    function attachChannelPreview(content) {
        if (!content?.text || !String(content.text).includes(groupChannelLink)) return content;
        content.linkPreview = CHANNEL_LINK_PREVIEW;
        return content;
    }

    // Builds a contextInfo with an externalAdReply card (thumbnail + title + link).
    // This works on ANY message type — including image+caption menu messages, where
    // Baileys would otherwise never generate a URL preview for the caption.
    function channelContextInfo() {
        return {
            externalAdReply: {
                title: CHANNEL_PREVIEW_TITLE,
                body: CHANNEL_PREVIEW_DESC,
                thumbnail: CHANNEL_LINK_PREVIEW.jpegThumbnail,
                mediaType: 1,
                sourceUrl: groupChannelLink,
                renderLargerThumbnail: true,
                showAdAttribution: false
            }
        };
    }

    // 🎭 PERSONA SELECTION (first pairing only)
    const PERSONA_POLL_QUESTION = `╔════════╦════════╗\n     EVENTIDE OMEGA\n    CHOOSE PERSONA\n╚════════╩════════╝`;
    const PERSONA_POLL_OPTIONS = [
        '🌑 ECLIPSE — cinematic terminal',
        '⚙️ RUIN — clean & minimal'
    ];
    const PERSONA_POLL_IDS = ['persona_eclipse', 'persona_ruin'];

    // 🛎 HELP AI PERSONA SELECTION (first .help when unbound)
    const HELP_PERSONA_POLL_QUESTION = `╔════════╦════════╗\n     EVENTIDE OMEGA\n    CHOOSE HELP AI\n╚════════╩════════╝`;
    const HELP_PERSONA_POLL_OPTIONS = [
        '🌑 ECLIPSE — cinematic oracle',
        '🛎 RUIN — friendly support'
    ];
    const HELP_PERSONA_POLL_IDS = ['helpp_eclipse', 'helpp_ruin'];

    // ──────────────────────────────────────────────
    // 🗂️ SUB-MENU / DOMAIN POLLS
    // ──────────────────────────────────────────────
    const DOMAIN_POLL_QUESTION = `╔════════╦════════╗\n     CHOOSE YOUR DOMAIN\n╚════════╩════════╝`;
    const DOMAIN_POLL_OPTIONS = [
        '╰|...➤ [ 1. SYSTEM MENU ]',
        '╰|...➤ [ 2. CONFIG MENU ]'
    ];
    const DOMAIN_POLL_IDS = ['system', 'config'];

    const OWNERS_WELCOME_TEXT = `${groupChannelLink}

    ╔════════╦════════╗
            ⚠ EVENTIDE OMEGA
                   TERMINAL ACCESS
    ╚════════╩════════╝

    " you built this night —
      you rule its stars. "

    *WELCOME, BOSS. 👑*

    This is the Owners Menu — yours alone.

    • *System Menu* — see how the bot is running
      (uptime, ping, profile pics & more)
    • *Config Menu* — change bot settings to your
      taste (.mode, .setalias & more)

    Pick a domain below to begin.

    > _Developed by 【 亗 ᑭᗩTᖇIᑕK ᗪEᐯ 亗 】✧_`;

    const GROUP_MENU_TEXT = `${groupChannelLink}

    ╔════════╦════════╗
            ⚠ EVENTIDE OMEGA
                   GROUP DOMAIN
    ╚════════╩════════╝

       *GROUP DOMAIN*
       Dominion over the vessel's gatherings.

    ┏━ ✦ ADMIN ━┓
      • *.add*        add a member
      • *.kick*       sever a member
      • *.promote*    raise a member
      • *.demote*     lower a member
      • *.mute*       silence a member
      • *.unmute*     release a member
      • *.listmuted*  list silenced
      • *.revoke*     reset invite link
      • *.link*       fetch invite link
    ┗━━━━━━━━━━━━━┛

    ┏━ ✦ AUTOMATION ━┓
      • *.greet*      set welcome/goodbye
      • *.antilink*   ward off links
      • *.antimention* ward off mentions
      • *.antiforward* ward off forwards
      • *.warn*       mark a member
      • *.warnconfig* premium warn matrix
    ┗━━━━━━━━━━━━━┛

    ┏━ ✦ INFO ━┓
      • *.groupinfo*  dominion details
      • *.tagall*     call everyone
      • *.hidetag*    silent mention (.ht)
      • *.getvcf*     members contact card
    ┗━━━━━━━━━━━━━┛

    ┏━ ✦ JOIN ━┓
      • *.join*       join a new group
    ┗━━━━━━━━━━━━━┛

       ⚠ *Note:* admin cmds require
       Group Admin + bot as Admin.

    📡 SECURE │ Ω │ GROUP: ARMED`;

    const SYSTEM_MENU_TEXT = `${groupChannelLink}

    ╔════════╦════════╗
            ⚠ EVENTIDE OMEGA
                   SYSTEM DOMAIN
    ╚════════╩════════╝

          ◈ ── S Y S T E M ── ◈
       the core of the machine

    ┏━ ✦ STATUS ━┓
      • *.ping*       signal pulse
      • *.uptime*     temporal logs
      • *.runtime*    process vitals
      • *.info*       core manifest
      • *.status*     overall state
      • *.version*    core build
      • *.os*         host machine
      • *.botinfo*    about the core
      • *.alive*      life check
    ┗━━━━━━━━━━━━━━┛

    ┏━ ✦ OWNER TOOLS ━┓
      • *.dev*        the architect
      • *.gpp*        pull profile pic
      • *.ggpp*       pull group pic
      • *.profile*    host identity
      • *.listgc*     joined groups
      • *.session*    this vessel
      • *.sessions*   linked sessions
      • *.logout*     unlink session
      • *.reconnect*  reweave socket
    ┗━━━━━━━━━━━━━━┛

    ┏━ ✦ UTILITIES ━┓
      • *.sticker*    make a sticker
      • *.toimg*      sticker to image
      • *.vv*         unlock view-once
      • *.qr*         generate QR
      • *.calc*       calculate
      • *.base64*     encode / decode
      • *.block*      seal a number
      • *.unblock*    open a number
      • *.cmdstats*   arsenal count
    ┗━━━━━━━━━━━━━━┛

    ┏━ ✦ CONTROL ━┓
      • *.restart*    reboot the core
      • *.shutdown*   power down
      • *.autoreact*  toggle auto-react
      • *.antidelete* toggle anti-delete
    ┗━━━━━━━━━━━━━━┛

       " the machine does not sleep.
         it only waits ."

    📡 type *_.help_* to learn how
       to use any command.

    > _Developed by 【 亗 ᑭᗩTᖇIᑕK ᗪEᐯ 亗 】✧_`;

    const CONFIG_MENU_TEXT = `${groupChannelLink}

    ╔════════╦════════╗
            ⚠ EVENTIDE OMEGA
                   CONFIG DOMAIN
    ╚════════╩════════╝

          ◈ ── C O N F I G ── ◈
       shape the vessel itself

    ┏━ ✦ ACCESS ━┓
      • .mode         lock the gates
      • .public       open to all
      • .owner        seal to owner
    ┗━━━━━━━━━━━━━┛

    ┏━ ✦ COMMANDS ━┓
      • .setprefix    change the sigil
      • .setalias     bind a new command
      • .delalias     unbind a command
      • .aliases      list bindings
    ┗━━━━━━━━━━━━━┛

    ┏━ ✦ IDENTITY ━┓
      • .setname      rename the vessel
      • .setbio       set the about text
      • .setpp        change the avatar
    ┗━━━━━━━━━━━━━┛

    ┏━ ✦ STATE ━┓
      • .settings     view config matrix
      • .reset        restore defaults
      • .autoreactconfig  configure auto-react
      • .antideleteconfig  configure anti-delete
    ┗━━━━━━━━━━━━━┛

       " the machine bends to
         the hand that shapes it ."

    📡 type *_.help_* to learn how
       to use any command.

    > _Developed by 【 亗 ᑭᗩTᖇIᑕK ᗪEᐯ 亗 】✧_`;

    const FUN_PLACEHOLDER_TEXT = `${groupChannelLink}

    ╔════════╦════════╗
            ⚠ EVENTIDE OMEGA
                    FUN DOMAIN
    ╚════════╩════════╝

       *FUN DOMAIN*
       Play. Roast. Ruin someone politely.

    ┏━ ✦ ARENA ━┓
      • *.ttt*        premium tic-tac-toe
      • *.hangman*    gallows  (.hm)
      • *.chain*      word chain  (.wc)
      • *.trivia*     quiz  (.quiz)
      • *.riddle*     guess  (.hint)
    ┗━━━━━━━━━━━━━┛

    ┏━ ✦ ROAST ━┓
      • *.roast*      reply to cook them
      • *.pickupline*  (.rizz / .pickup)
      • *.flirt*  ·  *.compliment*
      • *.joke*   ·  *.rate*  ·  *.ship*
    ┗━━━━━━━━━━━━━┛

       " type 1–9 to move.
         three in a line, or nothing. "

    📡 SECURE │ Ω │ PLAYGROUND: ARMED`;

    const BUG_PLACEHOLDER_TEXT = `${groupChannelLink}

    ╔════════╦════════╗
            ⚠ EVENTIDE OMEGA
                    BUG DOMAIN
    ╚════════╩════════╝

       *BUG DOMAIN*
       The fault-line is being sealed.

       🐞 This domain is *under processing*.
       The report pipeline is still being wired.

       " every crack is just the void
         reaching for your attention ."

    📡 SECURE │ Ω │ FAULTS: MONITORED`;

    return Object.freeze({
        TERMINAL_HEADER,
        attachChannelPreview,
        channelContextInfo,
        PERSONA_POLL_QUESTION,
        PERSONA_POLL_OPTIONS,
        PERSONA_POLL_IDS,
        HELP_PERSONA_POLL_QUESTION,
        HELP_PERSONA_POLL_OPTIONS,
        HELP_PERSONA_POLL_IDS,
        DOMAIN_POLL_QUESTION,
        DOMAIN_POLL_OPTIONS,
        DOMAIN_POLL_IDS,
        OWNERS_WELCOME_TEXT,
        GROUP_MENU_TEXT,
        SYSTEM_MENU_TEXT,
        CONFIG_MENU_TEXT,
        FUN_PLACEHOLDER_TEXT,
        BUG_PLACEHOLDER_TEXT
    });
}
