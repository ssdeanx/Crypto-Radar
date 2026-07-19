# Hermes Crypto Radar — Production Implementation Spec

> **Backend only.** Frontend (`crypto-radar-dashboard/`) is reference context.
> **Origin:** prism-full audit (2026-07-17). Build verified green (`npm run build` → exit 0); all defects below are post-build runtime/deploy seams `tsc` does not catch.
> **This document is the implementation spec** for taking the backend to production. Each section is executable: files, exact changes, acceptance criteria, verification commands.
> **Decisions locked:** Coverage target = **top-75** (env-configurable via `RADAR__DYNAMIC_MAX`, default 75). Scope = R1–R4 to production; R5 deferred (capability extensions).

---

## 0. Context — The Half-Integrated Defect

Every subsystem's *authoring* layer works (train writes a model, routes return data, registry returns tokens), but the *resolver/wiring* layer that connects produced artifacts to consumers is missing or duplicated. Three faces of one root cause — **no canonical resolver per artifact type**:

- **ML:** models are produced (`model_{ts}.joblib`) but never *discovered* by the CLI/daemon default path.
- **API:** routes are written *twice* (legacy `src/api/rest.ts` + Fastify); one copy dead at runtime.
- **Coverage:** top-volume coins are *discovered* (`fetchAllUsdtTickers`) but *filtered out* before use by the hardcoded registry.

**Attractor:** one canonical resolver per artifact type (models → `resolveLatestModel()` + MANIFEST; routes → single Fastify impl; coverage → registry-free discovery). Fixing the resolver layer closes more than half the gaps at once.

---

## 1. Audit Findings (condensed — full detail in `docs/PRODUCTION-READINESS-PLAN.md` §2)

| # | Location | Severity | Fixable |
|---|---|---|---|
| **G1** | `src/ml/predict.ts:32` vs `ml/train.py:313` | HIGH | yes — `resolveLatestModel()` |
| **G2** | `src/daemon.ts:62,238,266` / `src/cli.ts:1049` | HIGH | yes — persist model id + norm-stats |
| **G3** | `src/daemon.ts:172,199` / `src/ml/predict.ts:134` | MED | yes — thread `labelHorizon` |
| **G4** | `src/api/rest.ts` + `src/index.ts:124` | HIGH | yes — delete + repoint tests |
| **G5** | `src/store/db.ts:85` | MED | yes — real prepared bindings |
| **G6** | `src/tokens.ts:187` / `TOKENS` L16–112 | HIGH | yes — decouple scan from registry |
| **G7** | `scripts/install.sh` + `setup-ml-env.sh` | MED | yes — combined `setup.sh` |
| **G8** | `src/daemon.ts:291,420` / `app.ts:74` | MED | yes — fatal prod secret + env host/CORS |
| **G9** | `ml/requirements.txt` / `predict.py:155` | LOW | yes — pin stability + `signal.alarm` guard |
| **G10** (NEW) | `src/binance.ts:98` / `tokens.ts` | MED | yes — add 7d window (see R3) |

---

## 2. R1 — ML Trainability (G1+G2+G3) · HIGH · your #1 ask

**Goal:** A fresh user runs `ml:setup` → `ml train` → `ml predict` → `ml status` end-to-end with a resolved model. Users can actually train their agents on the signals/data.

### 2.1 `src/ml/predict.ts`
- Add:
  ```ts
  import { existsSync, readdirSync, statSync } from 'node:fs';
  import { resolve } from 'node:path';

  const MODELS_DIR = resolve(__dirname, '../../ml/models');

  /** Newest timestamped model, or model.joblib fallback, or null. */
  export function resolveLatestModel(dir = MODELS_DIR): string | null {
    if (!existsSync(dir)) return null;
    const ts = readdirSync(dir)
      .filter(f => /^model_.*\.joblib$/.test(f))
      .map(f => ({ f, m: statSync(resolve(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0];
    if (ts) return resolve(dir, ts.f);
    // fallback to legacy fixed name if present
    const legacy = resolve(dir, 'model.joblib');
    return existsSync(legacy) ? legacy : null;
  }

  /** MANIFEST.json written by train: { modelId, normStatsPath, horizon }. */
  export function loadModelManifest(dir = MODELS_DIR):
    { modelId: string; normStatsPath?: string; horizon: number } | null {
    const p = resolve(dir, 'MANIFEST.json');
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf-8')); }
    catch { return null; }
  }
  ```
