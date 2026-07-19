# ADR-001: Plugin Architecture — TypeScript CLI with Python Bridge

## Status
Accepted

## Context
The plugin needs to expose crypto market intelligence tools to the Hermes Agent. Hermes plugins are written in Python, but the core trading logic is performance-sensitive and benefits from TypeScript's type system and ecosystem.

## Decision
Use a hybrid architecture:
- **Python bridge** (`plugin/__init__.py`) — handles Hermes tool registration via `register(ctx)`, tool schema definitions, and check_fn gating
- **TypeScript CLI** (`src/cli.ts`) — all business logic, API calls, technical indicators, and signal generation
- Communication via subprocess: Python spawns `node dist/cli.js <command> --format json` and returns stdout
- Optional warm daemon: for production use, the daemon pre-caches data and the plugin connects via HTTP for sub-50ms calls

## Consequences
+ Hermes's plugin system is satisfied (Python entry point)
+ TypeScript ecosystem for trading logic (typed errors, strict mode, rich math)
+ Warm daemon bridges the subprocess overhead gap
- Subprocess per call when daemon isn't running (~200ms overhead)
- Two languages to maintain
