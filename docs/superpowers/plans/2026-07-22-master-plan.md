# Crypto Radar — Enterprise 10/10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Take all 12 categories from current ~6.8 to 10/10.

**Architecture:** 4 phases — sequential, each ships working software.

---

## Phase 1: Ship Blockers

### Task 1.1: Fix Python version
**File:** `pyproject.toml:5`
**Change:** `">=3.12"` → `">=3.14"` (was broken by earlier subagent)
**Status:** DONE (just applied)

### Task 1.2: JWT secret enforcement
**File:** `src/server.ts:24-32`
**Status:** DONE

### Task 1.3: CSV injection protection
**File:** `src/output.ts` — escapeCsvField added
**Status:** DONE

### Task 1.4: Terraform state backend
**File:** `infra/main.tf` — gcs backend block added
**Status:** DONE

### Task 1.5: Remove node-fetch
**File:** `package.json` — dependency removed
**Status:** DONE

---

## Phase 2: Structural Integrity

### Task 2.1: Config schema validation
**Files:** `src/core/config.schema.ts` (create), `src/core/config.ts` (modify)
**Status:** DONE

### Task 2.2: API request logging + health exemption
**File:** `src/api/fastify/app.ts`
**Status:** DONE

### Task 2.3: Fix coverage exclusions
**File:** `vitest.config.ts`
**Status:** DONE

### Task 2.4: Async batch logging
**File:** `src/core/logger.ts`
**Status:** DONE

### Task 2.5: Correlation IDs
**File:** `src/api/fastify/app.ts`
**Status:** DONE

### Task 2.6: ML subprocess test
**File:** `src/ml/subprocess-bridge.test.ts` (create)
**Status:** DONE

### Task 2.7: Split db.ts into domain modules
**Files:** 11 new files in `src/store/`, `src/store/db.ts` → facade
**Status:** DONE

### Task 2.8: Fix silent catch blocks
**Subagent brief:** Every `catch {}` or `catch { /* comment */ }` across all `src/store/*.ts` must log via `logger.error()`. Add `import { logger }` where missing. Check `futures.ts`, `market.ts`, `predictions.ts` specifically. `scan-archive.ts` already fixed.
**Verification:** `npm run build` passes.

---

## Phase 3: Algorithm 2.0

### Task 3.1: NewsScore blending
**File:** `src/analysis/engine.ts`
**Change:** decay newsScore by age (100%→50%→0% over 24h). Composite = 0.60×tech + 0.25×news + 0.15×onchain.

### Task 3.2: Confidence calibration
**File:** `src/analysis/engine.ts`
**Change:** Sigmoid normalize to [-1,+1]. Volatility shrink when ATR>3%.

### Task 3.3: Kelly position sizing
**File:** `src/analysis/engine.ts`
**Change:** `f* = (p·b - q)/b`, cap at 0.25.

### Task 3.4: Multi-divergence detection
**File:** Create `src/analysis/divergence.ts`
**Add:** MACD-histogram divergence, OBV divergence, multi-timeframe confirmation.

### Task 3.5: Correlation boost
**File:** `src/analysis/engine.ts`
**Change:** If token has r>0.8 with strong-signal token, boost 10%.

### Task 3.6: Regime transition alerts
**File:** `src/analysis/regime.ts`
**Change:** Track previous regime, emit alert on change, wire to webhook.

### Task 3.7: Portfolio VaR
**Files:** `src/analysis/portfolio.ts`, `src/api/fastify/routes/portfolio.ts`
**Add:** VaR95, VaR99, max drawdown. Endpoint: GET /api/portfolio/risk.

### Task 3.8: Statistical arbitrage strategy
**Files:** Create `src/analysis/stat-arb.ts`, register in strategies
**Logic:** Pair spread z-score between r>0.7 pairs. Entry |z|>2, exit z=0.

### Task 3.9: Volume velocity strategy
**Files:** Create `src/analysis/volume-velocity.ts`, register
**Logic:** Volume spike >3σ + price confirmation.

### Task 3.10: Order flow strategy
**Files:** Create `src/analysis/order-flow.ts`, register
**Logic:** Book imbalance trajectory over 3 depth reads.

### Task 3.11: ML meta-strategy
**Files:** Create `src/analysis/meta-strategy.ts`, `ml/meta_train.py`
**Logic:** CatBoost predicting best strategy. Features: scores + regime + ATR + vol z-score.

### Task 3.12: Edge-case hardening
**Files:** All `src/analysis/*.ts`, `src/indicators.ts`
**Method:** Property-based: feed arrays of length 0, 1, minimum. Assert no NaN/Infinity.

### Task 3.13: ML subprocess hardening
**File:** `src/ml/predict.ts`
**Changes:** Capture stderr, log on non-zero exit. Check model age (>7d → warn). 30s heartbeat.

### Task 3.14: Training validation
**File:** `ml/train.py`
**Changes:** Drop NaN columns, drop constant columns, auto-SMOTE on imbalance, flag near-duplicate features.

---

## Phase 4: Enterprise Polish

### Task 4.1: Alert rule engine
**Files:** `src/core/alerts.ts`, `src/core/config.ts`
**Add:** User-configurable alert rules in config. Evaluate after scan. Webhook dispatch.

### Task 4.2: Reddit sentiment
**Files:** Create `src/sources/reddit.ts`, integrate in `src/news.ts`
**Logic:** Reddit JSON feeds, keyword symbol match, sentiment ratio. No API key needed.

### Task 4.3: Wallet monitoring
**Files:** Create `src/sources/onchain-wallet.ts`
**Logic:** Config wallet addresses, DeFiLlama pool, >$10k outflow → alert.

### Task 4.4: Microstructure signals
**Files:** Create `src/analysis/microstructure.ts`
**Add:** Bid/ask wall ratio, trade intensity, candle fatigue.

### Task 4.5: Terraform CI
**Files:** `infra/main.tf`, create `.github/workflows/terraform.yml`
**Add:** GCS backend. GA: plan on PR, apply on merge.

### Task 4.6: Swagger enrichment
**Files:** All route files
**Add:** Schema decorators: examples, errors, auth, tags.

### Task 4.7: Documentation fixes
**Files:** `README.md`, `SECURITY.md`
**Fix:** Remove dead refs, dynamic badges, /docs link, honest coverage.

### Task 4.8: E2E test suite
**Files:** Create `src/e2e/scan-flow.test.ts`
**Test:** Full scan → verify tickers/signals/predictions flow. Mock Binance.

### Task 4.9: Catch block audit
**Files:** ALL `src/*.ts`
**Rule:** Every `catch {}` must call `logger.error()`. Zero exceptions.
