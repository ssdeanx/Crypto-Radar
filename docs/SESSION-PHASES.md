# Phased Implementation Plan — Backend Foundation (A) + New Sources (B)

> **Derived from:** `docs/SESSION-BACKEND-SPEC.md` (audited: `docs/SESSION-AUDIT-REPORT.md`)
> **Project:** Hermes Crypto Radar (`develop`) — TypeScript, Node v26.4.0, ESM, strict TS, vitest
> **Coverage gates (vitest.config.ts):** statements 80%, branches 70%, functions 75%, lines 80%
> **Locked decisions:** `node:sqlite` (`DatabaseSync`) built-in — NO `better-sqlite3`. `ws@^8.18.0` is the only new runtime dep. Every phase ships types + JSDoc + error handling + tests. No stubs.
> **Audit corrections applied:** snapshot/history schema split + retention (F1); liquidations best-effort via `allForceOrders`/Coinglass (F2); `persistRun` typed as `RadarResult` (F3); write `AsyncMutex` (F4); `applySecurityHeaders` (F5); extra env overrides (F6); `ws` in devDeps (F7).

---

## Status Overview (as of 2026-07-11)

### SESSION-BACKEND-SPEC scope A + B → **100% implemented**
Persistent store, collector, 4 data sources, REST API, WS hub, persist-on-scan, CLI `collect`, cron script, README/SPEC docs. 136 tests pass, `tsc` clean, `lint` 0 errors in new files.

### Audit fixes (F1–F8) → **All applied**
F1 (snapshot+history split), F2 (liquidations best-effort), F3 (RealResult type), F4 (AsyncMutex), F5 (security headers), F6 (env overrides), F7 (ws devDeps) all implemented.

### Phase 10 (ML Seed) → **Implemented**
Full ML pipeline: features, labels, dataset assembly, LightGBM training, batch inference, auto-retrain daemon, predictions API, CLI ml commands, Python env setup. 949 tests pass.

| Phase | Status | Notes |
|-------|--------|-------|
| **1** Store | ✅ Done | Schema v2 with F1 corrections |
| **2** Config/index | ✅ Done | F6 complete |
| **3** Persist-on-scan | ✅ Done | F3 applied |
| **4** Collector | ✅ Done | |
| **5** Sources (B) | ✅ Done | F2 applied |
| **6** REST API | ✅ Done | F5 applied |
| **7** WS Hub | ✅ Done | F8 done |
| **8** CLI/Cron/Docs | ✅ Done | |
| **9** Integration/Coverage | ✅ Done | 949 tests, 49 test files |
| **10** ML Seed | ✅ Done | Full ML pipeline (see v2.1.0) |

### Audit fix backlog (ordered by priority)
1. **F1 (HIGH)** — `tickers`/`signals` schema: snapshot+history split + retention
2. **F2 (HIGH)** — Liquidations endpoint: `/fapi/v1/allForceOrders` + Coinglass
3. **F4 (MED)** — Write `AsyncMutex` in `Store`
4. **F5 (MED)** — `applySecurityHeaders` for `/api/*`
5. **F6 (MED)** — Missing env vars: `RADAR__STORE_RETENTION_DAYS`, `RADAR__COINGLASS_KEY`, `orderbook` toggle
6. **F3/F7 (MED)** — Low-impact typing/devDep tweaks

---

## Phase 1 — Persistent Store (`src/store/`)

**Goal:** A `node:sqlite`-backed, idempotent, transactional store that archives scans and serves queries.
**Deps:** none.

**New files:** `src/store/schema.ts`, `src/store/db.ts`, `src/store/db.test.ts`, `src/store/index.ts`