- In `batchPredict`, change resolution order: `modelPath = opts.modelPath ?? loadModelManifest()?.modelId ?? resolveLatestModel() ?? DEFAULT_MODEL_PATH`.
- In `runSubprocessInference` call, if `modelPath` is a MANIFEST id (basename) but not absolute, resolve against `MODELS_DIR`.
- Replace hardcoded `horizon = 5` (`:134`) with `horizon = loadModelManifest()?.horizon ?? opts.horizon ?? 5`.

### 2.2 `ml/train.py` (write MANIFEST)
After `joblib.dump(model, …)` and `metrics_path` write, append:
```python
import json as _json
_manifest = {
    "model_id": os.path.basename(str(model_path)),
    "model_path": str(model_path),
    "metrics_path": str(metrics_path),
    "trained_at": timestamp,
    "horizon": int(os.environ.get("RADAR_ML_HORIZON", "5")),
}
with open(output_dir / "MANIFEST.json", "w") as _mf:
    _json.dump(_manifest, _mf, indent=2)
metrics["manifest_path"] = str(output_dir / "MANIFEST.json")
```
Norm-stats path is owned by the TS caller (it builds the dataset), so TS writes the manifest补全 after spawn — see 2.3.

### 2.3 `src/cli.ts` (`ml train` action ≈ L961) and `src/daemon.ts` (`autoRetrain` ≈ L127)
After training succeeds (spawn closes code 0), write MANIFEST with the TS-known norm-stats path:
```ts
import { writeFileSync } from 'node:fs';
const manifest = {
  modelId: path.basename(dataset.trainPath.replace(/\.csv$/, '')), // or parse from train stdout model_path
  normStatsPath: dataset.normalizationStats ? /* persist norm-stats to ml/models */ : undefined,
  horizon: horizon,
};
// Persist norm-stats JSON next to models so predict can load it:
const normPath = `ml/models/norm_${modelId}.json`;
writeFileSync(normPath, JSON.stringify(dataset.normalizationStats));
writeFileSync('ml/models/MANIFEST.json', JSON.stringify({ ...manifest, normStatsPath: normPath, modelId }, null, 2));
```
- Thread horizon: `daemon.ts:172` `computeLabels(closes, interval, { classHorizon: config.ml?.training?.labelHorizon ?? 5 })`; `cli.ts` already passes `--horizon` → map to `computeLabels({ classHorizon: horizon })` (currently hardcodes nothing there, good — only daemon hardcodes).
- `ml status` (`cli.ts:946`): replace `fs.existsSync('ml/models')` with `loadModelManifest()` → report `modelId`, `horizon`, and `normStatsPath` presence. Show "no model" only when manifest is null.

### 2.4 Acceptance
- [ ] `bash scripts/setup-ml-env.sh` → `node dist/cli.js ml train` → `node dist/cli.js ml predict` → `node dist/cli.js ml status` all succeed with a **resolved** model id (not "model not found").
- [ ] Daemon prediction (`runMlPrediction`) resolves a **CLI-trained** model (not only its own autoRetrain output).
- [ ] `ml status` reports horizon from MANIFEST, not a hardcoded 5.

### 2.5 Verification
```bash
npm run ml:setup
node dist/cli.js ml train --symbols SOL BTC ETH --horizon 5
node dist/cli.js ml predict --symbols SOL BTC ETH
node dist/cli.js ml status   # must show modelId + horizon, not "Models dir: exists"
```

---

## 3. R2 — Combined npm + venv Installer (G7) · MED · your #2 ask

**Goal:** One script installs both the npm part and the Python venv "flawless" — no manual second step.

### 3.1 New `scripts/setup.sh`
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "  🔧 Crypto Radar — full setup (npm + Python ML venv)"
npm ci || npm install
npm run build
bash scripts/setup-ml-env.sh
# Make the daemon/CLI use the venv Python automatically
if [ -f .venv-ml/bin/python3 ]; then
  echo "RADAR__ML_PYTHON=$(pwd)/.venv-ml/bin/python3" >> .env
  echo "  ✅ Wrote RADAR__ML_PYTHON to .env"
