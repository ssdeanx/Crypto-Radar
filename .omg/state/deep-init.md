# Deep Initialization State

- **Timestamp:** 2026-07-19T03:47:50-04:00
- **Workspace:** `/home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar`
- **Model:** Gemini 3.5 Flash (Medium)

## Project Overview

Hermes Crypto Radar is an enterprise-grade multi-chain crypto market intelligence system that fetches market data (from Binance, CoinGecko, DeFiLlama, Jupiter, RSS news feeds), processes it using a multi-strategy signal engine, stores results locally (SQLite, CSV, JSONL), and exposes them via REST/WebSockets.

---

## Key Entry Points

1. **CLI Engine** — [src/cli.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/cli.ts) (compiles to `dist/cli.js`). Driven by Commander.js.
2. **Scheduled Cron Collector** — [scripts/crypto-radar-collector.sh](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/scripts/crypto-radar-collector.sh). Orchestrates periodic scans, data persistence, and predictions.
3. **Warm Daemon** — [src/core/warm-daemon.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/core/warm-daemon.ts) and [src/daemon.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/daemon.ts). Fastify server for lightweight REST/WebSocket APIs.
4. **ML Python Entry point** — [ml/train.py](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/ml/train.py) and [ml/predict.py](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/ml/predict.py).

---

## High-Risk Zones & Hotspots

1. **Data Directory Permission Restrictions (`EACCES`):**
   The application uses `/data/crypto-radar` as the default data directory. In standard sandbox or non-root host systems, this causes `EACCES: permission denied, mkdir '/data/crypto-radar'` and crashes. The environment variable `RADAR__DATA_DIR` must be set to a local workspace path (like `./data`) to avoid execution failures.

2. **CLI Integration Test Subprocesses:**
   [src/cli.integration.test.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/cli.integration.test.ts) calls the compiled CLI via `execFile` without propagating environment variables, causing the test suite to fail on host environments unless `RADAR__DATA_DIR` overrides are hardcoded or passed.

3. **External Network Dependencies:**
   Core components call real-world APIs like Binance, DeFiLlama, and CoinGecko. If run in a strictly isolated sandboxed environment without internet access, these tests and operations will fail or timeout.

4. **Hermes Plugin Bridge (Broken/Non-functional):**
   The [plugin/](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/plugin) directory contains a Python bridge that is dev-only/non-functional. Do not make changes here expecting them to affect production cron operations.
