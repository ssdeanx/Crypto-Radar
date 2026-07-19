# Hermes Crypto Radar — Production-Readiness Plan

> **Scope:** Backend only (`Hermes-Crypto-Radar/`). Frontend (`crypto-radar-dashboard/`) is reference context, not in scope.
> **Audit method:** prism-full (multi-pass + adversarial). Build verified green (`npm run build` → exit 0).
> **Date:** 2026-07-17
> **Status:** PLAN — not yet implemented. All findings are post-build runtime/deploy seams; `tsc` passes and does not catch them.

---

## 1. Executive Summary

The backend is **feature-complete and well-architected** (Fastify + helmet/cors/rate-limit/jwt/compress/swagger, SQLite store with WAL + serialized writes, 26+ indicators, 3-strategy engine, LightGBM ML pipeline, warm daemon). It is **not yet deploy-ready** because it is *half-integrated*: every subsystem's authoring layer works, but the **resolver/wiring layer** that connects produced artifacts to consumers is missing or duplicated.

**Three faces of one structural defect — "no canonical resolver per artifact type":**
- ML: models are **produced** (timestamped `.joblib`) but **never discovered** by the CLI/daemon default path.
- API: routes are **written twice** (legacy `src/api/rest.ts` + Fastify), one copy dead at runtime.
- Coverage: top-volume coins are **discovered** (`fetchAllUsdtTickers`) but **filtered out** before use by the hardcoded registry.

**Conservation law (from adversarial pass):** *A backend can be 100% compiled and 0% usable when its discovery/wiring layer is decoupled from its authoring layer.* The attractor is **one canonical resolver per artifact type** (models, routes, coverage).

**Your three explicit asks map to findings below:**
| Your ask | Finding(s) | Severity |
|---|---|---|
| Users can actually train their agents (ML dir fixed, own venv) | G1, G2, G3, G7, G9 | HIGH |
| One script installs both npm + python "flawless" | G7 | MEDIUM |
| Get more tokens — "most of top 100" | G6, C1 | HIGH |
| Specific packages to improve algorithms/logic | P1–P8 (Section 4) | MEDIUM |

---

## 2. Audit Findings (backend, post-build)

| # | Location | Breaks | Severity | Fixable/Structural |
|---|---|---|---|---|
| **G1** | `src/ml/predict.ts:32` vs `ml/train.py:313` | Default model path `ml/models/model.joblib` is never written (train writes `model_{timestamp}.joblib`). Fresh `ml:predict` / daemon ML fails with "Model not found". | HIGH | Fixable (add `resolveLatestModel()`) |
| **G2** | `src/daemon.ts:62,238,266` / `src/cli.ts:1049` | `_mlModelId` only set inside `autoRetrain`. CLI `ml train` writes a model but daemon never sees it (`runMlPrediction` early-returns). `ml status` checks the *dir*, not models → falsely reports ready. | HIGH | Fixable |
| **G3** | `src/daemon.ts:172,199` / `src/ml/predict.ts:134` | `labelHorizon` / `--horizon` config ignored; predictions always H5. | MEDIUM | Fixable |
| **G4** | `src/api/rest.ts` + `src/index.ts:124` | Dead legacy API duplicate of every `/api/*` route. Still exported from `index.ts`, likely still tested by `src/api/rest.test.ts` (false confidence). Drift risk. | HIGH | Fixable (delete + repoint tests) |
| **G5** | `src/store/db.ts:85` | `queryAll` does positional `?` replacement with inline-escaped literals (explicitly "no binding"). A string value containing `?` corrupts param indexing or SQL. | MEDIUM | Fixable (use real prepared bindings) |
| **G6** | `src/tokens.ts:187` / `TOKENS` (L16–112) | `--dynamic` maps Binance pairs → `getTokenBySymbol` against ~49-entry registry. Top-100 coverage **impossible** without expanding registry or decoupling scan/indicators from it. | HIGH | Fixable (decouple scan from registry) |
| **G7** | `scripts/install.sh` + `scripts/setup-ml-env.sh` | No combined npm+venv installer. `install.sh` = npm only; `setup-ml-env.sh` = venv only (separate step). `requirements.txt` still carries `TODO: Use a virtual environment` comments. | MEDIUM | Fixable (build it — see SPEC §3) |
| **G10** (added) | `src/binance.ts:98` + `tokens.ts` | Only 24h window tracked. No 7d change/volume/high/low — a token up 24h but down 7d is a different regime than one up both; competitors (CryptoQuant/Glassnode) treat multi-horizon as table-stakes. | MEDIUM | Fixable (add `fetch7dStats` — SPEC §4.3) |
| **G8** | `src/daemon.ts:291,420` / `src/api/fastify/app.ts:74` | Hardcoded JWT fallback `'dev-secret-change-in-production'` (accepts known-bad secret instead of failing closed). `fastify.listen({host:'127.0.0.1'})` loopback-only, no `RADAR__HOST` env. CORS hardcoded to `crypto-radar.vercel.app` + localhost. | MEDIUM | Fixable |
| **G9** | `ml/requirements.txt` / `ml/predict.py:155` | `pandas>=3`, `numpy>=2` bleeding-edge pins; `signal.alarm` is Unix-only (no Windows ML). | LOW | Fixable |

