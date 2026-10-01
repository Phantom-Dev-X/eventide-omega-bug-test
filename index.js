import './loadEnv.js';
import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    getAggregateVotesInPollMessage,
    decryptPollVote,
    jidNormalizedUser,
    delay,
    downloadMediaMessage,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    proto
} from 'xzcbailz';
import pino from 'pino';
import express from 'express';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import https from 'https';
import { execSync, spawn } from 'child_process';

// Import Supabase Sync Service
import {
    isSupabaseEnabled,
    downloadSessionFromSupabase,
    debouncedSyncLocalToSupabase,
    setSyncPaused,
    deleteSessionFromSupabase,
    getAllSessionPhoneNumbers,
    saveUserToSupabase,
    deleteUserFromSupabase,
    loadAllUsersFromSupabase
} from './supabaseService.js';
import {
    initGames,
    isGamePoll,
    handleGameVote,
    handleGameText,
    handleGameCommand,
    isGameCommand
} from './games.js';
import { initWebApp } from './webApp.js';
import { startLocalBackups, runLocalBackup } from './backup.js';
import { parseInviteOrJid, listParticipatingGroups, resolveAndJoinTarget } from './wardConfig.js';
import { createEnvironmentConfig } from './src/config/env.js';
import { createPairingService } from './src/whatsapp/pairing.js';
import { createSocketService } from './src/whatsapp/socket.js';
import { createReconnectionService } from './src/whatsapp/reconnection.js';
import { createConnectionEventService } from './src/whatsapp/connection-events.js';
import { createMessageEventService } from './src/whatsapp/message-events.js';
import { createMessagePipeline, parseCommandInput } from './src/whatsapp/message-pipeline.js';
import { createMessageMiddleware } from './src/whatsapp/message-middleware.js';
import { createMessageAccessService } from './src/whatsapp/message-access.js';
import { createMessageConversationService } from './src/whatsapp/message-conversation.js';
import { createMessageConfigInputService } from './src/whatsapp/message-config-input.js';
import { createCommandRegistry } from './src/commands/registry.js';
import { createBasicSystemCommands } from './src/commands/system/basic.js';
import { createSessionSystemCommands } from './src/commands/system/session.js';
import { createAccountSystemCommands } from './src/commands/system/account.js';
import { createAccountToolCommands } from './src/commands/system/account-tools.js';
import { createOwnerOperationCommands } from './src/commands/system/owner-operations.js';
import { createUtilitySystemCommands } from './src/commands/system/utilities.js';
import { createConfigurationCommands } from './src/commands/system/configuration.js';
import { createAccessModeCommands } from './src/commands/system/access-mode.js';
import { createCustomizationCommands } from './src/commands/system/customization.js';
import { createConfigManagementCommands } from './src/commands/system/config-management.js';
import { createPluginKeyCommands } from './src/commands/system/plugin-key.js';
import { createDeploymentCommands } from './src/commands/system/deployment.js';
import { createPersonaCommands } from './src/commands/system/persona.js';
import { createSudoCommands } from './src/commands/system/sudo.js';
import { createConfigDeleteCommands } from './src/commands/system/config-delete.js';
import { createHelpCommands } from './src/commands/system/help.js';
import { createAiFunCommands } from './src/commands/fun/ai.js';
import { createTicTacToeCommands } from './src/commands/game/tic-tac-toe.js';
import { createOneShotProbeService } from './src/commands/testing/one-shot-probes.js';
import { createFloodProbeService } from './src/commands/testing/flood-probes.js';
import { createSandboxPayloadCommands } from './src/commands/testing/sandbox-payloads.js';
import { createTelegramCommandService } from './src/telegram/commands.js';
import { createRuinInterface } from './src/personas/ruin-interface.js';
import { createEclipseInterface } from './src/personas/eclipse-interface.js';
import { createTicTacToeEngine } from './src/games/tic-tac-toe-engine.js';
import { createWarnService } from './src/moderation/warn-service.js';
import { createAntideleteService } from './src/moderation/antidelete-service.js';
import { createAiEngine } from './src/ai/ai-engine.js';
import { createBugProbeEngine } from './src/testing/bug-probe-engine.js';
import { createBasicHelpers } from './src/core/basic-helpers.js';
import { createMessageContent } from './src/whatsapp/message-content.js';
import { createAccessService } from './src/moderation/access-service.js';
import { createGroupMembershipCommands } from './src/commands/group/membership.js';
import { createGroupInformationCommands } from './src/commands/group/information.js';
import { createGroupModerationCommands } from './src/commands/group/moderation.js';
import { createGroupProtectionCommands } from './src/commands/group/protections.js';
import { createGroupWarningCommands } from './src/commands/group/warnings.js';
import { createSessionStore } from './src/services/session-store.js';
import { DEFAULT_BOT_CONFIG } from './src/config/defaults.js';
import { log, logError } from './src/core/logger.js';
import {
    telegramUsers,
    waSessions,
    reconnectAttempts,
    connClosed428s,
    sentPolls,
    lastPollVotes,
    menuReplyMessages,
    helpModeUsers,
    presenceControllers,
    autoreactSessions,
    personaPollKeys,
    helpPersonaPollKeys,
    webPairSessions,
    mutedUsers,
    recentMessages,
    antiConfigSessions,
    welcomeGoodbyeSessions,
    warnConfigSessions,
    msgLogCache,
    msgLogSaveTimers,
    tttGames,
    tttSetupSessions
} from './src/core/state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const TelegramBot = require('node-telegram-bot-api');

// ──────────────────────────────────────────────
// 📋 CONFIG
// ──────────────────────────────────────────────
const environmentConfig = createEnvironmentConfig({ rootDir: __dirname });
const {
    TELEGRAM_TOKEN,
    MAX_USERS,
    DEV_IDS,
    PORT,
    AUTH_DIR,
    USER_MAP_FILE,
    KEEP_ALIVE_INTERVAL,
    RECENT_APPEND_WINDOW_SECONDS,
    IS_RENDER_RUNTIME,
    CURRENT_RENDER_SERVICE_ID,
    IS_BLOCKED_RENDER_SERVICE,
    BOT_RUNTIME_ALLOWED,
    GROUP_CHANNEL_LINK,
    VERBOSE_LOGS
} = environmentConfig;

// ──────────────────────────────────────────────
// 🔮 HEADERS & STAGES (PERFECT WHATSAPP SPACING)
// ──────────────────────────────────────────────

const TERMINAL_HEADER =
    '╔════════╦════════╗\n' +
    '        ⚠ EVENTIDE OMEGA\n' +
    '               TERMINAL ACCESS                                                                         \n' +
    '╚════════╩════════╝\n\n';

// ──────────────────────────────────────────────
// 📢 GROUP CHANNEL LINK (shows a nice preview on WhatsApp)
// Reads from the RENDER env var GROUP_CHANNEL_LINK (set it to your
// WhatsApp channel link), with a fallback default if unset.
// ──────────────────────────────────────────────

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
    if (!content?.text || !String(content.text).includes(GROUP_CHANNEL_LINK)) return content;
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
            sourceUrl: GROUP_CHANNEL_LINK,
            renderLargerThumbnail: true,
            showAdAttribution: false
        }
    };
}

// Absolute paths to the menu banner images (live in ./assets next to the script).
// (MENU_BANNER_PATH itself now lives inside src/personas/eclipse-interface.js's
// caller — computed once below and injected as `menuBannerPath`.)
const OWNERS_MENU_PATH      = path.join(__dirname, 'assets', 'owners_menu.png');
const GROUP_MENU_PATH       = path.join(__dirname, 'assets', 'group_menu.png');
const FUN_MENU_PATH         = path.join(__dirname, 'assets', 'fun_menu.png');
const SYSTEM_MENU_PATH      = path.join(__dirname, 'assets', 'system_menu.png');
const CONFIG_MENU_PATH      = path.join(__dirname, 'assets', 'config_menu.png');

// (POLL_QUESTION / POLL_OPTIONS / MENU_POLL_IDS for the Eclipse Owners/Group/
// Fun/Bug poll now live inside src/personas/eclipse-interface.js.)

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

const OWNERS_WELCOME_TEXT = `${GROUP_CHANNEL_LINK}

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

const GROUP_MENU_TEXT = `${GROUP_CHANNEL_LINK}

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

const SYSTEM_MENU_TEXT = `${GROUP_CHANNEL_LINK}

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

const CONFIG_MENU_TEXT = `${GROUP_CHANNEL_LINK}

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

const FUN_PLACEHOLDER_TEXT = `${GROUP_CHANNEL_LINK}

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

const BUG_PLACEHOLDER_TEXT = `${GROUP_CHANNEL_LINK}

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

// ──────────────────────────────────────────────
// 📋 WHATSAPP COMMANDS
// ──────────────────────────────────────────────
const COMMANDS = {
    // Add your normal text commands here!
};

// ──────────────────────────────────────────────
// 🔧 STATE
// ──────────────────────────────────────────────
let cachedBaileysVersion = null;
let cachedBaileysVersionAt = 0;

// ──────────────────────────────────────────────
// 📂 LOCAL PERSISTENT BOT CONFIG HELPERS
// ──────────────────────────────────────────────
function loadPollCache(phoneNumber) {
    const filePath = path.join(AUTH_DIR, phoneNumber, 'poll_cache.json');
    if (fs.existsSync(filePath)) {
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            return new Map(Object.entries(JSON.parse(raw)));
        } catch (err) {
            logError('CACHE', `${phoneNumber}: Failed to load poll_cache.json`, err);
        }
    }
    return new Map();
}

function savePollCache(phoneNumber, cacheMap) {
    const filePath = path.join(AUTH_DIR, phoneNumber, 'poll_cache.json');
    try {
        const obj = Object.fromEntries(cacheMap.entries());
        fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
        if (isSupabaseEnabled()) {
            const authDir = path.join(AUTH_DIR, phoneNumber);
            debouncedSyncLocalToSupabase(phoneNumber, authDir);
        }
    } catch (err) {
        logError('CACHE', `${phoneNumber}: Failed to save poll_cache.json`, err);
    }
}

function loadBotMode(phoneNumber) {
    const filePath = path.join(AUTH_DIR, phoneNumber, 'bot_mode.txt');
    if (fs.existsSync(filePath)) {
        try {
            return fs.readFileSync(filePath, 'utf8').trim();
        } catch (err) {
            logError('MODE', `${phoneNumber}: Failed to read bot_mode.txt`, err);
        }
    }
    return 'public'; // Default mode is public
}

function saveBotMode(phoneNumber, mode) {
    const filePath = path.join(AUTH_DIR, phoneNumber, 'bot_mode.txt');
    try {
        fs.writeFileSync(filePath, mode, 'utf8');
        if (isSupabaseEnabled()) {
            const authDir = path.join(AUTH_DIR, phoneNumber);
            debouncedSyncLocalToSupabase(phoneNumber, authDir);
        }
    } catch (err) {
        logError('MODE', `${phoneNumber}: Failed to save bot_mode.txt`, err);
    }
}

// ──────────────────────────────────────────────
// ⚙️ BOT CONFIG STORE (persistent, synced to Supabase)
// Per-phone config: prefix, aliases, identity, toggles. Stored as JSON in the
// session folder so it survives redeploys (the folder is synced to Supabase).
// ──────────────────────────────────────────────


// Normalize antidelete to the same shape as autoreact. Also migrates the old
// per-group { [jid]: 'on'/'off' } map (and legacy anti.antidelete) into endpoints.
function normalizeAntideleteConfig(parsed) {
    const empty = { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } };
    const raw = parsed?.antidelete;
    if (raw && typeof raw === 'object' && (raw.endpoints || typeof raw.enabled === 'boolean')) {
        return {
            enabled: !!raw.enabled,
            endpoints: {
                groups: Array.isArray(raw.endpoints?.groups) ? [...raw.endpoints.groups] : [],
                channels: Array.isArray(raw.endpoints?.channels) ? [...raw.endpoints.channels] : [],
                contacts: Array.isArray(raw.endpoints?.contacts) ? [...raw.endpoints.contacts] : []
            }
        };
    }
    const legacy = (raw && typeof raw === 'object' ? raw : null) || parsed?.anti?.antidelete || {};
    const groups = Object.entries(legacy)
        .filter(([k, v]) => v === 'on' && typeof k === 'string' && k.includes('@'))
        .map(([k]) => k);
    return { enabled: groups.length > 0, endpoints: { groups, channels: [], contacts: [] } };
}

function normalizeWarnConfig(parsed) {
    const groups = {};
    const rawGroups = parsed?.warn?.groups;
    if (rawGroups && typeof rawGroups === 'object') {
        for (const [jid, g] of Object.entries(rawGroups)) {
            if (!jid || !g || typeof g !== 'object') continue;
            const max = parseInt(g.maxWarns, 10);
            groups[jid] = {
                enabled: !!g.enabled,
                maxWarns: Number.isFinite(max) ? Math.max(0, max) : 3,
                action: g.action === 'none' ? 'none' : 'kick',
                phrases: Array.isArray(g.phrases) ? g.phrases.map(s => String(s).trim()).filter(Boolean) : [],
                deleteOffending: g.deleteOffending !== false
            };
        }
    }
    return { groups };
}

function loadBotConfig(phoneNumber) {
    const filePath = path.join(AUTH_DIR, phoneNumber, 'bot_config.json');
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                ...structuredClone(DEFAULT_BOT_CONFIG),
                ...(parsed || {}),
                aliases: { ...(parsed?.aliases || {}) },
                autoreact: { ...DEFAULT_BOT_CONFIG.autoreact, ...(parsed?.autoreact || {}), endpoints: { ...DEFAULT_BOT_CONFIG.autoreact.endpoints, ...(parsed?.autoreact?.endpoints || {}) } },
                antidelete: normalizeAntideleteConfig(parsed),
                warn: normalizeWarnConfig(parsed)
            };
        }
    } catch (err) {
        logError('CONFIG', `${phoneNumber}: Failed to load bot_config.json`, err);
    }
    return structuredClone(DEFAULT_BOT_CONFIG);
}

function saveBotConfig(phoneNumber, config) {
    const filePath = path.join(AUTH_DIR, phoneNumber, 'bot_config.json');
    try {
        ensureDir(path.dirname(filePath));
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
        if (isSupabaseEnabled()) {
            const authDir = path.join(AUTH_DIR, phoneNumber);
            debouncedSyncLocalToSupabase(phoneNumber, authDir);
        }
    } catch (err) {
        logError('CONFIG', `${phoneNumber}: Failed to save bot_config.json`, err);
    }
}

// ──────────────────────────────────────────────
// 📼 PERSISTENT MESSAGE LOG (for antidelete full-history recovery)
// Stores every message (by id) that flows through the bot after pairing, so a
// message deleted later can always be recovered — even after a bot restart.
// Stored per-session in msg_log.json. NOT synced to Supabase (it was blowing
// Render RAM — full proto + 5k entries + rewrite-on-every-msg).
// ──────────────────────────────────────────────
const MSG_LOG_LIMIT = 800;

