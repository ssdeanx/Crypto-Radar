# Product Definition: Crypto Radar

## Product Vision
Crypto Radar is an enterprise-grade multi-chain crypto market intelligence system and standalone CLI/daemon. The system collects, computes, persists, and serves real-time and historical market data, technical indicators, and machine learning predictions. It is currently transitioning to a serverless Google Cloud architecture as detailed in the [Cloud Migration Plan](../docs/cloud-migration-plan.md).

## Target Users
*   **Algorithmic & Quantitative Traders**: Accessing composite buy/sell/neutral signals and raw indicators for automated strategies.
*   **Machine Learning Researchers & Data Scientists**: Leveraging the CatBoost ML pipeline and JSONL data exports for feature engineering and model training.
*   **Developers**: Querying the Fastify REST API for enriched market data and token signals.
*   **Operations Engineers**: Monitoring the ingestion pipeline, database write reliability, and scheduler health.

## Core Features (Current)
1.  **Multi-Chain Ingestion**: Tracking 85 tokens across 35 chains using Binance public APIs, DeFiLlama, and CoinGecko.
2.  **Indicators & Signals**: Computing 28 technical indicators via Python (`ml/indicators.py`) in a single batch and feeding them into a 3-strategy composite engine (Momentum 40%, Mean Reversion 20%, Trend Following 40%) with regime-adaptive weights.
3.  **ML Pipeline**: CatBoost direction classifier with online learning (River), concept drift detection (ADWIN), and production promotion gates.
4.  **Dual-Path LLM Integration**: Production analysis via Vertex AI Gemini 3.1 Pro (`src/analysis/gemini.ts`). Local development and pre-deploy testing via any OpenAI-compatible endpoint (`src/analysis/openai-compatible.ts`) driven by `RADAR__AI_*` environment variables.
5.  **Fastify REST API**: Sub-50ms API endpoints for tickers, signals, news, and health checks.

## Migration Target Features
See [Cloud Migration Plan](../docs/cloud-migration-plan.md) for the complete serverless architecture, prediction feedback loop, Pub/Sub messaging, Cloud Tasks fan-out, and infrastructure-as-code specifications.

## Security Posture
*   Cron endpoint uses `timingSafeEqual` constant-time header comparison.
*   CORS configuration is env-driven (`CORS_ORIGIN`).
*   See [Migration Plan §9](../docs/cloud-migration-plan.md) for Secret Manager integration and secret rotation procedures.
