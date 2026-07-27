# Crypto Radar — Enterprise 10/10 Roadmap

> **Project:** Crypto Radar v2.8.1 (backend daemon)
> **Current score:** ~6.8/10 across 12 categories
> **Target:** 10/10 across all categories
> **Approach:** 4 sequential phases — Ship Blockers → Structural Integrity → Algorithm 2.0 → Enterprise Polish
> **Scope:** Backend only (this repo). ML Python (`ml/`) and TypeScript (`src/ml/`) included. Frontend excluded.

---

## Phase 0: Ship Blockers (Score Impact: ML 5→7, Security 7→8, Deployment 6→8, Docs 7→8)

### B1. Python version alignment
- **What:** `pyproject.toml:5` requires `>=3.14`. `Dockerfile:30` creates venv with `python3.12` (apk add py3-pip on Alpine ships 3.12). CatBoost 3.14 wheels won't load in a 3.12 interpreter.
- **Fix option A:** Change `pyproject.toml` to `>=3.12` — least friction, Python 3.12 is LTS stable.
- **Fix option B:** Update Dockerfile to install Python 3.14 from source or sid repo — keeps forward-looking version target.
- **Files:** `pyproject.toml:5`, `Dockerfile:30`
- **Verification:** `docker build .` succeeds, `node dist/cli.js ml predict` doesn't crash on subprocess launch

### B2. JWT secret enforcement in production
- **What:** `server.ts:32` falls back to `'dev-secret-change-in-production'` when `RADAR__JWT_SECRET` is unset. Any attacker who knows this default can forge JWT tokens.
- **Fix:** `NODE_ENV === 'production'` → `log.fatal()` + `process.exit(1)` when secret is default. Dev mode keeps the fallback with a clear warning.
- **Files:** `src/server.ts:24-32`
- **Verification:** `NODE_ENV=production node dist/server.js` exits with fatal error

### B3. CSV injection protection
- **What:** All CSV export paths (`output.ts`, `sqlite-export.ts`) write values verbatim. A field like `=HYPERLINK("http://evil","Click")` executes as a formula when opened in Excel/Sheets.
- **Fix:** Add `escapeCsvField(val: string): string` to the central CSV serializer — prefix with `\t` if value starts with `=`, `+`, `-`, `@`. Apply in `toCSV()` and `sqlite-export.ts`'s `formatValue()`.
- **Files:** `src/output.ts` (central serializer), `src/sqlite-export.ts` (separate CSV value formatter)
- **Verification:** `toCSV({ alerts: '=DAMAGE()' })` → `"'\t=DAMAGE()"'` in output. Written test asserts escape.

### B4. Terraform state backend
- **What:** `infra/main.tf` has no `backend` block — state stored locally. First `terraform apply` from a different machine creates a divergent state.
- **Fix:** Add `backend "gcs" { bucket = "crypto-radar-tfstate-${var.project_id}" }`. Bucket must be created manually first.
- **Files:** `infra/main.tf:1-9`
- **Verification:** `terraform init` shows backend migration prompt

### B5. Remove dead `node-fetch` dependency
- **What:** `package.json:173` depends on `node-fetch@3.3.3`. Node 22+ has native `fetch` globally.
- **Fix:** Replace all `import fetch from 'node-fetch'` with global `fetch`. Remove `node-fetch` from dependencies.
- **Files:** All files importing `node-fetch` (search: `from 'node-fetch'`), `package.json`
- **Verification:** `npm run build` + `npm test` — 0 regressions

---

## Phase 1: Structural Integrity (Architecture 7→9, Data 7→9, API 7→9, CLI 8→9, Testing 6→8, Observability 6→8)

### S1. Split radar.ts god module
- **Current:** `src/radar.ts` imports from ~15 modules — it's the hub that everything passes through.
- **Split into:**
  - `src/radar/runner.ts` — scan orchestration (runRadar main loop)
  - `src/radar/enricher.ts` — enrich tickers with indicators, onchain, news
  - `src/radar/persister.ts` — CSV/JSONL writing, log rotation
  - `src/radar/index.ts` — re-exports public API
- **Files:** `src/radar.ts` → `src/radar/*.ts`
- **Verification:** `npm run build` + `npm test` — all imports updated, no circular deps