### Retracted claim (adversarial)
Legacy `/api/health` `RADAR__START_TIME` (never set) is **not** a live bug — the legacy handler is dead (G4). Retained only as evidence of the incomplete API migration.

---

## 3. Competitor Gap Analysis

Grounded in real 2026 product capabilities (Glassnode, Santiment, CryptoQuant, Token Metrics, 3Commas/CryptoHopper, TradingView, Nansen/Arkham, Deribit/FalconX).

| Gap | Competitor evidence | Severity | Effort |
|---|---|---|---|
| **C1** Coverage ceiling (~49 vs top-100+) | CoinGecko/CoinMarketCap track 100s; TradingView screener scans full lists | HIGH | Med (decouple registry — G6) |
| **C2** Exchange-flow / derivatives positioning | CryptoQuant: Exchange Netflow, Reserve, Coinbase Premium, Funding/OI (partially via Binance futures already) | HIGH | Med (extend `src/sources/futures.ts`) |
| **C3** Social / sentiment signals | Santiment: 1,100+ on-chain + social (X/Reddit/Telegram/Discord) metrics across 2,000+ assets | HIGH | Med (add a social source; RSS ≠ sentiment) |
| **C4** Options-flow / volatility surface | Deribit/FalconX: BTC options OI now rivals futures; vol-surface signals | MEDIUM | High (new data partnership) |
| **C5** Smart-money / whale tracking | Nansen (labeled wallets), Arkham (entity deanonymization) | MEDIUM | High (on-chain indexing infra) |
| **C6** Automated trading execution | 3Commas (DCA/Grid/SmartTrade, 17+ exchanges), CryptoHopper, Pionex free bots | HIGH | Med (trading-bot API integration) |
| **C7** AI/ML maturity | Token Metrics (ML indices/ratings), deep-learning price models | MEDIUM | Med (upgrade ML stack — P3) |
| **C8** Custom screener / Pine-like scripting | TradingView Pine Screener + custom alerts | LOW | High (DSL) |

**Your top-100 ask (C1) maps directly to G6** — fixing the registry/coverage seam unlocks C1 and most of C2/C3's reach.

---

## 4. Algorithm / Package Recommendations

Prioritized high-ROI / low-effort first. "Replace" = duplicates a hand-rolled component; "Add" = new capability. **Versions verified against PyPI/npm as of 2026-07-17.**

