---
name: crypto-radar
description: "🛰️ Enterprise-grade multi-chain crypto market intelligence for Hermes Agent — tracks 49 tokens across 31 chains with 26 technical indicators, divergence detection, ADX trend filter, RSS news aggregation from 11 feeds, DeFiLlama on-chain metrics, WebSocket real-time prices, warm daemon for sub-50ms tool calls, SVG candlestick/dashboard charts, and XLSX/CSV/JSON/MD/HTML export. 8 full-spectrum agent tools for token scanning, signal generation, news analysis, chart rendering, daemon management, on-chain queries, and real-time price streams."
context: This is an enterprise-grade multi-chain crypto market intelligence plugin for Hermes Agent, providing comprehensive tools for token scanning, signal generation, news analysis, chart rendering, daemon management, on-chain queries, and real-time price streams. It tracks 49 tokens across 31 chains with 26 technical indicators, divergence detection, ADX trend filter, RSS news aggregation from 11 feeds, DeFiLlama on-chain metrics, WebSocket real-time prices, warm daemon for sub-50ms tool calls, SVG candlestick/dashboard charts, and XLSX/CSV/JSON/MD/HTML export.
argument-hint: crypto-radar <tool> [options]
metadata: 
  keywords: [crypto, trading, binance, defi, signals, technical-analysis, hermes-plugin, market-intelligence, enterprise]
  name: Hermes Crypto Radar
  author: Sam
  version: 2.3.0
user-invocable: true
compatibility:
  hermes: ">=0.1.0"
  node: ">=22.0.0"
  uv: ">=0.0.0"
disable-model-invocation: false
---

# 🛰️ Hermes Crypto Radar

**Enterprise-grade multi-chain crypto market intelligence — Hermes Agent plugin**

---

## ✨ Features

```
📊  49 tokens  ·  31 chains  ·  26 technical indicators
🧠  3-strategy signal engine with divergence detection + ADX trend filter
🤖  CatBoost ML direction classifier with SHAP explanations + ensemble voting
📰  11 RSS news feeds with relevance scoring + sentiment analysis
⛓️  DeFiLlama on-chain metrics (protocol TVL, chain TVL, DEX fees)
📈  SVG candlestick/dashboard charts with shared-svg.ts rendering engine
💾  XLSX/CSV/JSON/MD/HTML export with frozen headers + conditional formatting
🥇  Warm daemon for sub-50ms tool calls with TCP keep-alive
🔄  Concept drift detection with auto-retrain trigger (ADWIN/PageHinkley/KSWIN)
⚡  River online learning layer for real-time model updates
🔬  Backtesting engine, correlation matrix, candlestick pattern recognition
🛡️  Circuit breaker, rate limiter, log rotation, SHA-256 checksums
🔌  8 full-spectrum agent tools + ML API returning structured JSON for agent reasoning
```

## 🛠️ Tools (8 agent tools)

| Tool | Description |
|------|-------------|
| `crypto_radar_scan` | 🛰️ Full market scan — auto-dynamic top-30 tokens by volume, 26 indicators, on-chain metrics |
| `crypto_radar_signals` | 🚀 Composite trading signals from 3-strategy engine + divergence + ADX filter |
| `crypto_radar_news` | 📰 11 RSS feeds with relevance scoring, sentiment, dedup, poison filtering |
| `crypto_radar_tokens` | 📋 Query by chain, symbol, or ID — 49 tokens across 31 chains |
| `crypto_radar_chart` | 📊 SVG candlestick/line/multi-panel dashboard with responsive viewBox |
| `crypto_radar_daemon` | ⚙️ Start/stop/status warm daemon (<50ms cached responses) |
| `crypto_radar_onchain` | ⛓️ DeFiLlama protocol TVL, chain TVL, DEX fees |
| `crypto_radar_ws` | 🔌 Real-time WebSocket price streams on port 9878 |

---

## 📦 Installation

### ML Pipeline Architecture