fi
echo "  ✅ Setup complete"
```
- `chmod +x scripts/setup.sh`.

### 3.2 `scripts/install.sh`
After `npm run build`, replace the Hermes-plugin registration tail with a call to `bash scripts/setup.sh` (or document the one-liner `bash scripts/setup.sh` as the canonical install). Update README "Development" / install section to reference `setup.sh`.

### 3.3 `ml/requirements.txt`
- Remove the `TODO: Use a virtual environment` comments (the `setup-ml-env.sh` now creates `.venv-ml`).
- Pin for stability (G9): `pandas>=2.2,<3` and `numpy>=1.26,<2` unless the GPU/`lightgbm[cuda]` path is validated on the target box. Keep `lightgbm>=4.6,<5`. Note: `predict.py:155` uses `signal.alarm` (Unix-only) — wrap in `if (process.platform !== 'win32')` equivalent in the `.py` (`if os.name == 'posix': signal.signal(signal.SIGALRM, …)`) so Windows ML predict degrades gracefully.

### 3.4 Acceptance
- [ ] Fresh clone → `bash scripts/setup.sh` → both `node dist/cli.js --version` and `.venv-ml/bin/python3 -c "import lightgbm, pandas, sklearn"` succeed with **no manual second step**.
- [ ] `.env` contains `RADAR__ML_PYTHON=…/.venv-ml/bin/python3`.

### 3.5 Verification
```bash
git stash && rm -rf node_modules dist .venv-ml .env   # clean slate (safe: stash protects work)
bash scripts/setup.sh
node dist/cli.js health
.venv-ml/bin/python3 -c "import lightgbm; print(lightgbm.__version__)"
git stash pop
```

---

## 4. R3 — Token Coverage top-75 + 7d + Validation (G6+G10+C1) · HIGH · your #3 ask

**Goal:** Track "most of top-100" → **top-75** by volume, self-validated against live Binance pairs, with **both 24h and 7d** windows. Every token must be confirmed working via the live API.

### 4.1 `src/tokens.ts` — decouple discovery from registry (G6)
- Add registry-free pair helper:
  ```ts
  export function getGenericPair(sym: string): string {
    return `${sym.toUpperCase().replace(/USDT$/, '')}USDT`;
  }
  ```
- Refactor `getTopTokensByVolume(n = 75)` (L187):
  1. `const all = await fetchAllUsdtTickers();` (already exists, `binance.ts:98`).
  2. Sort entries by `quoteVolume` desc, slice top `n`.
  3. For each, `const tok = getTokenBySymbol(sym);` — if found use the `TokenDef` (keeps onchain/news/coingeckoId); **else synthesize** `{ id: sym.toLowerCase(), sym, name: sym, chain: 'multi', coingeckoId: null }` so indicators + generic features still run.
  4. Return `TokenDef[]`. (No longer capped at registry size.)
- Add `window: '24h' | '7d' = '24h'` param. When `'7d'`, after the top-N slice, enrich each with `fetch7dStats` (4.3) and rank by 7d volume/change.
- Add **validation** (your "curl all tokens" requirement):
  ```ts
  export async function validateTokenCoverage(): Promise<{ valid: string[]; dead: string[] }> {
    const live = await fetchAllUsdtTickers();        // live USDT pair set
    const all = getAllTokens();
    const valid: string[] = []; const dead: string[] = [];
    for (const t of all) {
      const pair = getBinancePair(t);
      const row = live.get(pair);
      if (row && Number(row.quoteVolume) > 0) valid.push(t.sym);
      else dead.push(`${t.sym} (${pair})`);
    }
    return { valid, dead };
  }
  ```
  This is the explicit "curl every token and make sure they work" gate — it hits the live Binance ticker set for **every** registry token and flags delisted / zero-volume pairs.

### 4.2 `src/cli.ts` (`tokens` command ≈ L273)
- Add `--validate` flag → calls `validateTokenCoverage()` and prints `valid` count + the `dead` list (the tokens to prune from `TOKENS`).
- `--dynamic` default value becomes 75 (already reads `DYNAMIC_FLAG_TOP_N`; change its default to 75, or honor `RADAR__DYNAMIC_MAX`).

### 4.3 `src/binance.ts` — 7d window (G10)
- Add:
  ```ts
  export interface WindowStats { change7dPct: number; volume7d: number; high7d: number; low7d: number; }
  export async function fetch7dStats(symbols: string[]): Promise<Map<string, WindowStats>> {
    const out = new Map<string, WindowStats>();
    await Promise.allSettled(symbols.map(async (sym) => {
      const url = `${BASE_URL}/api/v3/klines?symbol=${getGenericPair(sym)}&interval=1d&limit=7`;
      const res = await fetchWithRetry(url);
      const rows = (await res.json()) as unknown[][];   // [openTime, open, high, low, close, volume, …]
      if (!Array.isArray(rows) || rows.length < 2) return;
      const closes = rows.map(r => parseFloat(r[4]));
      const vols = rows.map(r => parseFloat(r[5]));
      const highs = rows.map(r => parseFloat(r[2]));
      const lows = rows.map(r => parseFloat(r[3]));
      out.set(sym, {
        change7dPct: (closes.at(-1)! - closes[0]!) / closes[0]! * 100,
        volume7d: vols.reduce((a, b) => a + b, 0),
        high7d: Math.max(...highs), low7d: Math.min(...lows),
      });
    }));
    return out;
  }
  ```
  (Reuses existing `fetchWithRetry` + circuit breaker. 7 daily klines per symbol is cheap — ~75 calls batched.)

### 4.4 Schema + types — store 7d
- `src/types.ts`: extend `EnrichedTicker` with optional `change7dPct?: number; volume7d?: number; high7d?: number; low7d?: number;`.
- `src/store/schema.ts`: add to `tickers` table:
  ```sql
  change_7d_pct REAL, volume_7d REAL, high_7d REAL, low_7d REAL
  ```
- `src/store/db.ts`: include those columns in the `tickers` upsert + `getLatestTickers` mapping.

### 4.5 Surface 7d
- `runRadar` / `radar.ts`: when `fetch7dStats` data is present, attach `change7dPct` etc. to each `EnrichedTicker`.
- `src/ml/features.ts`: optionally add `change_7d_pct` as a feature row (cheap signal — a token up 24h but down 7d is a different regime than one up both). Add after 7d is available in store.

### 4.6 Acceptance
- [ ] `node dist/cli.js scan --dynamic 75` returns **~75 distinct symbols** (not capped at 49); unknown top-75 coins run via the synthesized `TokenDef`.
- [ ] `node dist/cli.js tokens --validate` curls **every** registry token and lists dead pairs (delisted / zero-volume).
- [ ] Ticker output includes `change7dPct` / `volume7d` / `high7d` / `low7d` populated from `fetch7dStats`.

### 4.7 Verification
```bash
node dist/cli.js scan --dynamic 75 --format json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log('symbols:',new Set(d.tickers.map(t=>t.symbol)).size)"
node dist/cli.js tokens --validate      # prints valid count + dead list
node dist/cli.js scan --dynamic 20 --format json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.tickers.slice(0,3).map(t=>t.symbol+':7d='+t.change7dPct))"
```

---

## 5. R4 — Dead Code + Production Secrets (G4, G8) · MED

**Goal:** Single API implementation; daemon fails closed in production instead of accepting a known-bad secret.

### 5.1 Delete legacy API
- Delete `src/api/rest.ts`.
- `src/index.ts:124`: remove `export { createRestHandler } from './api/rest.js';`.
- `src/api/rest.test.ts`: delete or repoint to assert the Fastify `restRoutes` (`src/api/fastify/routes/rest.ts`) covers the same `/api/*` paths. Confirm `src/api/fastify/` is the **sole** live API (daemon imports `createApp` only).

### 5.2 Fatal prod secret (`src/daemon.ts:291`)
```ts
const jwtSecret = process.env['RADAR__JWT_SECRET'];
if (!jwtSecret && process.env.NODE_ENV === 'production') {
  logger.fatal('RADAR__JWT_SECRET is required when NODE_ENV=production');
  process.exit(1);
}
const secret = jwtSecret ?? 'dev-secret-change-in-production';
```

### 5.3 Env-driven bind + CORS
- `src/daemon.ts:420`: `await fastify.listen({ port, host: process.env.RADAR__HOST ?? '127.0.0.1' });`
- `src/api/fastify/app.ts:74`:
  ```ts
  origin: opts.corsOrigin ?? (process.env.RADAR__CORS_ORIGINS?.split(',') ?? [
    'https://crypto-radar.vercel.app', 'http://localhost:5173', 'http://localhost:4173',
  ]),
  ```

### 5.4 Acceptance
- [ ] `grep -rn "rest.ts" src/index.ts` → empty.
- [ ] `NODE_ENV=production` + unset `RADAR__JWT_SECRET` → daemon **refuses to start** (exit 1).
- [ ] `RADAR__HOST=0.0.0.0` binds publicly; `RADAR__CORS_ORIGINS=https://x.test` drives CORS.

### 5.5 Verification
```bash
grep -rn "rest.ts" src/index.ts        # must be empty
NODE_ENV=production node dist/cli.js daemon --port 9879 & sleep 2; kill %1   # expect fatal + exit 1 in log
RADAR__HOST=0.0.0.0 node dist/cli.js daemon --port 9880 & sleep 2; curl -s localhost:9880/health; kill %1
```

---

### 6.2 Core Package Dependencies — add to existing files

**Versions verified against PyPI/npm as of 2026-07-17.** These four packages add the most capability per dependency line without bloat. All Python deps install into `.venv-ml` (never global). None replace the existing `src/binance.ts` / `src/indicators.ts` — they supplement them.

#### Add to `ml/requirements.txt` (Python — installs into `.venv-ml`)

```txt
# ── Added 2026-07-17 per production-readiness audit ──
# P1: 150+ indicators for ML feature engineering (Py-side only)
pandas-ta>=0.4.71b0,<1
# P3: Gradient boosting — NaN-tolerant alternative/complement to LightGBM
catboost>=1.2.10,<2
# P5: Unified 100+ exchange API — multi-exchange data, futures, options
ccxt>=4.5.66,<5
```

- **`pandas-ta`** v0.4.71b0 (Sep 2025, twopirllc). 150+ indicators, 60+ TA-Lib candlestick patterns. Python-side only (`.venv-ml`). ⚠️ Original repo archived (maintenance mode). PyPI still hosts; community forks exist. Do NOT add `ta` (v0.11.0, Nov 2023 — unmaintained). The TS side already hand-rolls indicators in `src/indicators.ts`; this gives the ML pipeline (`src/ml/features.ts`) an alternative feature source for Python-side experimentation.
- **`catboost`** v1.2.10 (Feb 2026, Yandex). Native handling of categorical features, robust NaN tolerance — directly addresses the F5 NaN-fill concern from prior prism audits. Optional companion to LightGBM in `ml/train.py`; can A/B test or ensemble.
- **`ccxt`** v4.5.66 (Jul 2026). Unified API for 100+ crypto exchanges (Binance, Kraken, Coinbase, Bybit, OKX, etc.) — unlocks exchange-flow data, futures, and options signals. Highest single-leverage package; enables C1 (top-100 via any exchange), C2 (exchange flow), C4 (options), C6 (bot automation). Large dep (~40MB installed); rate-limit discipline needed.

#### Add to `package.json` `dependencies` (TypeScript — npm)

```json
{
  "technicalindicators": "^3.1.0",  // P2: 122+ indicators, pure TS, built-in types
  "ccxt": "^4.5.64"                 // P5: Multi-exchange API for Node
}
```

- **`technicalindicators`** v3.1.0 (~Feb 2026). Pure TypeScript, 122+ indicators (RSI, MACD, BB, ATR, Stochastic, ADX, PSAR, CCI, Keltner, ROC, VWAP, etc.), excellent types. **Replaces unmaintained `tulind` (v0.8.20, Aug 2021).** Does NOT include candlestick patterns (removed in v3) — we already have `src/io/patterns.ts`. Safe for all platforms (no native deps). Can partially replace hand-rolled `src/indicators.ts` for standard indicators while keeping custom ones.
- **`ccxt`** v4.5.64 (Jul 2026). Same library as the Python version — same API across both stacks. Supplements `src/binance.ts` for multi-exchange data and trading automation. Built-in TypeScript declarations.

#### Not adding (deferred or excluded)
- P4 `optuna` (hyperparameter tuning) — adds training runtime; defer.
- P6 `river` (online learning) — different paradigm; defer.
- P7 `arch` (GARCH) — research-grade; defer.
- P8 `empyrical`/`mlforecast` — backtest metrics helper; defer.
- `ta` (Python, v0.11.0, Nov 2023) — unmaintained; `pandas-ta` is the right choice.
- `tulind` (npm, v0.8.20, 2021) — unmaintained; replaced by `technicalindicators`.
- `vectorbtpro` — paid license; skip.
- `pytorch`/LSTM — heavy DL infra; skip unless committing to a deep-learning track.

---

## 7. Package Implementation Details

This section provides concrete code-level guidance for integrating each of the four adopted packages. Follow the order below (least risky to most impactful), verifying with `npm test` / `npm run build` after each integration.

### 7.1 `technicalindicators` (npm) — Partial refactor of `src/indicators.ts`

**Files to change:** `package.json` (add dep), `src/indicators.ts` (add library path for standard indicators), `src/ml/features.ts` (already calls `computeAllIndicators` — refactored version returns same `TechnicalIndicators` interface).

**Phase 1 — Add library parallel path (safe, test passes unchanged):**
```ts
// src/indicators.ts — add at top
import * as ti from 'technicalindicators';
```
Add a new function that delegates to the library for *standard* indicators while keeping hand-rolled for custom ones:
```ts
/**
 * Compute standard indicators via technicalindicators library.
 * Returns only the subset that the library provides; caller merges
 * with hand-rolled custom indicators (volTrend, volVsAvg, etc.).
 */