**Schema (`schema.ts`):** single `SCHEMA_SQL` constant + `SCHEMA_VERSION = 1`. Tables (WAL on):
- `schema_meta(key TEXT PK, value TEXT)` — stores `'version'`.
- `klines(symbol TEXT, interval TEXT, open_time INTEGER, open REAL, high REAL, low REAL, close REAL, volume REAL, quote_volume REAL, taker_buy_vol REAL, taker_buy_quote_vol REAL, PRIMARY KEY(symbol, interval, open_time))`.
- `tickers(symbol TEXT PK, ts_utc TEXT, price REAL, price_change_pct REAL, volume REAL, quote_volume REAL, rsi REAL, macd_hist REAL, bb_width REAL, atr_pct REAL, adx REAL, regime TEXT, composite_score REAL)` — **snapshot, upsert by symbol**.
- `ticker_history(symbol TEXT, ts_utc TEXT, price REAL, composite_score REAL, PRIMARY KEY(symbol, ts_utc))` — **time series**.
- `signals(symbol TEXT PK, ts_utc TEXT, composite_score REAL, direction TEXT, momentum_score REAL, mean_reversion_score REAL, trend_following_score REAL, regime TEXT, adx REAL)` — **snapshot, upsert by symbol**.
- `signal_history(symbol TEXT, ts_utc TEXT, composite_score REAL, direction TEXT, PRIMARY KEY(symbol, ts_utc))`.
- `news(id TEXT PK, symbol TEXT, headline TEXT, description TEXT, source TEXT, domain TEXT, relevance REAL, pub_date TEXT)`.
- `paper_trades(id TEXT PK, profile TEXT DEFAULT 'trader1', symbol TEXT, side TEXT, entry_price REAL, entry_time TEXT, quantity REAL, exit_price REAL, exit_time TEXT, pnl REAL, fees REAL, status TEXT)` — mirrors `src/paper-trade.ts:45` `PaperTrade`.
- `futures_funding(symbol TEXT, ts INTEGER, rate REAL, PRIMARY KEY(symbol, ts))`, `futures_oi(symbol TEXT, ts INTEGER, open_interest REAL, PRIMARY KEY(symbol, ts))`, `futures_ls_ratio(symbol TEXT, ts INTEGER, long_account REAL, short_account REAL, long_position REAL, short_position REAL, PRIMARY KEY(symbol, ts))`, `liquidations(id TEXT PK, symbol TEXT, ts INTEGER, side TEXT, price REAL, qty REAL, usd REAL)`, `fear_greed(ts INTEGER PK, value INTEGER, classification TEXT)`, `orderbook(symbol TEXT, ts INTEGER, spread_pct REAL, imbalance REAL, bids TEXT, asks TEXT, PRIMARY KEY(symbol, ts))`, `cross_asset(ts INTEGER PK, btc_dominance REAL, eth_dominance REAL, total_mcap REAL, total_mcap_change_24h REAL, market_cap_percentage_json TEXT)`.

**`Store` class (`db.ts`):**
```ts
import { DatabaseSync } from 'node:sqlite';
import type { EnrichedTicker, TokenSignal, NewsMatch, Kline, Chain } from '../types.js';
import type { RadarResult } from '../radar.js';

export class Store {
  private db: DatabaseSync;
  private stmts = new Map<string, StatementSync>(); // memoized prepared statements
  private writeLock = Promise.resolve();            // F4: serialize writes
  constructor(opts: { path: string });
  static open(dataDir: string, fileName = 'crypto-radar.db'): Store;
  migrate(): void;                                  // exec SCHEMA_SQL idempotently
  close(): void;

  private prepare(sql: string): StatementSync;      // memoized
  private withWrite<T>(fn: () => T): T;             // chains on writeLock; BEGIN/COMMIT/ROLLBACK

  upsertKlines(rows: KlineRow[]): number;
  getKlines(symbol: string, interval: string, o?: { from?: number; to?: number; limit?: number; order?: 'asc'|'desc' }): KlineRow[];
  latestKlineTime(symbol: string, interval: string): number | null;
  klineCount(symbol?: string, interval?: string): number;

  persistRun(result: RadarResult, retentionDays?: number): void; // F3: real type
  getLatestTickers(filter?: { symbol?: string; chain?: string; limit?: number }): TickerRow[];
  getSignals(filter?: { minScore?: number; direction?: string; limit?: number }): SignalRow[];
  getNews(filter?: { symbol?: string; limit?: number }): NewsRow[];

  upsertPaperTrade(t: PaperTradeRow): void;
  getPaperTrades(profile: string, status?: 'open'|'closed'): PaperTradeRow[];

  upsertFunding(rows: FundingRow[]): number;
  upsertOpenInterest(rows: OIRow[]): number;
  upsertLsRatio(rows: LsRatioRow[]): number;
  upsertLiquidations(rows: LiquidationRow[]): number;
  upsertFearGreed(row: FearGreedRow): void;
  upsertOrderBook(row: OrderBookRow): void;
  upsertCrossAsset(row: CrossAssetRow): void;
  getFunding(symbol: string, limit?: number): FundingRow[];
  getOpenInterest(symbol: string, limit?: number): OIRow[];
  getLsRatio(symbol: string, limit?: number): LsRatioRow[];
  getLiquidations(symbol?: string, limit?: number): LiquidationRow[];
  getFearGreed(limit?: number): FearGreedRow[];
  getOrderBook(symbol: string, limit?: number): OrderBookRow[];
  getCrossAsset(limit?: number): CrossAssetRow[];
  stats(): Record<string, number>;
}
```
- `persistRun` maps `result.tickers` (EnrichedTicker[]), `result.signals` (TokenSignal[]), `result.newsMatches` (NewsMatch[]) → snapshot upserts + history inserts, wrapped in `withWrite`. Applies retention `DELETE ... WHERE ts_utc < datetime('now', '-N days')`.
- All upserts use `INSERT ... ON CONFLICT(... ) DO UPDATE` (idempotent). Batch via `withWrite` transaction.