### S2. Split db.ts by domain
- **Current:** `src/store/db.ts` is 2,002 lines — klines, tickers, signals, news, paper trades, futures, fear/greed, orderbook, cross-asset, predictions, traces, drift, users, auth, GCS sync, BigQuery.
- **Split into sub-modules:**
  - `src/store/db.ts` — base class, connection management, GCS sync
  - `src/store/klines.ts` — kline CRUD
  - `src/store/tickers.ts` — ticker snapshot + history CRUD
  - `src/store/signals.ts` — signal CRUD
  - `src/store/news.ts` — news CRUD
  - `src/store/paper-trades.ts` — paper trade CRUD
  - `src/store/futures.ts` — funding, OI, L/S ratio, liquidations
  - `src/store/market.ts` — fear/greed, orderbook, cross-asset
  - `src/store/predictions.ts` — predictions, drift events
  - `src/store/auth.ts` — users, token traces
- **Files:** `src/store/db.ts` → `src/store/*.ts`
- **Verification:** `npm run build` + `npm test` — no broken imports, no circular deps

### S3. Config schema validation
- **Current:** `loadConfig()` deep-merges file + env + defaults with no schema validation. A typo like `datadir` vs `dataDir` silently falls to default.
- **Fix:** Add Zod schema for `RadarConfig` that validates shape + types + ranges on load. Emit warnings for unknown keys.
- **Files:** `src/core/config.ts`, new `src/core/config.schema.ts`
- **Verification:** Config with `{ "datadir": "/tmp" }` logs warning about unknown key. Config with `{ "fetchTimeoutMs": -1 }` throws validation error.

### S4. Split cli.ts action handlers
- **Current:** `src/cli.ts` is 1,337 lines with inline action handlers in every `.action()` callback.
- **Fix:** Extract each command handler to `src/cli/scan.ts`, `src/cli/chart.ts`, `src/cli/strategies.ts`, `src/cli/tokens.ts`, `src/cli/search.ts`, `src/cli/signals.ts`, `src/cli/news.ts`, `src/cli/health.ts`, `src/cli/config.ts`, `src/cli/export-sqlite.ts`, `src/cli/regime.ts`, `src/cli/backtest.ts`, `src/cli/benchmark.ts`, `src/cli/daemon.ts`, `src/cli/ml.ts`, `src/cli/collect.ts`.
- **Swap `process.exit(1)` for throwing `Commander.Error`** — Commander catches these gracefully and tests can assert without mocking process.exit.
- **Files:** `src/cli.ts` → `src/cli/*.ts`
- **Verification:** `npm test` — existing CLI tests pass without mocking process.exit. All handlers produce same output.

### S5. API request logging + /health rate-limit exemption
- **Current:** Fastify logger disabled (`logger: false`) with no custom hooks replacing it. `/api/health` goes through the 100 req/min rate limiter — health checks from load balancers get rate-limited.
- **Fix:** Add `onRequest`/`onResponse` hooks for structured request logging. Add `config` to skip rate limiting on `/api/health`.
- **Files:** `src/api/fastify/app.ts`
- **Verification:** Load balancer health checks at 10/sec don't 429. Request logs show method, path, status, duration.

### S6. Correlation IDs on API requests
- **Current:** No request tracing. Debugging a single request across logs requires manual timestamp matching.
- **Fix:** Add `onRequest` hook that sets `request.id` as a UUID or short-tag. Log it in every subsequent log line via `request.log`. Pass to child loggers.
- **Files:** `src/api/fastify/app.ts`, `src/core/logger.ts`
- **Verification:** Each API request produces log lines tagged with a unique request ID.

### S7. Add Prometheus metrics endpoint
- **Current:** No `/metrics` endpoint. Cache stats, scan counts, error rates are inaccessible.
- **Fix:** Add `@fastify/metrics` or lightweight manual counter registry. Export: scan duration (histogram), tickers per scan, API calls per route, cache hit rate, error count by type.
- **Files:** `src/api/fastify/app.ts`, `src/api/fastify/routes/metrics.ts` (new)
- **Verification:** `GET /metrics` returns Prometheus-format text with gauge/counter/histogram entries.

