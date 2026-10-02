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
    generateMessageID,
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
import { createInteractiveGamesCommands } from './src/commands/game/interactive-games.js';
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
import { createMenuAssets } from './src/personas/menu-assets.js';
import { createSessionConfigStore } from './src/config/session-config-store.js';
import { createMessageLogStore } from './src/services/message-log-store.js';
import { createHelpVoice } from './src/ai/help-voice.js';
import { createBaileysHelpers } from './src/whatsapp/baileys-helpers.js';
import { createPresenceService } from './src/whatsapp/presence-service.js';
import { createGroupMediaService } from './src/whatsapp/group-media-service.js';
import { createPollMenuService } from './src/whatsapp/poll-menu-service.js';
import { createMenuVoteService } from './src/whatsapp/menu-vote-service.js';
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
import { createDevHelpers } from './src/core/dev-helpers.js';
import { createGitUpdateService } from './src/services/git-update-service.js';
import { createWebTunnelService } from './src/services/web-tunnel-service.js';

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

const devHelpers = createDevHelpers({ devIds: DEV_IDS });
const { isDev, isDevNumber, countSystemCommands } = devHelpers;

const gitUpdateService = createGitUpdateService({ rootDir: __dirname, log, logError });
const {
    truncateCommitName,
    gitShQ,
    gitEnsureRepo,
    gitRemoteName,
    gitCheck,
    pullLatestCode,
    relaunchSelf
} = gitUpdateService;

const menuAssets = createMenuAssets({ groupChannelLink: GROUP_CHANNEL_LINK });
const {
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
} = menuAssets;

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

// ──────────────────────────────────────────────
// 📋 WHATSAPP COMMANDS
// ──────────────────────────────────────────────
const COMMANDS = {
    // Add your normal text commands here!
};

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

const sessionConfigStore = createSessionConfigStore({
    logError,
    authDir: AUTH_DIR,
    ensureDir,
    isSupabaseEnabled,
    debouncedSyncLocalToSupabase
});
const {
    loadPollCache,
    savePollCache,
    loadBotMode,
    saveBotMode,
    normalizeAntideleteConfig,
    normalizeWarnConfig,
    loadBotConfig,
    saveBotConfig
} = sessionConfigStore;

const messageLogStore = createMessageLogStore({
    msgLogCache,
    msgLogSaveTimers,
    logError,
    authDir: AUTH_DIR,
    ensureDir,
    extractMessageText
});
const {
    slimProto,
    loadMsgLog,
    flushMsgLog,
    scheduleMsgLogSave,
    logMessage,
    escapeRegExp,
    textHasPhrase,
    findMatchingPhrase,
    findHidetagTrigger
} = messageLogStore;

const helpVoice = createHelpVoice({ loadBotConfig });
const {
    formatForWhatsApp,
    HELP_FACT_SHEET,
    getHelpSystemPrompt,
    getRuinHelpSystemPrompt,
    getBoundHelpPrompt,
    getStaticHelpAnswer
} = helpVoice;

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

// ──────────────────────────────────────────────
// 🔧 BAILEYS HELPERS
// ──────────────────────────────────────────────
const accessService = createAccessService({
    loadBotConfig,
    // legacy hangman/chain/trivia/riddle polls removed with games.js; ttt
    // polls are gated by their own ttt_ prefix check inside the service.
    isGamePoll: () => false
});
const { normalizeDigits, isSudo, canVoteOnPoll } = accessService;

const baileysHelpers = createBaileysHelpers({
    log,
    logError,
    authDir: AUTH_DIR,
    sentPolls,
    recentMessages,
    getStoredSessionDirectories,
    loadMsgLog,
    loadPollCache,
    asNumber,
    fetchLatestBaileysVersion,
    commands: COMMANDS,
    recentAppendWindowSeconds: RECENT_APPEND_WINDOW_SECONDS
});
const {
    getDisconnectCode,
    getMessageFromStore,
    isRecentMessage,
    isIgnoredRemoteJid,
    getBaileysVersion,
    resolveCommandReply,
    resetBaileysVersionCache
} = baileysHelpers;

const presenceService = createPresenceService({
    log,
    logError,
    presenceControllers,
    delay,
    formatForWhatsApp,
    groupChannelLink: GROUP_CHANNEL_LINK,
    attachChannelPreview
});
const {
    applyPresence,
    getPresenceController,
    scheduleNextPresenceCycle,
    startPresenceCycle,
    flashPresenceOnline,
    safeWaReply
} = presenceService;

const groupMediaService = createGroupMediaService({
    jidNormalizedUser,
    getQuotedContext,
    downloadMediaMessage,
    pino,
    getMessageFromStore
});
const { isParticipantAdmin, isUserGroupAdmin, downloadQuotedMedia } = groupMediaService;

const pollMenuService = createPollMenuService({
    log,
    logError,
    jidNormalizedUser,
    decryptPollVote,
    loadPollCache,
    savePollCache,
    trimForLog,
    proto,
    generateWAMessageFromContent,
    formatForWhatsApp,
    flashPresenceOnline,
    canVoteOnPoll,
    lastPollVotes,
    menuReplyMessages
});
const {
    decryptVoteOption,
    handlePollVote,
    handlePollUpdateMessage,
    sendMenuPoll,
    sendMenuBanner,
    recordMenuMessage,
    deleteMenuMessages,
    buildBugMenuText
} = pollMenuService;