**Tests (`db.test.ts`):** (1) open `:memory:` + migrate → `stats()` shows tables; (2) `upsertKlines` twice same rows → count unchanged (idempotent); (3) `persistRun` with 2 tickers → `getLatestTickers` returns 2, re-run updates (snapshot upsert) + history grows; (4) `latestKlineTime` after insert; (5) `getSignals({minScore:70})` filters; (6) retention deletes old history rows.

**Acceptance:** build clean; `:memory:` + file DB both work; idempotent upserts verified; coverage gates hold for `src/store`.

---

## Phase 2 — Config & Public-API wiring

**Goal:** Expose `Store` + collector + sources through `RadarConfig`, env overrides, and `src/index.ts`.
**Deps:** Phase 1.

**Edited:** `src/core/config.ts`, `src/index.ts`, `package.json`.

**`config.ts` additions:**
```ts
store?: { path?: string; retentionDays?: number }; // default 30
sources: { binance: boolean; coinGecko: boolean; defiLlama?: boolean;
  futures?: boolean; fearGreed?: boolean; crossAsset?: boolean; orderbook?: boolean };
apiToken?: string;        // RADAR__API_TOKEN
wsPort?: number;          // RADAR__WS_PORT default 9878
coinglassKey?: string;    // RADAR__COINGLASS_KEY
```
Env map (F6): `RADAR__STORE_PATH`, `RADAR__STORE_RETENTION_DAYS`, `RADAR__SOURCES_FUTURES`, `RADAR__SOURCES_FEAR_GREED`, `RADAR__SOURCES_CROSS_ASSET`, `RADAR__SOURCES_ORDERBOOK`, `RADAR__API_TOKEN`, `RADAR__WS_PORT`, `RADAR__COINGLASS_KEY`. Add `ws@^8.18.0` to `dependencies` **and** `devDependencies` (F7).

**`index.ts`:** export `Store`, `runCollector`, `createRestHandler`, `createWsHub`, and `src/sources/*`, `src/collector.ts`.

**Tests:** `config.test.ts` already exists — extend with new env overrides. `index.test.ts` (if present) — assert new exports resolve.

**Acceptance:** `loadConfig()` parses all new `RADAR__*` vars; `Store.open(dataDir)` default path correct; `tsc` clean with new exports.

---

## Phase 3 — Persist-on-scan hook

**Goal:** Every scan + daemon refresh archives to the store automatically.
**Deps:** Phase 1, 2.

**Edited:** `src/radar.ts`, `src/daemon.ts`.

**`radar.ts`:** at end of `runRadar()` (after `log.info('Scan complete...')`, `:304`), guard-call `Store.open(config.dataDir).persistRun(result, config.store?.retentionDays)`. Use a module-level lazy `Store` singleton (`getStore()`) so repeated scans reuse one connection. On failure, `log.warn` (never throw — archiving must not break a scan).

**`daemon.ts`:** in `refreshAll()` (`:88`), after `prewarmKlines()`, call `getStore().persistRun(lastResult)` — but `refreshAll` only warms caches, it doesn't run a full `runRadar`. **Correct integration:** add a `runAndPersist()` that calls `runRadar()` then `persistRun`, invoked by the daemon's periodic refresh (replace or augment `refreshAll`), and `/refresh` endpoint returns updated `storeStats`.

**Tests:** `radar.test.ts` — spy on `Store.persistRun`, assert called with `RadarResult` shape; failure path logs warn, doesn't throw.

**Acceptance:** a `scan` writes rows to a temp-store (inject path via config); daemon refresh persists; scan still succeeds if store open fails.

---

## Phase 4 — Historical Kline Collector (`src/collector.ts`)

**Goal:** Resumable, idempotent, cron-safe kline + futures backfill.
**Deps:** Phase 1, 2, 7 (futures source).

**New:** `src/collector.ts`, `src/collector.test.ts`.

**Algorithm (per symbol × interval, confirmed vs Binance `/api/v3/klines`):**
- Interval ms: `{'15m':900_000,'1h':3_600_000,'4h':14_400_000,'1d':86_400_000}`.
- `last = store.latestKlineTime(symbol, interval)`.
- **Seed (last==null):** `endTime = now`; loop `fetchKlines(symbol, interval, 1000, {endTime})` (extend `fetchKlines` to accept `startTime/endTime` — see note); `endTime = firstRow.openTime - 1`; until covered `backfillDays` or `openTime < now - backfillDays*86400_000`.
- **Incremental (last!=null):** `fetchKlines(symbol, interval, 1000, {startTime: last + intervalMs})`; upsert.
- Reuse existing `CircuitBreaker`/`RateLimiter` from `src/binance.ts`. Respect `RADAR__CACHE_TTL_MS`/rate limits.

