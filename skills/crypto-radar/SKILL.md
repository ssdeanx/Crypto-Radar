---
name: crypto-radar
description: Use when querying multi-chain crypto market intelligence, calculating 28 technical indicators across 149 tokens and 50+ chains, generating 4-strategy composite trading signals, performing institutional quantitative portfolio optimization (Markowitz, Spectral PCA, Markov regimes, polynomial S/R curvature, fractional Kelly sizing), executing paper trading simulations, training ML models, evaluating LLM intelligence with Promptfoo, deploying to Google Cloud Run, configuring Cloud Scheduler cron jobs, managing BigQuery datasets, or integrating the backend with separate frontend dashboards.
context: Enterprise-grade multi-chain crypto intelligence, quantitative analytics, and algorithmic signal engine deployed on Google Cloud Run with BigQuery, Vertex AI, and Cloud Scheduler.
argument-hint: crypto-radar <tool> [options]
metadata: 
  keywords: [crypto, trading, binance, defi, signals, technical-analysis, market-intelligence, enterprise, mathjs, portfolio-optimization, quantitative, promptfoo, paper-trading, fastify, cloud-run, bigquery, gcp, cloud-scheduler, vertex-ai]
  name: Crypto-Radar
  author: ssdeanx
  version: 2.10.0
user-invocable: true
license: MIT
compatibility:
  hermes: ">=0.1.0"
  node: ">=22.0.0"
  uv: ">=0.0.0"
disable-model-invocation: false
---

# 🛰️ Crypto-Radar Agent Skill & Production Reference

> **Enterprise-grade multi-chain crypto market intelligence, quantitative analytics, and algorithmic trading signal engine deployed on Google Cloud Run with BigQuery, GCS, Cloud Scheduler, and Vertex AI.**

---

## 📚 Complete Technical Reference Library (`docs/references/`)

All architecture designs, REST API schemas, mathematical proofs, cloud infrastructure configurations, and frontend synchronization guides are documented in the [`docs/references/`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references) directory:

