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
- `src/services/session-store.js` — session-directory normalization and Telegram user-map persistence
- `scripts/check-syntax.js` — syntax validation for all JavaScript files
- `tests/` — Node built-in unit tests

## Dependency rule

Feature modules must never import `index.js`. Dependencies are passed through an
application context or a focused factory function. This prevents circular
imports and makes modules independently testable.

## Migration order

1. Core configuration, logging and state (complete)
2. Pairing and session lifecycle (in progress)
3. Incoming message pipeline
4. Command registry and simple system commands
5. Commands migrated one category at a time
6. Web and Telegram adapters
7. Cleanup, formatting and expanded tests

Each phase gets its own commit and deployment test before the next phase starts.