export function computeIndicatorsLib(klines: Kline[]): Partial<TechnicalIndicators> {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  
  const rsi = ti.RSI.calculate({ values: closes, period: 14 });
  const macd = ti.MACD.calculate({
    values: closes,
    fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  });
  const bb = ti.BollingerBands.calculate({
    values: closes, period: 20, stdDev: 2,
  });
  const atr = ti.ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const stoch = ti.Stochastic.calculate({
    high: highs, low: lows, close: closes, period: 14, signalPeriod: 3,
  });
  const adx = ti.ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const obv = ti.OBV.calculate({ close: closes, volume: volumes });
  const cci = ti.CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });
  const roc = ti.ROC.calculate({ values: closes, period: 10 });
  const psar = ti.ParabolicSAR.calculate({ high: highs, low: lows, step: 0.02, max: 0.2 });
  const vwap = ti.VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes });
  
  return {
    rsi: rsi.at(-1) ?? null,
    macd: { macd: macd.at(-1)?.MACD ?? null, signal: macd.at(-1)?.signal ?? null, histogram: macd.at(-1)?.histogram ?? null },
    bb: { upper: bb.at(-1)?.upper ?? null, middle: bb.at(-1)?.middle ?? null, lower: bb.at(-1)?.lower ?? null, width: null, position: null },
    atrPct: atr.at(-1) ?? null,
    obv: obv.at(-1) ?? null,
    stochastic: { k: stoch.at(-1)?.k ?? null, d: stoch.at(-1)?.d ?? null },
    adx: adx.at(-1) ?? null,
    cci: cci.at(-1) ?? null,
    roc: roc.at(-1) ?? null,
    psar: { sar: psar.at(-1) ?? null },
    vwap: vwap.at(-1) ?? null,
    // Custom indicators (volTrend, volVsAvg, priceVsEma50, etc.) remain hand-rolled
  };
}
```

**Phase 2 — Swap computeAllIndicators to hybrid (test drift, update snapshots):**
```ts
export function computeAllIndicators(klines: Kline[]): TechnicalIndicators {
  const lib = computeIndicatorsLib(klines);            // new library path
  const hand = computeIndicatorsHandrolled(klines);    // renamed from old body
  return { ...defaults, ...lib, ...hand };             // hand wins on overlap
}
```

**Migration strategy:** Phase 1 first — deploy the library call alongside existing code. Run test suite to verify output equivalence (snapshot differences indicate library vs hand-rolled math divergence). Update any drifted test assertions. Phase 2 after confidence.

---

### 7.2 `pandas-ta` (Python) — Alternative feature path for ML

**Files to change:** `ml/requirements.txt` (add dep), `src/ml/features.ts` (no change needed), `ml/train.py` (add pandas-ta feature compute option).

The current ML pipeline: TS builds feature rows with `buildFeatures()` → writes CSV → Python reads CSV for training. The features are self-computed (26+ indicators inside `src/indicators.ts` and mapped in `src/ml/features.ts`). `pandas-ta` is an **alternative** way to compute those same features on the Python side, useful for:
- A/B testing library-computed vs hand-rolled features for model quality
- Running `ml/train.py` standalone without the TS pipeline
- Experimenting with the 60+ TA-Lib candlestick patterns that `pandas-ta` enables

**Integration pattern — add `--feature-source` flag to `ml/train.py`:**
```python
import pandas_ta as ta  # P1