/**
 * Sends a reply with simulated typing ("composing" state) and organic delay.
 * Helps protect against WhatsApp anti-spam automated bot scanners.
 */
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
    resetBaileysVersionCache,
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
    handleGameText: async () => false, // legacy poll games removed with games.js
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

const interactiveGamesCommands = createInteractiveGamesCommands({
    generateWAMessageFromContent,
    generateMessageID,
    jidNormalizedUser,
    buildOmegaTerminal,
    log,
    logError
});

const menuVoteService = createMenuVoteService({
    log,
    logError,
    delay,
    safeWaReply,
    loadBotConfig,
    loadBotMode,
    saveBotConfig,
    sendMenuPoll,
    sendMenuBanner,
    recordMenuMessage,
    deleteMenuMessages,
    buildBugMenuText,
    sendEclipseMenu,
    sendRuinMenu,
    buildRuinCommandIndexBox,
    buildRuinSystemMenu,
    buildRuinConfigMenu,
    buildRuinGroupMenu,
    buildRuinFunMenu,
    buildOmegaTerminal,
    handleGameVote: async () => false, // legacy poll games removed with games.js
    getTttGame,
    tttSamePlayer,
    tttResolveLabel,
    tttCollectIds,
    tttKey,
    tttClearTimer,
    tttDeletePoll,
    tttDeleteVotedPoll,
    tttPaint,
    tttArmTimer,
    tttArmDeadGame,
    tttStart,
    tttTryMove,
    tttOpenLobby,
    getWarnState,
    saveWarnState,
    ensureWarnGroup,
    loadWarnLog,
    saveWarnLog,
    getAntideleteState,
    applyWardEndpoint,
    listAntideleteEndpoints,
    offerGroupPickPoll,
    antiConfigSessions,
    autoreactSessions,
    warnConfigSessions,
    welcomeGoodbyeSessions,
    tttSetupSessions,
    tttGames,
    personaPollKeys,
    helpPersonaPollKeys,
    OWNERS_MENU_PATH,
    OWNERS_WELCOME_TEXT,
    GROUP_MENU_PATH,
    GROUP_MENU_TEXT,
    FUN_MENU_PATH,
    FUN_PLACEHOLDER_TEXT,
    SYSTEM_MENU_PATH,
    SYSTEM_MENU_TEXT,
    CONFIG_MENU_PATH,
    CONFIG_MENU_TEXT,
    DOMAIN_POLL_QUESTION,
    DOMAIN_POLL_OPTIONS,
    DOMAIN_POLL_IDS
});
const { handleMenuVote } = menuVoteService;

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
    ...interactiveGamesCommands,
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
        botConfig,
        loadBotMode
    })) return;


    // ──────────────────────────────────────────────
    // 🛠️ SYSTEM UTILITIES & OWNER TOOLS
    // ──────────────────────────────────────────────

    const replyText = resolveCommandReply(token, phoneNumber);
    if (!replyText) {
        // Give useful feedback instead of silently ignoring typos. Compare only
        // against registered primary commands and suggest a close match when
        // the edit distance is small enough to be genuinely helpful.
        const typed = String(token || '').replace(/^\./, '').toLowerCase();
        const distance = (a, b) => {
            const row = Array.from({ length: b.length + 1 }, (_, i) => i);
            for (let i = 1; i <= a.length; i++) {
                let previous = row[0];
                row[0] = i;
                for (let j = 1; j <= b.length; j++) {
                    const saved = row[j];
                    row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
                    previous = saved;
                }
            }
            return row[b.length];
        };
        const candidates = commandRegistry.list().map(cmd => cmd.replace(/^\./, ''));
        const closest = candidates
            .map(cmd => ({ cmd, score: distance(typed, cmd) }))
            .sort((a, b) => a.score - b.score || a.cmd.localeCompare(b.cmd))[0];
        const limit = typed.length <= 4 ? 1 : Math.max(2, Math.floor(typed.length / 3));
        const suggestion = closest && closest.score <= limit
            ? `\n\nDid you mean *${prefix}${closest.cmd}*?`
            : `\n\nType *${prefix}menu* to view available commands.`;
        await safeWaReply(sock, remoteJid,
            `❌ *COMMAND NOT REGISTERED*\n\nThe command *${token}* is not recognized.${suggestion}`,
            msg
        );
        log('WA-CMD', `${phoneNumber}: unknown command ${token}${closest ? `; closest=${closest.cmd}` : ''}.`);
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
const webTunnelService = createWebTunnelService({ rootDir: __dirname, log, logError, waSessions });
const { startWebTunnel, stopWebTunnel } = webTunnelService;

let httpServer = null;         // express server (closed on shutdown)

// Commit subjects can be long — keep the WhatsApp card short.
async function main() {
    const buildStartedAt = Date.now();
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
    try { stopWebTunnel(); } catch (_) {}

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