function slimProto(message) {
    if (!message || typeof message !== 'object') return message || null;
    const out = {};
    for (const [k, v] of Object.entries(message)) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) { out[k] = v; continue; }
        const cloned = { ...v };
        delete cloned.jpegThumbnail;
        delete cloned.thumbnailDirectPath;
        delete cloned.thumbnailSha256;
        delete cloned.scansSidecar;
        delete cloned.midQualityFileSha256;
        delete cloned.waveform;
        if (cloned.contextInfo) {
            cloned.contextInfo = {
                stanzaId: cloned.contextInfo.stanzaId,
                participant: cloned.contextInfo.participant,
                mentionedJid: cloned.contextInfo.mentionedJid,
                isForwarded: cloned.contextInfo.isForwarded
            };
        }
        out[k] = cloned;
    }
    return out;
}

function loadMsgLog(phoneNumber) {
    if (msgLogCache.has(phoneNumber)) return msgLogCache.get(phoneNumber);
    const filePath = path.join(AUTH_DIR, phoneNumber, 'msg_log.json');
    let data = {};
    try {
        if (fs.existsSync(filePath)) {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            data = parsed && typeof parsed === 'object' ? parsed : {};
        }
    } catch (err) { logError('MSGLOG', `${phoneNumber}: failed to load msg_log.json`, err); }
    msgLogCache.set(phoneNumber, data);
    return data;
}

function flushMsgLog(phoneNumber) {
    const log = msgLogCache.get(phoneNumber);
    if (!log) return;
    const filePath = path.join(AUTH_DIR, phoneNumber, 'msg_log.json');
    try {
        ensureDir(path.dirname(filePath));
        fs.writeFileSync(filePath, JSON.stringify(log), 'utf8');
    } catch (err) { logError('MSGLOG', `${phoneNumber}: failed to save msg_log.json`, err); }
}

function scheduleMsgLogSave(phoneNumber) {
    if (msgLogSaveTimers.has(phoneNumber)) return;
    const timer = setTimeout(() => {
        msgLogSaveTimers.delete(phoneNumber);
        flushMsgLog(phoneNumber);
    }, 8000);
    msgLogSaveTimers.set(phoneNumber, timer);
}

function logMessage(phoneNumber, remoteJid, msg) {
    try {
        const id = msg?.key?.id;
        if (!id || msg?.key?.fromMe) return;
        const log = loadMsgLog(phoneNumber);
        const keys = Object.keys(log);
        if (keys.length >= MSG_LOG_LIMIT) delete log[keys[0]];
        const parsed = extractMessageText(msg);
        log[id] = {
            remoteJid,
            participant: msg?.key?.participant || null,
            text: parsed?.text || '',
            type: parsed?.leafType || 'unknown',
            message: slimProto(msg?.message),
            ts: msg?.messageTimestamp ? Number(msg.messageTimestamp) : Date.now() / 1000
        };
        scheduleMsgLogSave(phoneNumber);
    } catch (err) { logError('MSGLOG', `${phoneNumber}: logMessage failed`, err); }
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textHasPhrase(text, phrase) {
    const p = String(phrase || '').trim();
    if (!p || !text) return false;
    if (p.length <= 3) {
        try { return new RegExp(`(^|[^a-z0-9])${escapeRegExp(p)}([^a-z0-9]|$)`, 'i').test(text); }
        catch { return String(text).toLowerCase().includes(p.toLowerCase()); }
    }
    return String(text).toLowerCase().includes(p.toLowerCase());
}

function findMatchingPhrase(text, phrases) {
    for (const p of (phrases || [])) {
        if (textHasPhrase(text, p)) return p;
    }
    return null;
}

function findHidetagTrigger(normalized, prefix, aliases) {
    const pfx = prefix || '.';
    const triggers = new Set(['.hidetag', '.ht', `${pfx}hidetag`, `${pfx}ht`]);
    for (const [k, v] of Object.entries(aliases || {})) {
        if (v === '.hidetag' || v === '.ht') {
            triggers.add('.' + k);
            triggers.add(pfx + k);
        }
    }
    const parts = String(normalized || '').split(/\s+/).filter(Boolean);
    const idx = parts.findIndex(part => triggers.has(part.toLowerCase()));
    if (idx < 0) return null;
    return { body: [...parts.slice(0, idx), ...parts.slice(idx + 1)].join(' ').trim() };
}

// ✅ Creator-aware admin check. WhatsApp group metadata sets admin = null for
// the group CREATOR, so `p.admin` truthiness alone wrongly rejected the owner.
// This matches by JID (or phone digits when one side is a PN) and treats the
// creator as admin in every case.
function isParticipantAdmin(meta, jid) {
    try {
        if (!jid) return false;
        const norm = jidNormalizedUser(jid);
        const digits = String(jid).split('@')[0].replace(/\D/g, '');
        const ownerNorm = jidNormalizedUser(meta?.owner || '');
        if (norm === ownerNorm) return true; // the creator is always admin
        const found = meta?.participants?.find(p => {
            const ids = [p.id, p.phoneNumber, p.jid].filter(Boolean).map(jidNormalizedUser);
            if (ids.includes(norm)) return true;
            if (!digits) return false;
            // PN digits fallback (never for LIDs — those digits aren't phone numbers)
            return ids.some(id => id.endsWith('@s.whatsapp.net') && String(id).split('@')[0].replace(/\D/g, '') === digits);
        });
        if (!found) return false;
        const foundIds = [found.id, found.phoneNumber, found.jid].filter(Boolean).map(jidNormalizedUser);
        return !!found.admin || (ownerNorm && foundIds.includes(ownerNorm));
    } catch { return false; }
}

async function isUserGroupAdmin(sock, groupJid, jid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        return isParticipantAdmin(meta, jid);
    } catch { return false; }
}

async function downloadQuotedMedia(sock, msg) {
    const ctx = getQuotedContext(msg);
    const quoted = ctx?.quotedMessage;
    if (!quoted) throw new Error('Reply to a view-once photo/video first.');

    let inner = quoted;
    if (inner.viewOnceMessage?.message) inner = inner.viewOnceMessage.message;
    else if (inner.viewOnceMessageV2?.message) inner = inner.viewOnceMessageV2.message;
    else if (inner.viewOnceMessageV2Extension?.message) inner = inner.viewOnceMessageV2Extension.message;

    const type = inner.imageMessage ? 'imageMessage'
        : inner.videoMessage ? 'videoMessage'
        : inner.audioMessage ? 'audioMessage'
        : inner.documentMessage ? 'documentMessage'
        : inner.stickerMessage ? 'stickerMessage'
        : null;
    if (!type) throw new Error('Quoted message has no media.');

    const node = { ...inner[type], viewOnce: false };
    const isViewOnce = !!(
        quoted.viewOnceMessage || quoted.viewOnceMessageV2 || quoted.viewOnceMessageV2Extension ||
        inner[type]?.viewOnce
    );

    const full = {
        key: {
            remoteJid: msg.key.remoteJid,
            id: ctx.stanzaId || msg.key.id,
            fromMe: false,
            participant: ctx.participant || msg.key.participant
        },
        message: { [type]: node }
    };

    const opts = { logger: pino({ level: 'silent' }) };
    if (typeof sock.updateMediaMessage === 'function') {
        opts.reuploadRequest = sock.updateMediaMessage.bind(sock);
    }

    try {
        const buffer = await downloadMediaMessage(full, 'buffer', {}, opts);
        if (buffer && buffer.length) return { buffer, type, node, isViewOnce };
    } catch (_) {}

    if (ctx?.stanzaId) {
        const stored = await getMessageFromStore({ id: ctx.stanzaId, remoteJid: msg.key.remoteJid });
        if (stored) {
            const retry = { key: full.key, message: stored };
            const buffer = await downloadMediaMessage(retry, 'buffer', {}, opts);
            if (buffer && buffer.length) return { buffer, type, node, isViewOnce };
        }
    }
    throw new Error('WhatsApp already expired the media keys. Ask them to resend, or reply faster.');
}

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


const messageContent = createMessageContent();
const { getQuotedContext, unwrapMessageContent, extractMessageText } = messageContent;

const basicHelpers = createBasicHelpers({
    logError,
    getQuotedContext,
    unwrapMessageContent,
    jidNormalizedUser
});
const {
    ensureDir,
    safeRm,
    trimForLog,
    asNumber,
    formatUptime,
    runtimeUptime,
    buildOmegaTerminal,
    resolveTargetJid,
    extractQuotedPlainText,
    fetchBuffer,
    loadSharp,
    loadQrcode
} = basicHelpers;

const sessionStore = createSessionStore({
    authDir: AUTH_DIR,
    userMapFile: USER_MAP_FILE,
    telegramUsers,
    ensureDir,
    safeRm,
    isSupabaseEnabled,
    saveUserToSupabase,
    deleteUserFromSupabase,
    loadAllUsersFromSupabase,
    log,
    logError
});

const {
    getStoredSessionDirectories,
    countStoredSessions,
    normalizeAuthDirStructure,
    findTelegramChatIdByPhone,
    setTelegramUserState,
    clearTelegramUser,
    saveUserMap,
    loadUserMap
} = sessionStore;

function isDev(chatId) {
    if (DEV_IDS.length === 0) return true;
    return DEV_IDS.includes(Number(chatId));
}

// Dev numbers come from the RENDER env var DEV_NUMBERS (comma-separated).
// Returns true if the given jid (or raw number) belongs to a dev.
// Count the number of registered dot-commands (for .cmdstats/.botinfo).
function countSystemCommands() {
    const known = [
        'menu','help','ping','uptime','runtime','info','status','version','os','botinfo','alive','dev','gpp','ggpp','profile',
        'listgc','session','sessions','logout','reconnect','sticker','toimg','vv','viewonce','qr','calc','base64','block','unblock',
        'cmdstats','restart','shutdown','autoreact','mode','public','owner','setprefix','setalias','delalias',
        'aliases','setname','setbio','setpp','settings','reset','join','add','kick','link','autoreactconfig','antidelete','antideleteconfig','del','hidetag','ht','warn','unwarn','warns','warnconfig','warnreset','ttt','tictactoe','xo','hangman','chain','trivia','riddle'
    ];
    return known.length;
}

function isDevNumber(jid) {
    const raw = process.env.DEV_NUMBERS || '';
    const devs = raw.split(',').map(s => s.replace(/\D/g, '').trim()).filter(Boolean);
    if (!devs.length) return false;
    const num = String(jid || '').split(':')[0].split('@')[0].replace(/\D/g, '');
    return devs.includes(num);
}

// ──────────────────────────────────────────────
// 🔧 BAILEYS HELPERS
// ──────────────────────────────────────────────
const accessService = createAccessService({
    loadBotConfig,
    isGamePoll
});
const { normalizeDigits, isSudo, canVoteOnPoll } = accessService;

function getDisconnectCode(lastDisconnect) {
    return lastDisconnect?.error?.output?.statusCode
        ?? lastDisconnect?.error?.statusCode
        ?? lastDisconnect?.statusCode
        ?? null;
}

// Decrypt / Retrieve messages from memory map OR local persistent JSON.
// Baileys calls this to fetch a message by reference (e.g. for "delete for
// everyone" — the protocol message carries a reference and Baileys looks up
// the original here so it can emit the delete).
async function getMessageFromStore(key) {
    const inMemory = sentPolls.get(key.id);
    if (inMemory) return inMemory;

    // Look in the recent-messages cache first (this is how antidelete recovers content)
    const cacheKey = `__all__:${key.remoteJid || ''}:${key.id}`;
    for (const [k, v] of recentMessages) {
        if (k.endsWith(':' + key.id) && v?.message) return v.message;
    }

    // Full-history recovery: check the persistent msg_log across all sessions
    for (const number of getStoredSessionDirectories(AUTH_DIR)) {
        const log = loadMsgLog(number);
        if (log[key.id]?.message) return log[key.id].message;
        if (log[key.id]?.text) return { conversation: log[key.id].text };
    }

    // Fallback: search poll_cache.json files
    const sessionDirs = getStoredSessionDirectories(AUTH_DIR);
    for (const number of sessionDirs) {
        const cache = loadPollCache(number);
        const cached = cache.get(key.id);
        if (cached && cached.fullMessage) {
            return cached.fullMessage;
        }
    }
    return null;
}

function isRecentMessage(msg, maxAgeSeconds = RECENT_APPEND_WINDOW_SECONDS) {
    const ts = asNumber(msg?.messageTimestamp);
    if (!ts) return false;
    const age = Math.abs(Date.now() / 1000 - ts);
    return age <= maxAgeSeconds;
}

// Check if message JID is on the ignore list
function isIgnoredRemoteJid(remoteJid) {
    if (!remoteJid) return true;
    if (remoteJid === 'status@broadcast') return true;
    if (remoteJid.endsWith('@broadcast')) return true;
    // NOTE: @newsletter (channels) are NOT ignored here anymore — autoreact /
    // antidelete watch channels, and the command flow is skipped for them
    // later in handleWhatsAppMessage.
    return false;
}

async function getBaileysVersion() {
    const maxCacheAgeMs = 60 * 60 * 1000;
    const now = Date.now();
    if (cachedBaileysVersion && (now - cachedBaileysVersionAt) < maxCacheAgeMs) {
        return cachedBaileysVersion;
    }

    const { version } = await fetchLatestBaileysVersion();
    cachedBaileysVersion = version;
    cachedBaileysVersionAt = now;
    log('BAILEYS', `Using WA version ${version.join('.')}`);
    return version;
}

function resolveCommandReply(command, phoneNumber) {
    return COMMANDS[command] || null;
}

/**
 * Sends a reply with simulated typing ("composing" state) and organic delay.
 * Helps protect against WhatsApp anti-spam automated bot scanners.
 */
// ──────────────────────────────────────────────
// 🎭 HUMAN-LIKE PRESENCE CONTROLLER
// Randomly cycles the bot between "online" and "offline" for varying durations
// (e.g. online 1h, offline 30m, online 30m, offline 1h30m). While offline, a
// command flashes it online for ~5 min, then it returns to the background
// state. This makes the bot look less like a 24/7 automated server (reduces
// ban/flag risk). Works per-session (multi-user bot).
// ──────────────────────────────────────────────

function applyPresence(sock, phoneNumber, state) {
    if (!sock) return;
    try {
        sock.sendPresenceUpdate(state).catch(() => {});
        log('PRESENCE', `${phoneNumber}: presence -> ${state}`);
    } catch (err) {
        logError('PRESENCE', `${phoneNumber}: failed to set presence ${state}`, err);
    }
}

function getPresenceController(sock, phoneNumber) {
    let ctrl = presenceControllers.get(phoneNumber);
    if (!ctrl) {
        ctrl = { sock, backgroundState: 'unavailable', cycleTimer: null, flashTimer: null };
        presenceControllers.set(phoneNumber, ctrl);
    } else {
        ctrl.sock = sock;
    }
    return ctrl;
}

// Pick a random "online" or "offline" period (30, 45, 60 or 90 minutes).
function scheduleNextPresenceCycle(phoneNumber) {
    const ctrl = presenceControllers.get(phoneNumber);
    if (!ctrl) return;
    const durationsMin = [30, 45, 60, 90];
    const dur = durationsMin[Math.floor(Math.random() * durationsMin.length)] * 60 * 1000;
    if (ctrl.cycleTimer) clearTimeout(ctrl.cycleTimer);
    ctrl.cycleTimer = setTimeout(() => {
        const cur = presenceControllers.get(phoneNumber);
        if (!cur) return;
        cur.backgroundState = cur.backgroundState === 'available' ? 'unavailable' : 'available';
        applyPresence(cur.sock, phoneNumber, cur.backgroundState);
        scheduleNextPresenceCycle(phoneNumber);
    }, dur);
}