### 1. API, Frontend & Engine Specifications
| Reference Document | Direct Link | Scope & Content |
| :--- | :--- | :--- |
| **[REST API Reference](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/api-reference.md)** | [`docs/references/api-reference.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/api-reference.md) | Complete Fastify REST routes (`/api/tickers`, `/api/signals`, `/api/klines/:symbol`, `/api/indicators/:symbol`, `/api/paper/*`, `/api/ml/*`, `/api/cron/*`), Swagger schemas, and query parameters. |
| **[Frontend Integration Guide](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/frontend-integration.md)** | [`docs/references/frontend-integration.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/frontend-integration.md) | Frontend architecture for React/Vite/Next.js dashboards, TanStack Query polling hooks, paper order mutations, and UI blueprints. |
| **[Quantitative Math Engine](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/math-engine.md)** | [`docs/references/math-engine.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/math-engine.md) | Markowitz Sharpe maximization, Duchi simplex projection, Spectral PCA eigendecomposition, Markov regime transition matrix, Vandermonde polynomial curve fitting, and BigNumber compounding. |
| **[Machine Learning Pipeline](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/ml-pipeline.md)** | [`docs/references/ml-pipeline.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/ml-pipeline.md) | CatBoost & LightGBM batch training, Purged K-Fold CV, River streaming online updates, Optuna hyperparameter optimization, and ADWIN/Page-Hinkley drift detection. |
| **[Strategy & Signal Engine](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/signal-engine.md)** | [`docs/references/signal-engine.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/signal-engine.md) | 4-strategy composite scoring (Momentum, Mean Reversion, Trend Following, Divergence), multi-timeframe weighted voting (15m, 1h, 4h, 1d), candlestick pattern recognition, and ATR risk bounds. |
| **[Paper Trading & Telemetry](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/paper-trading.md)** | [`docs/references/paper-trading.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/paper-trading.md) | Account simulation, fractional Kelly sizing, slippage & fee mechanics, agent performance scorecards (Brier score, Sharpe, Sortino, MFE/MAE), and JSONL dataset export. |
| **[Promptfoo AI Evals](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/promptfoo-evals.md)** | [`docs/references/promptfoo-evals.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/promptfoo-evals.md) | Promptfoo benchmark test matrix, custom TypeScript LLM provider, assertion checks, latency constraints, and Autoevals factuality scoring. |

### 2. Google Cloud Platform (GCP) Production Architecture
| GCP Reference | Direct Link | Scope & Content |
| :--- | :--- | :--- |
| **[Cloud Migration Plan](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/cloud-migration-plan.md)** | [`docs/cloud-migration-plan.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/cloud-migration-plan.md) | End-to-end master migration plan: stateless Cloud Run service, Pub/Sub event fan-out, Cloud Tasks queues, and BigQuery data pipeline. |
| **[Google Cloud Run](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/cloud-run.md)** | [`docs/references/cloud-run.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/cloud-run.md) | Containerized Fastify deployment, autoscaling (0 to N instances), concurrency tuning, VPC connectors, health probes, and pricing analysis. |
| **[Google Cloud Scheduler](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/cloud-scheduler.md)** | [`docs/references/cloud-scheduler.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/cloud-scheduler.md) | Automated cron triggers for market scanning (5m), signals (15m), news ingestion (30m), and daily ML model retraining. |
| **[Google BigQuery](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/bigquery.md)** | [`docs/references/bigquery.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/bigquery.md) | Partitioned tables, streaming ingestion buffer, indicator schemas, and quantitative analytics queries. |
| **[Google Cloud Storage (GCS)](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/cloud-storage.md)** | [`docs/references/cloud-storage.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/cloud-storage.md) | Model artifact registry (`.cbm`, `.txt`), daily kline archives, dataset snapshots, and lifecycle management. |
| **[Google Artifact Registry](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/artifact-registry.md)** | [`docs/references/artifact-registry.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/artifact-registry.md) | Multi-stage Docker image builds, vulnerability scanning, and deployment digest pinning. |
| **[Google Vertex AI](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/vertex-ai.md)** | [`docs/references/vertex-ai.md`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/docs/references/vertex-ai.md) | Custom GPU model training pipelines, hyperparameter tuning jobs, and Model Registry integration. |

---

## 📦 Helper Scripts & Asset Payloads (`skills/crypto-radar/`)

In compliance with the **AgentSkills.io open standard**, the skill package includes runnable utilities and concrete JSON schema assets:

- **Deployment Script**: [`skills/crypto-radar/scripts/deploy-cloud-run.sh`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/skills/crypto-radar/scripts/deploy-cloud-run.sh) (Automates Docker builds, Artifact Registry uploads, and Cloud Run deployments).
- **Sample Tickers Payload**: [`skills/crypto-radar/assets/sample-tickers.json`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/skills/crypto-radar/assets/sample-tickers.json)
- **Sample Signals Payload**: [`skills/crypto-radar/assets/sample-signals.json`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/skills/crypto-radar/assets/sample-signals.json)
- **Sample Portfolio Payload**: [`skills/crypto-radar/assets/sample-portfolio.json`](file:///home/sam/Music/Crypto-Radar-Signals/Crypto-Radar/skills/crypto-radar/assets/sample-portfolio.json)

---

## 🚀 Production Deployment Runbook

### Step 1: Google Cloud Environment & Artifact Registry Setup
```bash
# Set GCP Project and Region
export PROJECT_ID="crypto-radar-prod"
export REGION="us-central1"
gcloud config set project $PROJECT_ID

# Create Artifact Registry Docker repository
gcloud artifacts repositories create crypto-radar \
  --repository-format=docker \
  --location=$REGION \
  --description="Crypto-Radar production Docker images"
```

### Step 2: Build & Push Production Container Image
```bash
# Build container image via Google Cloud Build
gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT_ID/crypto-radar/service:v2.10.0 .
```

### Step 3: Deploy to Google Cloud Run
```bash
gcloud run deploy crypto-radar \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/crypto-radar/service:v2.10.0 \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=2Gi \
  --cpu=2 \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=80 \
  --timeout=300 \
  --set-env-vars="NODE_ENV=production,RADAR_ENV=production,BIGQUERY_DATASET=crypto_radar,GCS_BUCKET=crypto-radar-models" \
  --set-secrets="RADAR_API_KEY=radar-api-key:latest,CRON_SECRET=cron-secret:latest"
```

### Step 4: Configure Automated Cloud Scheduler Cron Jobs
```bash
export SERVICE_URL=$(gcloud run services describe crypto-radar --region=$REGION --format='value(status.url)')

# 1. Market Ingestion & Tickers (Every 5 minutes)
gcloud scheduler jobs create http radar-cron-scan \
  --location=$REGION \
  --schedule="*/5 * * * *" \
  --uri="$SERVICE_URL/api/cron/scan" \
  --http-method=POST \
  --headers="x-api-key=CRON_SECRET" \
  --attempt-deadline=180s

# 2. Strategy Signal Generation (Every 15 minutes)
gcloud scheduler jobs create http radar-cron-signals \
  --location=$REGION \
  --schedule="*/15 * * * *" \
  --uri="$SERVICE_URL/api/cron/signals" \
  --http-method=POST \
  --headers="x-api-key=CRON_SECRET" \
  --attempt-deadline=180s

# 3. News Ingestion & Sentiment Analysis (Every 30 minutes)
gcloud scheduler jobs create http radar-cron-news \
  --location=$REGION \
  --schedule="*/30 * * * *" \
  --uri="$SERVICE_URL/api/cron/news" \
  --http-method=POST \
  --headers="x-api-key=CRON_SECRET" \
  --attempt-deadline=180s

# 4. Daily ML Model Retraining (Daily at midnight UTC)
gcloud scheduler jobs create http radar-cron-retrain \
  --location=$REGION \
  --schedule="0 0 * * *" \
  --uri="$SERVICE_URL/api/cron/retrain" \
  --http-method=POST \
  --headers="x-api-key=CRON_SECRET" \
  --attempt-deadline=600s
```

### Step 5: Initialize BigQuery Storage Tables
```bash
# Create BigQuery Dataset
bq mk --location=$REGION --dataset $PROJECT_ID:crypto_radar

# Tables are auto-partitioned by timestamp in src/store/bigquery.ts:
# - crypto_radar.tickers (partitioned by DATE(timestamp))
# - crypto_radar.signals (partitioned by DATE(timestamp))
# - crypto_radar.news (partitioned by DATE(published_at))
# - crypto_radar.paper_trades (partitioned by DATE(created_at))
```

---

## 🛠️ Invocable Agent Tools

| Tool | CLI Command | Description |
| :--- | :--- | :--- |
| `crypto_radar_scan` | `crypto-radar scan [options]` | Full market scan — tracks 149 tokens across 50+ chains, 28 indicators, on-chain metrics. |
| `crypto_radar_signals` | `crypto-radar signals [options]` | Composite trading signals from 4-strategy engine + divergence + ADX trend filter + Kelly sizing. |
| `crypto_radar_news` | `crypto-radar news [options]` | Aggregated crypto news from 28 RSS feeds with sentiment analysis and relevance scoring. |
| `crypto_radar_tokens` | `crypto-radar tokens [options]` | Token registry query by symbol, name, chain, or contract address. |
| `crypto_radar_chart` | `crypto-radar chart <symbol>` | Generates interactive SVG candlestick/indicator dashboard charts. |
| `crypto_radar_daemon` | `crypto-radar daemon <start\|stop\|status>` | Manages the high-speed warm background daemon (<50ms response latency). |
| `crypto_radar_onchain` | `crypto-radar onchain [options]` | Queries DeFiLlama protocol TVL, chain TVL, and DEX volume fees. |

---

## 🚀 Core Agent Workflows

### 1. Market Scanning & Indicator Computation
```bash
# Scan focus tokens across all timeframes (15m, 1h, 4h, 1d)
crypto-radar scan --filter SOL BTC ETH AVAX --format table

# Full market scan with JSON output
crypto-radar scan --limit 20 --format json
```

### 2. Quantitative Portfolio Optimization (MathJS)
```typescript
import { computeOptimalPortfolio, computeEigenportfolios } from 'crypto-radar/math';

// 1. Mean-Variance Maximum Sharpe Tangency Portfolio
const allocation = computeOptimalPortfolio(expectedReturns, covarianceMatrix, 0.0);
console.log('Optimal asset weights:', allocation.weights);

// 2. Spectral Market Factor Decomposition
const spectral = computeEigenportfolios(covarianceMatrix);
console.log('Market Beta Factor:', spectral[0].weights);
```

### 3. Paper Trading Simulation & ML Dataset Export
```bash
# Execute simulated paper trade
crypto-radar paper buy --symbol SOL --amount 10 --reason "Bullish breakout above resistance"

# Export paper trading telemetry dataset for machine learning
crypto-radar paper export --format jsonl --output data/paper_trades.jsonl

# Train supervised paper agent model
npm run ml:train-paper-agent
```

### 4. Promptfoo Benchmark & AI Evaluation Matrix
```bash
# Run Promptfoo benchmark suite
npm run eval:prompts

# Open evaluation dashboard in browser
npm run eval:view
```