**`fetchKlines` extension (Phase 1/4 joint edit in `binance.ts`):** add optional `{ startTime?, endTime?, limit? }` 4th arg; build query string conditionally. Existing callers unaffected (default undefined).

**`runCollector(opts)`** returns `CollectorReport { klinesInserted, fundingInserted, oiInserted, lsInserted, liquidationsInserted, errors: string[], durationMs }`. Exit 0 on success, 1 on fatal (cron catches).

**Tests:** mock `fetchKlines` with deterministic sine klines; run twice → second run inserts 0 (resumable); seed mode covers `backfillDays`; error path returns non-zero summary.

**Acceptance:** collector populates `klines` for all 4 intervals resumably; idempotent; cron-safe exit codes; coverage holds.

---

## Phase 5 — New Data Sources (B)

**Goal:** Four typed, tested source modules persisting to the store.
**Deps:** Phase 1, 2.

**New:** `src/sources/futures.ts`, `fear-greed.ts`, `orderbook.ts`, `cross-asset.ts` + 4 `.test.ts`.

### 5a `futures.ts` — `https://fapi.binance.com`
- `fetchFundingRates(symbol, limit=30)` → `GET /fapi/v1/fundingRate?symbol=&limit=` → `[{symbol, fundingTime, fundingRate}]`.
- `fetchOpenInterest(symbol)` → `GET /fapi/v1/openInterest?symbol=` → `{symbol, openInterest, time}`.
- `fetchLongShortRatio(symbol, period='5m', limit=30)` → `GET /futures/data/globalLongShortAccountRatio?symbol=&period=&limit=` → `[{symbol, longShortRatio, longAccount, shortAccount, timestamp}]`.
- `fetchTopLongShortPositionRatio(symbol, period, limit)` → `GET /futures/data/topLongShortPositionRatio` → `[{symbol, longAccount, shortAccount, timestamp}]`.
- `fetchLiquidations(symbol, limit=50)` → **`GET /fapi/v1/allForceOrders?symbol=&limit=`** (F2; public, recent-window only). On 401/403 → return `[]` + log warn (Coinglass fallback if `RADAR__COINGLASS_KEY` set: `GET https://open-api-v3.coinglass.com/api/futures/liquidation?symbol=&limit=`, header `accept: application/json;charset=utf-8;api_key=...`). Never throw.
- All wrapped in `CircuitBreaker`; pure parse fns unit-tested. Upsert via `store.upsertFunding/OI/LsRatio/Liquidations`.
- **Refs:** https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History , .../Open-Interest , .../Long-Short-Ratio.

### 5b `fear-greed.ts` — alternative.me
- `fetchFearGreed(limit=30)` → `GET https://api.alternative.me/fng/?limit=N` → `{data:[{value, value_classification, timestamp, time_until_update}]}`. `ts = Number(d.timestamp)*1000`. Upsert `fear_greed`.
- **Ref:** https://api.alternative.me/fng/?limit=1

### 5c `orderbook.ts` — reuse `fetchDepth`
- `fetchAndStoreOrderBook(store, pair, limit=20)`: `const d = await fetchDepth(pair, limit)` (exists `src/binance.ts:192`); `spread_pct = (bestAsk-bestBid)/mid*100`; `imbalance = (bidVol-askVol)/(bidVol+askVol)`; `bids/asks` → JSON top 20. Upsert `orderbook`. Cadence: collector `--orderbook` flag, default every 5 min via cron.

### 5d `cross-asset.ts` — CoinGecko
- `fetchGlobal()` → `GET https://api.coingecko.com/api/v3/global` → `{data:{market_cap_percentage:{btc,eth}, total_market_cap:{usd}, market_cap_change_percentage_24h_usd}}`. Upsert `cross_asset`.
- **Ref:** https://api.coingecko.com/api/v3/global

**Tests (per module):** mock `fetch` returning canned JSON (funding array, fng `data[]`, depth bids/asks, global `data`); assert parse + DB upsert count; 401/403 path → `[]`/skip; malformed → logged, no throw.

**Acceptance:** all four modules persist real-shaped data; liquidations never block; coverage holds for `src/sources`.

---

## Phase 6 — REST API (`src/api/rest.ts`)

**Goal:** Client-facing JSON API over the store, mounted into the daemon.
**Deps:** Phase 1, 3.

**New:** `src/api/rest.ts`, `src/api/rest.test.ts`.