// Starts the random online/offline cycle for a freshly-connected socket.
function startPresenceCycle(sock, phoneNumber) {
    const ctrl = getPresenceController(sock, phoneNumber);
    ctrl.backgroundState = Math.random() < 0.5 ? 'available' : 'unavailable';
    applyPresence(sock, phoneNumber, ctrl.backgroundState);
    scheduleNextPresenceCycle(phoneNumber);
}

// Flash the bot online when a command is used, then return to the current
// background state after ~5 minutes.
function flashPresenceOnline(sock, phoneNumber) {
    if (!sock) return;
    const ctrl = getPresenceController(sock, phoneNumber);
    applyPresence(sock, phoneNumber, 'available');
    if (ctrl.flashTimer) clearTimeout(ctrl.flashTimer);
    ctrl.flashTimer = setTimeout(() => {
        const cur = presenceControllers.get(phoneNumber);
        if (!cur) return;
        applyPresence(cur.sock, phoneNumber, cur.backgroundState);
    }, 5 * 60 * 1000);
}

async function safeWaReply(sock, remoteJid, text, quoted) {
    // 💡 Flash the bot online before any reply (dot commands, .help, help-mode
    // conversations, etc.), then return to the background presence after ~5 min.
    const flashPhone = sock?._eventidePhone;
    if (flashPhone) flashPresenceOnline(sock, flashPhone);
    try {
        let formattedText = formatForWhatsApp(text);

        // Channel URL sits on its own line so the baked PDV preview card
        // follows text replies. Polls and image messages never go through here.
        if (!formattedText.startsWith('🤖') && !formattedText.includes(GROUP_CHANNEL_LINK)) {
            formattedText = `${GROUP_CHANNEL_LINK}\n\n${formattedText}`;
        }

        // ⚡ Fixed 1s pacing: the reaction is already sent instantly by the
        // command handler, then this reply lands ~1s later. Removed the old
        // typing-presence round-trips and the length-based 1–2.7s delay —
        // they made the bot feel slow and added socket traffic.
        await delay(1000);

        const content = await attachChannelPreview({ text: formattedText });
        await sock.sendMessage(remoteJid, content, quoted ? { quoted } : undefined);
        return true;
    } catch (err) {
        logError('WA-SEND', `Quoted reply failed for ${remoteJid}. Retrying without quote`, err);
        try {
            let formattedText = formatForWhatsApp(text);
            if (!formattedText.startsWith('🤖') && !formattedText.includes(GROUP_CHANNEL_LINK)) {
                formattedText = `${GROUP_CHANNEL_LINK}\n\n${formattedText}`;
            }
            const content = await attachChannelPreview({ text: formattedText });
            await sock.sendMessage(remoteJid, content);
            return true;
        } catch (retryErr) {
            logError('WA-SEND', `Reply failed for ${remoteJid}`, retryErr);
            return false;
        }
    }
}

// ──────────────────────────────────────────────
// 📱 TELEGRAM BOT (OPTIONAL — only initialized if TELEGRAM_TOKEN is set)
// The bot works fully without Telegram via the web pairing page.
// ──────────────────────────────────────────────
let tgBot = null;
if (TELEGRAM_TOKEN && BOT_RUNTIME_ALLOWED) {
    try {
        tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
        tgBot.on('polling_error', err => logError('TELEGRAM', 'Polling error', err));
        log('TELEGRAM', 'Telegram bot initialized (token present).');
    } catch (err) {
        logError('TELEGRAM', 'Failed to init Telegram bot (continuing without it)', err);
        tgBot = null;
    }
} else if (!BOT_RUNTIME_ALLOWED) {
    const reason = IS_BLOCKED_RENDER_SERVICE
        ? `blocked Render service ${CURRENT_RENDER_SERVICE_ID}`
        : 'non-Render host';
    log('TELEGRAM', `Bot runtime disabled on ${reason}; Telegram polling will not start.`);
} else {
    log('TELEGRAM', 'TELEGRAM_TOKEN not set — Telegram bot disabled. Use the /pair web page instead.');
}

// ──────────────────────────────────────────────
// 🔒 TELEGRAM SEND HELPER
// ──────────────────────────────────────────────
async function safeTgSend(chatId, text) {
    if (!tgBot) return; // Telegram disabled — no-op
    try {
        await tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
        logError('TELEGRAM', `Markdown send failed to ${chatId}, retrying plain text`, err);
        await delay(1000);
        try {
            await tgBot.sendMessage(chatId, text);
        } catch (retryErr) {
            logError('TELEGRAM', `Plain text send failed to ${chatId}`, retryErr);
        }
    }
}

async function requireAdminOrExplain(chatId) {
    if (!tgBot) return false; // Telegram disabled
    if (isDev(chatId)) return true;
    await safeTgSend(chatId, '⛔ Admins only. Add your Telegram ID to DEV_TELEGRAM_IDS to unlock this command.');
    return false;
}

const socketService = createSocketService({
    botRuntimeAllowed: BOT_RUNTIME_ALLOWED,
    isBlockedRenderService: IS_BLOCKED_RENDER_SERVICE,
    currentRenderServiceId: CURRENT_RENDER_SERVICE_ID,
    telegramUsers,
    waSessions,
    makeWASocket,
    makeCacheableSignalKeyStore,
    createSilentLogger: () => pino({ level: 'silent' }),
    useMultiFileAuthState,
    getBaileysVersion,
    getMessageFromStore,
    ensureDir,
    isSupabaseEnabled,
    downloadSessionFromSupabase,
    debouncedSyncLocalToSupabase,
    setTelegramUserState,
    saveUserMap,
    setupSocketEvents,
    setupMessageHandler,
    log,
    logError,
    verboseLogs: VERBOSE_LOGS
});

const { createSocketForSession, stopAllSessions } = socketService;

// ──────────────────────────────────────────────
// 🔌 SOCKET / SESSION MANAGEMENT
// ──────────────────────────────────────────────
const reconnectionService = createReconnectionService({
    waSessions,
    reconnectAttempts,
    connectionClosed428s: connClosed428s,
    safeRm,
    isSupabaseEnabled,
    deleteSessionFromSupabase,
    clearTelegramUser,
    setTelegramUserState,
    saveUserMap,
    safeTgSend,
    createSocketForSession,
    resetBaileysVersionCache: () => {
        cachedBaileysVersion = null;
        cachedBaileysVersionAt = 0;
    },
    getBaileysVersion,
    delay,
    getClose428BaseDelayMs: () => parseInt(process.env.CLOSE428_DELAY_MS || '5000', 10) || 5000,
    getClose428StormBackoffMs: () => parseInt(process.env.CLOSE428_STORM_BACKOFF_MS || '600000', 10) || 600000,
    log,
    logError
});

const {
    cleanupDisconnectedSession,
    handleConnectionClosed428,
    restartSocketAfterClose
} = reconnectionService;

const connectionEventService = createConnectionEventService({
    rootDir: __dirname,
    disconnectReason: DisconnectReason,
    waSessions,
    reconnectAttempts,
    connectionClosed428s: connClosed428s,
    webPairSessions,
    personaPollKeys,
    personaPollQuestion: PERSONA_POLL_QUESTION,
    personaPollOptions: PERSONA_POLL_OPTIONS,
    personaPollIds: PERSONA_POLL_IDS,
    getDisconnectCode,
    setTelegramUserState,
    saveUserMap,
    safeTgSend,
    startPresenceCycle,
    isSupabaseEnabled,
    debouncedSyncLocalToSupabase,
    loadBotConfig,
    saveBotConfig,
    sendMenuPoll,
    truncateCommitName,
    cleanupDisconnectedSession,
    handleConnectionClosed428,
    restartSocketAfterClose,
    delay,
    log,
    logError
});

function setupSocketEvents(sock, phoneNumber, tgId, authDir, version, isRestore) {
    return connectionEventService.setupSocketEvents(
        sock,
        phoneNumber,
        tgId,
        authDir,
        version,
        isRestore
    );
}

const ticTacToeEngine = createTicTacToeEngine({
    tttGames,
    jidNormalizedUser,
    getQuotedContext,
    buildOmegaTerminal,
    sendMenuPoll,
    delay,
    log,
    logError
});
const {
    TTT_WINS,
    TTT_LABELS,
    tttKey,
    tttSamePlayer,
    tttOwnerPn,
    tttJidDigits,
    tttIsLid,
    tttIsOwnerJid,
    tttPnFromMsg,
    tttCollectIds,
    tttResolveLabel,
    tttPlayerMatches,
    tttName,
    tttShort,
    tttWinner,
    tttMinimax,
    tttBotMove,
    renderTttBoard,
    getTttGame,
    tttClearTimer,
    tttDeletePoll,
    tttDeleteVotedPoll,
    tttIsReplyToBoard,
    tttPaint,
    tttArmTimer,
    tttArmDeadGame,
    tttStart,
    tttPlayBot,
    tttTryMove,
    tttOfferChallenge,
    tttOpenLobby
} = ticTacToeEngine;

const antideleteService = createAntideleteService({
    loadBotConfig,
    saveBotConfig,
    normalizeAntideleteConfig,
    listParticipatingGroups,
    buildOmegaTerminal,
    sendMenuPoll,
    autoreactSessions,
    antiConfigSessions,
    warnConfigSessions,
    recentMessages,
    isIgnoredRemoteJid,
    jidNormalizedUser,
    getMessageFromStore,
    log
});
const {
    getAntideleteState,
    saveAntideleteState,
    applyWardEndpoint,
    offerGroupPickPoll,
    listAntideleteEndpoints,
    antideleteWatchesChat,
    extractRevokeRef,
    recoverDeletedContent,
    handleAntideleteRevoke
} = antideleteService;

const aiEngine = createAiEngine({
    log,
    logError,
    loadBotConfig
});
const {
    callGemini,
    callOpenAI,
    callPollinations,
    maskApiKey,
    isValidGeminiKey,
    splitApiKeys,
    maskKeyList,
    callGeminiChain,
    aiOptsFor,
    callUniversalAI,
    parseScoredAi,
    generateScoredFun,
    funRoastSystem
} = aiEngine;

const bugProbeEngine = createBugProbeEngine({
    log,
    logError,
    authDir: AUTH_DIR,
    delay,
    proto,
    generateWAMessageFromContent,
    prepareWAMessageMedia
});
const {
    loadBugSends,
    saveBugSends,
    recordBugSends,
    sendIozkProbe,
    sendFiosProbe,
    wireBytesOf,
    sendCrashmsgProbe,
    sendIoszkProbe,
    sendCrashclickProbe,
    buildAndrozPayload,
    buildTestfffMessage,
    prepareCardImage,
    sendGbHardProbe
} = bugProbeEngine;

const messagePipeline = createMessagePipeline({
    verboseLogs: VERBOSE_LOGS,
    isRecentMessage,
    isIgnoredRemoteJid,
    handleAntideleteRevoke,
    trimForLog,
    log,
    logError
});

const messageMiddleware = createMessageMiddleware({
    verboseLogs: VERBOSE_LOGS,
    recentMessages,
    mutedUsers,
    slimProto,
    logMessage,
    normalizeJid: jidNormalizedUser,
    maskApiKey,
    trimForLog,
    loadBotConfig,
    loadBotMode,
    isDevNumber,
    isSudo,
    log,
    logError
});

const warnService = createWarnService({
    authDirRoot: AUTH_DIR,
    loadBotConfig,
    saveBotConfig,
    normalizeWarnConfig,
    ensureDir,
    jidNormalizedUser,
    buildOmegaTerminal,
    log,
    logError
});
const {
    getWarnState,
    saveWarnState,
    ensureWarnGroup,
    loadWarnLog,
    saveWarnLog,
    getUserWarns,
    setUserWarns,
    listGroupWarns,
    applyWarn
} = warnService;

const messageAccessService = createMessageAccessService({
    personaPollKeys,
    personaPollQuestion: PERSONA_POLL_QUESTION,
    personaPollOptions: PERSONA_POLL_OPTIONS,
    personaPollIds: PERSONA_POLL_IDS,
    isSudo,
    normalizeJid: jidNormalizedUser,
    safeWaReply,
    sendMenuPoll,
    loadBotMode,
    getWarnState,
    findMatchingPhrase,
    isUserGroupAdmin,
    isDevNumber,
    applyWarn,
    getTttGame,
    tttIsReplyToBoard,
    tttTryMove,
    handleGameText,
    findHidetagTrigger,
    log,
    logError
});

const messageConversationService = createMessageConversationService({
    autoreactSessions,
    antiConfigSessions,
    helpModeUsers,
    parseInviteOrJid,
    resolveAndJoinTarget,
    applyWardEndpoint,
    safeWaReply,
    buildOmegaTerminal,
    terminalHeader: TERMINAL_HEADER,
    getBoundHelpPrompt,
    callUniversalAI,
    aiOptsFor,
    log,
    logError
});

const messageConfigInputService = createMessageConfigInputService({
    autoreactSessions,
    antiConfigSessions,
    warnConfigSessions,
    welcomeGoodbyeSessions,
    loadBotConfig,
    saveBotConfig,
    getAntideleteState,
    saveAntideleteState,
    ensureWarnGroup,
    getWarnState,
    saveWarnState,
    safeWaReply,
    buildOmegaTerminal
});

const oneShotProbeService = createOneShotProbeService({
    normalizeJid: jidNormalizedUser,
    isDevNumber,
    safeWaReply,
    sendIozkProbe,
    sendFiosProbe,
    recordBugSends,
    log,
    logError
});

const floodProbeService = createFloodProbeService({
    normalizeJid: jidNormalizedUser,
    isDevNumber,
    safeWaReply,
    delay,
    isSupabaseEnabled,
    setSyncPaused,
    sendIozkProbe,
    sendFiosProbe,
    sendCrashmsgProbe,
    sendIoszkProbe,
    sendCrashclickProbe,
    sendGbHardProbe,
    recordBugSends,
    log,
    logError,
    fetchThumbnail: async () => {
        const res = await fetch('https://raw.githubusercontent.com/DEVPRIMIS/Squichy-free/main/Squichy%20Free%20(Bot)/Func/bug.jpg');
        if (res.ok) return Buffer.from(await res.arrayBuffer());
        return Buffer.alloc(0);
    }
});

const ruinInterface = createRuinInterface({
    authDirRoot: AUTH_DIR,
    loadBotConfig,
    loadBotMode,
    isSupabaseEnabled,
    flashPresenceOnline,
    delay,
    sendMenuPoll,
    log
});
const {
    buildRuinCommandIndexBox,
    buildRuinSystemMenu,
    buildRuinConfigMenu,
    buildRuinGroupMenu,
    buildRuinFunMenu,
    sendRuinMenu
} = ruinInterface;