### S8. Real coverage — remove abusive exclusions
- **Current:** `vitest.config.ts` excludes `charts.ts` (1,386 lines), `advanced-charts.ts`, `daemon.ts`, `ml/**`, `types.ts`, `strategies.ts`, `index.ts`. Claimed 90% but actual meaningful coverage is ~60-65%.
- **Fix:** Move truly untestable files (ML subprocess calls, large SVG renderers) to their own project-level exclude list. Bring 90% of excluded files back in. Set progressive thresholds: 60% → 70% → 80% over 3 sprints.
- **Verification:** Coverage report shows 70%+ on modules that were previously excluded. Coverage badge updates to honest number.

### S9. ML subprocess integration test
- **Current:** Python→TypeScript bridge has zero E2E coverage. Subprocess failure → silent no-predictions.
- **Fix:** Write a test that spawns the Python subprocess with known JSONL input, captures stdout, parses predictions, asserts shape and range of outputs. Uses `ml/tests/test_predict.py` as reference — verify TS side produces compatible JSONL and Python side accepts it.
- **Files:** `src/ml/predict.test.ts` (extend existing), new `src/ml/subprocess-bridge.test.ts`
- **Verification:** Test passes with actual Python subprocess. Fails gracefully when Python venv isn't set up (skipIf).

### S10. Async file logging
- **Current:** `logger.ts:85` uses `appendFileSync` — blocks event loop on every log write in file mode.
- **Fix:** Batch log writes using a microtask queue or a `WritableStream`. Flush on process exit. Keep sync fallback for fatal-level logging.
- **Files:** `src/core/logger.ts`
- **Verification:** Writing 1,000 log lines doesn't block an ongoing API request measurable.

---

## Phase 2: Algorithm 2.0 (Signal Engine 8→10, ML Pipeline 5→10, Core Infra 8→9)

### A1. NewsScore blending into composite signal
- **Current:** `TokenSignal.newsScore` is computed but not blended into `compositeScore`. The composite is purely technical.
- **Fix:** `compositeScore = 0.60 × technicalScore + 0.25 × newsScore(l6h) + 0.15 × onchainScore`. News decays linearly from 100% at publish to 50% at 6h, to 0% at 24h.
- **Files:** `src/analysis/engine.ts`, `src/signals.ts`
- **Verification:** Token with strong news and weak tech gets `compositeScore` higher than tech alone. Test with known high-relevance news match.

### A2. Confidence calibration with sigmoid normalization
- **Current:** Raw scores pass through as `compositeScore` with no normalization — values outside [-100, 100] can appear.
- **Fix:** Apply sigmoid: `normalized = 2 / (1 + exp(-raw / 10)) - 1` → output in [-1, +1]. Volatility shrinkage: if ATR_pct > 3%, reduce confidence by `1 - (atr_pct - 3) / 20`.
- **Files:** `src/analysis/engine.ts`, `src/signals.ts`
- **Verification:** `compositeScore` always in [-1, +1]. High-volatility tokens have proportionally lower confidence.

### A3. Kelly criterion position sizing
- **Current:** `positionSize` field in `EnrichedTicker` exists but is never computed — always `undefined`.
- **Fix:** `f* = (p × b - q) / b` where p = historical win rate for this strategy×symbol (tracked in Store), b = avg_win / avg_loss, q = 1-p. Cap at 0.25 (25% max allocation per trade). Fall back to 0.1 when no history exists.
- **Files:** `src/analysis/engine.ts`, `src/store/db.ts` (new win-rate tracking table or in-memory accumulator)
- **Verification:** Token with 60% hit rate and 2:1 win/loss gets `positionSize` ~0.20. New token with no history gets 0.10.

### A4. Multi-indicator divergence detection 2.0
- **Current:** Price vs RSI divergence only (regular/hidden/subtle).
- **Add:** Price vs MACD-histogram (bearish divergence = price higher high, MACD hist lower high), Price vs OBV (volume confirms/rejects), multi-timeframe confirmation (daily divergence + 4h divergence = stronger signal).
- **New file:** `src/analysis/divergence.ts` — extract from current inline code, add MACD and OBV variants.
- **Verification:** Test with known divergence scenarios: price makes higher high, MACD hist makes lower high → bearish divergence flagged.