**`createRestHandler(store: Store): (req: IncomingMessage, url: URL, res: ServerResponse) => Promise<void>`** — routes:
`GET /api/health` (extend daemon stats w/ `store.stats()`), `/api/tickers[?symbol&chain&limit]`, `/api/tickers/:symbol`, `/api/klines/:symbol[?interval&from&to&limit]`, `/api/signals[?minScore&direction&limit]`, `/api/signals/:symbol`, `/api/news[?symbol&limit]`, `/api/portfolio[?profile]`, `/api/portfolio/trades[?profile&status]`, `/api/futures/:symbol[?type=funding|oi|lsratio|liquidations]`, `/api/fear-greed`, `/api/cross-asset`, `/api/orderbook/:symbol`, `/api/stats`, `POST /api/collect` (token-gated via `RADAR__API_TOKEN`; triggers `runCollector` async, returns `{jobId}`).

**Auth (F5/audit §5):** extract `applySecurityHeaders(res)` helper in `daemon.ts`; call it from `rest.ts` too. `POST /api/collect` requires `Authorization: Bearer <RADAR__API_TOKEN>` when token set; else 401. Reads open.

**Error contract:** `{error, code, detail?}` + proper status (400/401/404/500); reuse `CryptoRadarError` codes (`src/core/errors.ts`).

**Daemon mount (`daemon.ts`):** after OPTIONS handling, `if (pathname.startsWith('/api/')) { return restHandler(req, url, res); }` — `restHandler` built from `createWsHub`/`createRestHandler` sharing the Store opened at startup.

**Tests:** (1) handler-level with mock `req`/`res` per route; (2) booted-server: reuse `daemon.test.ts` harness, start on ephemeral port, `fetch()` real endpoints against a temp-store. (F7: `ws` in devDeps.)

**Acceptance:** all routes return real data; auth gates `POST /api/collect`; handler + booted tests green; coverage holds for `src/api`.

---

## Phase 7 — WebSocket Push Hub (`src/api/ws.ts`)

**Goal:** Daemon→client live push (prices/signals/news/portfolio).
**Deps:** Phase 3, 6.

**New:** `src/api/ws.ts`, `src/api/ws.test.ts`. Add `ws@^8.18.0`.

**`createWsHub(server: http.Server, store: Store): WsHub`** — `new WebSocketServer({ server })` (shared port, F8). Protocol:
```
client → {type:'subscribe', channel:'prices'|'signals'|'news'|'portfolio', symbol?}
server → {type:'prices'|'signals'|'news'|'portfolio', symbol?, data, ts}
```
- Broadcast on `persistRun` (prices/signals/news) and paper-trade state change (portfolio).
- Heartbeat: `ws.ping()` every 30s; terminate on `pong` timeout.
- No conflict with `src/ws.ts` (Binance inbound) — separate module/concern (audit §6).
- **Ref:** https://github.com/websockets/ws#server-example (WebSocketServer options, ping/pong).

**Tests:** connect a `ws` client, subscribe, trigger broadcast (via `hub.broadcast('prices', {...})`), assert message received; heartbeat disconnect after timeout.

**Acceptance:** subscribe/broadcast works; heartbeat prunes dead sockets; no port conflict; coverage holds.

---

## Phase 8 — CLI `collect` + Cron + Docs

**Goal:** Surface the collector + document everything.
**Deps:** Phase 4, 5.

**Edited:** `src/cli.ts`, `scripts/crypto-radar-collector.sh`, `README.md`, `SPEC.md`.

**`cli.ts`:** add (commander, mirrors `scan` at `cli.ts:60`):
```ts
program.command('collect')
  .description('Backfill historical klines + futures data into the local store')
  .option('--klines', 'Collect OHLCV history', true)
  .option('--futures', 'Collect Binance Futures metrics', true)
  .option('--orderbook', 'Snapshot order books', false)
  .option('--backfill <days>', 'Seed depth in days', '30')
  .option('--symbol <s...>', 'Subset of symbols')
  .action(async (opts) => { const r = await runCollector(opts); console.log(JSON.stringify(r)); process.exit(r.errors.length ? 1 : 0); });
```

**Cron (`scripts/crypto-radar-collector.sh`):** add a `collect` variant: `node dist/cli.js collect --klines --futures || exit 1`.

**Docs:** README "Backend API" + "Data Store" sections; SPEC.md schema + endpoints.

**Tests:** `cli.integration.test.ts` — invoke `collect --symbol SOL --backfill 1` against temp store; assert exit 0 + rows inserted (reuse existing CLI harness patterns).

**Acceptance:** `crypto-radar collect` runs + cron-safe; README/SPEC updated; coverage holds.

---

## Phase 9 — Integration & Coverage Gate