const eclipseInterface = createEclipseInterface({
    groupChannelLink: GROUP_CHANNEL_LINK,
    menuBannerPath: path.join(__dirname, 'assets', 'eventide_banner.png'),
    delay,
    sendMenuPoll,
    log,
    logError
});
const { sendEclipseMenu } = eclipseInterface;

const commandRegistry = createCommandRegistry([
    ...createBasicSystemCommands({
        safeWaReply,
        buildOmegaTerminal,
        runtimeUptime
    }),
    ...createSessionSystemCommands({
        safeWaReply,
        buildOmegaTerminal,
        runtimeUptime,
        loadBotMode,
        waSessions,
        isDevNumber,
        countSystemCommands,
        isRenderRuntime: IS_RENDER_RUNTIME
    }),
    ...createAccountSystemCommands({
        safeWaReply,
        buildOmegaTerminal,
        normalizeJid: jidNormalizedUser,
        isDevNumber,
        logError
    }),
    ...createOwnerOperationCommands({
        authDirRoot: AUTH_DIR,
        waSessions,
        webPairSessions,
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        runLocalBackup,
        safeRm,
        isSupabaseEnabled,
        deleteSessionFromSupabase,
        shutdownBot,
        log,
        logError
    }),
    ...createUtilitySystemCommands({
        safeWaReply,
        buildOmegaTerminal,
        loadSharp,
        loadQrcode,
        downloadMediaMessage,
        createSilentLogger: () => pino({ level: 'silent' }),
        groupChannelLink: GROUP_CHANNEL_LINK,
        logError
    }),
    ...createConfigurationCommands({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        saveBotConfig,
        welcomeGoodbyeSessions,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        sendMenuPoll
    }),
    ...createAccessModeCommands({
        safeWaReply,
        buildOmegaTerminal,
        loadBotMode,
        saveBotMode,
        terminalHeader: TERMINAL_HEADER
    }),
    ...createCustomizationCommands({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        saveBotConfig
    }),
    ...createConfigManagementCommands({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        downloadMediaMessage,
        createSilentLogger: () => pino({ level: 'silent' }),
        getAntideleteState,
        loadBotMode,
        splitApiKeys,
        defaultBotConfig: DEFAULT_BOT_CONFIG,
        saveBotConfig,
        logError
    }),
    ...createPluginKeyCommands({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        loadBotConfig,
        saveBotConfig,
        splitApiKeys,
        maskApiKey,
        isValidGeminiKey
    }),
    ...createDeploymentCommands({
        safeWaReply,
        isDevNumber,
        getGitSyncBusy: () => gitSyncBusy,
        setGitSyncBusy: value => { gitSyncBusy = value; },
        gitCheck,
        pullLatestCode,
        truncateCommitName,
        log,
        logError,
        relaunchSelf
    }),
    ...createPersonaCommands({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        loadBotConfig,
        saveBotConfig,
        sendRuinMenu,
        sendEclipseMenu,
        sendMenuPoll,
        personaPollKeys,
        helpPersonaPollKeys,
        personaPollQuestion: PERSONA_POLL_QUESTION,
        personaPollOptions: PERSONA_POLL_OPTIONS,
        personaPollIds: PERSONA_POLL_IDS,
        log,
        logError
    }),
    ...createSudoCommands({
        safeWaReply,
        isDevNumber,
        loadBotConfig,
        saveBotConfig,
        getQuotedContext,
        normalizeDigits,
        normalizeJid: jidNormalizedUser
    }),
    ...createConfigDeleteCommands({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        warnConfigSessions,
        antiConfigSessions,
        autoreactSessions,
        ensureWarnGroup,
        getWarnState,
        saveWarnState,
        getAntideleteState,
        listAntideleteEndpoints,
        saveAntideleteState,
        saveBotConfig
    }),
    ...createHelpCommands({
        safeWaReply,
        buildBugMenuText,
        log,
        logError,
        isSudo,
        loadBotConfig,
        helpPersonaPollKeys,
        sendMenuPoll,
        helpPersonaPollQuestion: HELP_PERSONA_POLL_QUESTION,
        helpPersonaPollOptions: HELP_PERSONA_POLL_OPTIONS,
        helpPersonaPollIds: HELP_PERSONA_POLL_IDS,
        getBoundHelpPrompt,
        callUniversalAI,
        aiOptsFor,
        getStaticHelpAnswer,
        terminalHeader: TERMINAL_HEADER,
        helpModeUsers
    }),
    ...createAiFunCommands({
        resolveTargetJid,
        extractQuotedPlainText,
        getQuotedContext,
        normalizeJid: jidNormalizedUser,
        funRoastSystem,
        generateScoredFun,
        loadBotConfig,
        logError,
        safeWaReply
    }),
    ...createTicTacToeCommands({
        getTttGame,
        tttSamePlayer,
        tttClearTimer,
        tttDeletePoll,
        tttPaint,
        tttArmTimer,
        tttGames,
        tttKey,
        buildOmegaTerminal,
        tttIsReplyToBoard,
        tttTryMove,
        resolveTargetJid,
        tttOfferChallenge,
        tttStart,
        tttResolveLabel,
        tttCollectIds,
        tttSetupSessions,
        sendMenuPoll,
        logError,
        safeWaReply
    }),
    ...createAccountToolCommands({
        safeWaReply,
        buildOmegaTerminal,
        normalizeJid: jidNormalizedUser,
        fetchBuffer,
        groupChannelLink: GROUP_CHANNEL_LINK,
        downloadQuotedMedia,
        resolveTargetJid,
        isDevNumber,
        logError
    }),
    ...createGroupMembershipCommands({
        safeWaReply,
        buildOmegaTerminal,
        isParticipantAdmin,
        normalizeJid: jidNormalizedUser,
        logError
    }),
    ...createGroupInformationCommands({
        safeWaReply,
        buildOmegaTerminal,
        normalizeJid: jidNormalizedUser,
        groupChannelLink: GROUP_CHANNEL_LINK,
        isDevNumber,
        isUserGroupAdmin
    }),
    ...createGroupModerationCommands({
        safeWaReply,
        buildOmegaTerminal,
        resolveTargetJid,
        normalizeJid: jidNormalizedUser,
        isParticipantAdmin,
        isDevNumber,
        mutedUsers,
        log,
        logError
    }),
    ...createGroupProtectionCommands({
        safeWaReply,
        buildOmegaTerminal,
        resolveAndJoinTarget,
        isParticipantAdmin,
        isDevNumber,
        saveBotConfig,
        getAntideleteState,
        saveAntideleteState,
        autoreactSessions,
        antiConfigSessions,
        sendMenuPoll
    }),
    ...createGroupWarningCommands({
        safeWaReply,
        buildOmegaTerminal,
        isDevNumber,
        isUserGroupAdmin,
        resolveTargetJid,
        normalizeJid: jidNormalizedUser,
        ensureWarnGroup,
        applyWarn,
        getUserWarns,
        setUserWarns,
        listGroupWarns,
        getWarnState,
        autoreactSessions,
        antiConfigSessions,
        warnConfigSessions,
        sendMenuPoll
    }),
    ...createSandboxPayloadCommands({
        isDevNumber,
        safeWaReply,
        delay,
        isSupabaseEnabled,
        setSyncPaused,
        buildAndrozPayload,
        buildTestfffMessage,
        prepareCardImage,
        wireBytesOf,
        recordBugSends,
        log,
        logError
    })
]);

// ──────────────────────────────────────────────
// 🔐 BRUTE-FORCE POLL DECRYPTION
// ──────────────────────────────────────────────

// Try to decrypt an encrypted poll vote against a set of creator/voter JID
// candidates (PN + LID) and, if it matches, return the selected option index.
function decryptVoteOption(secretHex, options, pollMsgId, creatorJids, voterJids, encVote) {
    const secretBuf = Buffer.from(secretHex, 'hex');
    for (const creator of creatorJids) {
        for (const voter of voterJids) {
            try {
                const d = decryptPollVote(encVote, {
                    pollEncKey: secretBuf,
                    pollCreatorJid: creator,
                    pollMsgId,
                    voterJid: voter,
                });
                if (d?.selectedOptions?.length) {
                    const hash = Buffer.from(d.selectedOptions[0]).toString('hex');
                    const idx = options.findIndex(
                        (o) => crypto.createHash('sha256').update(Buffer.from(o)).digest('hex') === hash
                    );
                    if (idx >= 0) return idx;
                }
            } catch (_) { /* wrong combo */ }
        }
    }
    return -1;
}

// Handles a decrypted vote arriving via a `messages.update` `pollUpdates` event.
// (Some Baileys builds emit this; harmless if it never fires.)
function handlePollVote(sock, phoneNumber, key, pollUpdates) {
    const cache = loadPollCache(phoneNumber);
    const cached = cache.get(key.id);
    if (!cached) return null;

    const mePN  = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';
    const rawLID = sock.user?.lid || sock.authState?.creds?.me?.lid || '';
    const meLID = rawLID ? jidNormalizedUser(rawLID) : '';

    const creators = [...new Set([meLID, mePN].filter(Boolean))];
    const keyJid = jidNormalizedUser(key.participant || key.remoteJid || '');
    if (keyJid) creators.push(keyJid);

    const voters = [];
    if (key.fromMe) { 
        voters.push(mePN, meLID); 
    } else if (key.participant) {
        voters.push(jidNormalizedUser(key.participant));
    } else {
        voters.push(jidNormalizedUser(key.remoteJid));
    }
    const uniqVoters = [...new Set(voters.filter(Boolean))];

    // 🛡️ same voting rights as the pollUpdateMessage path
    const ownerJids = [...new Set([mePN, meLID].filter(Boolean))];
    if (!canVoteOnPoll(phoneNumber, uniqVoters, Array.isArray(cached.ids) ? cached.ids : [], ownerJids)) {
        return null;
    }

    for (const update of pollUpdates) {
        if (!update?.vote) continue;
        const idx = decryptVoteOption(cached.secretHex, cached.options, key.id, creators, uniqVoters, update.vote);
        if (idx >= 0 && cached.ids && cached.ids[idx]) return cached.ids[idx];
    }
    return null;
}

// In Baileys 7.0.0-rc13 the built-in poll vote decryption is commented out, so
// votes arrive as raw `pollUpdateMessage` upserts (NOT via `messages.update`).
// This decrypts them manually and returns the selected menu id (or null).
function handlePollUpdateMessage(sock, phoneNumber, msg) {
    const content = msg?.message?.pollUpdateMessage;
    if (!content) return null;

    const creationKey = content.pollCreationMessageKey;
    if (!creationKey?.id) return null;

    const pollId = creationKey.id;

    const cache = loadPollCache(phoneNumber);
    const cached = cache.get(pollId);
    if (!cached) {
        log('POLL', `${phoneNumber}: poll update for unknown poll ${pollId}`);
        return null;
    }

    const encVote = content.vote;
    if (!encVote) return null;

    const mePN  = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';
    const rawLID = sock.user?.lid || sock.authState?.creds?.me?.lid || '';
    const meLID = rawLID ? jidNormalizedUser(rawLID) : '';

    // Poll creator = author of the poll creation message (LID + PN combos)
    const creators = [...new Set([meLID, mePN].filter(Boolean))];
    const ckeyJid = jidNormalizedUser(creationKey.participant || creationKey.remoteJid || '');
    if (ckeyJid) creators.push(ckeyJid);

    // Voter = author of the poll update message (LID + PN combos)
    const voters = [];
    if (msg.key?.fromMe) {
        voters.push(mePN, meLID);
    } else if (msg.key?.participant) {
        voters.push(jidNormalizedUser(msg.key.participant));
    } else {
        voters.push(jidNormalizedUser(msg.key.remoteJid));
    }
    const uniqVoters = [...new Set(voters.filter(Boolean))];

    // 🛡️ POLL VOTING RIGHTS: owner votes on everything; sudoes vote on
    // menu/game polls (they can navigate the bot) but NEVER on bot-self
    // config polls (persona/helpconfig/autoreact/antidelete/warn setups);
    // everyone else only votes on game/ttt polls.
    const ownerJids = [...new Set([mePN, meLID].filter(Boolean))];
    if (!canVoteOnPoll(phoneNumber, uniqVoters, Array.isArray(cached.ids) ? cached.ids : [], ownerJids)) {
        log('POLL', `${phoneNumber}: ignored non-owner poll vote (voter=[${uniqVoters.join(',')}])`);
        return null;
    }

    const idx = decryptVoteOption(cached.secretHex, cached.options, pollId, creators, uniqVoters, encVote);
    if (idx >= 0 && cached.ids && cached.ids[idx]) {
        const optionId = cached.ids[idx];
        // Only reply when the voter actually changes their selection (or votes a
        // new option), so re-selecting the same option doesn't re-trigger.
        const voterJid = uniqVoters[0] || 'me';
        const voteKey = `${pollId}:${voterJid}`;
        if (lastPollVotes.get(voteKey) === optionId) {
            log('POLL', `${phoneNumber}: duplicate vote on ${optionId} ignored for ${voteKey}`);
            return null;
        }
        lastPollVotes.set(voteKey, optionId);
        return { optionId, pollId, voterJid };
    }
    log('POLL', `${phoneNumber}: decrypt failed for poll ${pollId} (creators=[${creators.join(',')}] voters=[${uniqVoters.join(',')}])`);
    return null;
}

// Sends a native WhatsApp poll and stores its decryption details in cache.
// Used for the main .menu poll and the "Choose Your Domain" sub-poll.
async function sendMenuPoll(sock, remoteJid, phoneNumber, question, options, ids) {
    if (sock?._eventidePhone) flashPresenceOnline(sock, sock._eventidePhone);

    const pollOptions = Array.isArray(options) ? options.map(v => String(v || '').trim()).filter(Boolean) : [];
    const pollIds = Array.isArray(ids) ? ids : [];
    if (!remoteJid || remoteJid === 'unknown') throw new Error('Poll destination is missing.');
    if (!String(question || '').trim()) throw new Error('Poll question is empty.');
    if (pollOptions.length < 2 || pollOptions.length > 12) {
        throw new Error(`A WhatsApp poll needs 2–12 options; received ${pollOptions.length}.`);
    }
    if (pollIds.length !== pollOptions.length) {
        throw new Error(`Poll option/id mismatch (${pollOptions.length} options, ${pollIds.length} ids).`);
    }

    const secret = crypto.randomBytes(32);
    log('POLL-SEND', `${phoneNumber}: sending poll to ${remoteJid} | options=${pollOptions.length} | question=${JSON.stringify(trimForLog(question, 80))}`);

    // xzcbailz's high-level `{ poll: ... }` generator produces V3. Runtime
    // logs proved that V3 was built and relayed to the self-chat LID, yet the
    // server never acknowledged/rendered it. Build the widely-compatible V1
    // poll envelope directly instead. relayMessage() still handles encryption,
    // message type="poll", and the single required polltype=creation meta node.
    const pollContent = proto.Message.create({
        messageContextInfo: { messageSecret: secret },
        pollCreationMessage: {
            name: String(question),
            options: pollOptions.map(optionName => ({ optionName })),
            selectableOptionsCount: 1
        }
    });
    const pollMsg = generateWAMessageFromContent(remoteJid, pollContent, {
        userJid: sock.user?.id
    });
    if (!pollMsg?.key?.id || !pollMsg?.message?.pollCreationMessage) {
        throw new Error('Could not generate the V1 poll envelope.');
    }

    await sock.relayMessage(remoteJid, pollMsg.message, {
        messageId: pollMsg.key.id
    });
    log('POLL-SEND', `${phoneNumber}: poll relayed | id=${pollMsg.key.id} | type=pollCreationMessage(V1) | jid=${remoteJid}`);

    const actualSecret =
        pollMsg?.message?.messageContextInfo?.messageSecret ||
        pollMsg?.messageContextInfo?.messageSecret ||
        secret;

    const cache = loadPollCache(phoneNumber);
    cache.set(pollMsg.key.id, {
        secretHex: actualSecret.toString('hex'),
        options: pollOptions,
        ids: pollIds,
        fullMessage: pollMsg.message || null
    });
    savePollCache(phoneNumber, cache);

    return pollMsg;
}

