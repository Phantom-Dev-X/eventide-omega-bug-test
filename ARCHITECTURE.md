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
- `src/commands/group/membership.js` — group joining, member changes, invite links, and administrator rank changes
- `src/commands/group/information.js` — group details, visible and hidden broadcasts, and contact-card exports
- `src/commands/group/moderation.js` — per-member muting and whole-group lock/unlock controls
- `src/commands/group/protections.js` — anti-link/mention/forward toggles and antidelete configuration
- `src/commands/group/warnings.js` — warning mutations, ledgers, authorization, and warning-menu initialization
- `src/services/session-store.js` — session-directory normalization and Telegram user-map persistence
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