**Goal:** Whole-pipeline verification.
**Deps:** 1–8.

**New/Edited:** `src/integration-smoke.test.ts` (exists) — extend: boot daemon w/ temp store, run `collect` (mocked fetch), hit `/api/tickers` + `/api/klines/SOLUSDT` + `/api/futures/SOLUSDT?type=funding` + WS subscribe, assert live data flows end-to-end.

**Acceptance:** `npm run build` clean, `npm run lint` 0 errors, `npm test` green, **coverage gates met across all new `src/store`, `src/sources`, `src/api`, `src/collector`**.

---

## Phase 10 — ML Seed Scaffold (DEFERRED — NOT IMPLEMENTED)

**Goal:** A complete feature engineering → dataset → training → prediction pipeline that uses the persistent store (Phase 1) + collector (Phase 4) as its data source. Ready to build in a follow-up session.
**Deps:** Phase 1 (store → `getKlines()`/`getFunding()`/`getCrossAsset()`) + Phase 4 (backfill → sufficient history). No other Phase deps.

### 10.1 Directory structure (to be created)

```
src/ml/
├── features.ts          # Feature builders: 40–110 columns from store + indicators
├── features.test.ts     # Unit tests with deterministic kline fixtures
├── labels.ts            # Forward-return label generation
├── labels.test.ts
├── dataset.ts           # Assemble (features, labels) → CSV/Parquet, split, normalize
├── dataset.test.ts
├── predict.ts           # Load model, score latest window, emit SignalRow to store
├── predict.test.ts
├── train.ts             # Node orchestration: spawn Python training, parse metrics
└── types.ts             # FeatureRow, LabelRow, MLConfig, ModelMetadata
ml/
├── requirements.txt     # lightgbm, numpy, pandas, scikit-learn, joblib
├── train.py             # LightGBM classifier training script
├── predict.py           # Load model, accept feature vector, return prediction
└── models/              # Trained .joblib/.txt files (gitignored)
```

### 10.2 Feature engineering (`src/ml/features.ts`)

Feature extraction per `(symbol, interval, open_time)` — reuses existing `computeAllIndicators()` from `src/indicators.ts` which already computes 26+ indicators.

**Base features from klines (via `store.getKlines(symbol, interval)`):**
- OHLCV: `open, high, low, close, volume, quote_volume` (raw + log)
- Returns: `return_1, return_5, return_10, return_20, return_60` — `(close[t] - close[t-n]) / close[t-n]`
- Log returns: `log_return_1, log_return_5, log_return_10`
- Volume ratios: `volume_sma_5, volume_sma_20, volume_ratio` — `volume[t] / sma(volume, n)`

**Technical indicator features (reuse `computeAllIndicators`):**
- RSI, MFI, Williams %R, TSI, ROC, CCI, Fisher, Mass Index
- MACD: `macd_macd, macd_signal, macd_histogram`
- Bollinger: `bb_width, bb_position` — `(close - bb_lower) / (bb_upper - bb_lower)`
- Keltner: `keltner_width, keltner_position`
- ATR%, StochRSI K/D, ADX, Chaikin Osc, Force Index
- EMA slope: `ema50_dist_pct` — `(close - ema50) / ema50 * 100`
- OBV trend: `obv` normalized by z-score over window
- Elder Ray: `elder_bull_power, elder_bear_power`

**Regime features (existing `detectRegime` in `src/analysis/regime.ts`):**
- `regime_adx, regime_bb_width, regime_atr_pct, regime_vol_ratio` — rolled 5/10/20 window means

**Cross-asset features (from `store.getCrossAsset()`):**
- `btc_dominance, btc_dominance_delta_1h, btc_dominance_delta_24h`
- `total_mcap, total_mcap_change_24h`
- `btc_dominance_zscore` — normalized across the dataset window

**Futures features (from `store.getFunding()`):**
- `funding_rate, funding_rate_sma_5, funding_rate_diff_1h` (where available)
- `oi_change_1h` — open interest delta

**Feature interface:**
```ts
export interface FeatureRow {
  symbol: string;
  interval: string;
  open_time: number;
  // ~40–110 float features computed from the above
  [featureName: string]: unknown;
}
```

**Implementation detail:** `buildFeatures(symbol, interval, klines, opts)` — takes `Kline[]` from store, computes all indicators for each window position, aligns cross-asset/futures by timestamp. Returns `FeatureRow[]`.

### 10.3 Label generation (`src/ml/labels.ts`)

Forward-return labeling at multiple horizons. Key insight: labels require knowing *future* close prices, so they must be computed from rows with `n` lookahead.

