# Eventide Omega architecture

The repository is being migrated from a single large runtime file into small,
testable modules. Behaviour must remain unchanged during extraction.

## Extracted modules

- `src/config/env.js` — environment parsing and runtime paths
- `src/config/defaults.js` — default per-session bot configuration
- `src/core/logger.js` — stable structured console logging
- `src/core/state.js` — process-local Maps shared by runtime features
- `src/core/context.js` — dependency container for future feature modules
- `src/whatsapp/pairing.js` — Telegram/web pairing and startup restoration coordinator
- `src/whatsapp/socket.js` — socket construction, send tracing, credential persistence, and bulk shutdown
- `src/whatsapp/reconnection.js` — disconnect cleanup, bounded retries, and non-destructive 428 recovery
- `src/whatsapp/connection-events.js` — pairing, open/ready, notification, and close-event routing
- `src/whatsapp/message-events.js` — message, poll, antidelete, history, and group-participant event routing
- `src/whatsapp/message-pipeline.js` — transport preflight, echo filtering, revoke routing, and command-token parsing
- `src/whatsapp/message-middleware.js` — caching, moderation, command acknowledgement, and endpoint auto-reactions
- `src/whatsapp/message-access.js` — persona, privacy-mode, warning, game, and hidetag gates
- `src/whatsapp/message-conversation.js` — ward target input and stateful AI help-mode conversations
- `src/whatsapp/message-config-input.js` — autoreact, antidelete, warning, and welcome configuration text input
- `src/commands/registry.js` — command registration, alias lookup, and dispatch
- `src/commands/system/basic.js` — low-risk runtime and host information commands
- `src/commands/system/session.js` — health, deployment, and session visibility commands
- `src/commands/system/account.js` — developer contact, group listing, and account profile commands
- `src/commands/system/account-tools.js` — profile-picture retrieval, view-once recovery, and privileged contact controls
- `src/commands/system/owner-operations.js` — privileged backup, process control, reconnect, and logout operations with injected side-effect boundaries
- `src/commands/system/utilities.js` — sticker/image conversion, QR generation, calculator, and Base64 utilities
- `src/commands/system/configuration.js` — greeting, autoreact, and interactive-flow cancellation entry points
- `src/commands/system/access-mode.js` — public and owner-only access mode transitions
- `src/commands/system/customization.js` — command prefix, aliases, display name, and account bio customization
- `src/commands/system/config-management.js` — profile-picture updates, settings inspection, and factory reset
- `src/commands/system/plugin-key.js` — isolated Gemini key-pool status, append, replace, and removal operations
- `src/commands/system/deployment.js` — guarded Git update checks, deployment, and supervised/unsupervised restart handoff
- `src/commands/system/persona.js` — persona-aware menus and bot/help voice selection flows
- `src/commands/system/sudo.js` — persistent elevated-user listing, grant, and revocation commands
- `src/commands/system/config-delete.js` — context-sensitive warning, antidelete, and autoreact list deletion
- `src/commands/system/help.js` — antibug menu and persona-aware AI help oracle with timed help mode
- `src/commands/fun/ai.js` — scored AI roast, pickup, joke, compliment, flirt, rate, and ship commands
- `src/commands/game/tic-tac-toe.js` — challenge, board, move, bot-mode, and setup-poll routing for the premium arena
- `src/commands/testing/one-shot-probes.js` — early, owner-gated routing for temporary single-send iOS test probes
- `src/commands/testing/flood-probes.js` — early, owner-gated routing for temporary flood/app-level test probes (`.crash-iosd`, `.frz-iosd`, `.andro-nuke`, `.ios-zk`, `.gb`, `.gb-hard`)
- `src/commands/testing/sandbox-payloads.js` — registry-dispatched `.crash-hard`/`.frz-oom` sandbox payload commands (no early-interception requirement, unlike the probes above)
- `src/commands/group/membership.js` — group joining, member changes, invite links, and administrator rank changes
- `src/commands/group/information.js` — group details, visible and hidden broadcasts, and contact-card exports
- `src/commands/group/moderation.js` — per-member muting and whole-group lock/unlock controls
- `src/commands/group/protections.js` — anti-link/mention/forward toggles and antidelete configuration
- `src/commands/group/warnings.js` — warning mutations, ledgers, authorization, and warning-menu initialization
- `src/services/session-store.js` — session-directory normalization and Telegram user-map persistence
- `src/telegram/commands.js` — Telegram bot command surface: /start, /pair, pairing-number text intake, /status, /unbug, /disconnect, and /help
- `src/personas/ruin-interface.js` — Ruin persona status panel, command-index, and category-menu rendering plus the `.menu` status-panel/poll send (the shared poll-vote dispatcher that routes votes to these builders stays in index.js)
- `src/personas/eclipse-interface.js` — Eclipse persona cinematic 3-stage loading animation, banner image send, and Owners/Group/Fun/Bug poll send (`sendEclipseMenu`); accepts `groupChannelLink` and a precomputed `menuBannerPath` as injected dependencies rather than recomputing shared/`__dirname`-based constants itself. The shared `GROUP_CHANNEL_LINK`/`attachChannelPreview`/`channelContextInfo`/`CHANNEL_PREVIEW_*` constants and the `OWNERS_MENU_PATH`/`GROUP_MENU_PATH`/`FUN_MENU_PATH`/`SYSTEM_MENU_PATH`/`CONFIG_MENU_PATH` sibling paths stay in index.js (used elsewhere by `safeWaReply` and `handleMenuVote`). The poll-vote dispatcher (`handleMenuVote`) stays in index.js.
- `src/games/tic-tac-toe-engine.js` — tic-tac-toe board/session engine: game-state keying (`tttKey`/`tttGames`), player identity resolution across JID/LID/phone-number forms, the minimax bot AI (`tttMinimax`/`tttBotMove`), board rendering (`renderTttBoard`), per-game turn/idle timers, and the full challenge/open-lobby/move/bot-turn lifecycle (`tttStart`, `tttOfferChallenge`, `tttOpenLobby`, `tttTryMove`, `tttPlayBot`). Command routing and setup-poll orchestration stay in `src/commands/game/tic-tac-toe.js`; the shared poll-vote dispatcher (`handleMenuVote`) stays in index.js and calls these engine functions directly (destructured from `createTicTacToeEngine(...)` at module scope, instantiated before any top-level code that references them, to avoid the TDZ hoisting trap documented for the Ruin/Eclipse extractions).
- `src/moderation/warn-service.js` — per-group warning system: threshold/action config persistence (`getWarnState`/`saveWarnState`/`ensureWarnGroup`, stored inside the shared `bot_config.json` via the injected `normalizeWarnConfig`, which stays in index.js because `loadBotConfig` also calls it directly), the per-user strike ledger (`loadWarnLog`/`saveWarnLog`/`getUserWarns`/`setUserWarns`/`listGroupWarns`, backed by `warn_log.json`), and `applyWarn` — the strike + optional auto-delete + optional kick side-effect flow used by both the manual `.warn` command and the phrase-ward auto-moderation path. `src/commands/group/warnings.js` and the auto-ward access-gate path in index.js both consume these via dependency injection.
- `src/moderation/antidelete-service.js` — antidelete engine: per-session enable/endpoint config (`getAntideleteState`/`saveAntideleteState`, stored via the injected `normalizeAntideleteConfig`, which stays in index.js because `loadBotConfig` also calls it directly), `applyWardEndpoint` (shared by the antidelete/autoreact/anti-ward config flows), the group-picker poll (`offerGroupPickPoll`), endpoint listing/matching (`listAntideleteEndpoints`/`antideleteWatchesChat`), and the revoke-event recovery/forward pipeline (`extractRevokeRef` → `recoverDeletedContent` → `handleAntideleteRevoke`). Consumed via dependency injection by `src/commands/group/protections.js`, `src/whatsapp/message-config-input.js`, `src/whatsapp/message-conversation.js`, `src/whatsapp/message-events.js`, and `src/whatsapp/message-pipeline.js`.
- `src/ai/ai-engine.js` — unified multi-provider AI engine: raw provider calls (`callGemini`, `callOpenAI`, `callPollinations`, using the Node `https` module directly — no injected transport, matching the pre-extraction behaviour), per-user Gemini key utilities (`maskApiKey`, `isValidGeminiKey`, `splitApiKeys`, `maskKeyList`, and the ordered-retry `callGeminiChain`), `aiOptsFor` (resolves a session owner's own `.pluginkey` into AI call options via the injected `loadBotConfig`), the top-level fallback ladder `callUniversalAI` (user keys → env `GEMINI_API_KEY` → `OPENAI_API_KEY` → keyless Pollinations), and the scored "fun" generation helpers (`parseScoredAi`, `generateScoredFun`, `funRoastSystem`) used by roast/joke-style AI commands. `callUniversalAI` previously carried a stray unused `export` keyword in index.js with no importers anywhere in the repo (confirmed via grep); it is now a plain member of the frozen service object like everything else. Consumed via dependency injection by `src/commands/fun/ai.js`, `src/commands/system/config-management.js`, `src/commands/system/help.js`, `src/commands/system/plugin-key.js`, and `src/whatsapp/message-conversation.js`.
- `src/testing/bug-probe-engine.js` — 🧪 TEMPORARY antibug-test probe engine: the 72h bug-send registry (`bugSendsPath`/`loadBugSends`/`saveBugSends`/`recordBugSends`, persisted at `<AUTH_DIR>/<phone>/bug_sends.json`, TTL-filtered on load) that lets Telegram `/unbug` delete fired payloads for everyone, the raw provider-agnostic probe senders (`sendIozkProbe`, `sendFiosProbe`, `sendCrashmsgProbe`, `sendIoszkProbe`, `sendCrashclickProbe`, `sendGbHardProbe`) that all speak the injected `prim.relayMessage` interface, the wire-size measurer `wireBytesOf` (protobuf `proto.Message.encode` → JSON byte-length → 0 fallbacks), and the sandbox payload builders (`buildAndrozPayload`, `buildTestfffMessage`, `prepareCardImage`). Node builtins (fs/path/crypto) are imported directly; `log`/`logError`/`authDir`/`delay`/`proto`/`generateWAMessageFromContent`/`prepareWAMessageMedia` are injected. Consumed via dependency injection by `src/commands/testing/one-shot-probes.js`, `src/commands/testing/flood-probes.js`, `src/commands/testing/sandbox-payloads.js` (all three through the command registry), and `src/telegram/commands.js` (loadBugSends/saveBugSends for /unbug). All of it is to be deleted once testing ends.
- `src/core/basic-helpers.js` — the shared "basic helpers" layer: filesystem guards (`ensureDir`/`safeRm`), log truncation (`trimForLog`), Baileys-Long number coercion (`asNumber`), uptime formatting (`formatUptime`/`runtimeUptime`), the EVENTIDE OMEGA terminal wrapper (`buildOmegaTerminal`, used by ~50 command-text call sites), command target/quote extraction (`resolveTargetJid`/`extractQuotedPlainText`, built on the injected `getQuotedContext`/`unwrapMessageContent`/`jidNormalizedUser`), remote media download (`fetchBuffer`, used by the .gpp/.ggpp profile-picture flow), and the lazy optional-native-dep loaders (`loadSharp`/`loadQrcode`). Node builtins (fs/https) and `createRequire` are imported directly; `logError`, `getQuotedContext`, `unwrapMessageContent`, and `jidNormalizedUser` are injected (both message helpers are hoisted function declarations in index.js, so the instantiation before `createSessionStore` is TDZ-safe). Consumed directly throughout index.js (command registry, status/uptime rendering, profile-picture/sticker/avatar flows) and passed on via dependency injection into the session store, warn service, tic-tac-toe engine, socket/reconnection/pairing services, and the message pipeline/middleware/conversation services.
- `src/whatsapp/message-content.js` — the pure message-content decoders: `unwrapMessageContent` peels WhatsApp's wrapper messages (deviceSent / ephemeral / viewOnce V1/V2/V2Extension / documentWithCaption / edited, depth-capped at 10) down to the leaf content while reporting the wrapper chain, `extractMessageText` pulls the human-visible text/caption/button-selection out of a message with a `source` tag, and `getQuotedContext` resolves the contextInfo of the quoted/replied-to message. The three functions form a closed set with no external dependencies, so `createMessageContent()` takes none. Consumed directly by index.js (message log, downloadQuotedMedia, handleWhatsAppMessage) and via dependency injection by `src/core/basic-helpers.js` (getQuotedContext/unwrapMessageContent), the message middleware/pipeline, message conversation/config-input services, and the antidelete service.
- `src/moderation/access-service.js` — the sudo system and poll-voting rights gate: `normalizeDigits` (shared phone-digit normalizer), `isSudo` (checks a JID against the per-session sudo list saved in bot_config.json via the injected `loadBotConfig` — sudoes can command the bot even in owner mode), and `canVoteOnPoll` (owner → everything; sudo → menu + game polls but never bot-self config polls `persona_/helpp_/ar_/ad_/wn_/wg_/greet_`; everyone else → only game/ttt polls via the injected `isGamePoll`). Consumed via dependency injection by the message middleware, the message access service, and the sudo-management commands in the command registry; `canVoteOnPoll` is also called directly by the poll-vote handlers in index.js.
- `scripts/check-syntax.js` — syntax validation for all JavaScript files
- `tests/` — Node built-in unit tests

## Dependency rule

Feature modules must never import `index.js`. Dependencies are passed through an
application context or a focused factory function. This prevents circular
imports and makes modules independently testable.

## Migration order

1. Core configuration, logging and state (complete)
2. Pairing and session lifecycle (complete)
3. Incoming message pipeline (complete)
4. Command registry and simple system commands (in progress)
5. Commands migrated one category at a time
6. Web and Telegram adapters
7. Cleanup, formatting and expanded tests

Each phase gets its own commit and deployment test before the next phase starts.