### A5. Correlation-aware signal boost
- **Current:** Correlation matrix computed in `correlation.ts` but not consumed by signal engine.
- **Fix:** After computing all token signals, scan the pair matrix: if token A has signal < threshold but is correlated (r>0.8) with token B that has a strong signal (>0.5), boost A by 10%. Prevents missing moves in correlated assets.
- **Files:** `src/analysis/engine.ts`, `src/analysis/correlation.ts`
- **Verification:** SOL and BTC are correlated. BTC gets strong signal → SOL's signal gets +10% boost (capped).

### A6. Regime transition alerts
- **Current:** Regime is detected each scan but no event fires on change.
- **Fix:** Compare current regime against previous. If changed (e.g. Trending→Ranging), create an alert with transition reason (ADX dropped below 25, volume z-score confirms ranging). Emit to webhook.
- **Files:** `src/analysis/regime.ts`, `src/core/alerts.ts`
- **Verification:** ADX crosses from 30→22 and volume z-score confirms → alert "Regime change: Trending→Ranging".

### A7. Portfolio VaR (Value at Risk)
- **Current:** Portfolio endpoint returns holdings, PnL, performance. No risk metric.
- **Fix:** Compute 95% VaR = percentile of 30-day historical returns × current position value. 99% VaR for stress. Max drawdown over 30d. Output via `GET /api/portfolio/risk`.
- **Files:** `src/analysis/portfolio.ts`, `src/api/fastify/routes/portfolio.ts`
- **Verification:** Paper trading portfolio with $10k SOL position → VaR95 returns "$1,200 at risk (1-day, 95%)".

### A8. New strategy: Statistical arbitrage
- **What:** Track z-score of spread between highly correlated pairs (SOL/BTC, ETH/BTC, SOL/ETH). Entry signal when z > 2 (short spread) or z < -2 (long spread). Exit when z crosses 0. Dynamic pair selection from correlation matrix — only pairs with trailing 30d r > 0.7 are tradeable.
- **Files:** `src/analysis/stat-arb.ts` (new), register in `src/analysis/strategies.ts`
- **Data:** 1h klines for both legs, 30-day rolling correlation, 20-period z-score of spread
- **Verification:** Backtest with 90d of data — strategy produces signals that are not perfectly correlated with existing momentum/mean-reversion signals.

### A9. New strategy: Volume velocity
- **What:** Rolling 20-period volume z-score. When z > 3 (volume spike) and price moves in same direction → breakout confirmation, generates directional signal. When volume spike + price stalls → distribution warning, generates neutral-to-negative. Leading indicator by ~1-3 periods.
- **Files:** `src/analysis/volume-velocity.ts` (new), register in strategies
- **Data:** Volume from klines, rolling mean + std dev, price change
- **Verification:** Test with known breakout candles — volume spike of 5σ with +3% price move → strong bullish signal.

### A10. New strategy: Order flow pressure
- **What:** Track `bookImbalance` trajectory over last 3 depth reads. If imbalance > 0.3 trend (rising) → aggressive buying. If dropping from > 0.3 to < 0 → distribution. Use bid/ask wall proximity (large bids near current price) as confirmation.
- **Requires:** Depth snapshots from collector (already stored in `orderbook` table). Add 3-read trailing buffer.
- **Files:** `src/analysis/order-flow.ts` (new), register in strategies
- **Verification:** Test with synthetic order book data: 3 consecutive reads with imbalance 0.2 → 0.35 → 0.5 → bullish signal.

### A11. ML meta-strategy
- **What:** Ensembles all existing strategies by training a light CatBoost classifier that predicts *which strategy will be most accurate* for current market conditions. Features: each strategy's current score, regime label, ATR percentile, volume z-score, correlation regime, time-of-day. Training data from backtest results (strategy A was right, B was wrong → label = A).
- **Files:** `src/analysis/meta-strategy.ts` (new), `src/ml/meta/*` (new), `ml/meta_train.py`
- **Integration:** Returns `metaStrategy` score that becomes a 5th voter in the weighted ensemble, not a replacement — prevents catastrophic forgetting.
- **Verification:** Meta-strategy accuracy > 60% on holdout (vs ~33% random for 3 strategies). Doesn't degrade total system accuracy.