```ts
export interface LabelRow {
  symbol: string;
  interval: string;
  open_time: number;
  label_return_1: number;   // (close[t+1] - close[t]) / close[t]
  label_return_5: number;
  label_return_20: number;
  label_return_60: number;
  label_direction_1: number; // sign(label_return_1): -1, 0, 1
  label_direction_5: number;
  label_direction_20: number;
  label_direction_60: number;
  label_class_5: number;     // tri-class: -1 (drop>threshold), 0 (neutral), 1 (rise>threshold)
}
```

**Horizons map:** `{ '15m': {1:15,5:75,20:300}, '1h': {1:60,5:300,20:1200}, '4h': {1:240,5:1200,20:4800}, '1d': {1:1440,5:7200,20:28800} }` (minutes).

Labels can only be computed for rows where the lookahead window exists. The last N rows of the kline array produce `null` labels — they are for scoring, not training.

### 10.4 Dataset assembly (`src/ml/dataset.ts`)

```ts
export interface DatasetOpts {
  symbols?: string[];
  intervals?: KlineInterval[];
  fromTime?: number;
  toTime?: number;
  labelHorizon: 1 | 5 | 20 | 60;     // which label to use for training
  testSplit?: number;                 // default 0.15
  valSplit?: number;                  // default 0.15
  normalize?: boolean;                // z-score by feature across training set
  excludeFeatures?: string[];         // drop columns
  outputPath?: string;                // write CSV to disk (default data/ml/)
}
```

**Algorithm:**
1. For each `(symbol, interval)`, call `store.getKlines(symbol, interval, { from: fromTime, to: toTime })`
2. Build feature rows via `buildFeatures()` 
3. Build label rows via `computeLabels(klines, horizon)` — aligns by `open_time`
4. Inner-join features + labels on `(symbol, interval, open_time)`
5. Drop rows with `NaN`/`Infinity` features
6. Chronological split: sort by `open_time`, split `[0..N-splitVal-test]` training, `[..N-splitVal]` validation, `[N-splits...]` test
7. Z-score normalize features using training set statistics (record mean/std per feature for inference)
8. Write `data/ml/dataset_{hash}.csv` with header row
9. Return `{ trainPath, valPath, testPath, featureCount, rowCount, normalizationStats }`

### 10.5 Training script (`ml/train.py`)

```python
# ml/train.py — LightGBM Direction Classifier
# Usage: python3 ml/train.py --data data/ml/dataset.csv --output ml/models/

import lightgbm as lgb
import pandas as pd
import numpy as np
import json, sys, argparse
from sklearn.metrics import accuracy_score, roc_auc_score, f1_score, confusion_matrix

def train(data_path: str, output_dir: str):
    df = pd.read_csv(data_path)
    # Split on open_time (chronological)
    times = df['open_time'].unique().sort()
    split_val = int(len(times) * 0.7)
    split_test = int(len(times) * 0.85)

    train_idx = df['open_time'].isin(times[:split_val])
    val_idx = df['open_time'].isin(times[split_val:split_test])
    test_idx = df['open_time'].isin(times[split_test:])

    # Feature columns: all float columns not in (symbol, interval, open_time, label_*)
    exclude = {'symbol','interval','open_time'} | {c for c in df.columns if c.startswith('label_')}
    features = [c for c in df.columns if c not in exclude and df[c].dtype in (float, int)]

    X_train = df.loc[train_idx, features].values
    y_train = df.loc[train_idx, 'label_class_5'].values  # tri-class
    X_val = df.loc[val_idx, features].values
    y_val = df.loc[val_idx, 'label_class_5'].values
    X_test = df.loc[test_idx, features].values
    y_test = df.loc[test_idx, 'label_class_5'].values

    model = lgb.LGBMClassifier(
        n_estimators=1000, learning_rate=0.03, num_leaves=31,
        class_weight='balanced', early_stopping_rounds=50, random_state=42
    )
    model.fit(X_train, y_train, eval_set=[(X_val, y_val)])

    preds = model.predict(X_test)
    probs = model.predict_proba(X_test)

    metrics = {
        'accuracy': accuracy_score(y_test, preds),
        'f1_weighted': f1_score(y_test, preds, average='weighted'),
        'auc_ovr': roc_auc_score(y_test, probs, multi_class='ovr'),
        'test_samples': len(y_test),
        'features': len(features),
        'feature_importance': dict(zip(features, model.feature_importances_.tolist()))
    }

    import joblib
    model_path = f"{output_dir}/model_{datetime.now():%Y%m%d_%H%M}.joblib"
    joblib.dump(model, model_path)
    with open(f"{output_dir}/metrics_{datetime.now():%Y%m%d_%H%M}.json", 'w') as f:
        json.dump({**metrics, 'model_path': model_path}, f, indent=2)
```

### 10.6 Node-side prediction (`src/ml/predict.ts`)

