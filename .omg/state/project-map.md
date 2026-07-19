# Project Map

This document maps the modular architecture of the **Hermes Crypto Radar** codebase, showing the responsibilities of key directories and source files, along with dependency hotspots.

---

## Workspace Structure

```
.
├── src/                      # TypeScript modules (compiled to dist/)
│   ├── core/                 # Core engine mechanics, configs, utilities
│   ├── analysis/             # Strategy engine, TA indicators coordination
│   ├── sources/              # Data feed connectors (futures, fear/greed, etc.)
│   ├── store/                # Persistent database models (SQLite)
│   ├── api/                  # Fastify routes, WebSocket connections
│   ├── ml/                   # TypeScript wrapper for Python ML modules
│   ├── io/                   # Dashboard layouts, reporting, charts (SVG)
│   ├── monitor/              # Health checking and system alerts
│   └── *.ts                  # Main coordinators (cli.ts, radar.ts, backtest.ts)
│
├── ml/                       # Python machine learning modules (CatBoost)
│   ├── requirements.txt      # PyPI dependencies (numpy, pandas, catboost, shap)
│   ├── train.py              # CatBoost model training script
│   ├── predict.py            # SHAP-enabled batch classification
│   └── models/               # Saved trained model artifacts
│
├── scripts/                  # Scripts for setup, cron collection, and install
│   ├── setup.sh              # Project configuration initialization
│   ├── setup-ml-env.sh       # Installs isolated Python virtual environment (.venv-ml)
│   └── crypto-radar-collector.sh # Cron collector wrapper (runs scans, DB writes, ML)
│
└── data/                     # Local data directory for logs, database, reports (created by run)
```

---

## Module Directory Responsibilities

### 1. Application Coordinators (`src/*`)
- **[cli.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/cli.ts)**: Declares commands (`scan`, `daemon`, `collect`, `backtest`, `ml`) via Commander.js.
- **[radar.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/radar.ts)**: Orchestrates the core enrich-and-calculate pipeline. Calls Binance client, RSS news fetcher, indicators calculator, and strategy evaluator.
- **[indicators.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/indicators.ts)**: Calculates technical indicators (RSI, MACD, BB, ATR, EMA, VWAP) using custom math helper libraries.
- **[paper-trade.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/paper-trade.ts)**: Simulates account trading with mock balances, transactions, and performance reports.
- **[backtest.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/backtest.ts)**: Evaluates past strategy weights against historical datasets.

### 2. Core Config & Tooling (`src/core/*`)
- **[config.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/core/config.ts)**: Resolves configuration from `radar.config.json` + `RADAR__` env overrides.
- **[logger.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/core/logger.ts)**: Standardized logger outputting to stderr (colored console) or files (JSON lines).
- **[webhook.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/core/webhook.ts)**: Formats alerts and POSTs payload to Discord/Telegram.
- **[errors.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/core/errors.ts)**: Custom typed exception handlers.

### 3. Signal Engine (`src/analysis/*`)
- **[engine.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/analysis/engine.ts)**: Computes a unified buy/sell signal strength using weighted strategies.
- **[momentum.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/analysis/momentum.ts)**: Strategy logic focusing on rate of change and ADX trend force.
- **[mean-reversion.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/analysis/mean-reversion.ts)**: Reversion indicators evaluating distance from Bollinger Bands or VWAP.
- **[trend-following.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/analysis/trend-following.ts)**: Bullish/bearish EMA alignments and Chandelier exits.
- **[patterns.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/analysis/patterns.ts)**: Detects candlestick formations (Doji, Engulfing, Hammer).

### 4. Data Storage (`src/store/*` & `src/sources/*`)
- **[db.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/store/db.ts)**: Direct integration with SQLite via Node's native SQL wrapper in WAL mode.
- **[futures.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/sources/futures.ts)**: Fetches funding rates and open interest.

### 5. API Delivery (`src/api/*`)
- **[rest.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/api/rest.ts)**: Fastify REST endpoints `/api/scan`, `/api/signals`, `/api/health`.
- **[ws.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/api/ws.ts)**: WebSocket streams forwarding Binance real-time tickers.

### 6. Presentation/IO (`src/io/*`)
- **[charts.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/io/charts.ts)**: Produces terminal charts and embeds SVGs.
- **[signal-dashboard.ts](file:///home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar/src/io/signal-dashboard.ts)**: Compiles summaries into a beautiful dashboard markdown display.

---

## Dependency & Import Hotspots

- **`loadConfig`**: Central import used in almost all files to load paths and settings. If modifying default properties, test config parsing thoroughly.
- **`sqlite-export.ts`**: Merges CSV logs into SQL tables. Changing CSV headers requires updating both `radar.ts` and `sqlite-export.ts`.
- **`ml/types.ts` & `ml/dataset.ts`**: Typescript schema for data sent to `ml/train.py` via subprocess JSON pipes. Changing features requires changing Python and TS schemas.