### A12. Edge-case hardening audit (completeness check)
- **Current:** Subagent fixed 9 NaN/Infinity guards across 6 signal files. Remaining 30 indicators and all analysis modules may still have gaps.
- **Fix:** Run property-based test: for every indicator function, feed random arrays of varying lengths (0, 1, minimum, maximum). Assert no NaN, Infinity, or exception propagates. Fix all failures.
- **Files:** All `src/analysis/*.ts`, `src/indicators.ts`
- **Verification:** Property-based test suite passes — 0 NaN, 0 Infinity, 0 uncaught exceptions across all indicator functions.

### A13. ML pipeline: Subprocess bridge hardening
- **Current:** `src/ml/predict.ts` spawns Python subprocess, sends JSONL via stdin, reads stdout. If Python crashes: empty prediction array, no error surfaced.
- **Fix.** Add:
  1. Stderr capture on subprocess — log Python warnings/errors
  2. Exit code check — non-zero → full error message in logs, prediction returns error not empty array
  3. Heartbeat ping — if no stdout within 30s, escalate to timeout handler (exists but not logged)
  4. Stale model detection — compare model file modification time against last training time, warn if >7 days
- **Files:** `src/ml/predict.ts`
- **Verification:** Subprocess with `exit(1)` → logged error + no crash. Subprocess with 0 output → timeout logged. Model file 10 days old → warning in health check.

### A14. ML pipeline: Training data quality validation
- **Current:** `ml/train.py` reads whatever JSONL it receives. If feature computation produces NaN columns or constant columns, training degrades silently.
- **Fix:** Add pre-training data validation in `ml/train.py`:
  1. Check for NaN/Inf values — warn and drop affected rows or columns
  2. Check for constant columns — warn and exclude from training
  3. Check class balance — if < 10% minority class, enable SMOTE automatically
  4. Check feature correlation — if two features have r > 0.99, flag redundancy
- **Files:** `ml/train.py`
- **Verification:** Training with corrupted dataset (50% NaN in one column) logs warnings, drops column, completes successfully.

---

## Phase 3: Enterprise Polish (All categories → 10/10)

### P1. Webhook alert automation
- **Current:** Alerts are computed (`checkAlerts()`) and can be sent to Discord/Telegram webhooks, but there's no user-configurable alert criteria — all alerts are hardcoded.
- **Add:** Alert rule configuration in `radar.config.json`: user-defined conditions (price > X, volume spike > Y%, RSI > 70, regime change). Evaluate after every scan. Emit to webhook.
- **Files:** `src/core/alerts.ts`, `src/core/config.ts` (extend RadarConfig)
- **Verification:** Configure `{ "rule": "RSI > 70 and symbol = SOL", "action": "webhook" }` → scan with RSI=72 triggers webhook.

### P2. Social sentiment (Reddit + RSS)
- **Current:** No social sentiment data. News sources are 28 RSS feeds only.
- **Add:** Reddit r/cryptocurrency JSON feed parsing. Keyword match on token symbols/names, compute sentiment score (net positive/negative ratio in comments). Blend into `newsScore`.
- **Note:** Reddit JSON feeds require no API key. Rate limit: 30 req/min per IP.
- **Files:** `src/sources/reddit.ts` (new), integrate into `src/news.ts`
- **Verification:** SOL mentioned 15 times in last 100 Reddit posts, 60% positive → sentimentScore = 0.60 → boosts newsScore.

### P3. On-chain wallet tracking (basic)
- **Current:** Paper trading only. No real wallet tracking.
- **Add:** Accept user-supplied wallet addresses via config/env. Monitor on-chain (SOL, ETH, BNB) via DeFiLlama `wallet/{address}` endpoint for large movements. Alert on >$10k outflows.
- **Files:** `src/sources/onchain-wallet.ts` (new)
- **Verification:** Configured SOL wallet with $50k tracked → daily balance stored. >$10k outflow triggers alert.

### P4. Market microstructure signals
- **What:** Additional derived signals from existing data:
  - **Bid/Ask wall ratio**: ratio of total bid size within 1% of price vs ask size within 1% → support/resistance pressure
  - **Trade intensity**: `count` from kline / 60 (trades per minute) — acceleration/deceleration
  - **Candle fatigue**: consecutive small-body candles after a trend move → trend exhaustion
