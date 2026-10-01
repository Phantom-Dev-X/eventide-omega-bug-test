/**
 * Process-local runtime state.
 *
 * Persistent state still belongs in the session/config stores. These Maps are
 * intentionally centralized so feature modules no longer create hidden globals.
 */
export const telegramUsers = new Map();
export const waSessions = new Map();
export const reconnectAttempts = new Map();
export const connClosed428s = new Map();
export const sentPolls = new Map();
export const lastPollVotes = new Map();
export const menuReplyMessages = new Map();
export const helpModeUsers = new Map();
export const presenceControllers = new Map();
export const autoreactSessions = new Map();
export const personaPollKeys = new Map();
export const helpPersonaPollKeys = new Map();
export const webPairSessions = new Map();
export const mutedUsers = new Map();
export const recentMessages = new Map();
export const antiConfigSessions = new Map();
export const welcomeGoodbyeSessions = new Map();
export const warnConfigSessions = new Map();
export const msgLogCache = new Map();
export const msgLogSaveTimers = new Map();
export const tttGames = new Map();
export const tttSetupSessions = new Map();

export const runtimeState = Object.freeze({
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
});