// Routes a decrypted poll vote to the correct menu flow.
// Sends the matching menu banner image with the menu text as its caption.
async function sendMenuBanner(sock, remoteJid, imagePath, caption) {
    if (sock?._eventidePhone) flashPresenceOnline(sock, sock._eventidePhone);
    try {
        const sent = await sock.sendMessage(remoteJid, {
            image: { url: imagePath },
            caption: formatForWhatsApp(caption)
            // contextInfo: channelContextInfo() // (commented: externalAdReply caused "no proper viewing app" error)
        });
        return sent?.key || null;
    } catch (err) {
        logError('WA-BANNER', `Failed to send banner for ${remoteJid}`, err);
        // Fall back to sending the caption as a plain text reply.
        try {
            const sent = await sock.sendMessage(remoteJid, { text: formatForWhatsApp(caption) });
            return sent?.key || null;
        } catch (_) { return null; }
    }
}


// Records a sent menu message key so it can be deleted when the vote changes.
function recordMenuMessage(replyKey, msgKey) {
    if (!msgKey?.id) return;
    const arr = menuReplyMessages.get(replyKey) || [];
    arr.push(msgKey);
    menuReplyMessages.set(replyKey, arr);
}

// Deletes every previously-sent menu message for a poll+voter on a vote change.
async function deleteMenuMessages(sock, replyKey) {
    const messages = menuReplyMessages.get(replyKey) || [];
    for (const key of messages) {
        try {
            await sock.sendMessage(key.remoteJid, { delete: key });
        } catch (err) {
            logError('WA-DEL', `Failed to delete menu message ${key?.id}`, err);
        }
    }
    menuReplyMessages.delete(replyKey);
}

// 🧪 Shared bug-menu text builder — used by BOTH the .bugmenu command and the
// menu-poll "BUG MENU" vote, so they always send the exact same reply.
function buildBugMenuText(prefix = '.') {
    const date = new Date();
    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const menuText = [
            '╭┈〔 *𝙸𝙽𝙵𝙾 𝙱𝙾𝚃* 〕',
            '┆𖤍╭────↯',
            `┃𖤍│➣ *𝙿𝚁𝙴𝙵𝙸𝚇:* ${prefix}`,
            `┃𖤍│➣ *𝙳𝙰𝚃𝙴:* ${date.toLocaleDateString('en-GB')}`,
            `┃𖤍│➣ *ᴜᴘᴛɪᴍᴇ*: ${hours}h ${minutes}m ${seconds}s`,
            `┃𖤍│➣ *𝚁𝚄𝙽𝚃𝙸𝙼𝙴:* ${process.version}`,
            `┃𖤍│➣ *𝙼𝙾𝙳𝙴:* ${currentMode}`,
            '┆𖤍╰────↯',
            '╰┄┄┄┄┄┄┄┄┄┄┄┄┄〩',
            '',
            '╭┈〔 *Eventides-omega-𝙱𝚄𝙶 menu* 〕',
            '┆𖤍╭────↯',
            '┃𖤍│ ᖫ *𝙰𝙽𝙳𝚁𝙾𝙸𝙳* ᖭ',
            '┃𖤍│ ╰━➤ *`𝙲𝚁𝙰𝚂𝙷`*',
            '┃𖤍│➣ *.𝗰𝗿𝗮𝘀𝗵-𝗵𝗮𝗿𝗱* <num>',
            '┃𖤍│➣ *.𝗳𝗿𝘇-𝗼𝗼𝗺* <num>',
            '┃𖤍│',
            '┃𖤍│ ᖫ *𝙸𝙾𝚂* ᖭ',
            '┃𖤍│      ╰━➤ *`𝙲𝚁𝙰𝚂𝙷 / 𝙵𝚁𝙴𝙴𝚉𝙴`*',
            '┃𖤍│➣ *.𝗰𝗿𝗮𝘀𝗵-𝗶𝗼𝘀* <num>',
            '┃𖤍│➣ *.𝗰𝗿𝗮𝘀𝗵-𝗶𝗼𝘀𝗱* <num>',
            '┃𖤍│➣ *.𝗳𝗿𝘇-𝗶𝗼𝘀* <num> ',
            '┃𖤍│➣ *.𝗶𝗼𝘀-𝘇𝗸* <num> — ×60 loc/mention bomb',
            '┃𖤍│',
            '┃𖤍│ ᖫ *𝙷𝚈𝙱𝚁𝙸𝙳 𝙽𝚄𝙺𝙴* ᖭ',
            '┃𖤍│      ╰━➤ *`𝙵𝚅𝙲𝙺𝙱𝙸𝚃𝙲𝙷`*',
            '┃𖤍│➣ *.𝗮𝗻𝗱𝗿𝗼-𝗻𝘂𝗸𝗲* <num> [rounds] — ×10 per round',
            '┃𖤍│',
            '┃𖤍│ ᖫ *𝙶𝚁𝙾𝚄𝙿* ᖭ',
            '┃𖤍│      ╰━➤ *`𝙲𝚁𝙰𝚂𝙷𝙲𝙻𝙸𝙲𝙺`*',
            '┃𖤍│➣ *.𝗴𝗯* yes — in group ×10',
            '┃𖤍│➣ *.𝗴𝗯* <invite link> — group ×10',
            '┃𖤍│➣ *.𝗴𝗯-𝗵𝗮𝗿𝗱* <link> — group app-level ×10',
            '┆𖤍╰────↯',
            '╰┄┄┄┄┄┄┄┄┄┄┄┄┄〩',
            '',
            '> please dont spam to aviod bans, i didnt say dont use, just type the name of the command you wanna use and youll see how to use it',
            `Main menu: ${prefix}menu`
        ].join('\n');
    return menuText;
}