- **Files:** `src/analysis/microstructure.ts` (new), register signals in `strategies.ts`
- **Verification:** Backtest confirms microstructure signals are not correlated >0.5 with existing strategies (ensures diversification benefit).

### P5. Readable and writable Terraform target
- **Current:** `infra/main.tf` has no state backend and no CI pipeline.
- **Add:** GCS state backend. GitHub Actions workflow for `terraform plan` on PR and `terraform apply` on merge to main. Parameterize all project-specific values (project_id, region) as variables with no defaults for production safety.
- **Files:** `infra/main.tf`, `.github/workflows/terraform.yml` (new)
- **Verification:** `terraform plan` on PR shows expected changes. `terraform apply` on merge creates/updates infrastructure.

### P6. Async logging with backpressure
- **Current:** `appendFileSync` is synchronous.
- **Target:** Implement async batch writer with drain awareness. On backpressure (disk slow), drop non-critical log levels before blocking.
- **Files:** `src/core/logger.ts`

### P7. OpenAPI/Swagger enrichment
- **Current:** Swagger UI at `/docs` shows routes but no request/response examples, no error schemas.
- **Fix:** Add `@fastify/swagger` decorators with: example values for every route, error response schemas, auth header documentation. Auto-generates from Zod schemas where possible.
- **Files:** All route files, `src/api/fastify/app.ts`

### P8. Fix documentation gaps
- **Current:** SECURITY.md references non-existent `CRYPTO-ENTERPRISE-AUDIT.md`. README badges may be stale. No link to Swagger UI. Coverage badge overstates.
- **Fix:** Remove dead ref. Update badges with dynamic shields.io URLs. Add "API Docs: `/docs`" to README. Replace coverage badge with honest number from real coverage run.
- **Files:** `README.md`, `SECURITY.md`

### P9. Full E2E test suite
- **What:** End-to-end test that starts the server, runs a scan, fetches results via API, asserts data flows correctly.
- **Implementation:** Vitest test with `beforeAll` that starts the app via `app.inject()` for API tests + imports radar functions directly for scan tests. No subprocess needed — everything in-process. Mock Binance responses to control for deterministic output.
- **Files:** `src/e2e/scan-flow.test.ts` (new)
- **Verification:** `npm run test:e2e` passes — scan produces tickers → signals → predictions flow correctly end-to-end.

---

## Missing Features (not improving existing — entirely new)

| Feature | Why it's missing | Phase | Effort |
|---------|-----------------|-------|--------|
| **Alert rule engine** | Alerts are hardcoded in `checkAlerts()`. No user-configurable rules. | P3 | 3-4d |
| **Social sentiment (Reddit)** | No social data pipeline. Only RSS news feeds. | P3 | 2-3d |
| **Wallet monitoring** | No real wallet tracking. Only paper trading. | P3 | 3-4d |
| **Market microstructure** | No trade intensity, candle fatigue, wall ratio signals. | P3 | 2-3d |
| **Strategy backtest optimization** | Backtest exists but doesn't auto-optimize weights. Output: manual JSON inspection. | P2 | 3-4d |
| **Model performance alerts** | ML model trains, predicts, but no alert on accuracy degradation. | P2 | 1d |
| **Feature importance drift** | SHAP computed at training time but not monitored across predictions. | P2 | 1d |

---

## Effort Summary

| Phase | Items | Effort (backlog-days) | Score gain |
|-------|-------|----------------------|------------|
| P0: Ship Blockers | 5 | 2-3d | ~6.8 → 7.5 |
| P1: Structural Integrity | 10 | 10-15d | 7.5 → 8.5 |
| P2: Algorithm 2.0 | 14 | 20-30d | 8.5 → 9.5 |
| P3: Enterprise Polish | 10 | 15-20d | 9.5 → 10.0 |
| **Total** | **39** | **47-68d** | **6.8 → 10.0** |

---

## Dependencies & Sequencing

```
P0 (no deps) → P1 (no deps on P0 but wise to do P0 first)
              ↘ P2 (depends on P1 for signal engine structure, 
                |        independent for ML items)
                ↘ P3 (depends on P1 for observability, P2 for algorithms)
```

P0 and P1 can be worked in parallel by different subagents. P2 and P3 cannot start until P1 is complete.

---

**End of design spec.**
