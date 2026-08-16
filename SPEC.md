# 🛰️ Crypto-Radar — Production Data Pipeline SPEC

> **Project:** Multi-chain crypto market data collection pipeline  
> **Status:** v2.10.0 · Production (August 15, 2026)  
> **Versioning:** [SemVer](https://semver.org/) — all changes tracked in this spec

---

## 1. Production Vision

Crypto-Radar is a **multi-chain crypto market data collection and quantitative intelligence pipeline** that runs on a schedule (system cron or Cloud Scheduler) to fetch, compute, persist, and serve market intelligence data. It is implemented in TypeScript and runs as a compiled Node.js binary (`node dist/cli.js`).

**What it does in production:**

1. **Periodic data collection** — A cron job runs every hour (or configurable interval), fetching live prices, technical indicators, news, futures data, and on-chain metrics for 149 tracked tokens across 50+ chains.
2. **Persistent storage** — All collected data is written to a configurable data directory (`/data/crypto-radar/` by default) in multiple formats: CSV logs (append-only), JSONL datasets (ML-ready), SQLite database (structured queries), BigQuery (async enterprise data lake), and human-readable reports (`.txt`, `.md`, `.xlsx`).
3. **Signal & Math computation** — A 3-strategy composite signal engine (Momentum 35%, Mean Reversion 20%, Trend Following 30%, Divergence 15%) enriched with a deep MathJS quantitative backbone: Markowitz Mean-Variance Portfolio Optimization, Spectral Eigendecomposition, 1st-order Markov Regime Switching, S/R Polynomial Curvature, Kalman Filtering, Hurst Exponent, and Fractional Kelly Sizing.
4. **ML & Paper Agent pipelines** — CatBoost/LightGBM direction classifier with auto-retrain, concept drift detection, batch inference, River online learning, and telemetry-trained paper trading agent models.
5. **AI Reasoning & Promptfoo Evals** — Vertex AI Gemini 3.1 Pro / local OpenAI-compatible inference with Autoevals factuality scoring and enterprise Promptfoo red-teaming/benchmarking.
6. **API serving** — A warm daemon or stateless Cloud Run server exposes a Fastify REST API (port 8080/9877) for querying collected and predicted data. Fastify is the sole API implementation.
7. **Data retention** — Monthly archive compression, configurable log pruning (default 30 days), SHA-256 checksum verification on all log files.

**Key design tenets:**

1. **Cron-first** — The primary production path is `scripts/crypto-radar-collector.sh` driven by system cron. All output formats are automatically saved to the data directory.
2. **Multi-chain** — 50+ chains: Solana, Polygon, Ethereum, BNB, Bitcoin, XRP, Cardano, Dogecoin, Cosmos, Sui, Aptos, Sei, Celestia, Injective, Thorchain, NEAR, TRON, Stellar, Avalanche, Litecoin, Bitcoin Cash, Hedera, Bittensor, Polkadot, Filecoin, Zcash, Monero, Algorand, Tezos, Theta, Dash, NEO, Internet Computer, Ethereum Classic + broader market.
3. **No API keys required** — Uses public Binance REST API, RSS feeds, DeFiLlama (free), CoinGecko (free), and Jupiter DEX (free).
4. **Self-contained** — Single compiled Node.js binary. No external runtime needed for core functionality.
5. **Data-portable** — All persistent data resolves through a configurable data directory.
6. **Fastify-only API** — High-performance REST API with Swagger documentation and rate limiting.
7. **Cloud Run–ready** — Dockerfile with `deploy.sh` automates Artifact Registry, Cloud Build, Cloud Run deploy, and Cloud Scheduler cron for managed serverless deployment. GCS bucket synchronization automatically saves/restores SQLite db files and CatBoost ML model assets.

---

## 2. Architecture

### 2.1 Module Map

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Crypto-Radar (Production Pipeline)                   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  dist/cli.js  (Compiled TypeScript, 95+ source modules)               │   │
│  │                                                                        │   │
│  │  src/ root-level modules:                                              │   │
│  │  ├── cli.ts          (Commander.js CLI — dev-only)                     │   │
│  │  ├── index.ts        (Public API exports)                              │   │
│  │  ├── types.ts        (Chain, Kline, TokenSignal types)                 │   │
│  │  ├── tokens.ts       (Token registry — 149 tokens, 50+ chains)         │   │
│  │  ├── binance.ts      (Binance REST client — ticker + klines)          │   │
│  │  ├── indicators.ts   (28 technical indicators)                         │   │
│  │  ├── onchain.ts      (DeFiLlama integration — TVL, fees, prices)      │   │
│  │  ├── news.ts         (RSS news fetcher — 28 feeds, relevance scoring) │   │
│  │  ├── signals.ts      (Composite signal scoring + on-chain boost)      │   │
│  │  ├── radar.ts        (Data enrichment pipeline — the core engine)     │   │
│  │  ├── output.ts       (Formatters — table, JSONL, JSON, CSV, MD)       │   │
│  │  ├── paper-trade.ts  (Paper trading portfolio simulation)             │   │
│  │                                                                        │   │
│  │  src/math/ modules (Quantitative MathJS Backbone):                     │   │
│  │  ├── markowitz.ts    (Markowitz Mean-Variance Sharpe Optimizer)        │   │
│  │  ├── spectral.ts     (Spectral Eigendecomposition & PCA Factors)       │   │
│  │  ├── markov.ts       (Markov Regime Transition Matrix & Stationary)    │   │
│  │  ├── curve-fit.ts    (Polynomial S/R Curvature & Inflection Solver)    │   │
│  │  ├── bignum.ts       (BigNumber Arbitrary-Precision Compounder)        │   │
│  │  ├── risk.ts         (Kelly Criterion & Volatility ATR Sizing)         │   │
│  │  ├── portfolio.ts    (Covariance, Correlation & Risk Parity Weights)   │   │
│  │  ├── filtering.ts    (Kalman Filter, MAD Z-Scores & Hurst Exponent)    │   │
│  │  └── eval.ts         (Brier, ECE, Sharpe/Sortino/Calmar, MFE/MAE)      │   │
│  │                                                                        │   │
│  │  src/analysis/ modules (AI Reasoning & Evaluation):                   │   │
│  │  ├── engine.ts       (Multi-strategy Signal Engine)                    │   │
│  │  ├── ai-eval.ts      (Autoevals Factuality & Indicator Consistency)    │   │
│  │  ├── agent-eval.ts   (Paper Trading Agent Scorecard Generator)         │   │
│  │  └── promptfoo-provider.ts (Custom TypeScript Provider for Promptfoo)  │   │
│  │  ├── backtest.ts     (Strategy backtesting + weight optimization)     │   │
│  │  ├── daemon.ts       (Warm HTTP daemon — Fastify server)              │   │
│  │  ├── jupiter.ts      (Jupiter DEX price aggregator — Solana)          │   │
│  │  ├── pdf-export.ts   (HTML/PDF self-contained report generator)       │   │
│  │  ├── xlsx-export.ts  (Excel export via exceljs)                       │   │
│  │  ├── sqlite-export.ts(CSV→SQLite export bridge)                       │   │
│  │  ├── webhook.ts      (Discord/Telegram alert delivery)                 │   │
│  │  ├── shared-test-helpers.ts (Test fixtures)                           │   │
│  │  │                                                                     │   │
│  │  src/ subdirectories:                                                  │   │
│  │  ├── core/           (Config, cache, errors, logger, rate-limiter,     │   │
│  │  │                     circuit-breaker, log-rotation, warm-daemon,     │   │
│  │  │                     alerts, webhook, benchmark, feed-monitor)       │   │
│  │  ├── analysis/       (Strategies, engine, momentum, mean-reversion,    │   │
│  │  │                     trend-following, patterns, volume-profile,      │   │
│  │  │                     correlation, regime, support-resistance,       │
│  │  │                     gemini)                                          │   │
│  │  ├── store/          (SQLite store + BigQuery async store —             │   │
│  │  │                     node:sqlite, WAL mode, @google-cloud/bigquery)   │   │
│  │  ├── sources/        (Futures, Fear & Greed, orderbook, cross-asset)   │   │
│  │  ├── api/            (Fastify-only — REST handler + enterprise routes  │   │
│  │  │                     in fastify/ subdirectory)                       │   │
│  │  ├── ml/             (Features, labels, dataset, predict, drift,       │   │
│  │  │                     online, monitor — TypeScript orchestration)     │   │
│  │  ├── io/             (Charts, advanced-charts, shared-svg,             │   │
│  │  │                     signal-dashboard)                               │   │
│  │  └── monitor/        (Health checks — API, data, system)               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  ml/  (Python — ML training & inference, optional)                     │   │
│  │  ├── train.py         (CatBoost training orchestrator)                 │   │
│  │  ├── predict.py       (Batch inference with SHAP)                      │   │
│  │  ├── online.py        (River online learning)                          │   │
│  │  ├── detect_drift.py  (Concept drift detection — ADWIN/PageHinkley)    │   │
│  │  ├── indicators.py    (pandas-ta technical indicators)                  │   │
│  │  ├── manifest.py      (Model registry — MANIFEST.json)                 │   │
│  │  ├── model.py         (CatBoost model factory)                         │   │
│  │  ├── daemon.py        (Python HTTP daemon for real-time inference)     │   │
│  │  ├── pyproject.toml   (mypy + ruff type/ lint config)                  │   │
│  │  └── models/          (Trained model files + MANIFEST.json)            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  scripts/  (Production deployment scripts)                            │   │
│  │  ├── crypto-radar-collector.sh  (CRON COLLECTOR — main production     │   │
│  │  │                                 entry point for scheduled runs)     │   │
│  │  ├── install.sh         (One-line install for end users)              │   │
│  │  ├── deploy.sh          (Cloud Run deployment — Artifact Registry,    │   │
│  │  │                        Cloud Build, Cloud Run, Cloud Scheduler)    │   │
│  │  ├── setup.sh           (Full environment setup — npm + ML venv)      │   │
│  │  └── setup-ml-env.sh    (Python ML venv setup via uv)                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Root config and build files                                          │   │
│  │  ├── .dockerignore     (Excludes node_modules, .git, *.test.ts,      │   │
│  │  │                       coverage, .env, etc. — 60 MB build context) │   │
│  │  ├── pyproject.toml    (mypy strict + ruff lint for Python ML code)  │   │
│  │  ├── Dockerfile        (node:22-bookworm-slim + uv Python ML venv)   │   │
│  │  ├── package.json      (npm scripts including check:python for       │   │
│  │  │                       Python type checking via mypy + ruff)        │   │
│  │  └── tsconfig.json     (TypeScript strict mode)                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  System Cron  │───▶│  Collector   │───▶│  Scan        │
│  (crontab)    │    │  Script      │    │  Pipeline    │
└──────────────┘    └──────────────┘    └──────┬───────┘
                                                │
          ┌─────────────────────────────────────┤
          ▼              ▼              ▼       ▼
   ┌──────────┐  ┌────────────┐  ┌────────┐  ┌──────┐
   │ Binance   │  │ DeFiLlama  │  │ RSS    │  │ Coin │
   │ API       │  │ API        │  │ Feeds  │  │Gecko │
   └──────────┘  └────────────┘  └────────┘  └──────┘
          │              │              │         │
          └──────────────┴──────────────┴─────────┘
                          │
                          ▼
                ┌──────────────────┐
                │  Signal Engine   │
                │  Momentum   40%  │
                │  Mean Rev   20%  │
                │  Trend Fol  40%  │
                └────────┬─────────┘
                          │
                          ▼
           ┌──────────────────────────────┐
           │  Data Persistence Layer      │
           │  ┌──────┐ ┌──────┐ ┌─────┐ │
           │  │ CSV  │ │JSONL │ │SQLite││
           │  │ Logs │ │Dsets │ │ DB  │ │
           │  └──────┘ └──────┘ └─────┘ │
           └──────────────────────────────┘
```

### 2.3 Startup Paths

**Primary (Production — system cron):**
```
crontab entry (every hour):
  RADAR__DATA_DIR=/data/crypto-radar ./scripts/crypto-radar-collector.sh
    → node dist/cli.js scan --dynamic 30 --onchain --no-news --format json --quiet
    → node dist/cli.js collect --klines --futures
    → node dist/cli.js ml predict (if model exists)
    → Output written to /data/crypto-radar/{radar-output.*, crypto-radar*.csv, crypto-radar.db}
```

**Cloud Run (production — serverless):**
```
deploy.sh (or manual gcloud commands):
  → Artifact Registry: docker push crypto-radar-image
  → Cloud Run deploy: gcloud run deploy crypto-radar
    → Fastify server on :8080/9877 (auto-mapped to HTTPS)
    → BigQuery async store active
    → Gemini 3.1 Pro reasoning on ML predictions
  → Cloud Scheduler: POST /api/cron/scan every hour
    → OIDC or x-cron-secret authentication
    → Full collect + predict cycle
```

**Secondary (Daemon — REST API for live queries):**
```
node dist/cli.js daemon start
  → Fastify server on :9877
  → REST endpoints at /api/*
  → Cache refresh every 300s (configurable)
  → Cron endpoint at POST /api/cron/scan (secret-gated, rate-limit exempt)
```

**Development (CLI — interactive use only):**
```
node dist/cli.js scan --filter SOL --no-news --format json
  → Commander.js parses args → radar.ts pipeline → JSON/table/CSV output
  → Also writes to data directory as side effect
```

### 2.4 Hermes Plugin Integration (BROKEN / DEV-ONLY)

The `plugin/` directory contains a Python bridge (`plugin/__init__.py`) and plugin metadata (`plugin.yaml`) that were originally designed to register Crypto Radar commands as Hermes Agent tools. This integration is **currently non-functional**:

- The Hermes plugin loading flow (`hermes plugins install`) expects a working Python bridge interacting with the Hermes runtime — this path has never been validated end-to-end.
- The `crypto_` tool registration (`crypto_radar_scan`, `crypto_radar_signals`, etc.) was never successfully published to the marketplace.
- All CLI commands, API routes, and cron automation work independently without the Hermes plugin layer.

**Do not rely on the Hermes plugin integration for production.** Use the production cron path or the CLI/REST API directly.

---

## 3. Features

### 3.1 Data Sources

| Source | Module | Data | Auth |
|--------|--------|------|------|
| **Binance Spot** | `binance.ts` | 24hr ticker (85+ pairs), klines (15m/1h/4h/1d), depth snapshots | None (public API) |
| **Binance Futures** | `sources/futures.ts` | Funding rates, open interest, long/short ratio, liquidations | None (public API) |
| **CoinGecko** | `coingecko.ts` | Fallback prices for non-Binance tokens, global market data (BTC dominance, total mcap) | None (free tier) |
| **Jupiter DEX** | `jupiter.ts` | Solana token prices via Jupiter aggregator API | None (free API) |
| **DeFiLlama** | `onchain.ts` | Protocol TVL, chain TVL, fees (1d/7d/30d), on-chain prices | None (free API) |
| **RSS News** | `news.ts` | 28 feeds (CoinTelegraph, CoinDesk, Decrypt, The Block, Blockworks, SolanaFloor, DL News + 21 more) | None (public RSS) |
| **Fear & Greed** | `sources/fear-greed.ts` | Fear & Greed index from alternative.me | None (free API) |
| **Cross-Asset** | `sources/cross-asset.ts` | BTC dominance, ETH dominance, total market cap | None (free API) |
| **BigQuery Store** | `store/db.ts` | Async enterprise data lake via `@google-cloud/bigquery` — tickers, klines, signals, news, predictions, futures data | GCP service account (optional; in-memory SQLite fallback) |

### 3.2 Token Coverage (85 tokens, 35 chains)

| Group | Tokens |
|-------|--------|
| **Solana** (14) | SOL, JUP, JTO, RAY, PYTH, BONK, KMNO, PUMP, RENDER, ORCA, FIDA, WIF, BOME, AUDIO |
| **Solana (additional)** (1) | TRUMP |
| **Polygon/DeFi** (13) | POL, SUSHI, UNI, AAVE, CRV, LINK, QUICK, BAL, LDO, BAT, COMP, ZRO, GRT |
| **Multi/Broad** (6) | BTC, ETH, BNB, XRP, DOGE, ADA |
| **Cosmos/New L1s** (7) | SUI, APT, SEI, TIA, INJ, RUNE, ATOM |
| **Layer-1 Broader** (11) | NEAR, TRX, XLM, AVAX, LTC, BCH, HBAR, TAO, DOT, FIL, ZEC |
| **Ethereum Ecosystem** (6) | PEPE, WLD, ENA, FET, OP, ARB |
| **Ethereum Gaming/DeFi** (4) | AXS, JASMY, CVX, 1INCH |
| **Monero** (1) | XMR |
| **Algorand** (1) | ALGO |
| **BNB Ecosystem** (1) | CAKE |
| **TRON Ecosystem** (1) | JST |
| **Tezos** (1) | XTZ |
| **Theta Network** (1) | THETA |
| **Research Additions** (17) | ONDO, XEC, OM, AERO, DASH, PENGU, ORDI, CHZ, VIRTUAL, NEO, EIGEN, PENDLE, ICP, SHIB, ETC, SKL, KAITO |

Dynamic top-75 volume detection via `--dynamic` flag with synthesized `TokenDef` fallback for high-volume unmatched tickers.

### 3.3 Technical Indicators (36 computed + sub-components)

| Category | Indicators |
|----------|-----------|
| **Momentum** (10) | RSI (14), MFI (14), Stochastic (%K/%D), Williams %R (14), CCI (20), ROC (12), TRIX (15), Fisher Transform (10), KAMA (14), ALMA (20) |
| **Trend** (12) | MACD (12/26/9), SMA (20), EMA (20/50), Ichimoku Cloud, ADX (14), Parabolic SAR, KST, Keltner Channels (20/2), Mass Index (14), HMA (20), SuperTrend (10/3), SSL (10) |
| **Volatility** (6) | Bollinger Bands (20/2), ATR (14), VWAP, Volatility Trend, Z-Score (20), Donchian Channels (20) |
| **Volume** (8) | OBV, CMF (20), Force Index (13), ADL, Chaikin Oscillator (3/10), Volume vs Avg, Volume Trend, Pivot Points |

### 3.4 Signal Engine

| Component | Weight | Description |
|-----------|--------|-------------|
| **Momentum Strategy** | 40% | Trending moves with volume confirmation + MACD alignment |
| **Mean Reversion Strategy** | 20% | Overextended prices (RSI extremes, BB touch) |
| **Trend Following Strategy** | 40% | Established trends via EMA alignment + volume |
| **On-chain boost** | 0–15% | Protocol TVL strength (DeFiLlama, trend-aware) |
| **ADX adjustment** | 0.6×–1.1× | Trend-strength confidence multiplier |
| **Divergence detection** | ±strength | Regular/hidden/subtle price-RSI divergences |
| **Confidence calibration** | ±15pp | Conflict penalties / agreement bonuses |
| **Volume confirmation** | −6 to +8 | Graduated scale based on volVsAvg ratio |
| **Regime-adaptive weights** | Dynamic | Trending: 45/10/45, Ranging: 15/60/25, Volatile: 30/35/35 |
| **Multi-timeframe aggregation** | Weighted | 15m=0.10, 1h=0.25, 4h=0.30, 1d=0.35 |

### 3.5 ML Pipeline (Optional — CatBoost)

| Component | Module | Description |
|-----------|--------|-------------|
| **Feature Engineering** | `ml/features.ts` | 80+ features: returns, 28 TA indicators, cross-asset, futures funding, temporal features |
| **Label Generation** | `ml/labels.ts` | Forward-return labels at 1/5/20/60 horizons, volatility-adjusted thresholds |
| **Dataset Assembly** | `ml/dataset.ts` | Chronological 70/15/15 split, z-score normalization, CSV export |
| **Model Training** | `ml/train.py` | CatBoost classifier with early stopping, class weights, feature selection |
| **Hyperparameter Tuning** | `ml/model.py` | Optional Optuna HPO with purged cross-validation |
| **Ensemble Voting** | `ml/train.py` | N seeds → soft vote averaging (2–5% accuracy improvement) |
| **SHAP Explanations** | `ml/predict.py` | Per-prediction feature attribution via TreeExplainer |
| **Probability Calibration** | `ml/train.py` | IsotonicRegression on validation set |
| **Model Registry** | `ml/manifest.py` | MANIFEST.json with F1 tracking, production promotion gates (1% improvement threshold) |
| **Batch Inference** | `ml/predict.ts` | Single Python subprocess for all symbols (~200ms total) |
| **Concept Drift** | `ml/detect_drift.py`, `drift.ts` | ADWIN/PageHinkley/KSWIN detectors, auto-retrain trigger |
| **Online Learning** | `ml/online.py`, `online.ts` | River LogisticRegression with AdaptiveStandardScaler |
| **Calibration Monitoring** | `ml/monitor.ts` | ECE (Expected Calibration Error) per confidence bucket |
| **Model Path Resolution** | `ml/predict.ts` | All model paths (`resolveActiveModel`, `resolveModelPath`, `resolveNormStatsPath`) resolve through `config.dataDir` |
| **TS-PY Contract** | `predict.ts` ↔ `predict.py` | Feature name header validation between subprocess caller and Python — `PredictContractHeader` interface ensures feature alignment |
| **Python Code Quality** | `pyproject.toml` | mypy strict mode + ruff lint, enforced via `npm run check:python` |
| **Gemini Reasoning** | `gemini.ts` | Vertex AI Gemini 3.1 Pro enriches ML predictions with professional market reasoning using recent klines, prices, and signals — stored in the `reasoning` field |
| **Gemini Reasoning Batching** | `gemini.ts` | Per-token LLM calls batched into single API call via `batchGenerateReasoning()`. Both local LLM (`RADAR__AI_BASE_URL`) and Vertex AI paths supported |
| **Python ML Test Suite** | `ml/tests/` | 209 tests achieving 86% coverage across all 8 Python modules (model.py, manifest.py, indicators.py, predict.py, online.py, detect_drift.py, train.py, daemon.py). pytest config, `npm test:python` script |

### 3.6 News Aggregation

| Feature | Detail |
|---------|--------|
| **Feed Count** | 28 RSS feeds (CoinTelegraph, CoinDesk, Decrypt, The Block, Blockworks, SolanaFloor, DL News + 21 more) |
| **Fetch Method** | Concurrency-4 batched Promise.all, 15s timeout per feed |
| **Relevance Scoring** | Token name in headline (1.0), ticker in headline with crypto context (0.7), name in description (0.7), ticker in headline bare (0.5), ticker in description with $ (0.5) |
| **Source Tier Weights** | CoinTelegraph/CoinDesk/Decrypt = 1.0, NullTX = 0.4, graduated scale |
| **Minimum Relevance** | `MIN_MATCH_RELEVANCE = 0.5` — articles below this threshold are discarded |
| **Tier Penalty** | Feeds at tier 3+ require 0.2 additional relevance to pass filter |
| **Sentiment Boost** | Bullish keywords in headline (+0.1) |
| **Recency Bonus** | <6h old (+0.2) |
| **Deduplication** | `deduplicateMatches()` — headline-normalized dedup, keeps highest-tier source when duplicates found |
| **Poison Filtering** | Token headline/body matching to filter irrelevant articles |
| **JSONL Output** | `appendNewsToJsonl()` writes separate `crypto-radar-news.jsonl` file with structured fields (ts, symbol, feed, headline, url, relevance, sentiment, tier) |

### 3.7 Charts & Visual Output

| Type | Module | Description |
|------|--------|-------------|
| **SVG Line Chart** | `io/charts.ts` | Self-contained SVG with gradient fill, volume bars, crosshair, tooltips, watermark |
| **SVG Candlestick Chart** | `io/charts.ts` | OHLCV with EMA20/EMA50 overlays, green/red candles |
| **SVG Multi-Panel Dashboard** | `io/charts.ts` | Price (top) + RSI (bottom) with overbought/oversold zones |
| **SVG Comparison Chart** | `io/charts.ts` | Multi-symbol % change overlay, colorblind-safe palette |
| **Correlation Heat Map** | `io/advanced-charts.ts` | N×N Pearson correlation with divergence warnings |
| **Portfolio Dashboard** | `io/advanced-charts.ts` | Holdings table, P&L, allocations pie, drawdown sparkline |
| **Market Breadth Gauge** | `io/advanced-charts.ts` | Gainers/losers ratio, advance-decline line |
| **Strategy Performance** | `io/advanced-charts.ts` | Win rate gauge, Sharpe ratio, equity curve |
| **Signal Dashboard** | `io/signal-dashboard.ts` | 2×2 grid: top signals, market breadth, correlation, on-chain |
| **Volume Profile SVG** | `analysis/volume-profile.ts` | POC marker, HVN/LVN, value area highlight |
| **ASCII Sparklines** | `io/charts.ts` | Multi-line terminal charts with color-coded RSI and volume bars |

### 3.8 Persistence & Export Formats

| Format | File | Write Mode | Description |
|--------|------|-----------|-------------|
| **CSV** | `crypto-radar-log.csv` | Append + SHA-256 checksum | Rolling ticker dataset |
| **CSV** | `crypto-radar-news.csv` | Append + SHA-256 checksum | Rolling news dataset |
| **JSONL** | `radar-runlog.jsonl` | Append (single file) | Run history ledger |
| **JSONL** | `radar-tickers.jsonl` | Append (single file) | ML-ready ticker dataset |
| **JSONL** | `crypto-radar-news.jsonl` | Append (single file) | Structured news dataset with sentiment and tier fields |
| **SQLite** | `crypto-radar.db` | SQLite upsert (WAL mode) | Structured store (klines, tickers, signals, news, predictions, etc.) |
| **Table (TXT)** | `radar-output.txt` | Overwrite + rotate to archive/ | Human-readable scan table |
| **CSV** | `radar-output.csv` | Overwrite + rotate to archive/ | Latest scan CSV |
| **Markdown** | `radar-output.md` | Overwrite + rotate to archive/ | Latest scan report |
| **XLSX** | `radar-output.xlsx` | Overwrite + rotate to archive/ | Excel with frozen headers + conditional formatting |
| **HTML/PDF** | `crypto-radar-report.html` | Overwrite (CLI `report` command) | Self-contained HTML report |
| **GZIP** | `archive/*.gz` | Monthly compression | Archived data files |

### 3.9 Enterprise Infrastructure

| Component | Module | Description |
|-----------|--------|-------------|
| **Circuit Breaker** | `core/circuit-breaker.ts` | CLOSED/OPEN/HALF-OPEN states, 3-failure threshold, 60s cooldown |
| **Rate Limiter** | `core/rate-limiter.ts` | Token-bucket with gradual refill, configurable max/interval |
| **TTL Cache** | `core/cache.ts` | Global in-memory cache, 300s default TTL, hit-rate tracking |
| **Typed Errors** | `core/errors.ts` | 6 classes: NetworkError, RateLimitError, DataError, ConfigError, CacheError, SignalError |
| **Structured Logger** | `core/logger.ts` | 6 levels (trace→fatal), picocolors in CLI, auto-JSON for files, child loggers |
| **Log Rotation** | `core/log-rotation.ts` | Rotate at 10MB, gzip to .1.gz, keep 5 archives |
| **Monthly Archive** | `core/log-rotation.ts` | Gzip all data files to archive/ at month boundary |
| **SHA-256 Checksums** | `core/log-rotation.ts` | Sidecar `.sha256` files on all CSV writes, atomic tmp+rename |
| **Data Retention** | `core/log-rotation.ts` | Auto-prune CSV logs older than N days (default 30) |
| **Process Lock** | `radar.ts` | `radar.lock` file to prevent concurrent runs |
| **Advisory File Locking (FileLock)** | `radar.ts`, `news.ts` | Advisory file lock (FileLock) for concurrent write protection on CLI/news CSV append operations, preventing interleaved writes |
| **PID File** | `daemon.ts` | `daemon.pid` for daemon lifecycle management |
| **Health Monitoring** | `monitor/health.ts` | Binance, Jupiter, DeFiLlama, cache, feed health checks |
| **Feed Monitor** | `core/feed-monitor.ts` | Per-feed success/failure tracking, dead feed detection |
| **Backtesting** | `backtest.ts` | Strategy backtesting + weight optimization engine |
| **Docker Build Context** | `.dockerignore` | Excludes node_modules, .git, *.test.ts, coverage, .env → 60 MB vs 313 MB |
| **BigQuery Store** | `store/db.ts` | Async enterprise data lake — tickers, klines, signals, news, predictions, futures tables; in-memory SQLite fallback when GCP unavailable |
| **Gemini Reasoning** | `gemini.ts` | Vertex AI Gemini 3.1 Pro market reasoning enrichment for ML predictions via Vertex AI client |
| **Gemini Reasoning Batching** | `gemini.ts` | Per-token LLM calls batched into single API call via `batchGenerateReasoning()` — supports both local LLM (`RADAR__AI_BASE_URL`) and Vertex AI paths |
| **Configurable CORS Origins** | `src/api/fastify/` | `CORS_ORIGIN` env var replaces hardcoded Vercel URLs. Priority: env var → opts.corsOrigin → localhost defaults |
| **Configurable Swagger URL** | `src/api/fastify/` | `RADAR__SWAGGER_URL` env var (default http://localhost:8080) replaces hardcoded daemon port 9877 |
| **Zod Query Validation** | All GET routes | Zod schema validation on all 15+ GET route query params (coerce.number, enum, defaults) for type-safe request handling |
| **Cloud Run Deploy** | `deploy.sh` | Automated GCP provisioning — Artifact Registry image push, Cloud Build, Cloud Run deploy, Cloud Scheduler cron setup |
| **Debian Dockerfile** | `Dockerfile` | `node:22-bookworm-slim` base with `uv` Python ML venv for drift detection |

### 3.10 REST API (30+ endpoints)

Fastify server (port 9877) with CORS, JWT auth, rate-limit, compression, Swagger docs. Fastify is the sole API provider — the legacy `src/api/rest.ts` has been removed. **All 15+ GET route query parameters validated with Zod schemas** (coerce.number, enum, defaults). CORS origins configurable via `CORS_ORIGIN` env var. Swagger URL configurable via `RADAR__SWAGGER_URL` env var.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Daemon + store status |
| GET | `/api/tickers` | Latest ticker snapshot |
| GET | `/api/tickers/:symbol` | Single ticker |
| GET | `/api/klines/:symbol` | OHLCV with interval/from/to/limit |
| GET | `/api/signals` | Latest signals |
| GET | `/api/signals/:symbol` | Signal for symbol |
| GET | `/api/news` | News articles |
| GET | `/api/tokens` | Token list |
| GET | `/api/portfolio` | Paper trading portfolio |
| GET | `/api/portfolio/trades` | Trade history |
| POST | `/api/portfolio/trades` | Execute buy/sell |
| GET | `/api/futures/:symbol` | Funding rate, OI, LS ratio, liquidations |
| GET | `/api/fear-greed` | Fear & Greed index |
| GET | `/api/cross-asset` | BTC dominance, total mcap |
| GET | `/api/orderbook/:symbol` | Order book snapshots |
| GET | `/api/regime/:symbol` | Live market regime |
| GET | `/api/predictions` | ML predictions |
| GET | `/api/predictions/:symbol` | Predictions per symbol |
| GET | `/api/stats` | Row counts per table |
| POST | `/api/collect` | Trigger backfill (token-gated) |
| POST | `/api/cron/scan` | Secure cron trigger (secret-gated, rate-limit exempt) |
| GET | `/api/ml/status` | Pipeline health |
| GET | `/api/ml/models` | Model registry list |
| GET | `/api/ml/drift` | Recent drift events |
| GET | `/api/ml/predictions` | Recent predictions |
| GET | `/api/ml/calibration` | Calibration report (ECE) |
| GET | `/api/ml/online` | Online model metrics |
| POST | `/api/auth/signup` | Create user |
| POST | `/api/auth/login` | JWT login |
| GET | `/api/auth/me` | Current user info |

### 3.11 WebSocket Hub (Removed for Cloud Run parity)

The WebSocket server, standalone client connections, and raw `ws` dependencies have been deprecated and completely removed. The pipeline utilizes purely stateless, request-driven Fastify HTTP APIs to support serverless scaling, avoiding scale-to-zero connection blockages and timeout overhead associated with persistent TCP sockets in serverless runtimes.


### 3.12 Paper Trading

Complete portfolio simulation engine (`paper-trade.ts`, `paper-trade-cli.ts`):
- Multiple named profiles (e.g., 'trader1', 'aggressive')
- Buy/sell execution with real-time Binance/CoinGecko pricing
- FIFO position matching and P&L computation
- Partial fills and position tracking
- Performance reports (PnL, win rate, Sharpe)
- Signal-based auto-trading via `agentPlay()`

### 3.13 Token Validation

The `tokens --validate` Commander.js command curls every registry token against the live Binance USDT pair set and reports:
- **Valid tokens** — those with a live Binance USDT pair and positive 24h quote volume
- **Dead/delisted tokens** — those with zero volume or missing pairs, candidates for pruning

```bash
node dist/cli.js tokens --validate
# → Reports 85 valid, 0 dead
```

The `validateTokenCoverage()` function in `src/tokens.ts` performs the live check using `fetchAllUsdtTickers()`.

---

## 4. Data Flow

### 4.1 Full Scan Pipeline

```
cron trigger (or CLI invocation)
  → cli.ts dispatches to radar.ts: runRadar()
    → tokens.ts: resolve tokens (static list or dynamic top-N by volume)
    → binance.ts: fetchAllTickers() [GET /ticker/24hr, parallel batches of 5]
    → binance.ts: fetchKlines() [parallel per interval, batches of 5, limit=200]
    → indicators.ts: computeAllIndicators() [28 indicators per token]
    → news.ts: fetchAndMatchNews() [28 RSS feeds, concurrency-4]
    → onchain.ts: fetchOnChainMetrics() [DeFiLlama: protocol TVL, chain TVL, fees]
    → signals.ts: computeSignals() [weighted composite, ADX adjustment, divergence]
    → analysis/engine.ts: StrategyEngine.evaluate() [3 strategies, multi-TF aggregation]
    → output.ts: format → JSON/table/csv/md
    → File system: append CSV logs + overwrite reports + rotate to archive/
    → news.ts: appendNewsToJsonl() [separate crypto-radar-news.jsonl file]
    → store/db.ts: BigQuery async store (tickers, signals, news, predictions) with in-memory SQLite fallback
    → gemini.ts: Vertex AI Gemini 3.1 Pro reasoning enrichment on ML predictions using recent klines, prices, and signals
    → Store predictions with reasoning field
```

### 4.2 Collector Pipeline (Historical Backfill)

```
runCollector() [called by collector script after scan]
  → Store.open(dataDir) → migrate() → prepare SQLite
  → For each symbol × interval:
    → Check latestKlineTime()
    → If null: seedKlines() [walk GET /klines backward to lookback depth]
    → If exists: incrementalKlines() [fetch from last timestamp forward]
  → collectFutures() [funding rate, OI, LS ratio, liquidations per symbol]
  → collectOrderBook() [depth snapshots per symbol]
  → collectFearGreed() [Fear & Greed index]
  → collectCrossAsset() [BTC dominance, total mcap]
  → Store.close()
```

### 4.3 ML Pipeline Data Flow

**Auto-Retrain (daemon refresh cycle):**
```
Daemon refresh → check config.ml.enabled
  → buildFeatures() [80+ columns from store klines + cross-asset + funding]
  → computeLabels() [forward returns at configured horizon]
  → assembleDataset() [inner join, NaN drop, 70/15/15 split, z-score normalize]
  → spawn ml/train.py [CatBoost with early stopping, optuna, shap]
  → save model + MANIFEST.json to <dataDir>/ml/models/  [config.dataDir-based]
  → batchPredict() [build features → normalize → CSV → spawn predict.py]
      → TS-PY contract header (_header, _features, _featureCount) validates alignment
  → persistPredictions() [write to predictions table]
  → gemini.ts: enrich prediction with Gemini 3.1 Pro market reasoning [recent klines, prices, signals → reasoning field]
  → store/db.ts: async BigQuery store (tickers, signals, predictions, news) with in-memory SQLite fallback
  → detectDrift() [ADWIN on prediction errors → auto-retrain if needed]
```

**Model Path Resolution (all config.dataDir-based):**
- `resolveActiveModel()` → `<dataDir>/ml/models/MANIFEST.json` → active model path
- `resolveModelPath()` → `<dataDir>/ml/models/` → latest `model_*.joblib`
- `resolveNormStatsPath()` → `<dataDir>/ml/` → latest `*_norm_*.json`

### 4.4 Signal Scoring Model

| Component | Weight | Inputs |
|-----------|--------|--------|
| Momentum | 40% | Price change, spread, volume, book imbalance, range position |
| Technical | 40% | RSI, MACD, BB position, volume trend, EMA50 distance, 28 indicators |
| News | 20% | Recent article count × relevance, sentiment keywords, recency bonus |
| On-chain boost | 0–15% | Protocol TVL strength (DeFiLlama, trend-aware) |
| ADX adjustment | 0.6×–1.1× | Trend strength multiplier |
| Volume adjustment | −6 to +8 | Graduated volVsAvg scale |
| Calibration penalty | ±15pp | Inter-strategy conflict/agreement |

### 4.5 Store Schema (SQLite + BigQuery)

The `Store` class wraps `node:sqlite` (`DatabaseSync`) in WAL mode for local persistence, with an async BigQuery layer (`store/db.ts`) for enterprise data lake workloads. Single-file SQLite store at `<dataDir>/crypto-radar.db`. BigQuery dataset mirrors the same table schema when enabled, with in-memory SQLite fallback when GCP is unavailable.

| Table | Type | Primary Key | Purpose |
|-------|------|-------------|---------|
| `klines` | Time series | (symbol, interval, open_time) | OHLCV candle data |
| `tickers` | Snapshot | (symbol) | Latest ticker per symbol |
| `ticker_history` | History | (symbol, ts_utc) | Append-only ticker time series |
| `signals` | Snapshot | (symbol) | Latest signal per symbol |
| `signal_history` | History | (symbol, ts_utc) | Append-only signal time series |
| `news` | Log | (id) | Deduplicated news articles |
| `paper_trades` | Record | (id) | Simulated trades |
| `futures_funding` | Time series | (symbol, ts) | Funding rate history |
| `futures_oi` | Time series | (symbol, ts) | Open interest history |
| `futures_ls_ratio` | Time series | (symbol, ts) | Long/short ratio history |
| `liquidations` | Log | (id) | Liquidation events |
| `fear_greed` | Time series | (ts) | Fear & Greed index |
| `orderbook` | Time series | (symbol, ts) | Order book snapshots |
| `cross_asset` | Time series | (ts) | BTC dominance, total mcap |
| `predictions` | Record | (id) | ML model predictions |
| `drift_events` | Log | (id) | Concept drift detection events |
| `users` | Record | (id) | Auth users (Fastify API) |

### 4.6 Data Sources (src/sources/)

| Module | Source | Data | Rate Limit |
|--------|--------|------|------------|
| `futures.ts` | Binance Futures (fapi.binance.com) | Funding rate, OI, LS ratio, liquidations | Circuit breaker + 10 req/s rate limiter |
| `fear-greed.ts` | alternative.me | Fear & Greed index | Public, no auth |
| `orderbook.ts` | Binance Spot | Depth snapshots | Circuit breaker + rate limiter |
| `cross-asset.ts` | CoinGecko global API | BTC dominance, total mcap, market cap change | Circuit breaker + 5 req/s rate limiter |

---

## 5. Data Persistence Architecture

### 5.1 Primary Data Directory

**Default path:** `/data/crypto-radar/`  
**Configuration:** `RADAR__DATA_DIR` env var or `config.dataDir` in code  
**Purpose:** All logs, reports, SQLite DB, ML models, and state files persist here

### 5.2 Secondary Data Directory (Legacy Fallback)

**Default path:** `~/.hermes/data/crypto-radar/` (auto-detected if directory exists)  
**Configuration:** `RADAR__SECONDARY_DATA_DIR` for explicit override  
**Purpose:** Gradual migration path — users with existing data in the old path can leave it in place while the new path handles all writes

### 5.3 All Write Sites

| # | File | Target File | Write Mode |
|---|------|-------------|-----------|
| 1 | `radar.ts` | `crypto-radar-log.csv` | Append + SHA-256 checksum |
| 2 | `radar.ts` | `crypto-radar-news.csv` | Append + SHA-256 checksum |
| 3 | `cli.ts` | `radar-output.txt` | Overwrite + rotate to archive/ |
| 4 | `cli.ts` | `radar-output.csv` | Overwrite + rotate to archive/ |
| 5 | `cli.ts` | `radar-output.md` | Overwrite + rotate to archive/ |
| 6 | `radar.ts` (via xlsx-export) | `radar-output.xlsx` | Overwrite + rotate to archive/ |
| 7 | `cli.ts` | `radar-runlog.jsonl` | Append |
| 8 | `cli.ts` | `radar-tickers.jsonl` | Append |
| 9 | `news.ts` | `crypto-radar-news.jsonl` | Append |
| 10 | `collector.ts` | `crypto-radar.db` | SQLite upsert (WAL mode) |
| 11 | `daemon.ts` | `crypto-radar.db` | SQLite upsert |
| 12 | `cli.ts` (ml commands) | `crypto-radar.db` | SQLite upsert |
| 13 | `paper-trade.ts` | `profiles/*.json` | File write |
| 14 | `paper-trade.ts` | `last-profile.txt` | File write |
| 15 | `radar.ts` | `radar.lock` | Atomic file write |
| 16 | `radar.ts` | `crypto-radar-state.json` | JSON dump |
| 17 | `daemon.ts` | `daemon.pid` | PID file |
| 18 | `cli.ts` (report) | `crypto-radar-report.html` | Overwrite |
| 19 | `ml/dataset.ts` | `<dataDir>/ml/*.csv` | CSV export (training data) |
| 20 | `log-rotation.ts` | `archive/*.gz` | Monthly gzip archive |
| 21 | `ml/predict.ts` | `<dataDir>/ml/models/` | Model files + MANIFEST.json |
| 22 | `store/db.ts` | BigQuery dataset | Async enterprise data lake — tickers, klines, signals, news, predictions, futures tables (in-memory SQLite fallback) |

All write sites resolve through `config.dataDir`. CWD-relative paths were hardened to `config.dataDir` in v2.4.0. ML model paths use `config.dataDir` consistently via `resolveActiveModel()`, `resolveModelPath()`, and `resolveNormStatsPath()`.

### 5.4 File Output Summary

After each cron run, the data directory contains:

| File | Purpose | Format |
|------|---------|--------|
| `crypto-radar-log.csv` | Rolling scan log | CSV with SHA-256 checksums |
| `crypto-radar-news.csv` | Rolling news log | CSV |
| `crypto-radar-news.jsonl` | Structured news dataset | JSON Lines (ts, symbol, feed, headline, url, relevance, sentiment, tier) |
| `crypto-radar.db` | Persistent SQLite store | SQLite (WAL mode) |
| `radar-output.txt` | Latest scan table | Plain text |
| `radar-output.csv` | Latest scan data | CSV |
| `radar-output.md` | Latest scan report | Markdown |
| `radar-output.xlsx` | Latest scan spreadsheet | Excel (frozen headers, conditional coloring) |
| `radar-runlog.jsonl` | Append-only run log | JSON Lines |
| `radar-tickers.jsonl` | Append-only ticker data | JSON Lines |
| `archive/` | Monthly gzipped archives | `.gz` (rotated at month boundary) |
| **BigQuery** | Enterprise data lake | `@google-cloud/bigquery` — tickers, klines, signals, news, predictions, futures (async, with in-memory SQLite fallback) |

### 5.5 Startup Validation

At config load time (`src/core/config.ts`), the resolved data directory is logged:

```
INFO  Config loaded  dataDir=/data/crypto-radar  secondaryDataDir=~/.hermes/data/crypto-radar
```

This is the canonical signal confirming which paths the tool will use for all writes.

---

## 6. Configuration

### 6.1 Config File: `radar.config.json`

Auto-discovered from project root. JSON object with all `RadarConfig` fields. Merge priority:
1. Config file values (lowest)
2. Environment variable overrides (`RADAR__*`)
3. Built-in defaults (highest)

### 6.2 Environment Variables

All env vars use the `RADAR__` prefix. They override values from `radar.config.json` and built-in defaults.

| Env Variable | Default | Description |
|-------------|---------|-------------|
| **Core** | | |
| `RADAR__DATA_DIR` | `/data/crypto-radar` | Primary data directory |
| `RADAR__SECONDARY_DATA_DIR` | auto-detected | Legacy fallback path |
| `RADAR__LOG_LEVEL` | `info` | Verbosity: trace, debug, info, warn, error, fatal |
| `RADAR__LOG_FORMAT` | `text` | Log format: text (human) or json (structured) |
| `RADAR__LOG_RETENTION_DAYS` | `30` | Days to retain log files |
| `RADAR__BINANCE_BASE_URL` | `https://data-api.binance.vision` | Binance REST API base URL |
| `RADAR__FETCH_TIMEOUT_MS` | `10000` | HTTP fetch timeout in ms |
| `RADAR__CACHE_TTL_MS` | `300000` | In-memory cache TTL (5 min) |
| `RADAR__MAX_RETRIES` | `3` | Max retries for network calls |
| `RADAR__RATE_LIMIT_MAX` | `20` | Max requests per rate-limit window |
| `RADAR__ENABLE_FILE_CHECKSUMS` | `true` | SHA-256 checksums on log files |
| **Tokens** | | |
| `RADAR__TOKENS` | — | Token whitelist (comma-separated or JSON array) |
| **Strategy** | | |
| `RADAR__STRATEGY_WEIGHTS` | `{"momentum":0.4,"mean-reversion":0.2,"trend-following":0.4}` | Strategy weight overrides |
| `RADAR__TIMEFRAME_WEIGHTS` | `{"15m":0.1,"1h":0.25,"4h":0.3,"1d":0.35}` | Timeframe weight overrides |
| **Daemon** | | |
| `RADAR__DAEMON_PORT` | `9877` | Daemon HTTP server port |
| `RADAR__DAEMON_REFRESH_SEC` | `300` | Cache refresh interval in seconds |
| `CRON_SECRET` | — | Secret for POST /api/cron/scan endpoint |
| **Store** | | |
| `RADAR__STORE_PATH` | `<dataDir>/crypto-radar.db` | SQLite store file path |
| `RADAR__STORE_RETENTION_DAYS` | `30` | Data retention days in store |
| **API / Auth** | | |
| `RADAR__API_TOKEN` | — | API token for gated endpoints |
| `RADAR__JWT_SECRET` | — | JWT signing secret (REQUIRED in production) |
| `RADAR__JWT_AUDIENCE` | — | JWT audience claim |
| `RADAR__JWT_ISSUER` | — | JWT issuer claim |
| **Sources** | | |
| `RADAR__SOURCES_FUTURES` | `true` | Enable Binance Futures collection |
| `RADAR__SOURCES_FEAR_GREED` | `true` | Enable Fear & Greed collection |
| `RADAR__SOURCES_CROSS_ASSET` | `true` | Enable cross-asset data collection |
| `RADAR__SOURCES_ORDERBOOK` | `false` | Enable order-book snapshots (opt-in) |
| `RADAR__DEFI_LLAMA_ENABLED` | `false` | Enable DeFiLlama on-chain metrics |
| `RADAR__COINGLASS_KEY` | — | CoinGlass API key (optional liquidation source) |
| **ML Pipeline** | | |
| `RADAR__ML_ENABLED` | `false` | Enable ML prediction pipeline |
| `RADAR__ML_PYTHON` | `python3` | Python interpreter path |
| `RADAR__ML_LOOKBACK_DAYS` | `90` | Training data lookback days |
| `RADAR__ML_RETRAIN_HOURS` | `24` | Auto-retrain interval in hours |
| `RADAR__ML_MIN_CONFIDENCE` | `0.6` | Minimum prediction confidence (0–1) |
| `RADAR__ML_LABEL_HORIZON` | `5` | Label horizon (1/5/20/60 periods) |
| `RADAR__ML_OPTUNA_TRIALS` | `30` | Optuna HPO trials |
| `RADAR__ML_OPTIMIZE` | `false` | Enable hyperparameter optimization |
| `RADAR__ML_CV_FOLDS` | `5` | Cross-validation folds |
| `RADAR__ML_BALANCE` | `false` | Enable class balancing |
| `RADAR__ML_SHAP` | `false` | Enable SHAP explanations |
| **Alerts / Webhooks** | | |
| `RADAR__WEBHOOK_URL` | — | Webhook URL (Discord or Telegram) |
| `RADAR__WEBHOOK_TYPE` | `discord` | Webhook type: discord or telegram |

---

## 7. Deployment

### 7.1 Production Environment

Crypto Radar runs on **bare metal Linux** or any system with Node.js >=22. It is designed to be invoked via **system cron** as a scheduled data collection pipeline. The optional warm daemon provides a REST API for live queries.

### 7.2 Required Directory

```bash
sudo mkdir -p /data/crypto-radar
sudo chown -R $(whoami):$(whoami) /data/crypto-radar
```

### 7.3 Required Environment Variables

| Variable | Purpose | Set In |
|----------|---------|--------|
| `RADAR__DATA_DIR=/data/crypto-radar` | Primary data directory | cron env or shell profile |
| `RADAR__ML_PYTHON=/path/to/python3` | Python interpreter (if ML enabled) | cron env |
| `RADAR__ML_ENABLED=true` | Enable ML (if needed) | cron env |

### 7.4 Cron Setup (Production)

**Primary — hourly scan via collector script:**

```bash
# crontab -e
0 * * * * RADAR__DATA_DIR=/data/crypto-radar /opt/hermes-crypto-radar/scripts/crypto-radar-collector.sh >> /data/crypto-radar/cron-run.log 2>&1
```

The collector script runs:
1. `node dist/cli.js scan --dynamic 30 --onchain --no-news --format json --quiet` — Live scan with auto-save to all formats
2. `node dist/cli.js collect --klines --futures` — Backfill klines and futures data to SQLite
3. `node dist/cli.js ml predict --interval 1h` — ML prediction (if model exists at `<dataDir>/ml/models/`)
4. Archive housekeeping — moves old files to `archive/`, migrates legacy file names

### 7.5 Daemon Setup (Optional — REST API)

```bash
# systemd unit or screen/tmux session
RADAR__DATA_DIR=/data/crypto-radar node dist/cli.js daemon start
```

The daemon pre-warms caches on startup and refreshes every 300s (configurable). Provides:

- REST API on port 9877 (Fastify with CORS, JWT, rate-limit, compression, Swagger at `/docs`)
- Health check at `/health`
- Manual cache refresh at `/refresh`
- Secure cron endpoint at `POST /api/cron/scan` (rate-limit exempt, secret-gated)

### 7.6 Complete Installation

```bash
# 1. Clone and build
git clone https://github.com/ssdeanx/Hermes-Crypto-Radar.git
cd Hermes-Crypto-Radar
npm install && npm run build

# 2. Create data directory
sudo mkdir -p /data/crypto-radar
sudo chown -R $(whoami):$(whoami) /data/crypto-radar

# 3. Set env var in cron env
echo 'RADAR__DATA_DIR=/data/crypto-radar' >> /etc/environment

# 4. (Optional) Set up ML environment
bash scripts/setup-ml-env.sh

# 5. Test
node dist/cli.js scan --filter SOL --no-news --format json

# 6. Validate token coverage
node dist/cli.js tokens --validate

# 7. Install cron job
crontab -e
# Add: 0 * * * * RADAR__DATA_DIR=/data/crypto-radar /opt/hermes-crypto-radar/scripts/crypto-radar-collector.sh >> /data/crypto-radar/cron-run.log 2>&1
```

### 7.7 Startup Steps (in order)

1. Clone repo — `git clone ...`
2. Install deps — `npm install && npm run build`
3. Create data dir — `sudo mkdir -p /data/crypto-radar && sudo chown -R $(whoami):$(whoami) /data/crypto-radar`
4. Set `RADAR__DATA_DIR` in cron environment
5. Test scan — `node dist/cli.js scan --filter SOL --no-news`
6. (Optional) Set up ML — `npm run ml:setup` + `RADAR__ML_PYTHON`
7. Validate token coverage — `node dist/cli.js tokens --validate`
8. Install cron job for automated collection
9. (Optional) Start daemon for REST API
10. Verify startup log — check for `INFO  Config loaded  dataDir=/data/crypto-radar`

### 7.8 Required Permissions

| Resource | Permission | Reason |
|----------|-----------|--------|
| `$RADAR__DATA_DIR/` | rwx | Read/write data files, SQLite DB, run logs |
| Node.js + `dist/cli.js` | rx | Execute CLI commands |
| Python 3 + ML scripts | rx | Execute ML pipeline (if enabled) |

### 7.9 Env Propagation Warning

When running as a cron task, environment variables are set at **cron daemon start time** and are **not** inherited from the user's shell profile. Every `RADAR__*` env var must be explicitly set in the cron command line or be present in the system's cron environment.

### 7.10 Docker Build Context

The `.dockerignore` file reduces the build context from ~313 MB to ~60 MB by excluding:
- `node_modules/` (largest contributor)
- `.git/` (repository history)
- `dist/*.map` (source maps)
- `*.test.ts` (test files)
- `__pycache__/`, `*.pyc` (Python bytecode)
- `coverage/` (test coverage reports)
- `.env`, `.env.local` (secrets)
- `.venv-ml/` (ML virtual environment)
- `.gitignore`, `.hermes/`, `.cursorrules` (dev config)

---

## 8. Development

### 8.1 CLI Commands (Dev-Only)

These commands exist for development and interactive use. They are not the primary production path.

| Command | Description |
|---------|-------------|
| `crypto-radar scan` | Full market scan (auto-dynamic top 30 by default) |
| `crypto-radar signals` | Quick signal snapshot |
| `crypto-radar news` | Fetch and score crypto news |
| `crypto-radar tokens` | List tracked tokens |
| `crypto-radar tokens --validate` | Validate registry tokens against live Binance API |
| `crypto-radar chart` | Generate SVG or ASCII charts |
| `crypto-radar daemon` | Start/stop/status warm daemon |
| `crypto-radar onchain` | DeFiLlama on-chain metrics |
| `crypto-radar health` | System health checks |
| `crypto-radar configure` | Show or generate configuration |
| `crypto-radar backtest` | Strategy backtesting |
| `crypto-radar benchmark` | Performance benchmarks |
| `crypto-radar ml train` | Train ML model |
| `crypto-radar ml predict` | Run ML prediction |
| `crypto-radar ml status` | Check ML pipeline status |
| `crypto-radar ml drift` | Run drift detection |
| `crypto-radar collect` | Historical backfill to SQLite |
| `crypto-radar export-sqlite` | Export CSV logs as SQL |
| `crypto-radar report` | Generate HTML report |

### 8.2 npm Scripts

```bash
npm run build         # Compile TS → dist/
npm run watch         # Watch mode
npm run start         # Run CLI
npm test              # Run vitest suite (~1222+ tests)
npm run test:coverage # Coverage report
npm run test:python   # Python ML test suite (pytest, 209 tests)
npm run lint          # ESLint check
npm run format        # Prettier check
npm run daemon        # Start warm daemon
npm run collector     # Historical backfill
npm run ml:setup      # Set up Python ML environment
npm run ml:train      # Train ML model
npm run ml:predict    # Run ML prediction
npm run check:python  # Python type check (mypy --strict) + lint (ruff)
npm run benchmark     # Performance benchmarks
npm run backtest      # Strategy backtesting
npm run docs          # Generate TypeDoc API reference
```

**Note:** The stale `./prices` export has been removed from `package.json`. The only package exports are `.` (main), `./news`, and `./signals`.

### 8.3 Hermes Plugin Integration (BROKEN)

The Hermes plugin integration (`plugin/` directory, `plugin.yaml`) is **legacy and non-functional**. It was originally intended to register 8 tools into the Hermes Agent ecosystem:

- `crypto_radar_scan`
- `crypto_radar_signals`
- `crypto_radar_news`
- `crypto_radar_tokens`
- `crypto_radar_chart`
- `crypto_radar_daemon`
- `crypto_radar_onchain`
- `crypto_radar_ws`

The Python bridge (`plugin/__init__.py`) spawns `node dist/cli.js` subprocesses and wraps output as Hermes tool responses. This path has **never been validated end-to-end**. All functionality works independently through the CLI and REST API.

### 8.4 Python Code Quality

Python ML code is type-checked and linted via `pyproject.toml`:

| Tool | Config | Command |
|------|--------|---------|
| **mypy** | `strict = true`, `ignore_missing_imports = true` | `npm run check:python` |
| **ruff** | Target `py312`, select E/W/F/I/N/UP | (same `check:python` script) |

```bash
npm run check:python
# → mypy --strict --ignore-missing-imports *.py
# → ruff check *.py
```

### 8.5 Testing

- **Test framework:** Vitest v4 with v8 coverage provider; pytest for Python ML modules
- **Test count:** ~1222+ TypeScript tests across 55+ test files; 209 Python ML tests achieving 86% coverage
- **Coverage targets:** Lines 90.5%, Statements 87.8%, Functions 91.4%, Branches 74.4% (TypeScript); 86% coverage (Python ML)
- **Test types:** Unit, integration, smoke, E2E, fuzz (157 edge-case tests), Python ML (pytest)
- **Excluded from coverage:** ML modules (Python infra dependency), chart modules (SVG rendering infra)

### 8.6 Code Quality

- TypeScript strict mode with `noUncheckedIndexedAccess`, `noImplicitOverride`
- ESLint with `typescript-eslint` strict rules
- Prettier formatting
- Husky pre-commit hooks
- Full JSDoc on all exported functions
- TypeDoc API documentation
- Python ML code: mypy strict + ruff lint

---

## 9. Changelog

### [2.8.1] — 2026-07-22

**Added:**
- Production Hardening Sprint — 4 workstreams: Oxlint config repaired (237 warnings, 0 errors), Zod schema validation on 15+ GET routes, advisory FileLock for CSV writes, 27 TS ML unit tests
- Python ML Pipeline Tests — 209 tests achieving 86% coverage across all 8 Python modules (pytest config, `npm test:python` script)
- Gemini Reasoning Batching — Per-token LLM calls batched into single API call via `batchGenerateReasoning()`. Both local LLM and Vertex AI paths supported
- 8 new pandas-ta indicators: KAMA, ALMA, HMA, SuperTrend, SSL, Z-Score, Donchian Channels, Pivot Points (total 36 indicators)
- Configurable CORS Origins — `CORS_ORIGIN` env var replaces hardcoded Vercel URLs
- Configurable Swagger URL — `RADAR__SWAGGER_URL` env var replaces hardcoded daemon port 9877

**Changed:**
- `deploy.sh` no longer deploys `RADAR__AI_API_KEY` secret (development-only; production uses Vertex AI)

**Fixed:**
- Dead `ws.test.ts` removed (ws.ts deleted in WebSocket removal)
- Daemon test EADDRINUSE flake — mock listen replaces real port binding

### [2.6.0] — 2026-07-19

**Added:**
- 17 new tokens (ONDO, XEC, OM, AERO, DASH, PENGU, ORDI, CHZ, VIRTUAL, NEO, EIGEN, PENDLE, ICP, SHIB, ETC, SKL, KAITO) — token registry grows to 85
- Synthesized `TokenDef` fallback in `getTopTokensByVolume()` — top-75 dynamic scan now works even for unmatched high-volume tickers
- `appendNewsToJsonl()` — separate `crypto-radar-news.jsonl` output file with structured fields (ts, symbol, feed, headline, url, relevance, sentiment, tier)
- `deduplicateMatches()` — headline-normalized dedup keeping highest-tier source
- `MIN_MATCH_RELEVANCE = 0.5` filter + tier 3+ penalty of 0.2 extra relevance required
- `tokens --validate` command that curls every registry token against live Binance USDT pairs
- Python type checking: `pyproject.toml` with mypy (strict) + ruff; `npm run check:python` script
- `.dockerignore` reduces build context from ~313 MB to ~60 MB
- Secure cron endpoint `POST /api/cron/scan` (rate-limit exempt, secret-gated, `CRON_SECRET` env var)
- MANIFEST.json horizon threading into the cron route for ML prediction parameters
- **Google Cloud Run & Cloud Scheduler Automation** — Secure hourly cron trigger endpoint for full radar scan, data collection, and ML predictions cycle. Cloud Scheduler triggers via OIDC or shared `x-cron-secret`
- **Vertex AI Gemini 3.1 Pro Integration** (`src/analysis/gemini.ts`) — Generates professional market reasoning for ML predictions using recent klines, prices, and signals, stored in the `reasoning` field
- **Asynchronous BigQuery Store** (`src/store/db.ts`) — Core Data Layer refactored to async with BigQuery + in-memory SQLite fallback
- **Automated Deployment Script** (`deploy.sh`) — Full provisioning: Artifact Registry, Cloud Build, Cloud Run deploy, Cloud Scheduler cron
- **Debian-Based Dockerfile** — `node:22-bookworm-slim` with `uv` Python ML venv for drift detection

**Changed:**
- ML model paths (`resolveActiveModel`, `resolveModelPath`, `resolveNormStatsPath`) all resolve through `config.dataDir` instead of hardcoded paths
- Fastify is now the sole API provider — legacy `src/api/rest.ts` deleted
- Collector script ML model path uses `DATA_DIR/ml/models/` not hardcoded `ml/models/`
- TS-PY contract: feature name header validation (`PredictContractHeader` interface) between `predict.ts` and `predict.py`
- Alert failures: `.catch(() => {})` replaced with `logger.error` in alert delivery and webhook loading
- Stale `./prices` export removed from `package.json` — exports are now `.`, `./news`, `./signals`

**Fixed:**
- Package.json exports cleanup — removed dead `./prices` entry

### [2.5.0] — 2026-07-18

**Added:**
- Gemini 3.1 Pro reasoning enrichment for ML predictions in cron route
- Additional Solana ecosystem feeds (SolanaFM, Google News DeFi, Crypto Briefing DeFi)

**Fixed:**
- `resolveModelPath` fallback to `model.joblib` if no timestamped models exist

### [2.4.0] — 2026-07-18

**Added:**
- Monthly archive retention — all data files gzipped to `archive/` at month boundaries
- Secondary data directory support — auto-detects `~/.hermes/data/crypto-radar/` as fallback
- Startup info log — resolved dataDir logged at config init
- Collector script DATA_DIR guard — asserts non-empty before directory creation

**Changed:**
- Default data directory from `~/.hermes/data/crypto-radar` to `/data/crypto-radar`
- Env propagation requirement documented for cron tasks

**Fixed:**
- Lock file, state file, PID file paths hardened to `config.dataDir`
- HTML report, CSV export, ML dataset paths hardened to `config.dataDir`
- Duplicate `DEFAULT_DATA_DIR` constant removed from `paper-trade.ts`
- Collector script path hardened (single source of truth)
- ML Python subprocess paths resolved via `import.meta.url`

### [2.3.0] — 2026-07-18

- ML module refactoring: `ml/train.py` split into `indicators.py`, `manifest.py`, `model.py`
- Model registry (MANIFEST.json) with production promotion gates
- Cross-platform timeout (replaced signal.alarm with ThreadPoolExecutor)
- SHAP-per-prediction explainability
- Concept drift detection (ADWIN/PageHinkley/KSWIN) with auto-retrain trigger
- River online learning layer (slow drift catching)
- Calibration monitoring (ECE)
- 6 ML API endpoints

### [2.2.0] — 2026-07-16

- Enterprise Fastify API server (CORS, JWT, rate-limit, compress, Helmet, Swagger)
- Auth API (signup/login/me, bcrypt, Zod v4)
- Paper trading POST API (FIFO matching, P&L)
- Enterprise logger (picocolors, auto-JSON for files)

### [2.1.0] — 2026-07-11

- ML pipeline (LightGBM → CatBoost, features, labels, dataset, predict)
- Store schema v2 (snapshot+history split, predictions table)
- Auto-retrain daemon
- Scale-boundary fixes (F1–F6)
- Test coverage increased to 1222 tests

### [2.0.0] — 2026-07-04

- 49 tracked tokens, 31 chains
- 13 new technical indicators (26 total)
- Fuzz testing suite (157 edge-case tests)
- SVG charts overhaul
- Divergence detection + ADX trend-strength filter
- RSS parser upgrade (rss-parser)
- Cron automation script
- Enterprise marketplace polish

### [2.0.1] — 2026-07-06

- Auto-save .txt output captures TABLE format
- Auto-save .xlsx real binary data
- Collector script cleanup

### [1.4.0] — 2026-07-04

- Enterprise marketplace polish (plugin.yaml, typedoc, env.example)
- TypeScript configuration audit
- Marketplace publication preparation

### [1.3.0] — 2026-07-03

- 5 new technical indicators (Stochastic, Ichimoku, Williams %R, CMF, TSI)
- DeFiLlama on-chain metrics (TVL, fees)
- Dynamic top-50 volume scan
- Strategy weight config overrides
- On-chain CLI flag + env var
- SVG charts overhaul (gradients, viewBox, a11y)
- ESLint configuration

### [1.2.0] — 2026-07-02

- Circuit breaker (CLOSED/OPEN/HALF-OPEN)
- Parallel kline fetching (batches of 5)
- Atomic file writes (tmp + rename)
- Log rotation (10MB, gzip, 5 archives)
- Multi-timeframe analysis (15m/1h/4h/1d)
- Cross-timeframe strategy aggregation
- 7 new tokens (SUI, APT, SEI, TIA, INJ, RUNE, ATOM)
- 155-test suite + coverage gate

### [1.1.0] — 2026-07-02

- XLSX export via exceljs
- CoinGecko API module (fallback prices)
- GitHub Actions CI pipeline
- Vitest test suite (58 tests)
- Kline caching (eliminated double-fetch)
- Bug fixes (SOURCE_TIERS, news domain, CSV multi-line)

### [1.0.0] — 2026-07-02

- Initial release: 32 tokens, Binance 24hr ticker, 7 technical indicators
- Composite signal engine (3 strategies)
- RSS news (9 feeds), CSV/MD/JSON output
- CLI-first design

---

## 10. GCP Reference Documentation

Detailed reference guides for each GCP service used in the production deployment are maintained in `docs/references/`:

| Service | Reference Doc | Free Tier |
|---------|--------------|-----------|
| **BigQuery** | [`docs/references/bigquery.md`](docs/references/bigquery.md) | 10 GB storage, 1 TiB queries/month |
| **Cloud Run** | [`docs/references/cloud-run.md`](docs/references/cloud-run.md) | 240K vCPU-seconds, 450K GiB-seconds/month |
| **Cloud Storage** | [`docs/references/cloud-storage.md`](docs/references/cloud-storage.md) | 5 GB storage, 50K ops/month |
| **Vertex AI** | [`docs/references/vertex-ai.md`](docs/references/vertex-ai.md) | $300 credits + Gemini API free tier |
| **Cloud Scheduler** | [`docs/references/cloud-scheduler.md`](docs/references/cloud-scheduler.md) | 3 jobs free/month |
| **Artifact Registry** | [`docs/references/artifact-registry.md`](docs/references/artifact-registry.md) | 500 MB storage/month |

All Crypto Radar GCP services operate within free tier limits. The $300 Vertex AI credits are reserved for Gemini 3.1 Pro reasoning calls and optional ML experimentation.
