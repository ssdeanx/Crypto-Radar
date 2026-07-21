# Cloud Migration Plan: Crypto Radar Backend

**Target Architecture:** REST API + Pub/Sub + Cloud Tasks on Google Cloud Run  
**Status:** Plan (ready for next session)  
**Last Updated:** 2026-07-20  

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 0: Stateless Foundation](#2-phase-0-stateless-foundation)
3. [Phase 1: Messaging Decoupling](#3-phase-1-messaging-decoupling)
4. [Phase 2: Gemini / LLM Integration](#4-phase-2-gemini--llm-integration)
5. [Phase 3: Trace → Prediction → Outcome Loop](#5-phase-3-trace--prediction--outcome-loop)
6. [Phase 4: Batch Evaluation & Prompt A/B Testing](#6-phase-4-batch-evaluation--prompt-ab-testing)
7. [Implementation Sequencing & Dependencies](#7-implementation-sequencing--dependencies)
8. [Local Development Strategy](#8-local-development-strategy)
9. [Security & Secrets](#9-security--secrets)
10. [Cost Analysis (Free Tier Fit)](#10-cost-analysis-free-tier-fit)
11. [Risks & Mitigations](#11-risks--mitigations)

---

## 1. Architecture Overview

### 1.1 High-Level Data Flow

```
Cloud Scheduler (0 * * * *)  ──POST /api/cron/scan──►  Cloud Run (stateless)
                                                              │
                                                    Store.persistRun()
                                                        2 writes:
                                                    ├── BigQuery (raw tickers, signals, news)
                                                    └── Pub/Sub topic "crypto-radar-events"
                                                              │
                                                          (fan-out)
                                              ┌───────────────┼───────────────┐
                                              ▼               ▼               ▼
                                       Cloud Task     Cloud Task      Cloud Task
                                       Queue A        Queue B         Queue C
                                       gemini-        paper-trade     model-retrain
                                       analysis       simulation      (daily)
                                              │               │               │
                                              ▼               ▼               ▼
                                          BigQuery        BigQuery        BigQuery
                                      (token_traces)   (paper_trades)  (ML models)
```

### 1.2 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Event granularity | Per-scan (start) → per-token (future) | Per-scan minimizes Pub/Sub ops initially; per-token enables independent retry as volume grows |
| LLM integration | Dual path: OpenCode local, Gemini 3.1 Pro production | `.env`-driven via `RADAR__AI_*` vars; code routes to OpenAI-compatible endpoint or Vertex AI |
| Local storage | None in production — BigQuery only | Cloud Run has no persistent filesystem |
| Port | `process.env.PORT \|\| 8080` | Cloud Run convention |
| WS in production | Removed | REST + Pub/Sub replaces all WS patterns |

### 1.3 File Layout Summary

| What | Path | Action |
|------|------|--------|
| Stateless server entrypoint | `src/server.ts` | Create |
| LLM provider abstraction | `src/core/llm-provider.ts` | Create |
| Cloud Tasks handlers | `src/handlers/gemini-analyze.ts`, `src/handlers/paper-trade.ts`, `src/handlers/model-retrain.ts` | Create |
| Local queue fallback | `src/core/queue.ts` | Create |
| Terraform configs | `infra/main.tf` | Create |
| Dockerfile | `Dockerfile` | Overwrite |
| Deploy script | `deploy.sh` | Overwrite |
| Env example | `.env.example` | Already updated |
| BigQuery field mapping fix | `src/store/db.ts` near line 470-471 | Patch |
| Cloud-mode guard | `src/core/config.ts` + `src/radar.ts` + `src/daemon.ts` | Patch |
| Pub/Sub publish | `src/store/db.ts` after BQ insert | Patch |
| BQ Remote Model setup | Run via `gcloud` + console | One-time |
| token_traces table | Run via `bq query` or console | One-time |

---

## 2. Phase 0: Stateless Foundation

### 2.1 Create stateless server entrypoint
- **File:** `src/server.ts` (new)
- **What:** Fastify server on `process.env.PORT \|\| 8080`. No daemon state, no PID file, no WebSocket hub, no cache refresh timer. Calls `createApp()` from `src/api/fastify/app.ts`, opens Store, calls migrate, then `listen()`.
- **Depends on:** Nothing

### 2.2 Fix Dockerfile
- **File:** `Dockerfile` (overwrite)
- **What:** Multi-stage `node:22-alpine` build. Runtime stage has only `dist/`, `node_modules/`, `package.json`. `EXPOSE 8080`. `CMD ["node", "dist/server.js"]`. No Python, git, build-essential, or uv in server image. ML inference runs as a separate container or via Cloud Tasks.
- **Depends on:** 2.1

### 2.3 Fix deploy.sh
- **File:** `deploy.sh` (overwrite)
- **What:** Remove hardcoded `CRON_SECRET`. Remove `--allow-unauthenticated`. Use `gcloud run deploy --update-secrets` to mount secrets from Secret Manager. Add `--no-cpu-throttling` for background task containers. Add `--min-instances=0`.
- **Depends on:** 2.2

### 2.4 Add cloud-mode guard
- **File:** `src/core/config.ts` — add `isCloudMode()` function
- **What:** Returns `true` when `process.env.K_SERVICE` or `GOOGLE_APPLICATION_CREDENTIALS` is set. A single source of truth for "we're on Cloud Run."
- **Depends on:** Nothing

### 2.5 Guard filesystem writes in radar.ts
- **File:** `src/radar.ts` — patch `appendToLog()`, `acquireLock()`, `releaseLock()`, `saveState()`, `loadState()`
- **What:** When `isCloudMode()` returns true, these become no-ops. The scan result is already persisted to BigQuery via `Store.persistRun()`. The file writes are for local/CLI-only.
- **Depends on:** 2.4

### 2.6 Guard filesystem writes in daemon.ts
- **File:** `src/daemon.ts` — patch `writePid()`, `removePid()`, and the WS hub creation at the `createWsHub` call site
- **What:** In cloud mode, skip PID files, skip WS hub attachment. The daemon entrypoint itself won't run in production (server.ts is the entrypoint), but guarding prevents issues if someone calls it.
- **Depends on:** 2.4

### 2.7 Fix BigQuery field mapping bug
- **File:** `src/store/db.ts` near lines 470-471
- **What:** `persistRun()` maps `s.technicalScore → mean_reversion_score` and `s.newsScore → trend_following_score` for BigQuery `signal_history`. This writes wrong values. Fix both mappings to use the correct strategy breakdown fields from the `AggregatedSignal` or `TokenSignal` type.
- **Depends on:** Nothing (can be done independently)

### 2.8 Deploy and verify
- **What:** `gcloud run deploy`, verify `GET /health` returns 200, verify `/api/tickers` returns data. (Full functional test.)
- **Depends on:** 2.1-2.7

---

## 3. Phase 1: Messaging Decoupling

### 3.1 Install Pub/Sub dependency
- **File:** `package.json` — add `@google-cloud/pubsub`
- **What:** `npm install @google-cloud/pubsub`
- **Depends on:** Nothing

### 3.2 Publish scan.complete from Store.persistRun()
- **File:** `src/store/db.ts` — patch after the BigQuery insert block
- **What:** After all `table.insert()` calls succeed, publish a JSON message to the `crypto-radar-events` Pub/Sub topic. Message payload: `{ type: "scan.complete", runId, tsUtc, tokenCount, tickerSymbols, tickerIds, signalCount }`. Wrap in try/catch — publish failure does not fail the scan.
- **Depends on:** 3.1, 2.4

### 3.3 Create Pub/Sub topic via Terraform
- **File:** `infra/main.tf` (new)
- **What:** `google_pubsub_topic "crypto-radar-events"` resource.
- **Depends on:** Nothing

### 3.4 Create Cloud Tasks queues via Terraform
- **File:** `infra/main.tf` (new resources)
- **What:** Three queues:
  - `crypto-radar-gemini-analysis`: max 1 concurrent, 1/sec dispatch, 3 retry attempts, 5s-60s backoff
  - `crypto-radar-paper-trade`: max 5 concurrent, 10/sec dispatch
  - `crypto-radar-model-retrain`: max 1 concurrent, scheduled daily
- **Depends on:** Nothing

### 3.5 Create Gemini analysis Cloud Task handler
- **File:** `src/handlers/gemini-analyze.ts` (new)
- **What:** Consumes `scan.complete` events. For each token in the scan, enqueues an LLM analysis request via the LLM provider abstraction (see Phase 2). Writes results to `token_traces.analysis_text`.
- **Depends on:** 3.2, 4.1

### 3.6 Create paper trade Cloud Task handler
- **File:** `src/handlers/paper-trade.ts` (new)
- **What:** Consumes scan events, evaluates signals against the PaperTrader, executes simulated trades, writes results to `paper_trades` BigQuery table.
- **Depends on:** 3.2

### 3.7 Create model retrain Cloud Task handler
- **File:** `src/handlers/model-retrain.ts` (new)
- **What:** Scheduled via Cloud Scheduler daily. Spawns Python training subprocess (same as existing `autoRetrain()` in `daemon.ts`), writes model artifact to GCS (not ephemeral filesystem).
- **Depends on:** 3.4

### 3.8 Create local queue fallback
- **File:** `src/core/queue.ts` (new)
- **What:** In-memory queue that mirrors the Cloud Tasks contract. In dev mode (no `K_SERVICE`), runs handlers `setImmediate` instead of dispatching to Cloud Tasks. Registerable handlers per queue name. This enables full local testing without emulators.
- **Depends on:** Nothing

---

## 4. Phase 2: Gemini / LLM Integration

### 4.1 Create LLM provider abstraction
- **File:** `src/core/llm-provider.ts` (new)
- **What:** A single function `analyzeToken(symbol, traceData): Promise<string>` that routes to one of:
  - **OpenAI-compatible endpoint** (when `RADAR__AI_BASE_URL` is set): Uses `fetch()` with the OpenAI chat completions API format. Configurable URL, key, model from env vars.
  - **Vertex AI Gemini 3.1 Pro** (when `RADAR__AI_*` is not set): Uses existing `VertexAI` SDK from `src/analysis/gemini.ts`.
  
  The prompt template lives here. Response parsing extracts `prediction_direction` (BULLISH/BEARISH/NEUTRAL) and `prediction_confidence` (0-1) from the LLM output.

- **Depends on:** Nothing

### 4.2 Refactor existing gemini.ts to use the provider
- **File:** `src/analysis/gemini.ts` — refactor
- **What:** `generateGeminiReasoning()` becomes a thin wrapper around the provider from 4.1. Keeps existing Vertex AI path for compatibility, but falls back to the provider when `RADAR__AI_*` vars are set.
- **Depends on:** 4.1

### 4.3 Create BigQuery Remote Model (one-time)
- **What:** In `gcloud` or BigQuery console:
  1. Create a Cloud Resource Connection to Vertex AI
  2. Create `crypto_radar.gemini_pro` remote model pointing to `gemini-3.1-pro`
  3. Grant the connection service account the Vertex AI user role
- **Files:** Add commands to `infra/README.md` or a new `infra/setup-bq.sh`
- **Depends on:** GCP project with Vertex AI + BigQuery Connection APIs enabled

### 4.4 Integrate ML.GENERATE_TEXT into batch analysis
- **File:** `src/handlers/gemini-analyze.ts` (same as 3.5)
- **What:** The handler runs `SELECT FROM ML.GENERATE_TEXT(MODEL crypto_radar.gemini_pro, ...)` for batch analysis of unanalyzed `token_traces`. Writes `analysis_text` back. This complements the per-token real-time path from 4.1.
- **Depends on:** 4.3

---

## 5. Phase 3: Trace → Prediction → Outcome Loop

### 5.1 Create token_traces table (one-time)
- **What:** Create `crypto_radar.token_traces` with schema:
  - **Identity:** `trace_id STRING` (PK), `run_id`, `symbol`, `token_id`
  - **Timestamps:** `observed_at`, `outcome_at`
  - **Trace columns:** `last_price`, `price_change_pct`, `volume`, `spread_pct`, `market_cap`, `composite_score`, `direction`, `regime`, `rsi`, `macd_histogram`, `bb_width`, `atr_pct`, `adx`
  - **Prediction columns:** `analysis_text`, `prediction_direction`, `prediction_confidence`, `gemini_raw`, `needs_analysis`, `analyzed_at`
  - **Outcome columns:** `outcome_price`, `outcome_change_pct`, `outcome_high`, `outcome_low`, `outcome_volume`, `outcome_is_rugpull`, `outcome_pnl_pct`, `outcome_classification`, `outcome_evaluated`, `outcome_evaluated_at`
  - **Meta:** `created_at`, `updated_at`
  - Partition by `DATE(observed_at)`, cluster by `symbol`
- **File:** Add DDL to `infra/setup-bq.sh`
- **Depends on:** BigQuery dataset `crypto_radar` existing

### 5.2 Wire persistRun() to populate token_traces
- **File:** `src/store/db.ts` — add insert into `token_traces` alongside existing ticker/signal/news inserts in `persistRun()`
- **What:** For each enriched ticker in the scan result, insert a row into `token_traces` with trace data. Prediction and outcome columns stay NULL until filled by later phases.
- **Depends on:** 5.1

### 5.3 Wire LLM analysis to prediction columns
- **File:** `src/handlers/gemini-analyze.ts` / `src/core/llm-provider.ts`
- **What:** After LLM analysis (Phase 2), run `UPDATE token_traces SET analysis_text = ..., prediction_direction = ..., prediction_confidence = ..., needs_analysis = FALSE WHERE trace_id = ...`
- **Depends on:** 5.2, 4.1

### 5.4 Create 24h outcome backfill (scheduled query)
- **What:** Scheduled BigQuery query that runs hourly. Finds `token_traces` rows where `observed_at < NOW() - 24h` and `outcome_evaluated = FALSE`. Queries `ticker_history` for the price at `observed_at + 24h` and writes `outcome_change_pct`, `outcome_classification`.
- **Depends on:** 5.2

---

## 6. Phase 4: Batch Evaluation & Prompt A/B Testing

### 6.1 Create win/loss evaluation queries
- **File:** Add to `infra/evaluation-queries.sql` (new)
- **What:** SQL queries that join `token_traces` predictions against outcomes:
  - Win rate by prediction direction
  - Average return by prediction direction
  - Confusion matrix (predicted vs actual direction)
  - Time-series accuracy trend

### 6.2 Create prompt A/B test pattern
- **File:** Add to `infra/evaluation-queries.sql`
- **What:** SQL pattern using `ML.GENERATE_TEXT` with two different remote models (`gemini_pro_v1`, `gemini_pro_v2`) against the same evaluation set of 1000 historical traces. Compare prediction accuracy side by side.

### 6.3 Add evaluation dashboard
- **What:** Run evaluation queries on a schedule or on demand. Results are written to an `evaluation_results` table that can be queried from a frontend or Hermes command. Not a UI — just a data layer that the results are queryable.

### 6.4 Prompt iteration workflow
- **File:** `src/core/llm-provider.ts` — prompt template
- **What:** Document the workflow:
  1. Copy prompt to new version
  2. Create new BigQuery model pointing to same Gemini
  3. Run A/B test query
  4. If new prompt wins, point `gemini_pro` model to the new prompt
  5. Update `src/core/llm-provider.ts` prompt template to match

---

## 7. Implementation Sequencing & Dependencies

### Track 1: Deploy-Blockers (Day 1)

| Step | Task | Est. Time | Depends On |
|------|------|-----------|------------|
| 0.1 | Create `src/server.ts` | 30 min | Nothing |
| 0.2 | Fix `Dockerfile` | 15 min | 0.1 |
| 0.3 | Fix `deploy.sh` | 30 min | Nothing |
| 0.4 | Add `isCloudMode()` to `src/core/config.ts` | 10 min | Nothing |
| 0.5 | Guard fs writes in `src/radar.ts` | 20 min | 0.4 |
| 0.6 | Guard fs writes and WS in `src/daemon.ts` | 15 min | 0.4 |
| 0.7 | Fix BQ field mapping in `src/store/db.ts` | 5 min | Nothing |
| 0.8 | Deploy to Cloud Run, verify | 30 min | 0.1-0.7 |

### Track 2: Messaging (Day 1-2)

| Step | Task | Est. Time | Depends On |
|------|------|-----------|------------|
| 1.1 | Install `@google-cloud/pubsub` | 2 min | Nothing |
| 1.2 | Publish from `Store.persistRun()` | 20 min | 1.1 |
| 1.3 | Create Terraform for topic + queues | 30 min | Nothing |
| 1.4 | Create `src/handlers/gemini-analyze.ts` | 45 min | 1.2, 4.1 |
| 1.5 | Create `src/handlers/paper-trade.ts` | 45 min | 1.2 |
| 1.6 | Create `src/handlers/model-retrain.ts` | 30 min | 1.3 |
| 1.7 | Create `src/core/queue.ts` (local fallback) | 30 min | Nothing |

### Track 3: LLM Integration (Day 2-3)

| Step | Task | Est. Time | Depends On |
|------|------|-----------|------------|
| 4.1 | Create `src/core/llm-provider.ts` | 45 min | Nothing |
| 4.2 | Refactor `src/analysis/gemini.ts` | 15 min | 4.1 |
| 4.3 | Create BQ Remote Model (one-time CLI) | 10 min | GCP |
| 4.4 | Wire ML.GENERATE_TEXT into handler | 20 min | 4.3, 1.4 |

### Track 4: Feedback Loop (Day 3-4)

| Step | Task | Est. Time | Depends On |
|------|------|-----------|------------|
| 5.1 | Create `token_traces` table | 10 min | BQ dataset exists |
| 5.2 | Wire `persistRun()` to populate traces | 20 min | 5.1 |
| 5.3 | Wire LLM output to prediction columns | 15 min | 5.2, 4.1 |
| 5.4 | Create 24h outcome backfill query | 20 min | 5.2 |
| 6.1 | Create evaluation queries | 20 min | 5.4 |
| 6.2 | Create A/B test pattern | 15 min | 6.1, 4.3 |

### Total Estimated Effort: ~9-11 hours across 4 tracks

---

## 8. Local Development Strategy

### 8.1 LLM Provider Routing
- **File:** `src/core/llm-provider.ts`
- When `RADAR__AI_BASE_URL` is set in `.env`: route to OpenAI-compatible endpoint with your key and model. Zero cost, no cloud dependencies.
- When unset: use Vertex AI Gemini 3.1 Pro (production path).
- The `.env.example` has the vars as commented placeholders — uncomment and fill to enable local testing.

### 8.2 Queue Strategy
- Without emulators: `src/core/queue.ts` runs handlers in-process via `setImmediate`. Enables full data flow testing locally.
- With emulators: `gcloud beta emulators pubsub start` + `gcloud beta emulators tasks start` — set env vars to point at localhost ports.
- The code checks `NODE_ENV` + `K_SERVICE` to decide: dev mode → local queue; production → Cloud Tasks.

### 8.3 BigQuery Local Testing
- **Option A (recommended):** Use production BigQuery with a dev dataset (`crypto_radar_dev`). The `BIGQUERY_PROJECT_ID` env var controls which project.
- **Option B:** SQLite fallback (already exists in `src/store/db.ts` — when BQ env vars aren't set, the Store uses `node:sqlite`).
- For LLM integration tests locally, set `RADAR__AI_*` vars to point to OpenCode. The analysis still runs, just hits OpenCode instead of Gemini.

---

## 9. Security & Secrets

### 9.1 Secret Manager Integration
- **Files:** `deploy.sh`, `src/core/secrets.ts` (new)
- Store all secrets in Google Secret Manager:
  - `crypto-radar-cron-secret` — random 64-char string for cron auth
  - `crypto-radar-jwt-secret` — 256-bit hex for JWT signing
- Mount via `gcloud run deploy --update-secrets`
- `src/core/secrets.ts` provides a `getSecret(name)` helper that reads from Secret Manager in prod, falls back to `process.env` in dev.

### 9.2 CORS Config
- **File:** `src/api/fastify/app.ts`
- Currently hardcoded to Vercel + localhost. Change to env-driven: `process.env.CORS_ORIGIN` (comma-separated list). Default to localhost dev origins when not set.

### 9.3 Cron Auth (Already Done — Verify)
- **File:** `src/api/fastify/routes/cron.ts`
- Already has `timingSafeEqual` constant-time comparison, `x-cron-secret` header, 500 response if CRON_SECRET unset. Verify after deploy that Cloud Scheduler's OIDC token or secret header is configured.

---

## 10. Cost Analysis (Free Tier Fit)

### 10.1 Monthly Gemini API Cost (Production)

| Item | Value |
|------|-------|
| Scan frequency | Every hour (720 scans/month) |
| Tokens per scan | 49 |
| Gemini calls per scan | 49 (one per token) |
| **Total Gemini calls/month** | **~35,280** |
| Input tokens per call | ~500 (trace data + prompt) |
| Total input tokens/month | ~17.6M |
| Gemini 3.1 Pro input cost | ~$0.005/1K input chars |
| **Estimated monthly cost** | **~$50-90/mo** |

**Mitigations (NOT model downgrade — Gemini 3.1 Pro stays):**

1. **Analyze top-N by signal score** — Only analyze the top 10 tokens with the highest composite signal scores each scan. Reduces calls from 49 to 10 per scan = ~7,200 calls/mo = **~$15-25/mo**. Zero information loss because the low-signal tokens add minimal predictive value.
2. **Batch multiple traces per prompt** — Send 3-5 token traces in a single LLM call with "analyze each" instruction. Reduces calls proportionally.
3. **Debounce low-volatility tokens** — Skip analysis for tokens with <0.5% price change. They're not actionable.
4. **Local testing costs $0** — OpenCode via `RADAR__AI_*` env vars. All development, integration testing, and prompt iteration happens locally with zero Gemini spend.

### 10.2 Free Tier Budget

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| Cloud Run | $0 | 2M requests free; we use ~3K |
| Cloud Scheduler | $0 | 3 jobs free; we use 1 |
| Pub/Sub | $0 | 10GB free; we use ~1MB |
| Cloud Tasks | $0 | 1M operations free; we use ~2K |
| BigQuery | $0 | 10GB storage free; we use ~500MB |
| Artifact Registry | $0 | 500MB free |
| Secret Manager | $0 | 6 secrets free |
| Vertex AI / Gemini | ~$15-90/mo | Depends on mitigation strategy used |
| **Total (mitigated)** | **~$15-25/mo** | Top-10 analysis + batching |
| **$300 trial duration** | **12-20 months** | At mitigated rate |

---

## 11. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Gemini rate limit (60 req/min) | Batch analysis fails mid-way | High on 49-token scan | Cloud Tasks queue throttles to 1 req/sec; per-token publish enables independent retry; top-N analysis reduces batch size |
| Cloud Run cold start >10s | Gateway timeout on first request | Medium | Use `--min-instances=1` for 1 warm instance; keep Docker image <300MB (alpine helps) |
| Pub/Sub at-least-once duplicates | Double analysis, wasted Gemini quota | Low | `INSERT IF NOT EXISTS` via trace_id; BigQuery streaming `insertId` dedup for raw data |
| Secrets exposed in deploy.sh | Unauthorized cron triggers | HIGH (now) | **Phase 0 fixes this** — remove from git, use Secret Manager |
| ML model lost on deploy | No predictions until first retrain | Medium | Bake latest model into Docker image as fallback; GCS for retrained models |
| LLM provider abstraction misses a feature | Local OpenCode behavior differs from Gemini | Low | Both use OpenAI-compatible chat completions for the analysis path; the SQL path (ML.GENERATE_TEXT) is Gemini-only |
| $300 trial exhausted before ROI | Service shuts down | Low (at $20/mo → 15 months) | Monitor billing; set budget alerts at $50/month |

---

## Appendix: Execution Checklist

### Day 1 — Deploy-Blockers
- [x] Create `src/server.ts`
- [x] Overwrite `Dockerfile`
- [x] Overwrite `deploy.sh`
- [x] Add `isCloudMode()` to `src/core/config.ts`
- [x] Guard fs writes in `src/radar.ts`
- [x] Guard fs writes + WS in `src/daemon.ts`
- [x] Fix BQ field mapping in `src/store/db.ts`
- [ ] Deploy to Cloud Run
- [ ] Verify `/health` returns 200
- [ ] Verify `/api/cron/scan` with secret header

### Day 1-2 — Messaging
- [x] Install `@google-cloud/pubsub`
- [x] Add publish to `Store.persistRun()`
- [x] Create `infra/main.tf` with topic + queues
- [x] Create `src/core/queue.ts` (local fallback)
- [x] Create `src/handlers/gemini-analyze.ts` (implemented as Fastify /api/tasks/gemini-analyze)
- [x] Create `src/handlers/paper-trade.ts` (implemented as Fastify /api/tasks/paper-trade)
- [x] Create `src/handlers/model-retrain.ts` (implemented as Fastify /api/tasks/model-retrain)

### Day 2-3 — LLM
- [x] Create `src/core/llm-provider.ts`
- [x] Refactor `src/analysis/gemini.ts`
- [ ] Create BQ Remote Model (one-time CLI)
- [ ] Wire ML.GENERATE_TEXT into gemini handler

### Day 3-4 — Feedback Loop
- [x] Create `token_traces` table (in SQLite schema.ts DDL & migrations, mapped in BigQuery store schemas)
- [x] Wire `persistRun()` to populate traces
- [x] Wire LLM output to prediction columns (via gemini-analyze task handler)
- [x] Create 24h outcome backfill query (implemented as Fastify /api/tasks/evaluate-outcomes)
- [x] Create evaluation queries (created infra/evaluation-queries.sql)
- [x] Create A/B test SQL pattern (created infra/evaluation-queries.sql)

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-07-20 | v1.0 | Initial plan — REST + Pub/Sub + Tasks architecture |
| 2026-07-20 | v2.0 | Rewrite: no code blocks, subgroup structure, corrected cost (Gemini 3.1 Pro), OpenCode local path, BigQuery Remote Model, Trace/Prediction/Outcome loop |