| Priority | Package | Ver | Lang | Improves | Replaces? | Caveat |
|---|---|---|---|---|---|---|
| **P1** | `pandas-ta` | 0.4.71b0 (Sep 2025) | Python (ML) | 150+ indicators, 60+ candlestick patterns; feature engineering for ML pipeline. Already hand-roll indicators in `src/indicators.ts` — this provides a Python-side reference/alternative | **Partial replace** of hand-rolled Python-side feature gen in `src/ml/features.ts` | Original twopirllc repo archived (⚠️ maintenance mode). PyPI still hosts; community forks exist. Use python-side only (`.venv-ml`), not TS. Do NOT add `ta` (v0.11.0, Nov 2023 — unmaintained). |
| **P2** | `technicalindicators` | 3.1.0 (~Feb 2026) | TypeScript / npm | 122+ indicators (RSI, MACD, BB, ATR, Stochastic, ADX, PSAR, CCI, Keltner, ROC, VWAP, etc.), pure TS with built-in types. Can replace hand-rolled indicator compute in the daemon/scanner hot path. **Replaces `tulind` (v0.8.20, Aug 2021 — unmaintained).** | **Partial replace** of `src/indicators.ts` (keep custom indicators, use library for standard ones) | Pure TypeScript, no native deps — safe for all platforms. Does NOT include candlestick patterns (removed in v3); we already have `src/io/patterns.ts`. |
| **P3** | `catboost` | 1.2.10 (Feb 2026) | Python (ML) | Gradient boosting w/ native categorical handling, robust NaN tolerance (directly addresses F5 from prior audit), often beats LightGBM on tabular | **Companion/alternative** to LightGBM in `ml/train.py` | Different API; needs separate model training pipeline. Optional — train both and ensemble or A/B test. |
| **P4** | `optuna` | *(deferred)* | Python | Hyperparameter tuning for `train.py` (currently hardcodes params) | Add | Adds training runtime. Defer. |
| **P5** | `ccxt` | npm 4.5.64 / PyPI 4.5.66 (Jul 2026) | Both | Unified multi-exchange API → unlocks C1 (top-100 via any exchange), C2 (exchange flow), C4 (options), C6 (bot automation). Single highest-leverage pkg. | **Adds capability** (currently Binance-only via `src/binance.ts`) | Large dep (~100 exchange adapters). Rate-limit discipline needed. Has excellent TypeScript types. |
| **P6** | `river` | *(deferred)* | Python | Online/streaming learning — update model per new kline instead of nightly batch | Add | Different paradigm; care needed. Defer. |
| **P7** | `arch` | *(deferred)* | Python | GARCH volatility forecasting — novel signal class competitors (CryptoQuant) use | Add | Research-grade. Defer. |
| **P8** | `empyrical` / `mlforecast` | *(deferred)* | Python | Sharpe/Sortino/returns metrics for backtest rigor | Partial replace backtest metrics | Defer. |

**Adopt now (R5 — concrete dependency additions to `package.json` and `ml/requirements.txt`):** P1 (`pandas-ta`), P2 (`technicalindicators`), P3 (`catboost`), P5 (`ccxt`). These four add the most capability per line of deps. See the SPEC §6.2 for exact version-pinned lines to add.

**Exact dependency additions:**

Python (`ml/requirements.txt` — installs into `.venv-ml`, NOT globally):
```txt
# Added 2026-07-17 per production-readiness spec
pandas-ta>=0.4.71b0,<1                # 150+ indicators for ML feature engineering (Py side only)
catboost>=1.2.10,<2                     # Gradient boosting — alternative/complement to LightGBM, NaN-tolerant
ccxt>=4.5.66,<5                        # Unified 100+ exchange API — multi-exchange data, futures, options
```

npm (`package.json` — TypeScript dependencies):
```json
"dependencies": {
  "technicalindicators": "^3.1.0",    /* 122+ indicators, pure TS — replaces hand-rolled in src/indicators.ts */
  "ccxt": "^4.5.64"                   /* Multi-exchange API for Node — supplements src/binance.ts */
}
```

**Deferred:** P4 (`optuna`), P6 (`river`), P7 (`arch`), P8 (`empyrical`/`mlforecast`) — capability extensions for future iterations.

**Caveats flagged:** Avoid `vectorbtpro` (paid). Avoid `pytorch`/LSTM unless committing to a DL track. `ccxt` is a large dependency (~40MB installed) — evaluate impact on the Hermes plugin bundle size in `package.json` `files` array.

---

## 5. Remediation Roadmap (your explicit must-haves, priority order)

### R1 — ML trainability (G1 + G2 + G3) — HIGH, your #1 ask
- Add `resolveLatestModel()` to `src/ml/predict.ts` — glob `ml/models/model_*.joblib`, pick newest mtime; fall back to `model.joblib` if present.
- On `ml train` (CLI) **and** `autoRetrain` (daemon): persist chosen model id + norm-stats path to a stable manifest (`ml/models/MANIFEST.json` or store row) so `ml status`, `ml predict`, and daemon all resolve the same model.
- Thread `labelHorizon` / `--horizon` through daemon (`daemon.ts:172,199`) and `predict.ts:134` instead of hardcoding `5`.
- **Outcome:** "users can actually train their agents based on the signals and data we have."

### R2 — Combined npm + venv installer (G7) — MEDIUM, your #2 ask
- New `scripts/setup.sh` chaining: `npm ci && npm run build && bash scripts/setup-ml-env.sh`, then auto-export `RADAR__ML_PYTHON=.venv-ml/bin/python3` (write to a `.env` or print the export).
- Update `scripts/install.sh` one-liner + README to call `setup.sh`.
- Remove the `TODO: Use a virtual environment` comments from `ml/requirements.txt`; pin to tested versions (consider `pandas>=2,<3` / `numpy>=1.26,<2` for stability unless GPU path validated).
- **Outcome:** "a script that will install both our npm part and the python part so they are flawless."