parser.add_argument("--feature-source", choices=["ts", "pandas-ta"], default="ts",
    help="Feature source: 'ts' (TypeScript-computed CSV, default) or 'pandas-ta' (compute from OHLCV)")

# Inside train(), when feature_source == 'pandas-ta':
if args.feature_source == "pandas-ta":
    # Read raw klines CSV (must have OHLCV columns)
    df = pd.read_csv(data_path)
    # Compute features using pandas-ta
    df.ta.sma(close=df.close, length=10, append=True)    # adds SMA_10
    df.ta.rsi(close=df.close, length=14, append=True)     # adds RSI_14
    df.ta.macd(close=df.close, append=True)               # adds MACD_*, MACDh_*, MACDs_*
    df.ta.bbands(close=df.close, length=20, append=True)  # adds BB* columns
    df.ta.atr(high=df.high, low=df.low, close=df.close, length=14, append=True)
    df.ta.obv(close=df.close, volume=df.volume, append=True)
    df.ta.stoch(high=df.high, low=df.low, close=df.close, append=True)
    df.ta.adx(high=df.high, low=df.low, close=df.close, length=14, append=True)
    # ... extend as needed
    # pandas-ta renames columns automatically (e.g., MACD_12_26_9)
    feature_cols = [c for c in df.columns if c not in exclude_cols and c not in required_cols]
