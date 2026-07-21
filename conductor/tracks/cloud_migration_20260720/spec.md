# Specification: End-to-End Cloud Migration & Prediction Pipeline

## 1. Overview
This track implements the full transition of the Crypto Radar backend to a stateless, event-driven architecture on Google Cloud Run. It establishes a Fastify server entrypoint, guards local file-system operations, decouples asynchronous processes using Pub/Sub and Cloud Tasks, abstracts LLM providers (supporting local OpenAI-compatible and production Vertex AI Gemini models), establishes the trace-prediction-outcome database loops, and sets up batch evaluation and prompt A/B testing queries.

## 2. Functional Requirements

### Phase 0: Stateless Foundation
- **Server Entrypoint (`src/server.ts`)**: Fastify web server listening on `process.env.PORT || 8080`. No daemon background intervals, PID files, or WebSocket hubs.
- **Cloud-Mode Guard**: Implement `isCloudMode()` checking `K_SERVICE` or `GOOGLE_APPLICATION_CREDENTIALS`. Guard CSV log appends, lock files, and daemon processes.
- **Dockerfile & deploy.sh**: Overwrite with a clean multi-stage `node:22-alpine` build (EXPOSE 8080) and secure secret-manager binding (`--update-secrets`), removing hardcoded secrets and unauthenticated access flags.

### Phase 1: Messaging Decoupling & Queue Fallback
- **Pub/Sub Publishing**: Install `@google-cloud/pubsub` and publish a `scan.complete` event from `Store.persistRun()` after BigQuery/SQLite inserts. Payload: `{ type: "scan.complete", runId, tsUtc, tokenCount, tickerSymbols, tickerIds, ... }`.
- **Cloud Tasks Handlers**: Create routes/handlers for:
  - `POST /api/tasks/gemini-analyze` (LLM processing)
  - `POST /api/tasks/paper-trade` (simulation trades)
  - `POST /api/tasks/model-retrain` (daily model updates)
- **Local Queue Fallback (`src/core/queue.ts`)**: Implement an in-memory queue matching the Cloud Tasks interface running tasks via `setImmediate` when not in Cloud Run.
- **Infrastructure Definitions (`infra/main.tf`)**: Define Pub/Sub topic and Cloud Tasks queues.

### Phase 2: Gemini / LLM Integration
- **LLM Provider Router (`src/core/llm-provider.ts`)**: Single wrapper function `analyzeToken(symbol, traceData)` routing calls based on `RADAR__AI_ENV` (explicit DEV vs PROD switcher):
  - Route to `openai-compatible.ts` (Ollama/Mock endpoints) in `DEV` mode (or if `RADAR__AI_BASE_URL` is set).
  - Route to Vertex AI Gemini (`gemini.ts`) in `PROD` mode.
- **Parsing**: Extract `prediction_direction` (BULLISH/BEARISH/NEUTRAL) and `prediction_confidence` (0-1) from the LLM outputs.
- **BigQuery Setup**: Documentation and SQL templates for setting up BQ Vertex AI Connection and Remote Model (`crypto_radar.gemini_pro` calling `gemini-3.1-pro`).

### Phase 3: Trace → Prediction → Outcome Loop
- **`token_traces` Database Table**: Create the `token_traces` table in SQLite (`src/store/schema.ts`) and BigQuery (`src/store/db.ts`).
  - Schema: PK `trace_id`, `run_id`, `symbol`, `token_id`, `observed_at`, `outcome_at`, trace metrics (prices, volume, indicators), prediction columns (analysis_text, direction, confidence, analyzed_at), and outcome metrics (outcome_change_pct, pnl, classification, outcome_evaluated_at).
- **Wiring Data Pipeline**:
  - Insert raw trace records in `Store.persistRun()`.
  - Update prediction columns upon LLM task completion.
  - Scheduled query/endpoint to query past prices after 24h and backfill outcomes.
- **AI Paper-Trading Advisor Endpoint (`POST /api/portfolio/chat`)**: Integrated a Socratic portfolio bot under `/api/portfolio/chat` that analyzes user performance and automatically executes simulated trades on command.
- **Refined News Collector Matching (`src/news.ts`)**: Relaxed the poison filters to allow normal market keywords (e.g. *price*, *trading*) to process.

### Phase 4: Batch Evaluation & Prompt A/B Testing
- **Evaluation SQL Queries (`infra/evaluation-queries.sql`)**: Include queries for win rates, average returns, and confusion matrix comparing prediction direction vs actual 24h outcomes.
- **A/B Testing Pattern**: SQL templates testing different remote models (`gemini_pro_v1`, `gemini_pro_v2`) side-by-side.

## 3. Non-Functional Requirements
- **Test-Driven Development**: Every new module or refactored logic must start with failing unit or integration tests.
- **Type Safety**: Strictly typed TypeScript data rows.
- **Validation**: Pass `npm run validate` (build, lint, python checks, and vitest test suites).
- **Changelog**: Add detailed entry under version v2.1.0 in `CHANGELOG.md`.

## 4. Acceptance Criteria
- `npm run validate` completes successfully.
- Web server boots on port 8080 and handles health/ticker/task requests.
- All SQLite and BigQuery database updates (including the new `token_traces` table and prediction columns) run cleanly.
- Integration tests confirm local queue routing and local mock OpenAI-compatible LLM analysis runs without exceptions.
- **Deploy Lock**: No `gcloud` deployment commands are to be executed in the terminal until local testing and verification are fully production-ready.