### R3 — Token coverage top-75 + 7d + validation (G6 + G10 + C1) — HIGH, your #3 ask
- Decouple `--dynamic` from the hardcoded `TOKENS` registry: `getTopTokensByVolume(n=75)` returns **any** Binance USDT top-N pair; unknown top-75 coins run via a **synthesized** `TokenDef` (`${sym}USDT`), so indicators + generic ML features work. Registry is no longer the coverage blocker.
- **Add 7d window (your ask):** new `fetch7dStats()` in `src/binance.ts` pulls 7× 1d klines per symbol → `change7dPct`, `volume7d`, `high7d`, `low7d`; stored in `tickers` schema + `EnrichedTicker` + surfaced in `runRadar`. A token up 24h but down 7d is a different regime than one up both — competitors (CryptoQuant/Glassnode) treat multi-horizon as table-stakes.
- **Add coverage validation (your "curl all tokens" ask):** new `validateTokenCoverage()` curls the **live** Binance USDT pair set for **every** registry token, flags delisted / zero-volume pairs → `tokens --validate` prints the dead list to prune from `TOKENS`.
- **Coverage target — LOCKED:** **top-75** (your "most of top-100"), configurable via `RADAR__DYNAMIC_MAX` (default 75). Lower false-positive noise on thin/stablecoin pairs vs hard top-100.
- **Outcome:** "we need more tokens, like most of top 100" — delivered, self-validated against live pairs, with 7d regime context.

### R4 — Dead-code + production secrets (G4, G8) — MEDIUM
- Delete legacy `src/api/rest.ts` + its `index.ts:124` export + `src/api/rest.test.ts`; confirm `src/api/fastify/` is the sole live API and repoint any tests.
- JWT: in production (`NODE_ENV=production`), **fail closed** if `RADAR__JWT_SECRET` is unset/is the dev default — do not silently accept `'dev-secret-change-in-production'`.
- Add `RADAR__HOST` env (default `127.0.0.1`); drive CORS origins from env instead of hardcoded Vercel/localhost.

### R5 — (deferred) Data-source + capability gaps (C2–C7, P1–P8)
- Extend `src/sources/futures.ts` for exchange-flow (C2); add a social/sentiment source (C3); integrate `ccxt` for multi-exchange + options (C1/C2/C4/C6).
- Adopt P1–P3 + P5 packages per Section 4.

---

## 6. Open Decisions (block R3/R4 implementation)

1. **Coverage target (R3):** hard top-100, or "most of top-100" (~top-75)? → *recommend top-75, env-configurable.*
2. **Scope of first implementation pass:** R1–R3 (your stated must-haves) only, or include R4 (dead-code + secrets) in the same pass?

---

## 7. Verification Plan (post-implementation)

For each remediation, verify with real tool output (not self-report):
- **R1:** `npm run build` → `npm run ml:setup` → `node dist/cli.js ml train` → `node dist/cli.js ml predict` → `node dist/cli.js ml status` all succeed end-to-end with a resolved model; daemon prediction path resolves CLI-trained model.
- **R2:** fresh checkout → `bash scripts/setup.sh` → both `node dist/cli.js` and `.venv-ml/bin/python3 -c "import lightgbm"` succeed; no manual second step.
- **R3:** `node dist/cli.js scan --dynamic 75` returns ~75 distinct symbols; `getTopTokensByVolume(75)` not capped at registry size.
- **R4:** `grep -r "rest.ts" src/index.ts` → empty; `NODE_ENV=production` + unset secret → daemon refuses to start.
- **Tests:** `npm test` green; no test references deleted `rest.ts`.

---

## 8. Source Index (files referenced)

- `src/ml/predict.ts`, `src/ml/dataset.ts`, `src/ml/features.ts`, `ml/train.py`, `ml/predict.py`, `ml/requirements.txt`
- `src/daemon.ts`, `src/cli.ts`, `src/core/config.ts`
- `src/api/rest.ts` (legacy, dead), `src/api/fastify/{app,routes/rest,routes/auth,routes/portfolio}.ts`, `src/index.ts`
- `src/store/db.ts`, `src/tokens.ts`, `src/binance.ts`
- `scripts/install.sh`, `scripts/setup-ml-env.sh`, `scripts/crypto-radar-collector.sh`
- `plugin/__init__.py` (Hermes bridge — confirms 8 tools, no changes needed for backend scope)