Loads the most recent model, scores the latest feature window, writes `SignalRow` predictions to the store.

```ts
export interface PredictionResult {
  symbol: string;
  open_time: number;
  direction: -1 | 0 | 1;
  confidence: number;      // probability of predicted class
  probs: number[];         // all class probabilities
  horizon: number;
}

export async function predictLatest(
  store: Store,
  opts: { modelPath?: string; symbols?: string[]; interval?: string; horizon?: number }
): Promise<PredictionResult[]>;
```

**Inference pipeline:**
1. For each symbol, fetch latest klines from store (last 200)
2. Build feature row via `buildFeatures()` (same function as training)
3. Apply stored normalization (z-score using training means/stds)
4. Spawn `python3 ml/predict.py --model <path>` via `child_process`, pipe CSV feature row to stdin
5. Parse stdout JSON: `{ direction, probabilities }`
6. Write prediction as `SignalRow` to the store via `store.persistRun` or a dedicated `upsertPredictions` method

**Alternative (lower-latency):** ONNX Runtime via `onnxruntime-node` — convert LightGBM model to ONNX format, load directly in Node without Python subprocess. Add as `onnxruntime-node` dep when ready. Trades Python ecosystem for latency.

### 10.7 ML configuration (`RadarConfig` additions)

```ts
ml?: {
  enabled?: boolean;           // default false
  training?: {
    symbols?: string[];
    intervals?: string[];
    lookbackDays?: number;     // default 90
    labelHorizon?: 1 | 5 | 20 | 60;
    retrainIntervalHours?: number;  // auto-retrain every N hours
  };
  prediction?: {
    symbolInterval?: string;       // default '1h'
    minConfidence?: number;        // default 0.6, skip predictions below this
    modelPath?: string;            // override model file
  };
};
```

Env overrides: `RADAR__ML_ENABLED`, `RADAR__ML_LOOKBACK_DAYS`, `RADAR__ML_RETRAIN_HOURS`, `RADAR__ML_MIN_CONFIDENCE`.

### 10.8 CLI extension (future)

```
crypto-radar ml train [--symbols SOL BTC] [--horizon 5] [--lookback 90]
crypto-radar ml predict [--symbols SOL] [--interval 1h]
crypto-radar ml status                       # model age, last metrics, feature count
```

### 10.9 Testing strategy

| Module | Approach |
|--------|----------|
| `features.ts` | Build features from known kline series (sine-wave fixture); assert shape, no NaN, specific indicator values (RSI should be 50 for flat market) |
| `labels.ts` | Given N klines with known prices, assert forward returns match manual calc; assert last N have null labels |
| `dataset.ts` | Full end-to-end: build features+labels, assert CSV output has correct row/col count; test normalization roundtrip |
| `predict.py` | Unit tests with mocked model; assert JSON output format |
| `predict.ts` | Mock `src/ml/predict.py` subprocess; test store write |

### 10.10 Acceptance criteria

- [`]` `src/ml/features.ts` produces feature rows with no NaN/Infinity from real kline data
- [`]` `src/ml/labels.ts` produces correct forward returns (verified against spreadsheet calc)
- [`]` `src/ml/dataset.ts` writes CSV that LightGBM can read (verified by `ml/train.py --dry-run`)
- [`]` `ml/train.py` produces `model.joblib` + `metrics.json` with AUC > 0.55 (better than random)
- [`]` `src/ml/predict.ts` writes predictions as `SignalRow` to store
- [`]` All new code meets existing coverage gates
- [`]` `npm run build` clean, `npm run lint` 0 errors

### 10.11 Dependencies to add

**Node:** none initially (Python subprocess). If using ONNX Runtime later: `onnxruntime-node`.

**Python (`ml/requirements.txt`):**
```
lightgbm>=4.0
pandas>=2.0
numpy>=1.24
scikit-learn>=1.3
joblib>=1.3
```

No new Node runtime deps. Python is assumed available (the Hermes agent plugin model already depends on Python).

### 10.12 Deferral note

Phase 10 is fully specified but **not implemented**. The store (Phase 1) + collector (Phase 4) already archive all the data this pipeline needs — klines go back `backfillDays`, funding/OI/cross-asset are persisted. Nothing in Phases 1–8 needs to change for ML to work.

---

## Phase order & subagent batching

1→2→3→4 (store, config, persist, collector) → 5 (sources) → 6 (REST) → 7 (WS) → 8 (CLI/docs) → 9 (integration) ; 10 deferred.
Each phase has clear file boundaries (≤7 parallel subagents, no overlap). **Verify with own `build + lint + test` after each batch** — do not trust subagent "done" status without running the suite (observed: delegation model override failures produce empty output).