```

**Key fact:** This is purely additive — does NOT change how TS computes features. The TS pipeline still owns `buildFeatures()`. pandas-ta adds an experimentation path on the Python side. The `--feature-source ts` default preserves full backward compatibility.

---

### 7.3 `catboost` (Python) — Alternative model class

**Files to change:** `ml/requirements.txt` (add dep), `ml/train.py` (add `--model-type lightgbm|catboost` flag), `ml/predict.py` (add catboost load path), `src/ml/predict.ts` (no change — both models speak `.joblib`).

**Step 1 — Train integration (`ml/train.py`):**
```python
parser.add_argument("--model-type", choices=["lightgbm", "catboost"], default="lightgbm",
    help="Model class for training")

# Inside train(), when model_type == 'catboost':
from catboost import CatBoostClassifier  # P3

if args.model_type == "catboost":
    model = CatBoostClassifier(
        iterations=args.n_estimators,
        learning_rate=args.learning_rate,
        depth=args.num_leaves,   # Note: catboost uses depth, not num_leaves
        random_seed=args.seed,
        verbose=False,
        early_stopping_rounds=args.early_stopping if args.early_stopping > 0 else None,
        # CatBoost handles NaN natively — no imputation needed (directly addresses F5)
        nan_mode='Min',
    )
    eval_set = [(X_val, y_val)]
    if sample_weight is not None:
        model.fit(X_train, y_train, eval_set=eval_set, sample_weight=sample_weight)
    else:
        model.fit(X_train, y_train, eval_set=eval_set)