async function handleMenuVote(sock, remoteJid, phoneNumber, votedOptionId, pollId = '', voterJid = 'me') {
    log('POLL-MENU', `${phoneNumber}: handling vote -> ${votedOptionId} for ${remoteJid}`);
    const replyKey = `${pollId}:${voterJid}`;
    try {
        // Delete the previous menu reply (image + caption, and for owners the
        // domain poll too) when the user changes their vote.
        await deleteMenuMessages(sock, replyKey);
        if (pollId && /^(ar_|ad_|wn_|wg_|greet_)/.test(String(votedOptionId || ''))) {
            await tttDeleteVotedPoll(sock, remoteJid, pollId);
        }

        switch (votedOptionId) {
            case 'persona_eclipse':
            case 'persona_ruin': {
                // 🎭 First-pair persona pick: delete the poll, save the choice,
                // then show the chosen persona's menu.
                try {
                    const pkey = personaPollKeys.get(phoneNumber);
                    if (pkey?.id) {
                        try {
                            await sock.sendMessage(remoteJid, { delete: { remoteJid: pkey.remoteJid || remoteJid, id: pkey.id, fromMe: true } });
                        } catch (_) {}
                    }
                    if (pollId) await tttDeleteVotedPoll(sock, remoteJid, pollId);
                    personaPollKeys.delete(phoneNumber);
                } catch (_) {}

                const persona = votedOptionId === 'persona_eclipse' ? 'eclipse' : 'ruin';
                const bc = loadBotConfig(phoneNumber);
                bc.persona = persona;
                saveBotConfig(phoneNumber, bc);
                log('PERSONA', `${phoneNumber}: persona bound -> ${persona.toUpperCase()} (persisted in bot_config.json)`);

                await sock.sendMessage(remoteJid, {
                    text: `𖣘 *PERSONA BOUND* :: ${persona.toUpperCase()}\n\n` +
                        (persona === 'ruin'
                            ? `   clean minimal interface armed.\n   type .menu to see it.`
                            : `   cinematic terminal armed.\n   type .menu to see it.`)
                }).catch(() => {});

                if (persona === 'ruin') {
                    try { await sendRuinMenu(sock, remoteJid, phoneNumber); }
                    catch (err) { logError('PERSONA', `${phoneNumber}: ruin menu failed`, err); }
                } else {
                    try { await sendEclipseMenu(sock, remoteJid, phoneNumber); }
                    catch (err) { logError('PERSONA', `${phoneNumber}: eclipse menu failed`, err); }
                }
                break;
            }
            case 'rm_all': {
                const k = await sock.sendMessage(remoteJid, { text: buildRuinCommandIndexBox(phoneNumber) });
                if (k?.key) recordMenuMessage(replyKey, k.key);
                break;
            }
            case 'rm_system': {
                const k = await sock.sendMessage(remoteJid, { text: buildRuinSystemMenu(phoneNumber) });
                if (k?.key) recordMenuMessage(replyKey, k.key);
                break;
            }
            case 'rm_config': {
                const k = await sock.sendMessage(remoteJid, { text: buildRuinConfigMenu(phoneNumber) });
                if (k?.key) recordMenuMessage(replyKey, k.key);
                break;
            }
            case 'rm_group': {
                const k = await sock.sendMessage(remoteJid, { text: buildRuinGroupMenu(phoneNumber) });
                if (k?.key) recordMenuMessage(replyKey, k.key);
                break;
            }
            case 'rm_fun': {
                const k = await sock.sendMessage(remoteJid, { text: buildRuinFunMenu(phoneNumber) });
                if (k?.key) recordMenuMessage(replyKey, k.key);
                break;
            }
            case 'helpp_eclipse':
            case 'helpp_ruin': {
                // 🛎 First-.help persona pick: delete the poll, save the voice,
                // confirm. Saved forever — the poll never shows again.
                try {
                    const hpKey = helpPersonaPollKeys.get(phoneNumber);
                    if (hpKey?.id) {
                        try {
                            await sock.sendMessage(remoteJid, { delete: { remoteJid: hpKey.remoteJid || remoteJid, id: hpKey.id, fromMe: true } });
                        } catch (_) {}
                    }
                    if (pollId) await tttDeleteVotedPoll(sock, remoteJid, pollId);
                    helpPersonaPollKeys.delete(phoneNumber);
                } catch (_) {}

                const hp = votedOptionId === 'helpp_eclipse' ? 'eclipse' : 'ruin';
                const bc = loadBotConfig(phoneNumber);
                bc.helpPersona = hp;
                saveBotConfig(phoneNumber, bc);
                log('HELPP', `${phoneNumber}: help persona bound -> ${hp.toUpperCase()} (persisted in bot_config.json)`);

                await sock.sendMessage(remoteJid, {
                    text: hp === 'ruin'
                        ? `🛎 *HELP PERSONA BOUND* :: RUIN\n\n` +
                          `friendly support armed.\n` +
                          `type .help <question> — and talk\n` +
                          `to me like a human. 🙂`
                        : `🌑 *HELP PERSONA BOUND* :: ECLIPSE\n\n` +
                          `cinematic oracle armed.\n` +
                          `type .help <question>.`
                }).catch(() => {});
                break;
            }
            case 'ttt_vs_bot': {
                await tttDeleteVotedPoll(sock, remoteJid, pollId);
                const sess = tttSetupSessions.get(phoneNumber) || { chat: remoteJid, host: sock.user?.id };
                if (voterJid && voterJid !== 'me' && sess.host && !tttSamePlayer(voterJid, sess.host) && !tttSamePlayer(voterJid, sock.user?.id)) {
                    break;
                }
                tttSetupSessions.set(phoneNumber, { ...sess, step: 'diff', chat: remoteJid });
                const diffPoll = await sendMenuPoll(sock, remoteJid, phoneNumber, 'VOID LEVEL', ['Easy', 'Medium', 'Hard'], ['ttt_easy', 'ttt_med', 'ttt_hard']);
                sess.diffPollKey = diffPoll?.key || null;
                tttSetupSessions.set(phoneNumber, { ...sess, step: 'diff', chat: remoteJid, diffPollKey: diffPoll?.key || null });
                break;
            }
            case 'ttt_vs_p': {
                await tttDeleteVotedPoll(sock, remoteJid, pollId);
                const sess = tttSetupSessions.get(phoneNumber) || { chat: remoteJid, host: sock.user?.id };
                const host = sess.host || sock.user?.id;
                if (voterJid && voterJid !== 'me' && sess.host && !tttSamePlayer(voterJid, sess.host) && !tttSamePlayer(voterJid, sock.user?.id)) {
                    break;
                }
                tttSetupSessions.delete(phoneNumber);
                await tttOpenLobby(sock, phoneNumber, remoteJid, host);
                break;
            }
            case 'ttt_easy':
            case 'ttt_med':
            case 'ttt_hard': {
                await tttDeleteVotedPoll(sock, remoteJid, pollId);
                const sess = tttSetupSessions.get(phoneNumber) || {};
                const host = sess.host || sock.user?.id;
                if (voterJid && voterJid !== 'me' && sess.host && !tttSamePlayer(voterJid, sess.host) && !tttSamePlayer(voterJid, sock.user?.id)) {
                    break;
                }
                const diff = votedOptionId === 'ttt_easy' ? 'easy' : votedOptionId === 'ttt_hard' ? 'hard' : 'medium';
                tttSetupSessions.delete(phoneNumber);
                await tttStart(sock, phoneNumber, remoteJid, {
                    x: host,
                    o: 'BOT',
                    vsBot: true,
                    difficulty: diff,
                    xLabel: sess.hostLabel || await tttResolveLabel(sock, phoneNumber, host, null),
                    oLabel: 'VOID',
                    xIds: sess.hostIds || tttCollectIds(sock, phoneNumber, host, null)
                });
                break;
            }
            case 'ttt_yes': {
                await tttDeleteVotedPoll(sock, remoteJid, pollId);
                const game = getTttGame(phoneNumber, remoteJid);
                if (!game || game.status !== 'pending') { await sock.sendMessage(remoteJid, { text: '❌ No open seat.' }); break; }
                const voter = voterJid === 'me' ? sock.user?.id : voterJid;
                if (game.openSeat) {
                    if (tttSamePlayer(voter, game.x)) {
                        await sock.sendMessage(remoteJid, { text: '❌ You already host this grid. Wait for a rival.' });
                        break;
                    }
                    game.o = voter;
                    game.oLabel = await tttResolveLabel(sock, phoneNumber, voter, null);
                    game.oIds = tttCollectIds(sock, phoneNumber, voter, null);
                    game.openSeat = false;
                } else if (!tttSamePlayer(voter, game.o)) {
                    await sock.sendMessage(remoteJid, { text: '❌ This invite is sealed. Only the tagged rival may sit.' });
                    break;
                }
                game.status = 'active';
                tttClearTimer(game);
                game.boardKey = null;
                await tttDeletePoll(sock, game);
                await tttPaint(sock, phoneNumber, game);
                tttArmTimer(sock, phoneNumber, game);
                tttArmDeadGame(sock, phoneNumber, game);
                break;
            }
            case 'ttt_no': {
                await tttDeleteVotedPoll(sock, remoteJid, pollId);
                const game = getTttGame(phoneNumber, remoteJid);
                if (!game || game.status !== 'pending') break;
                const voter = voterJid === 'me' ? sock.user?.id : voterJid;
                const canCancel = tttSamePlayer(voter, game.x) || tttSamePlayer(voter, game.o) || tttSamePlayer(voter, sock.user?.id);
                if (!canCancel) break;
                tttClearTimer(game);
                await tttDeletePoll(sock, game);
                tttGames.delete(tttKey(phoneNumber, remoteJid));
                await sock.sendMessage(remoteJid, { text: '🕊 Seat cancelled. The grid sleeps.' });
                break;
            }
            case 'ttt_again': {
                const game = getTttGame(phoneNumber, remoteJid);
                if (!game) { await sock.sendMessage(remoteJid, { text: '❌ No arena to rematch. *.ttt*' }); break; }
                await tttStart(sock, phoneNumber, remoteJid, {
                    x: game.x, o: game.o, vsBot: game.vsBot, difficulty: game.difficulty || 'medium',
                    xLabel: game.xLabel, oLabel: game.oLabel, xIds: game.xIds || [], oIds: game.oIds || []
                });
                break;
            }
            case 'ttt_close': {
                const game = getTttGame(phoneNumber, remoteJid);
                if (game) { tttClearTimer(game); await tttDeletePoll(sock, game); }
                tttGames.delete(tttKey(phoneNumber, remoteJid));
                await sock.sendMessage(remoteJid, { text: buildOmegaTerminal(`   ✦ *ARENA_CLOSED*\n\n   " The grid forgets. "`) });
                break;
            }
            case 'owners': {
                const k1 = await sendMenuBanner(sock, remoteJid, OWNERS_MENU_PATH, OWNERS_WELCOME_TEXT);
                if (k1) recordMenuMessage(replyKey, k1);
                await delay(400);
                const pollMsg = await sendMenuPoll(sock, remoteJid, phoneNumber, DOMAIN_POLL_QUESTION, DOMAIN_POLL_OPTIONS, DOMAIN_POLL_IDS);
                if (pollMsg?.key) recordMenuMessage(replyKey, pollMsg.key);
                break;
            }
            case 'group': {
                const k = await sendMenuBanner(sock, remoteJid, GROUP_MENU_PATH, GROUP_MENU_TEXT);
                if (k) recordMenuMessage(replyKey, k);
                break;
            }
            case 'fun': {
                const k = await sendMenuBanner(sock, remoteJid, FUN_MENU_PATH, FUN_PLACEHOLDER_TEXT);
                if (k) recordMenuMessage(replyKey, k);
                break;
            }
            case 'bug': {
                // Same reply as the .bugmenu command — the shared builder
                // keeps command list and poll vote perfectly in sync.
                const bugPrefix = String(loadBotConfig(phoneNumber)?.prefix || '.');
                const sent = await sock.sendMessage(remoteJid, { text: buildBugMenuText(bugPrefix) });
                if (sent?.key) recordMenuMessage(replyKey, sent.key);
                break;
            }
            case 'system': {
                const k = await sendMenuBanner(sock, remoteJid, SYSTEM_MENU_PATH, SYSTEM_MENU_TEXT);
                if (k) recordMenuMessage(replyKey, k);
                break;
            }
            case 'config': {
                const k = await sendMenuBanner(sock, remoteJid, CONFIG_MENU_PATH, CONFIG_MENU_TEXT);
                if (k) recordMenuMessage(replyKey, k);
                break;
            }
            case 'ar_add': {
                // Autoreact: choose endpoint category
                autoreactSessions.set(phoneNumber, { step: 'category' });
                await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                    `   ░▒▓█ *ENDPOINT_CATEGORY* █▓▒░\n\n` +
                    `   Which type of endpoint do\n` +
                    `   you want to auto-react to?`
                ));
                await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ ENDPOINT TYPE ✦', ['👥 Group', '📢 Channel', '👤 Contact'], ['ar_cat_group', 'ar_cat_channel', 'ar_cat_contact']);
                break;
            }
            case 'ar_delete': {
                // Autoreact: list endpoints with indices for deletion via .del
                const cfg = loadBotConfig(phoneNumber).autoreact || { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } };
                const g = cfg.endpoints?.groups || [], c = cfg.endpoints?.channels || [], ct = cfg.endpoints?.contacts || [];
                let n = 1, list = '';
                if (g.length) { list += `  ─ *GROUPS* ─\n`; for (const e of g) list += `   [${n++}] ${e}\n`; }
                if (c.length) { list += `  ─ *CHANNELS* ─\n`; for (const e of c) list += `   [${n++}] ${e}\n`; }
                if (ct.length) { list += `  ─ *CONTACTS* ─\n`; for (const e of ct) list += `   [${n++}] ${e}\n`; }
                if (!n) list = '   _no endpoints yet_';
                await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                    `   ░▒▓█ *ENDPOINTS* █▓▒░\n\n` +
                    `${list}\n\n` +
                    `   Delete by index: *_.del 2 5 6 9_*`
                ));
                autoreactSessions.set(phoneNumber, { step: 'delete' });
                break;
            }
            case 'ar_cat_group':
            case 'ar_cat_channel':
            case 'ar_cat_contact': {
                const type = votedOptionId.replace('ar_cat_','');
                const cfg = loadBotConfig(phoneNumber).autoreact || { enabled: false, endpoints: { groups: [], channels: [], contacts: [] } };
                if (type === 'contact') {
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *CONTACT_ENDPOINT* █▓▒░\n\n` +
                        `   Send the phone number you want\n` +
                        `   auto-reacted. All messages from it\n` +
                        `   will be reacted to.\n\n` +
                        `   (or type *.cancel* to exit)`
                    ));
                    autoreactSessions.set(phoneNumber, { step: 'awaiting_contact' });
                } else if (type === 'group') {
                    await offerGroupPickPoll(sock, remoteJid, phoneNumber, 'ar', 'Choose a group to auto-react.');
                } else if (type === 'channel') {
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   📢 *CHANNEL_ENDPOINT*\n\n` +
                        `   Reply to this (or the poll) with\n` +
                        `   a channel link or ID.\n` +
                        `   I will follow it if I am not in.\n\n` +
                        `   or type *.cancel*`
                    ));
                    autoreactSessions.set(phoneNumber, { step: 'awaiting_ref', ward: 'ar', endpoint: 'channel', chat: remoteJid });
                }
                break;
            }
            case 'greet_welcome':
            case 'greet_goodbye': {
                const gsess = welcomeGoodbyeSessions.get(phoneNumber);
                const gtype = votedOptionId === 'greet_welcome' ? 'welcome' : 'goodbye';
                welcomeGoodbyeSessions.set(phoneNumber, { step: 'action', type: gtype, group: gsess?.group || remoteJid });
                await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                    `   ░▒▓█ *THRESHOLD_MATRIX* █▓▒░\n\n` +
                    `   Configure the ${gtype}\n` +
                    `   message for this group.`
                ));
                await sendMenuPoll(sock, remoteJid, phoneNumber, gtype === 'welcome' ? '✦ WELCOME MATRIX ✦' : '✦ GOODBYE MATRIX ✦', ['📝 Custom Message', '🎯 Default Message', '🚫 Disable'], gtype === 'welcome' ? ['wg_wel_custom','wg_wel_default','wg_wel_off'] : ['wg_gb_custom','wg_gb_default','wg_gb_off']);
                break;
            }
            case 'wg_wel_custom':
            case 'wg_gb_custom':
            case 'wg_wel_default':
            case 'wg_gb_default':
            case 'wg_wel_off':
            case 'wg_gb_off': {
                const sess = welcomeGoodbyeSessions.get(phoneNumber);
                const type = sess?.type || (votedOptionId.includes('wel') ? 'welcome' : 'goodbye');
                const group = sess?.group || remoteJid;
                const isWel = type === 'welcome';
                const cfg = loadBotConfig(phoneNumber);
                cfg[isWel ? 'welcomeMsg' : 'goodbyeMsg'] = cfg[isWel ? 'welcomeMsg' : 'goodbyeMsg'] || {};
                if (votedOptionId.endsWith('_off')) {
                    cfg[isWel ? 'welcomeMsg' : 'goodbyeMsg'][group] = 'off';
                    saveBotConfig(phoneNumber, cfg);
                    welcomeGoodbyeSessions.delete(phoneNumber);
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ✦ *${isWel ? 'WELCOME' : 'GOODBYE'}* :: DISABLED\n\n   " The threshold falls\n     silent. "`
                    ));
                } else if (votedOptionId.endsWith('_default')) {
                    cfg[isWel ? 'welcomeMsg' : 'goodbyeMsg'][group] = 'default';
                    saveBotConfig(phoneNumber, cfg);
                    welcomeGoodbyeSessions.delete(phoneNumber);
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ✦ *${isWel ? 'WELCOME' : 'GOODBYE'}* :: DEFAULT\n\n   " The standard words\n     are restored. "`
                    ));
                } else {
                    // custom -> ask for the message text
                    welcomeGoodbyeSessions.set(phoneNumber, { step: 'custom_text', type, group });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ✦ *CUSTOM ${isWel ? 'WELCOME' : 'GOODBYE'}*\n\n` +
                        `   Send the ${isWel ? 'welcome' : 'goodbye'} message now.\n` +
                        `   (use *{{name}}* for the member's name)\n\n` +
                        `   or type *.cancel* to exit`
                    ));
                }
                break;
            }
            case 'wn_add':
            case 'wn_cfg':
            case 'wn_remove': {
                const mode = votedOptionId === 'wn_add' ? 'add' : votedOptionId === 'wn_cfg' ? 'cfg' : 'remove';
                let names = [];
                let jids = [];
                try {
                    const g = await sock.groupFetchAllParticipating();
                    if (mode === 'add') {
                        for (const [id, v] of Object.entries(g)) {
                            names.push(v.subject || id);
                            jids.push(id);
                        }
                    } else {
                        const warn = getWarnState(phoneNumber);
                        for (const id of Object.keys(warn.groups || {})) {
                            names.push(g[id]?.subject || id);
                            jids.push(id);
                        }
                    }
                } catch (_) {}
                names = names.slice(0, 10);
                jids = jids.slice(0, 10);
                if (!names.length) {
                    await safeWaReply(sock, remoteJid, mode === 'add' ? '❌ No groups found.' : '❌ No warn groups configured yet. Use Add Group first.');
                    break;
                }
                const prefixId = mode === 'add' ? 'wn_agrp_' : mode === 'cfg' ? 'wn_cgrp_' : 'wn_rgrp_';
                warnConfigSessions.set(phoneNumber, { step: mode, groups: names, jids });
                await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                    mode === 'add' ? `   Choose a group to put under the warn ward:` :
                    mode === 'cfg' ? `   Choose which group's law to reshape:` :
                    `   Choose a group to release from the ward:`
                ));
                await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ SELECT GROUP ✦', names, names.map((_, i) => prefixId + i));
                break;
            }
            case 'wn_limit':
            case 'wn_action':
            case 'wn_phrases':
            case 'wn_resetall':
            case 'wn_on':
            case 'wn_off':
            case 'wn_kick':
            case 'wn_none':
            case 'wn_ph_add':
            case 'wn_ph_del':
            case 'wn_ph_list': {
                const sess = warnConfigSessions.get(phoneNumber);
                const group = sess?.group;
                if (!group) { await safeWaReply(sock, remoteJid, '❌ Warn session expired. Use .warnconfig again.'); break; }
                if (votedOptionId === 'wn_limit') {
                    warnConfigSessions.set(phoneNumber, { step: 'awaiting_limit', group });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *WARN_LIMIT* █▓▒░\n\n` +
                        `   Send how many warns before kick.\n` +
                        `   Use *0* to never kick.\n\n` +
                        `   (or type *.cancel*)`
                    ));
                    break;
                }
                if (votedOptionId === 'wn_action') {
                    await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ WARN ACTION ✦', ['👢 Kick on limit', '📋 Warn only (no kick)'], ['wn_kick', 'wn_none']);
                    break;
                }
                if (votedOptionId === 'wn_kick' || votedOptionId === 'wn_none') {
                    const action = votedOptionId === 'wn_none' ? 'none' : 'kick';
                    ensureWarnGroup(phoneNumber, group, { action });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *WARN_ACTION* █▓▒░\n\n` +
                        `   ✦ *ACTION* :: ${action === 'none' ? 'WARN_ONLY' : 'KICK'}\n\n` +
                        `   " The sentence is set. "`
                    ));
                    break;
                }
                if (votedOptionId === 'wn_on' || votedOptionId === 'wn_off') {
                    ensureWarnGroup(phoneNumber, group, { enabled: votedOptionId === 'wn_on' });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *PHRASE_WARD* █▓▒░\n\n` +
                        `   ✦ *STATE* :: ${votedOptionId === 'wn_on' ? 'ARMED' : 'IDLE'}\n\n` +
                        `   Auto-warn on listed phrases is\n   now ${votedOptionId === 'wn_on' ? 'watching' : 'silent'}.`
                    ));
                    break;
                }
                if (votedOptionId === 'wn_resetall') {
                    const log = loadWarnLog(phoneNumber);
                    delete log[group];
                    saveWarnLog(phoneNumber, log);
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *LEDGER_BURNED* █▓▒░\n\n` +
                        `   All strikes in this group\n   have been wiped.`
                    ));
                    break;
                }
                if (votedOptionId === 'wn_phrases') {
                    await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ PHRASE WARD ✦', ['➕ Add Phrase', '🗑️ Delete Phrase', '📜 List Phrases'], ['wn_ph_add', 'wn_ph_del', 'wn_ph_list']);
                    break;
                }
                if (votedOptionId === 'wn_ph_add') {
                    warnConfigSessions.set(phoneNumber, { step: 'awaiting_phrase', group });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *BIND_PHRASE* █▓▒░\n\n` +
                        `   Send the word or phrase.\n` +
                        `   Example: see   or   send nudes\n\n` +
                        `   Anyone who sends it is warned.\n` +
                        `   (or type *.cancel*)`
                    ));
                    break;
                }
                if (votedOptionId === 'wn_ph_list' || votedOptionId === 'wn_ph_del') {
                    const phrases = ensureWarnGroup(phoneNumber, group).phrases || [];
                    const list = phrases.length ? phrases.map((p, i) => `   [${i + 1}] ${p}`).join('\n') : '   _none bound_';
                    if (votedOptionId === 'wn_ph_del') {
                        warnConfigSessions.set(phoneNumber, { step: 'delete', group, phrases });
                        antiConfigSessions.delete(phoneNumber);
                        autoreactSessions.delete(phoneNumber);
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *PHRASE_LIST* █▓▒░\n\n${list}\n\n` +
                            `   Delete by index: *_.del 1 3_*`
                        ));
                    } else {
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *PHRASE_LIST* █▓▒░\n\n${list}`
                        ));
                    }
                    break;
                }
                break;
            }
            case 'ad_add': {
                antiConfigSessions.set(phoneNumber, { step: 'category' });
                await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                    `   ░▒▓█ *ENDPOINT_CATEGORY* █▓▒░\n\n` +
                    `   Which type of endpoint do\n` +
                    `   you want anti-delete on?`
                ));
                await sendMenuPoll(sock, remoteJid, phoneNumber, '✦ ENDPOINT TYPE ✦', ['👥 Group', '📢 Channel', '👤 Contact'], ['ad_cat_group', 'ad_cat_channel', 'ad_cat_contact']);
                break;
            }
            case 'ad_delete': {
                const ad = getAntideleteState(phoneNumber);
                const { list } = listAntideleteEndpoints(ad);
                await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                    `   ░▒▓█ *ANTIDELETE_ENDPOINTS* █▓▒░\n\n` +
                    `${list}\n\n` +
                    `   Delete by index: *_.del 2 5 6 9_*`
                ));
                antiConfigSessions.set(phoneNumber, { step: 'delete' });
                autoreactSessions.delete(phoneNumber);
                break;
            }
            case 'ad_cat_group':
            case 'ad_cat_channel':
            case 'ad_cat_contact': {
                const type = votedOptionId.replace('ad_cat_', '');
                if (type === 'contact') {
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *CONTACT_ENDPOINT* █▓▒░\n\n` +
                        `   Send the phone number you want\n` +
                        `   watched. Deleted msgs from that\n` +
                        `   chat will be forwarded to you.\n\n` +
                        `   (or type *.cancel* to exit)`
                    ));
                    antiConfigSessions.set(phoneNumber, { step: 'awaiting_contact' });
                } else if (type === 'group') {
                    await offerGroupPickPoll(sock, remoteJid, phoneNumber, 'ad', 'Choose a group to watch for deletions.');
                } else if (type === 'channel') {
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   📢 *CHANNEL_ENDPOINT*\n\n` +
                        `   Reply to this (or the poll) with\n` +
                        `   a channel link or ID.\n` +
                        `   I will follow it if I am not in.\n\n` +
                        `   or type *.cancel*`
                    ));
                    antiConfigSessions.set(phoneNumber, { step: 'awaiting_ref', ward: 'ad', endpoint: 'channel', chat: remoteJid });
                }
                break;
            }
            default:
                if (await handleGameVote({ sock, remoteJid, phoneNumber, votedOptionId, pollId, voterJid })) {
                    break;
                }
                if (votedOptionId?.startsWith('ttt_m')) {
                    const idx = parseInt(String(votedOptionId).replace('ttt_m', ''), 10) - 1;
                    await tttTryMove(sock, phoneNumber, remoteJid, voterJid, idx);
                    break;
                }
                if (votedOptionId?.startsWith('wn_agrp_') || votedOptionId?.startsWith('wn_cgrp_') || votedOptionId?.startsWith('wn_rgrp_')) {
                    const kind = votedOptionId.startsWith('wn_agrp_') ? 'add' : votedOptionId.startsWith('wn_cgrp_') ? 'cfg' : 'remove';
                    const idx = parseInt(votedOptionId.replace(/wn_[acr]grp_/, ''), 10);
                    const sess = warnConfigSessions.get(phoneNumber);
                    const jid = sess?.jids?.[idx];
                    const name = sess?.groups?.[idx] || jid;
                    if (!jid) { await safeWaReply(sock, remoteJid, '❌ Could not resolve that group.'); break; }
                    if (kind === 'remove') {
                        const warn = getWarnState(phoneNumber);
                        delete warn.groups[jid];
                        saveWarnState(phoneNumber, warn);
                        const wlog = loadWarnLog(phoneNumber);
                        delete wlog[jid];
                        saveWarnLog(phoneNumber, wlog);
                        warnConfigSessions.delete(phoneNumber);
                        await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                            `   ░▒▓█ *WARD_RELEASED* █▓▒░\n\n` +
                            `   ✦ *GROUP* :: ${name}\n\n` +
                            `   " The law no longer\n     watches this hall. "`
                        ));
                        break;
                    }
                    if (kind === 'add') ensureWarnGroup(phoneNumber, jid, { enabled: true });
                    warnConfigSessions.set(phoneNumber, { step: 'matrix', group: jid });
                    const gcfg = ensureWarnGroup(phoneNumber, jid);
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *WARN_LAW* █▓▒░\n\n` +
                        `   ✦ *GROUP* :: ${name}\n` +
                        `   ✦ *STATE* :: ${gcfg.enabled ? 'ARMED' : 'IDLE'}\n` +
                        `   ✦ *MAX* :: ${gcfg.maxWarns === 0 ? '∞' : gcfg.maxWarns}\n` +
                        `   ✦ *ACTION* :: ${gcfg.action.toUpperCase()}\n` +
                        `   ✦ *PHRASES* :: ${gcfg.phrases.length}\n\n` +
                        `   Shape the law below.`
                    ));
                    await sendMenuPoll(
                        sock, remoteJid, phoneNumber, '✦ WARN LAW ✦',
                        ['📊 Set Limit', '⚖️ Set Action', '📝 Phrases', '✅ Arm Phrases', '🚫 Disarm Phrases', '🔄 Reset Warns'],
                        ['wn_limit', 'wn_action', 'wn_phrases', 'wn_on', 'wn_off', 'wn_resetall']
                    );
                    break;
                }
                if (votedOptionId === 'ad_grp_paste' || votedOptionId === 'ar_grp_paste') {
                    const ward = votedOptionId.startsWith('ad') ? 'ad' : 'ar';
                    const map = ward === 'ad' ? antiConfigSessions : autoreactSessions;
                    map.set(phoneNumber, { ...(map.get(phoneNumber) || {}), step: 'awaiting_ref', ward, endpoint: 'group', chat: remoteJid });
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ✦ *PASTE LINK OR ID*\n\n` +
                        `   Reply with a group invite\n` +
                        `   (chat.whatsapp.com/…) or a group ID.\n` +
                        `   If I am not inside I will join.\n\n` +
                        `   or type *.cancel*`
                    ));
                    break;
                }
                if (votedOptionId?.startsWith('ad_grp_') || votedOptionId?.startsWith('ar_grp_')) {
                    const ward = votedOptionId.startsWith('ad') ? 'ad' : 'ar';
                    const sess = (ward === 'ad' ? antiConfigSessions : autoreactSessions).get(phoneNumber);
                    const idx = parseInt(String(votedOptionId).replace(/a[rd]_grp_/, ''), 10);
                    const row = sess?.rows?.[idx];
                    const jid = row?.id;
                    const name = row?.name || jid;
                    if (!jid) { await safeWaReply(sock, remoteJid, '❌ Could not resolve that group.'); break; }
                    applyWardEndpoint(phoneNumber, ward, 'group', jid);
                    (ward === 'ad' ? antiConfigSessions : autoreactSessions).delete(phoneNumber);
                    await safeWaReply(sock, remoteJid, buildOmegaTerminal(
                        `   ░▒▓█ *ENDPOINT_ADDED* █▓▒░\n\n` +
                        `   ✦ *TYPE* :: GROUP\n` +
                        `   ✦ *TARGET* :: ${name}\n\n` +
                        (ward === 'ad'
                            ? `   Anti-delete is watching this group.\n   Arm it with *.antidelete on* if needed.`
                            : `   Auto-react is watching this group.\n   Arm it with *.autoreact on* if needed.`)
                    ));
                    break;
                }
                log('POLL-MENU', `${phoneNumber}: unhandled vote id ${votedOptionId}`);
                break;
        }
    } catch (err) {
        logError('POLL-MENU', `${phoneNumber}: failed handling menu vote ${votedOptionId}`, err);
    }
}

async function handleWhatsAppMessage(sock, msg, phoneNumber, tgId, eventType) {
    const incoming = await messagePipeline.preprocessIncomingMessage({
        sock,
        message: msg,
        phoneNumber,
        eventType
    });
    if (!incoming) return;

    const {
        remoteJid,
        messageId: msgId,
        participant,
        fromMe,
        pushName,
        recent
    } = incoming;

    // Temporary one-shot test probes must remain ahead of reactions and all
    // normal command side effects. Flood variants below share this parse.
    const parsed = extractMessageText(msg);
    const cisWords = String(parsed.text || '').trim().split(/\s+/);
    const cisFirstWord = (cisWords[0] || '').toLowerCase();
    const cisPrefix = String(loadBotConfig(phoneNumber)?.prefix || '.').toLowerCase();
    const earlyProbeContext = {
        sock,
        message: msg,
        phoneNumber,
        remoteJid,
        fromMe,
        words: cisWords,
        firstWord: cisFirstWord,
        prefix: cisPrefix
    };
    if (await oneShotProbeService.handle(earlyProbeContext)) return;
    if (await floodProbeService.handle(earlyProbeContext)) return;

    const continueToDispatch = await messageMiddleware.runMessageMiddleware({
        sock,
        message: msg,
        phoneNumber,
        eventType,
        remoteJid,
        messageId: msgId,
        participant,
        fromMe,
        parsed
    });
    if (!continueToDispatch) return;

    const botConfig = loadBotConfig(phoneNumber);
    const {
        text,
        normalized,
        args,
        prefix,
        token,
        startsWithDot
    } = parseCommandInput(parsed.text, botConfig);

    const accessContext = await messageAccessService.runPreCommandAccess({
        sock,
        message: msg,
        phoneNumber,
        remoteJid,
        messageId: msgId,
        fromMe,
        text,
        normalized,
        prefix,
        token,
        startsWithDot,
        botConfig
    });
    if (!accessContext) return;

    const { currentMode, senderJid, isSenderOwner } = accessContext;

    const conversationHandled = await messageConversationService.handleConversation({
        sock,
        message: msg,
        phoneNumber,
        eventType,
        remoteJid,
        messageId: msgId,
        fromMe,
        text,
        normalized,
        token
    });
    if (conversationHandled) return;

    const configInputHandled = await messageConfigInputService.handleConfigInput({
        sock,
        message: msg,
        phoneNumber,
        remoteJid,
        text,
        startsWithDot
    });
    if (configInputHandled) return;

    const sensitiveCmd = token === '.pluginkey' || token === '.plugin';
    const logRaw = sensitiveCmd ? `.pluginkey ${maskApiKey(args[0] || '')}`.trim() : trimForLog(text, 250);
    log(
        'WA-CMD',
        `${phoneNumber}: command flow | raw=${JSON.stringify(logRaw)} normalized=${JSON.stringify(sensitiveCmd ? logRaw : trimForLog(normalized, 250))} token=${JSON.stringify(token)}`
    );

    // (Instant ⚡ reaction now fires at the upsert level, before this flow.)
    // Wake the bot online for this command, then back offline shortly after.
    flashPresenceOnline(sock, phoneNumber);

    // ⚙️ Alias resolution: if the token isn't a native command but matches a
    // configured alias, swap it for the target command so the normal handlers run.
    if (botConfig.aliases && token.startsWith('.')) {
        const aliasKey = token.slice(1).toLowerCase();
        if (botConfig.aliases[aliasKey]) {
            token = botConfig.aliases[aliasKey];
            log('ALIAS', `${phoneNumber}: alias "${aliasKey}" -> ${token}`);
        }
    }

    // ──────────────────────────────────────────────
    // ⚙️ CONFIG COMMANDS (change the bot / host account)
    // ──────────────────────────────────────────────

    // ──────────────────────────────────────────────
    // 🔒 PRIVACY ACCESS LOCK (.mode public / owner)
    // ──────────────────────────────────────────────

    // ──────────────────────────────────────────────
    // 👥 GROUP COMMANDS
    // ──────────────────────────────────────────────

    // ──────────────────────────────────────────────
    // 🖥️ SYSTEM COMMANDS
    // ──────────────────────────────────────────────
    if (await commandRegistry.execute(token, {
        sock,
        remoteJid,
        message: msg,
        phoneNumber,
        senderJid,
        isSenderOwner,
        args,
        prefix,
        pushName,
        botConfig
    })) return;


    // ──────────────────────────────────────────────
    // 🛠️ SYSTEM UTILITIES & OWNER TOOLS
    // ──────────────────────────────────────────────

    if (isGameCommand(token)) {
        const handled = await handleGameCommand({ sock, phoneNumber, remoteJid, senderJid, token, args });
        if (handled) return;
    }

    const replyText = resolveCommandReply(token, phoneNumber);
    if (!replyText) {
        log('WA-CMD', `${phoneNumber}: no reply mapped for command ${token}. Ignoring.`);
        return;
    }

    log('WA-CMD', `${phoneNumber}: matched command ${token}. Sending simulated typing reply...`);
    const sent = await safeWaReply(sock, remoteJid, replyText, msg);
    if (sent) {
        log('WA-CMD', `${phoneNumber}: reply sent successfully for ${token} to ${remoteJid}`);
    } else {
        log('WA-CMD', `${phoneNumber}: failed to send reply for ${token} to ${remoteJid}`);
    }
}

const messageEventService = createMessageEventService({
    verboseLogs: VERBOSE_LOGS,
    lastPollVotes,
    loadBotConfig,
    loadBotMode,
    handlePollUpdateMessage,
    handleMenuVote,
    handleWhatsAppMessage,
    extractRevokeRef,
    handleAntideleteRevoke,
    handlePollVote,
    normalizeJid: jidNormalizedUser,
    log,
    logError
});

function setupMessageHandler(sock, phoneNumber, tgId) {
    return messageEventService.setupMessageHandler(sock, phoneNumber, tgId);
}

const pairingService = createPairingService({
    authDirRoot: AUTH_DIR,
    maxUsers: MAX_USERS,
    telegramUsers,
    webPairSessions,
    countStoredSessions,
    getStoredSessionDirectories,
    normalizeAuthDirStructure,
    findTelegramChatIdByPhone,
    setTelegramUserState,
    clearTelegramUser,
    saveUserMap,
    ensureDir,
    safeTgSend,
    createSocketForSession,
    isSupabaseEnabled,
    getAllSessionPhoneNumbers,
    downloadSessionFromSupabase,
    loadAuthState: useMultiFileAuthState,
    log,
    logError
});

const {
    initiatePairing,
    initiateWebPairing,
    restoreAllSessions
} = pairingService;

// ──────────────────────────────────────────────
// 📱 TELEGRAM COMMANDS (only registered when Telegram is enabled)
// ──────────────────────────────────────────────
const telegramCommandService = createTelegramCommandService({
    authDirRoot: AUTH_DIR,
    maxUsers: MAX_USERS,
    telegramUsers,
    waSessions,
    safeTgSend,
    setTelegramUserState,
    saveUserMap,
    clearTelegramUser,
    initiatePairing,
    requireAdminOrExplain,
    countStoredSessions,
    formatUptime,
    isSupabaseEnabled,
    deleteSessionFromSupabase,
    loadBugSends,
    saveBugSends,
    safeRm,
    delay,
    trimForLog,
    log,
    logError
});
telegramCommandService.register(tgBot);
// ──────────────────────────────────────────────
// 🌐 EXPRESS
// ──────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        activeSockets: waSessions.size,
        storedSessions: countStoredSessions(),
        loadedTelegramUsers: telegramUsers.size,
        maxUsers: MAX_USERS,
        uptime: process.uptime(),
        supabaseSync: isSupabaseEnabled() ? 'enabled' : 'disabled'
    });
});

app.get('/health', (req, res) => {
    let commit = '';
    try {
        const f = path.join(__dirname, 'CURRENT_COMMIT.txt');
        if (fs.existsSync(f)) commit = fs.readFileSync(f, 'utf8').trim();
    } catch (_) {}
    res.json({
        status: 'ok',
        commit,
        uptime: process.uptime(),
        memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
        activeSockets: waSessions.size,
        storedSessions: countStoredSessions(),
        supabaseSync: isSupabaseEnabled() ? 'enabled' : 'disabled'
    });
});

app.get('/ping', (req, res) => {
    res.send('pong');
});

initWebApp(app, {
    express,
    waSessions,
    webPairSessions,
    initiateWebPairing,
    AUTH_DIR,
    MAX_USERS,
    countStoredSessions,
    safeRm,
    isSupabaseEnabled,
    deleteSessionFromSupabase,
    tgBot,
    log,
    logError,
    formatUptime
});

// ──────────────────────────────────────────────
// 🚀 MAIN

// ──────────────────────────────────────────────
// 🚀 MAIN
// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// 🛰 GIT SYNC (.gitpull) — dev-only WhatsApp command that pulls the latest
// commit from GitHub and restarts the bot. No polling, no auto-deploy.
// ──────────────────────────────────────────────
let gitSyncBusy = false;       // .gitpull in-flight guard
let shuttingDown = false;      // set by the SIGTERM/SIGINT fast-shutdown handler
// 🌐 WEB TUNNEL (opt-in: WEB_TUNNEL=cloudflare on the panel) — free Cloudflare
// quick tunnel: gives the dashboard a clean public https://…trycloudflare.com
// address — no :port, IP hidden, HTTPS included, no account needed. The URL
// rotates on every start, so each new URL is logged AND DM'd to the owner on
// WhatsApp (same path as the deploy DMs).
let tunnelChild = null;
let tunnelUrl = null;
let tunnelStopped = false;
function dmOwnersWa(text) {
    for (const sess of waSessions.values()) {
        try {
            const myJid = sess?.sock?.authState?.creds?.me?.id;
            if (!myJid) continue;
            const selfJid = `${myJid.split(':')[0]}@s.whatsapp.net`;
            sess.sock.sendMessage(selfJid, { text }).catch(() => {});
        } catch (_) {}
    }
}
async function startWebTunnel(port) {
    const mode = String(process.env.WEB_TUNNEL || '').trim().toLowerCase();
    if (!['cloudflare', 'true', '1', 'yes'].includes(mode)) return;
    const binPath = path.join(__dirname, 'bin', 'cloudflared');
    try {
        if (!fs.existsSync(binPath)) {
            const archFile = process.arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64';
            log('TUNNEL', `downloading ${archFile} (one-time)…`);
            const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${archFile}`);
            if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            fs.mkdirSync(path.dirname(binPath), { recursive: true });
            fs.writeFileSync(binPath, buf);
            fs.chmodSync(binPath, 0o755);
            log('TUNNEL', `cloudflared saved (${Math.round(buf.length / 1048576)}MB)`);
        }
        const tunnelToken = String(process.env.CLOUDFLARE_TUNNEL_TOKEN || '').trim();
        if (tunnelToken) {
            // NAMED tunnel — permanent address (your domain mapped in the
            // Cloudflare dashboard). No URL rotation, no DM needed.
            log('TUNNEL', 'named tunnel starting (permanent URL from your Cloudflare dashboard)');
            tunnelChild = spawn(binPath, ['tunnel', '--no-autoupdate', 'run', '--token', tunnelToken], { stdio: ['ignore', 'pipe', 'pipe'] });
            tunnelChild.stderr.on('data', d => {
                if (/Registered tunnel connection/i.test(String(d))) log('TUNNEL', '✅ named tunnel connected — permanent URL is live');
            });
        } else {
            tunnelChild = spawn(binPath, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
        }
        const huntUrl = chunk => {
            const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
            if (m && tunnelUrl !== m[0]) {
                tunnelUrl = m[0];
                log('TUNNEL', `🌐 dashboard live at ${tunnelUrl}`);
                dmOwnersWa(`🌐 *WEB TUNNEL UP*\n\n${tunnelUrl}\n\nPair/dashboard address — no port, HTTPS, IP hidden.\nRotates on restart; every new URL gets DM'd here.`);
            }
        };
        tunnelChild.stdout.on('data', huntUrl);
        tunnelChild.stderr.on('data', huntUrl);
        tunnelChild.on('exit', code => {
            tunnelChild = null; tunnelUrl = null;
            if (tunnelStopped) return;
            log('TUNNEL', `cloudflared exited (code ${code}) — restarting in 15s`);
            setTimeout(() => startWebTunnel(port).catch(() => {}), 15000);
        });
    } catch (err) {
        logError('TUNNEL', 'web tunnel could not start (binary download/exec failed?)', err);
    }
}