```mermaid
flowchart TB
    subgraph Data["Data Layer"]
        A[Klines<br/>Binance] --> B[Feature Engineering<br/>80+ features]
        C[26 Indicators<br/>+ 12 TA indicators] --> B
        D[Cross-Asset<br/>Funding Rate<br/>Order Book] --> B
        E[Forward Returns] --> F[Label Generation<br/>Volatility-adjusted]
        F --> G[Dataset Assembly<br/>Z-score normalization]
        B --> G
    end

    subgraph Train["Training Pipeline"]
        G --> H[Feature Selection<br/>SelectKBest MI]
        H --> I[Correlation Filter<br/>>0.98 dropped]
        I --> J[CatBoost Training<br/>GPU auto-detect]
        J --> K[Optuna HPO<br/>TPE sampler]
        J --> L[purgedcv CV<br/>Purge + embargo]
        K --> M[Ensemble Voting<br/>N seeds → soft vote]
        L --> M
        M --> N[Calibration<br/>Isotonic Regression]
        N --> O[SHAP Analysis<br/>Per-feature importance]
        O --> P[MANIFEST.json<br/>Model registry]
    end

    subgraph Infer["Inference Pipeline"]
        Q[Latest Klines] --> R[buildFeatures]
        R --> S[Z-score Normalize]
        S --> T{--explain?}
        T -->|Yes| U[SHAP Explainer]
        T -->|No| V[CatBoost Predict]
        U --> V
        V --> W[Prediction Result<br/>direction, confidence, explanation]
    end

    subgraph Online["Online Learning"]
        W --> X[SQLite predictions]
        X --> Y[River LogisticRegression<br/>AdaptiveStandardScaler]
        Y --> Z[Streaming Accuracy<br/>partial_fit / metrics]
    end

    subgraph Drift["Drift Detection"]
        X --> AA[ADWIN / PageHinkley / KSWIN]
        AA --> AB[Drift Events<br/>SQLite drift_events]
        AB --> AC{Auto-Retrain?}
        AC -->|Drift + 1h cooldown| H
        X --> AD[Calibration Monitor<br/>ECE per bucket]
    end

    subgraph API["API & CLI"]
        P --> AE[GET /api/ml/status]
        P --> AF[GET /api/ml/models]
        AB --> AG[GET /api/ml/drift]
        X --> AH[GET /api/ml/predictions]
        AD --> AI[GET /api/ml/calibration]
        Z --> AJ[GET /api/ml/online]
        AK[CLI: ml train|predict|status|drift] --> Train
        AK --> Infer
        AK --> Drift
    end
```

### Linux / macOS (one-liner)

### Linux / macOS (one-liner)
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ssdeanx/Hermes-Crypto-Radar/main/scripts/install.sh)
```

### Windows (PowerShell)
```powershell
powershell -c "irm https://raw.githubusercontent.com/ssdeanx/Hermes-Crypto-Radar/main/scripts/install.ps1 | iex"
```

### Manual Hermes Agent install
```bash
git clone https://github.com/ssdeanx/Hermes-Crypto-Radar.git
cd Hermes-Crypto-Radar
npm install && npm run build
ln -sf "$PWD" ~/.hermes/plugins/crypto-radar
```

### Via npm (standalone CLI)
```bash
npm install -g hermes-crypto-radar
crypto-radar scan
```

---

## ⏰ Cron Automation

The plugin ships with a production-ready collector script:

```bash
# Every 2 hours — zero token cost (no_agent=true)
bash scripts/crypto-radar-collector.sh

# Or manually:
node dist/cli.js scan --dynamic 30 --onchain --no-news --format json --quiet
```

For Hermes cron:
```bash
hermes cron create "0 */2 * * *" \
  --script crypto-radar-collector.sh \
  --no-agent \
  --workdir /path/to/hermes-crypto-radar
```

---

## 📋 CLI Commands

```bash
crypto-radar scan          # Full market scan (auto-dynamic)
crypto-radar signals       # Composite trading signals
crypto-radar news          # RSS news aggregation
crypto-radar tokens        # List tracked tokens
crypto-radar chart SOL     # SVG candlestick chart
crypto-radar daemon        # Warm daemon management
crypto-radar onchain       # DeFiLlama metrics
crypto-radar health        # System health check
crypto-radar backtest      # Strategy backtesting
crypto-radar search        # Token search
crypto-radar benchmark     # Performance benchmark
crypto-radar export        # XLSX/CSV/JSON export
crypto-radar ml train      # Train CatBoost direction classifier
crypto-radar ml predict    # Run inference with optional SHAP explanations
crypto-radar ml status     # Pipeline health, active model, drift events
crypto-radar ml drift      # Detect concept drift (ADWIN/PageHinkley/KSWIN)
```

---

## ⚙️ Configuration

Edit `radar.config.json` or use `RADAR__*` environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RADAR__DATA_DIR` | `~/.hermes/data/crypto-radar` | Data/log directory |
| `RADAR__DAEMON_PORT` | `9877` | Daemon HTTP port |
| `RADAR__WS_PORT` | `9878` | WebSocket stream port |
| `RADAR__LOG_LEVEL` | `info` | Log level (trace/debug/info/warn/error) |
| `RADAR__CACHE_TTL_MS` | `300000` | Cache TTL in ms |
| `RADAR__LOG_RETENTION_DAYS` | `30` | Auto-prune logs after N days |
| `RADAR__WEBHOOK_URL` | — | Discord/Telegram webhook URL |
| `RADAR__STRATEGY_WEIGHTS` | — | JSON strategy weight overrides |
| `RADAR__TIMEFRAME_WEIGHTS` | — | JSON timeframe weight overrides |

---

## 📄 Included Files

```
hermes-crypto-radar-2.0.0.tar.gz
├── dist/                     # Compiled TypeScript
├── plugin/                   # Python Hermes bridge
├── plugin.yaml               # Plugin metadata
├── package.json              # npm package
├── README.md                 # Full documentation
├── CHANGELOG.md              # Release history
├── SPEC.md                   # Architecture & design
├── LICENSE                   # MIT license
├── SECURITY.md               # Vulnerability disclosure
├── main-banner.png           # Project banner image
└── scripts/
    ├── install.sh            # Linux/macOS one-liner installer
    ├── install.ps1           # Windows PowerShell installer
    └── crypto-radar-collector.sh  # Cron automation script
```

---

## 📃 License

MIT © Sam