else:
    # existing LightGBM path unchanged
```

**Step 2 — Predict integration (`ml/predict.py`):**
```python
parser.add_argument("--model-type", choices=["lightgbm", "catboost"], default="lightgbm")

# Model loading — CatBoost uses its own save()/load_model() instead of joblib
if args.model_type == "catboost":
    from catboost import CatBoostClassifier
    model = CatBoostClassifier()
    model.load_model(str(model_path))   # CatBoost native format (.cbm)
else:
    model = joblib.load(str(model_path))  # lightgbm
```

**Note:** CatBoost's native format is `.cbm`, not `.joblib`. When writing `--model-type catboost`, save as `model_{ts}.cbm` instead of `.joblib`. Update `train.py` save path and `predict.py` model discovery accordingly. This keeps the two model types cleanly separated by extension.

**Config:** Add `config.ml.training.modelType = 'lightgbm' | 'catboost'` (default `'lightgbm'`). Thread through daemon's autoRetrain spawn args.

---

### 7.4 `ccxt` (npm + PyPI) — Multi-exchange data layer

**TypeScript side (`src/binance.ts` addition — does not replace, supplements):**

```ts
// src/binance.ts — add after existing code
import * as ccxt from 'ccxt';  // P5

/** Lazy-initialised multi-exchange interface. Use only for specific cross-exchange needs. */
let _exchange: ccxt.Exchange | null = null;
function getExchange(): ccxt.Exchange {
  if (!_exchange) {
    _exchange = new ccxt.pro.binance({
      enableRateLimit: true,
      options: { defaultType: 'spot' },
    });
  }
  return _exchange;
}

/** Fetch 7d stats via ccxt (fallback for tokens Binance API can't resolve). */
export async function fetch7dStatsCcxt(symbol: string): Promise<WindowStats | null> {
  try {
    const exchange = getExchange();
    const ohlcv = await exchange.fetchOHLCV(`${symbol}/USDT`, '1d', undefined, 7);
    if (!ohlcv || ohlcv.length < 2) return null;
    const closes = ohlcv.map(v => v[4] as number);
    const vols = ohlcv.map(v => v[5] as number);
    return {
      change7dPct: ((closes.at(-1)! - closes[0]!) / closes[0]!) * 100,
      volume7d: vols.reduce((a, b) => a + b, 0),
      high7d: Math.max(...ohlcv.map(v => v[2] as number)),
      low7d: Math.min(...ohlcv.map(v => v[3] as number)),
    };
  } catch (err) {
    logger.warn(`ccxt fetch7dStats failed for ${symbol}`, { error: String(err) });
    return null;
  }
}