let httpServer = null;         // express server (closed on shutdown)

// Commit subjects can be long — keep the WhatsApp card short.
function truncateCommitName(name, max = 38) {
    const s = String(name || 'unknown commit').trim() || 'unknown commit';
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Git helpers used by .gitpull. If the folder has no .git (files copied
// without history), we init + attach origin + fetch — i.e. clone in place.
function gitShQ(cmd, timeoutMs = 60000) {
    return execSync(cmd, {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: timeoutMs, // a sync op can never block the event loop forever —
                            // the shutdown handler must always be able to run
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
}

function gitEnsureRepo() {
    if (!fs.existsSync(path.join(__dirname, '.git'))) {
        log('GIT', 'no .git folder — initializing fresh repo (clone in place).');
        gitShQ('git init');
    }
    try { gitShQ('git config --global --add safe.directory ' + JSON.stringify(__dirname)); } catch (_) {}
    const remoteUrl = String(process.env.GIT_REMOTE_URL || 'https://github.com/Phantom-Dev-X/eventide-omega-bug-test.git').trim();
    try {
        gitShQ(`git remote add origin ${remoteUrl}`);
    } catch (_) {
        try { gitShQ(`git remote set-url origin ${remoteUrl}`); } catch (_) {}
    }
}

function gitRemoteName() {
    try { return gitShQ('git log -1 --pretty=%s origin/main').trim() || 'unknown commit'; }
    catch (_) { return 'unknown commit'; }
}

// Light check: fetch + compare. Returns { changed, name } — no checkout.
async function gitCheck() {
    gitEnsureRepo();
    gitShQ('git fetch --depth 1 origin main');
    const local = gitShQ('git rev-parse HEAD').trim();
    const remote = gitShQ('git rev-parse origin/main').trim();
    return { changed: local !== remote, name: gitRemoteName() };
}

// Full pull: fetch + force-checkout + npm install if package.json changed.
// Returns { changed, commit, name }.
async function pullLatestCode() {
    gitEnsureRepo();
    gitShQ('git fetch --depth 1 origin main');
    const local = gitShQ('git rev-parse HEAD').trim();
    const remote = gitShQ('git rev-parse origin/main').trim();
    if (local === remote) return { changed: false, commit: local, name: gitRemoteName() };
    let pkgBefore = '';
    try { pkgBefore = gitShQ('git rev-parse HEAD:package.json').trim(); } catch (_) {}
    gitShQ('git checkout -f -B main origin/main');
    let commit = remote;
    try { commit = gitShQ('git rev-parse HEAD').trim(); } catch (_) {}
    const name = gitRemoteName();
    try { fs.writeFileSync(path.join(__dirname, 'CURRENT_COMMIT.txt'), `${commit} ${name}\n`, 'utf8'); } catch (_) {}
    let pkgAfter = '';
    try { pkgAfter = gitShQ('git rev-parse HEAD:package.json').trim(); } catch (_) {}
    if (pkgBefore && pkgAfter && pkgBefore !== pkgAfter) {
        log('GIT', 'package.json changed — installing dependencies...');
        try { gitShQ('npm install --omit=dev --no-audit --no-fund', 180000); } catch (err) {
            logError('GIT', 'npm install failed', err);
        }
    }
    return { changed: true, commit, name };
}

function relaunchSelf() {
    const entry = path.join(__dirname, 'index.js');
    // New process waits a few seconds before binding the port, giving this
    // process time to exit and free it (no EADDRINUSE on the panel).
    const childProc = spawn(process.execPath, [entry], {
        cwd: __dirname,
        detached: true,
        stdio: 'inherit',
        env: { ...process.env, EVENTIDE_BIND_DELAY_MS: '3500' }
    });
    childProc.unref();
    log('GIT', 'new bot process spawned — old process exiting in 1.5s...');
    setTimeout(() => process.exit(0), 1500);
}

async function main() {
    const buildStartedAt = Date.now();
    initGames({
        sendMenuPoll,
        buildOmegaTerminal,
        delay,
        jidNormalizedUser,
        log,
        logError,
        getQuotedContext
    });
    ensureDir(AUTH_DIR);
    normalizeAuthDirStructure();
    await loadUserMap({ clearExisting: true });
    startLocalBackups({ log, logError });

    log('BOOT', '🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷');
    log('BOOT', '🤖 WHATSAPP MULTI-BOT');
    log('BOOT', '📦 Baileys v7.0.0-rc13');
    log('BOOT', '📱 Telegram Pairing + Supabase Database Sync');
    log('BOOT', '🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷🔷');

    if (DEV_IDS.length === 0) {
        log('BOOT', '⚠️ DEV_TELEGRAM_IDS is empty. Admin commands are open to any Telegram private chat user.');
    } else {
        log('BOOT', `🔒 Dev Telegram IDs: ${DEV_IDS.join(', ')}`);
    }

    if (isSupabaseEnabled()) {
        log('BOOT', '☁️ Supabase Cloud Sync integration is ENABLED.');
    } else {
        log('BOOT', '⚠️ Supabase integration is DISABLED. Local storage will act as primary.');
    }
    try {
        const commitFile = path.join(__dirname, 'CURRENT_COMMIT.txt');
        const commitLine = fs.existsSync(commitFile)
            ? fs.readFileSync(commitFile, 'utf8').trim()
            : '';
        if (commitLine) {
            log('BUILD', `📦 running commit: ${commitLine}`);
        } else {
            log('BUILD', '📦 running commit: unknown (CURRENT_COMMIT.txt missing)');
        }
        // ⚠️ REACT-V3 BUILD MARKER: this line only exists in builds that have
        // the working ⚡ reaction. If you do NOT see it, you are running OLD code.
        log('BOOT', `⚡ REACT-V4 BUILD ACTIVE — in-handler reactions armed (commit ${commitLine.split(' ')[0] || '?'})`);
    } catch (_) {}

    let restoredCount = 0;
    if (!BOT_RUNTIME_ALLOWED) {
        if (IS_BLOCKED_RENDER_SERVICE) {
            log('BOOT', `🛑 SERVICE KILL SWITCH ACTIVE — ${CURRENT_RENDER_SERVICE_ID} is blocked.`);
            log('BOOT', '🛑 WhatsApp session restore and Telegram polling are permanently disabled here.');
        } else {
            log('BOOT', '🛑 RENDER-ONLY BUILD — non-Render host detected. WhatsApp session restore is disabled.');
            log('BOOT', '🛑 This panel will stay passive and cannot cause Baileys 440 connection conflicts.');
        }
    } else {
        restoredCount = await restoreAllSessions();
        log('BOOT', `🔁 Session reconnection startup pass finished. Sessions queued: ${restoredCount}`);
    }

    // 🔁 SELF-RESTART HANDOFF: the auto-deploy relaunch passes this delay so
    // the old process can exit and free the port before this one binds.
    const bindDelayMs = parseInt(process.env.EVENTIDE_BIND_DELAY_MS || '0', 10) || 0;
    if (bindDelayMs > 0) {
        log('DEPLOY', `handoff: waiting ${bindDelayMs}ms before binding port...`);
        await delay(bindDelayMs);
    }

    httpServer = app.listen(PORT, '0.0.0.0', () => {
        log('HTTP', `Server listening on port ${PORT}`);
        startWebTunnel(PORT).catch(() => {});
        log('HTTP', `GET / -> status summary`);
        log('HTTP', `GET /health -> health info`);
        log('HTTP', `GET /ping -> pong`);
        log('BOT', `Telegram bot polling is active.`);
        log('BOT', `Max users: ${MAX_USERS}`);
        log('BUILD', `✅ BUILD DONE in ${((Date.now() - buildStartedAt) / 1000).toFixed(1)}s — HTTP is up.`);
        if (!BOT_RUNTIME_ALLOWED) {
            const reason = IS_BLOCKED_RENDER_SERVICE
                ? `blocked Render service ${CURRENT_RENDER_SERVICE_ID}`
                : 'passive non-Render host';
            log('BUILD', `🛑 ${reason} — WhatsApp and Telegram connections are disabled.`);
        } else {
            log('BUILD', `⏳ sockets connecting... when you see "SESSION READY" for your number, .ping will respond.`);
        }
    });

}

process.on('unhandledRejection', err => logError('PROCESS', 'Unhandled promise rejection', err));
process.on('uncaughtException', err => logError('PROCESS', 'Uncaught exception', err));

// ⚡ FAST GRACEFUL SHUTDOWN — Pterodactyl sends SIGTERM when Stop is pressed.
// What used to go wrong: background loops (auto-deploy poller with blocking
// git/npm execSync, Telegram polling, WhatsApp sockets, keepalive fetches)
// kept the event loop busy, the process lingered, the panel timed out and
// force-killed the container → "Server marked as offline..." + power action
// lock errors. Now:
//   1) signal caught → all background work stopped instantly (poll timer cleared)
//   2) best-effort cleanup of active connections (Telegram polling, WA sockets,
//      HTTP server) — fire-and-forget so it can never block the exit
//   3) explicit process.exit(0) IMMEDIATELY — the panel registers the stop
//      right away and no lock errors occur
function shutdownBot(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('PROCESS', `${signal} received — fast shutdown (exit code 0).`);


    // best-effort connection teardown — never awaited, never allowed to block
    try { if (tgBot) tgBot.stopPolling().catch(() => {}); } catch (_) {}
    for (const sess of waSessions.values()) {
        try { sess?.sock?.end?.(new Error('shutdown')); } catch (_) {}
    }
    try { if (httpServer) httpServer.close(); } catch (_) {}
    try { tunnelStopped = true; if (tunnelChild) tunnelChild.kill('SIGKILL'); } catch (_) {}

    // explicit, immediate termination with exit code 0
    process.exit(0);
}
process.on('SIGTERM', () => shutdownBot('SIGTERM'));
process.on('SIGINT', () => shutdownBot('SIGINT'));

main().catch(err => {
    logError('BOOT', 'Fatal startup error', err);
    process.exit(1);
});

const renderUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(async () => {
    try {
        await fetch(`${renderUrl}/ping`);
    } catch (err) {
        logError('KEEPALIVE', `Failed keep-alive ping to ${renderUrl}/ping`, err);
    }
}, KEEP_ALIVE_INTERVAL);

