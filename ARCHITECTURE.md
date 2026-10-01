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