/** Fetch exchange-flow data (netflow, reserves) — example for a single exchange. */
export async function fetchExchangeFlow(exchange: string, symbol: string): Promise<{ inflow: number; outflow: number } | null> {
  // ccxt doesn't directly provide exchange flow; this is a placeholder showing
  // the pattern. Real exchange-flow data would come from CryptoQuant's API or
  // a dedicated on-chain source. ccxt enables MULTI-exchange price/volume/funding/OI
  // which supplements the Binance-only src/binance.ts path.
  return null;
}
```

**Key fact:** ccxt is added as a *supplement* to `src/binance.ts`, not a replacement. The existing Binance REST client (`fetchAllTickers`, `fetchWithRetry`, circuit breaker) stays unchanged. ccxt adds:
- Multi-exchange price/OHLCV data (cross-check Binance prices against Kraken/Coinbase)
- Future/swap endpoints (funding rates, OI from Bybit, dYdX, OKX — currently only Binance futures)
- Options data (Deribit via ccxt)
- Exchange-agnostic orderbook snapshots

**Python side (`ml/` integration — data collection for ML features):**
```python
import ccxt  # P5

# Example: fetch klines from multiple exchanges for ML feature diversity
exchanges = {
    'binance': ccxt.binance({'enableRateLimit': True}),
    'kraken': ccxt.kraken({'enableRateLimit': True}),
}

def fetch_multi_exchange_klines(symbol='BTC/USDT', timeframe='1h', limit=200):
    data = {}
    for name, ex in exchanges.items():
        try:
            ohlcv = ex.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
            data[name] = ohlcv
        except Exception as e:
            print(f"  ⚠️ {name} failed: {e}")
    return data
```

**Risk:** ccxt is ~40MB installed. Pin in `package.json` `files` array to only include `dist/` and not the full ccxt tree in published npm tarball.

---

### 7.5 Implementation order

| Order | Package | Risk | Tests affected | Rollback |
|---|---|---|---|---|
| 1 | `technicalindicators` Phase 1 (parallel path) | Low — code not yet wired to live path | None — new function, existing path untouched | Remove import, keep hand-rolled |
| 2 | `pandas-ta` | Low — Python-side only, default `--feature-source ts` preserves existing | None | Remove dep, keep default |
| 3 | `catboost` | Medium — new `--model-type`, default `lightgbm` unchanged | Add unit test for catboost path | Remove dep, keep default |
| 4 | `technicalindicators` Phase 2 (swap) | Medium — live indicator values may shift slightly | Update snapshots in `indicators.test.ts`, `features.test.ts` | Revert to hand-rolled |
| 5 | `ccxt` | Medium — large dep, new API surface | Add integration tests (skip unless API keys) | Remove from package.json + requirements.txt |

---

## 8. Sequencing & Definition of Done

**Order:** R1 → R3 → R2 → R4 → R5(deferred). R1+R3 are your stated must-haves and unblock "users train agents" + "top-100 coverage". R2 makes install flawless. R4 is hardening (do before any public deploy).

**Definition of Done (per item):** build clean, 0 lint errors, tests green with coverage held, the item's Acceptance checklist (§2.4/3.4/4.6/5.4) all checked, no stubs/TODOs left in touched files, docs (`README.md`, `SPEC.md`) updated.

**Test additions required:**
- `src/ml/predict.test.ts` — `resolveLatestModel()` picks newest timestamped model; `loadModelManifest()` round-trips.
- `src/tokens.validate.test.ts` — `validateTokenCoverage()` flags a known-delisted pair as dead (network test; skip unless `RADAR__NETWORK_TEST=1`).
- `src/tokens.test.ts` — `getTopTokensByVolume(75)` is **not** capped at registry size (synthesize path).
- `src/binance.test.ts` — `fetch7dStats()` computes correct 7d change from mocked klines.
- `src/api/rest.test.ts` — deleted/repinted to Fastify routes (R4).

---

## 9. Source Index (files referenced)

- `src/ml/predict.ts`, `src/ml/dataset.ts`, `src/ml/features.ts`, `ml/train.py`, `ml/predict.py`, `ml/requirements.txt`
- `src/daemon.ts`, `src/cli.ts`, `src/core/config.ts`, `src/types.ts`
- `src/api/rest.ts` (legacy, delete), `src/api/fastify/{app,routes/rest,routes/auth,routes/portfolio}.ts`, `src/index.ts`
- `src/store/db.ts`, `src/store/schema.ts`, `src/tokens.ts`, `src/binance.ts`
- `scripts/install.sh`, `scripts/setup-ml-env.sh`, `scripts/setup.sh` (new)
- `plugin/__init__.py` (Hermes bridge — 8 tools, no backend changes needed)
