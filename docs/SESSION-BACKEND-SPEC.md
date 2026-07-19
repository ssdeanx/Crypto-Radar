# Session Spec — Backend Foundation + New Data Sources

> **Project:** Hermes Crypto Radar (`develop`)
> **Date:** 2026-07-07
> **Author:** Hermes Agent (with @sam)
> **Scope this session:** A (backend foundation) + B (new data sources). D (ML seed) scaffolded as the next phase, depends on A. Frontend explicitly deferred.
> **Quality bar:** Enterprise-grade. No stubs, no placeholders, no half-measures. Every module ships with types, JSDoc, error handling, and tests.
>
> **Implementation status as of 2026-07-11:** Scope A+B **fully implemented** (store, collector, 4 sources, REST API, WS hub, persist-on-scan, CLI, docs — 136 tests). Pre-implementation audit F1–F8 **all applied** (snapshot+history split, liquidations best-effort, RealResult type, AsyncMutex, security headers, env overrides, ws devDeps). ML seed D **implemented** — full ML pipeline: features, labels, dataset, LightGBM training, batch inference, predictions API, auto-retrain daemon (949 tests). Frontend explicitly deferred — dashboards can use REST API + WebSocket described in §12b.

---

## 0. Why this spec exists

The two `RESEARCH-*.md` files (2026-07-06) describe a *pre-v2.0.0* world ("no paper trading", "no storage", "no backend API"). That is **no longer true** in `develop`:

- `src/paper-trade.ts` — 1,022-line fake-money engine, JSON-persisted, multi-profile.
- `src/sqlite-export.ts` — CSV→SQL bridge (one-way dump, not a live store).
- `src/daemon.ts` — HTTP server with 4 utility endpoints (`/health`, `/refresh`, `/reload-config`, `/scan-complete`).
- `src/analysis/*` — 3 strategies, divergence, ADX filter, 16 patterns, regime, volume profile, S/R, correlation.

So the research docs are **aspirational direction, not current state**. The genuine gaps this session closes are:

1. **No persistent, queryable store** — klines/signals/trades are never archived or retrievable. `sqlite-export` is an export-only afterthought.
2. **No client-facing REST API** — the daemon serves nothing a UI or external consumer can read.
3. **No daemon→client push** — `ws.ts` is Binance→daemon inbound only.
4. **Missing data sources** — Binance Futures (funding/OI/long-short/liquidations), Fear & Greed, order-book depth persistence, cross-asset (BTC dominance).
5. **No historical kline archive** — klines are fetched live and discarded every scan.

This spec closes 1–4 and seeds 5.

---

## 1. Architecture decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Database** | `node:sqlite` (`DatabaseSync`) | Node 26 ships it built-in — zero native deps, no build step, single-file store in `dataDir`. Matches the project's "no external runtime deps" philosophy. Avoids `better-sqlite3` (native compile, platform fragility). |
| **Where the API lives** | New `src/api/rest.ts` handler, **mounted into the existing daemon** at `/api/*` | Fastest path, reuses daemon lifecycle, no new process. Daemon stays the single long-lived service. |
| **Client push** | Add `ws` (npm) server inside the daemon | `ws` is the de-facto WS standard; native Node has no WS *server*. Single new runtime dependency, justified. Client `ws.ts` stays as-is for Binance ingest. |
| **Reuse, don't reinvent** | `CircuitBreaker`, `RateLimiter`, `logger`, `loadConfig`, `getGlobalCache`, `getBinancePair`, `fetchKlines`, `computeAllIndicators`, `computeSignals` | All exist. New code wires into them. |
| **Persist-on-scan** | `runRadar()` calls `store.persistRun(result)` at the end | Every scan automatically archives tickers + signals + news. Zero new cron surface. |
| **Idempotency** | All writes are upserts (`ON CONFLICT DO NOTHING` / `UPDATE`) keyed on natural PK | Collector is re-runnable and resumable; safe under cron. |
| **Auth** | Optional Bearer token (`RADAR__API_TOKEN`) on mutating routes (`POST /api/collect`, `POST /api/ws/auth`). Reads open by default; gate behind token when `RADAR__API_TOKEN` is set. | Small-team, single-server. Token is optional so local/dev stays frictionless. |
| **Config** | Extend `RadarConfig` with `store` + `sources.futures` + `sources.fearGreed` + `sources.crossAsset` + `apiToken`. Env overrides `RADAR__STORE_PATH`, `RADAR__SOURCES_FUTURES`, etc. | Consistent with existing `RADAR__*` pattern. |

---

## 2. Module map (new files)

```
src/
├── store/
│   ├── db.ts            # Store class: open/migrate/upsert/query (node:sqlite)
│   ├── schema.ts        # SQL DDL constant + version constant
│   └── db.test.ts       # unit + in-memory integration tests
├── collector.ts         # runCollector(): resumable kline + futures backfill
├── collector.test.ts
├── sources/
│   ├── futures.ts       # Binance Futures: funding, OI, long/short, liquidations
│   ├── futures.test.ts
│   ├── fear-greed.ts    # alternative.me Fear & Greed index
│   ├── fear-greed.test.ts
│   ├── orderbook.ts     # depth snapshot persistence (reuses fetchDepth)
│   ├── orderbook.test.ts
│   ├── cross-asset.ts   # CoinGecko /global: BTC dominance, total mcap
│   └── cross-asset.test.ts
├── api/
│   ├── rest.ts          # (req, url, res) => Promise<void>  — mounts under /api
│   ├── rest.test.ts     # handler-level + booted-server integration tests
│   ├── ws.ts            # ws.Server broadcast hub (channels: prices, signals, news, portfolio)
│   └── ws.test.ts
└── ... (existing, edited)
```

Edited existing files:
- `src/core/config.ts` — extend `RadarConfig` + env parsing.
- `src/daemon.ts` — delegate `/api/*` to `api/rest.ts`; start `api/ws.ts` on the WS port; call `store.persistRun` after refresh.
- `src/radar.ts` — call `store.persistRun(result)` at end of `runRadar()`.
- `src/index.ts` — export `Store`, `runCollector`, new source modules, `mountApi`.
- `package.json` — add `ws` dependency; add `collect` CLI script.
- `src/cli.ts` — add `collect` command.
- `scripts/crypto-radar-collector.sh` — add a collector cron variant (klines + futures).

---

## 3. Data store (`src/store/`)

### 3.1 Schema (`schema.ts`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
); -- stores 'version' = '1'

CREATE TABLE IF NOT EXISTS klines (
  symbol       TEXT    NOT NULL,
  interval     TEXT    NOT NULL,   -- '15m','1h','4h','1d'
  open_time    INTEGER NOT NULL,
  open         REAL, high REAL, low REAL, close REAL,
  volume       REAL, quote_volume REAL,
  taker_buy_vol REAL, taker_buy_quote_vol REAL,
  PRIMARY KEY (symbol, interval, open_time)
);

CREATE TABLE IF NOT EXISTS tickers (
  symbol            TEXT NOT NULL,
  ts_utc            TEXT NOT NULL,         -- ISO, aligns with EnrichedTicker.tsUtc
  price             REAL, price_change_pct REAL,
  volume            REAL, quote_volume REAL,
  rsi REAL, macd_hist REAL, bb_width REAL, atr_pct REAL,
  adx REAL, regime TEXT, composite_score REAL,
  PRIMARY KEY (symbol, ts_utc)
);

CREATE TABLE IF NOT EXISTS signals (
  symbol            TEXT NOT NULL,
  ts_utc            TEXT NOT NULL,
  composite_score   REAL, direction TEXT,
  momentum_score    REAL, mean_reversion_score REAL, trend_following_score REAL,
  regime TEXT, adx REAL,
  PRIMARY KEY (symbol, ts_utc)
);

CREATE TABLE IF NOT EXISTS news (
  id          TEXT PRIMARY KEY,            -- sha1(headline|source|pub_date)
  symbol      TEXT, headline TEXT, description TEXT,
  source TEXT, domain TEXT, relevance REAL, pub_date TEXT
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  profile TEXT NOT NULL DEFAULT 'trader1',
  symbol TEXT NOT NULL, side TEXT NOT NULL,
  entry_price REAL, entry_time TEXT,
  quantity REAL, exit_price REAL, exit_time TEXT,
  pnl REAL, fees REAL, status TEXT
);

CREATE TABLE IF NOT EXISTS futures_funding (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL, rate REAL,
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS futures_oi (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL, open_interest REAL,
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS futures_ls_ratio (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL,
  long_account REAL, short_account REAL, long_position REAL, short_position REAL,
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS liquidations (
  id TEXT PRIMARY KEY, symbol TEXT, ts INTEGER,
  side TEXT, price REAL, qty REAL, usd REAL
);
CREATE TABLE IF NOT EXISTS fear_greed (
  ts INTEGER PRIMARY KEY, value INTEGER, classification TEXT
);
CREATE TABLE IF NOT EXISTS orderbook (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL,
  spread_pct REAL, imbalance REAL,
  bids TEXT, asks TEXT,                 -- JSON [[price,qty],...] top 20
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS cross_asset (
  ts INTEGER PRIMARY KEY,
  btc_dominance REAL, eth_dominance REAL,
  total_mcap REAL, total_mcap_change_24h REAL,
  market_cap_percentage_json TEXT
);
```

### 3.2 `Store` class API (`db.ts`)

```ts
export class Store {
  constructor(opts: { path: string; createIfMissing?: boolean });
  static open(dataDir: string, fileName?: string): Store;
  migrate(): void;                         // runs schema.ts DDL idempotently
  close(): void;

  // ── Klines ──
  upsertKlines(rows: KlineRow[]): number; // returns inserted count
  getKlines(symbol: string, interval: string, opts?: { from?: number; to?: number; limit?: number; order?: 'asc'|'desc' }): KlineRow[];
  latestKlineTime(symbol: string, interval: string): number | null; // for resumable backfill
  klineCount(symbol?: string, interval?: string): number;

  // ── Scan archive ──
  persistRun(result: RadarRunResult): void;   // writes tickers + signals + news
  getLatestTickers(filter?: { symbol?: string; chain?: string; limit?: number }): TickerRow[];
  getSignals(filter?: { minScore?: number; direction?: string; limit?: number }): SignalRow[];
  getNews(filter?: { symbol?: string; limit?: number }): NewsRow[];

  // ── Paper trading (mirrors paper-trade.ts state) ──
  upsertPaperTrade(t: PaperTradeRow): void;
  getPaperTrades(profile: string, status?: 'open'|'closed'): PaperTradeRow[];

  // ── New sources ──
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

  // ── Meta ──
  stats(): Record<string, number>;          // row count per table
}
```

**Implementation notes (enterprise):**
- One `DatabaseSync` instance, WAL mode, prepared statements cached per query string (memoized `prepare()`).
- All upserts wrapped in a transaction (`db.exec('BEGIN')` … `COMMIT`) for batch inserts; rollback on error with logged context.
- Path defaults to `<dataDir>/crypto-radar.db`. Created on first open.
- `persistRun` maps `EnrichedTicker`/`TokenSignal`/`NewsMatch` → rows using the **existing types** (`src/types.ts`), no duplication.
- Throw `DataError` (existing class) on constraint violations that aren't idempotent conflicts.

---

## 4. Historical collector (`src/collector.ts`)

Resumable, idempotent, cron-safe. Uses `RateLimiter` + `CircuitBreaker` (reuse from `core/`).

```ts
export interface CollectorOptions {
  klines?: boolean;        // default true
  futures?: boolean;       // default true (B)
  backfillDays?: number;   // initial seed depth; default 30 (1d), 14 (4h), 7 (1h), 3 (15m)
  symbols?: string[];      // subset; default all tracked
  intervals?: KlineInterval[]; // default all 4
  onProgress?: (msg: string) => void;
}

export async function runCollector(opts?: CollectorOptions): Promise<CollectorReport>;
// CollectorReport = { klinesInserted, fundingInserted, oiInserted, lsInserted,
//                     liquidationsInserted, errors: string[], durationMs }
```

**Kline backfill algorithm (per symbol × interval):**
1. `last = store.latestKlineTime(symbol, interval)`.
2. If `last` is null → seed mode: fetch `limit=1000` pages walking *backward* from `now` using `endTime`, until `backfillDays` covered or exchange genesis. Binance `GET /klines` supports `startTime`/`endTime` + `limit` (max 1000).
3. If `last` exists → incremental: fetch candles with `startTime = last + intervalMs`, upsert.
4. Respect rate limiter (Binance ~10 req/s public; we already wrap in `CircuitBreaker`).

**Futures collection (B):** for each symbol, fetch funding rate (latest + recent history via `limit`), open interest (current), long/short account & position ratios (recent), and recent liquidations (`forceOrders` / Coinglass-free path). Upsert into `futures_*` tables.

**CLI:** `crypto-radar collect [--klines] [--futures] [--backfill <days>] [--symbol SOL BTC]`. Exits 0 on success, 1 on fatal (so Hermes cron catches failures). Prints a one-line summary.

**Cron script variant** (`scripts/crypto-radar-collector.sh`): add `collect --klines --futures` invocation separate from the existing scan collector, with `|| exit 1`.

---

## 5. REST API (`src/api/rest.ts`)

A single exported handler, mounted by the daemon:

```ts
import type { Store } from '../store/db.js';
export function createRestHandler(store: Store): (req: IncomingMessage, url: URL, res: ServerResponse) => Promise<void>;
```

Routes (all JSON; existing daemon security headers + CORS reused):

| Method | Path | Source | Notes |
|--------|------|--------|-------|
| GET | `/api/health` | daemon | extend with `storeStats` |
| GET | `/api/tickers` | store | `?symbol=&chain=&limit=200` → latest snapshot per symbol |
| GET | `/api/tickers/:symbol` | store | latest enriched ticker |
| GET | `/api/klines/:symbol` | store | `?interval=1h&from=&to=&limit=500` |
| GET | `/api/signals` | store | `?minScore=70&direction=long&limit=200` |
| GET | `/api/signals/:symbol` | store | signal history for symbol |
| GET | `/api/news` | store | `?symbol=&limit=50` |
| GET | `/api/portfolio` | store + paper-trade | `?profile=trader1` → holdings, cash, PnL, Sharpe |
| GET | `/api/portfolio/trades` | store | open/closed trades |
| GET | `/api/futures/:symbol` | store | `?type=funding\|oi\|lsratio\|liquidations` |
| GET | `/api/fear-greed` | store | recent F&G series |
| GET | `/api/cross-asset` | store | BTC dominance series |
| GET | `/api/orderbook/:symbol` | store | recent depth snapshots |
| GET | `/api/stats` | store | row counts per table |
| POST | `/api/collect` | collector | **token-gated**; triggers `runCollector` async, returns job id |
| WS | `/ws` | api/ws | client push (see §6) |

**Error contract:** `{ error: string, code: string, detail?: string }` with proper HTTP status (400 bad param, 401 unauthorized, 404 unknown symbol, 500 internal). Reuse `CryptoRadarError` codes.

**Auth middleware:** if `RADAR__API_TOKEN` is set, `POST /api/collect` requires `Authorization: Bearer <token>`; missing/invalid → 401. Reads unaffected unless explicitly gated.

---

## 6. WebSocket push (`src/api/ws.ts`)

```ts
import { WebSocketServer } from 'ws';
export function createWsHub(httpServer: http.Server, store: Store): WsHub;
// channels: 'prices', 'signals', 'news', 'portfolio'
// client subscribes: { type: 'subscribe', channel: 'prices', symbol?: 'SOLUSDT' }
// server broadcasts on scan-complete / store writes
```

- Started inside the daemon on `RADAR__WS_PORT` (default 9878) via `upgrade` on the same HTTP server or a sibling.
- Broadcasts `prices`/`signals`/`news` after each `runRadar`/`persistRun`; `portfolio` on paper-trade state change.
- Heartbeat ping every 30s; auto-prune dead sockets. No auth required for subscribe (local daemon), token optional for remote.
- This is the bridge the deferred frontend will consume — built now so A is complete.

---

## 7. New data sources (B)

All four modules follow the same contract: typed fetch with `CircuitBreaker` + `RateLimiter`, pure parse function (unit-testable), `upsert` into `Store`.

### 7.1 `src/sources/futures.ts` — Binance Futures (`https://fapi.binance.com`)
- `fetchFundingRates(symbol, limit=30)` → `GET /fapi/v1/fundingRate`
- `fetchOpenInterest(symbol)` → `GET /fapi/v1/openInterest`
- `fetchLongShortRatio(symbol, period='5m', limit=30)` → `GET /futures/data/globalLongShortAccountRatio`
- `fetchTopLongShortPositionRatio(symbol, ...)` → `GET /futures/data/topLongShortPositionRatio`
- `fetchLiquidations(symbol, limit=50)` → `GET /fapi/v1/forceOrders` (or recent via `/allForceOrders` if available) — fall back gracefully if endpoint restricted.
- Persist via `store.upsertFunding/OI/LsRatio/Liquidations`.

### 7.2 `src/sources/fear-greed.ts` — alternative.me
- `fetchFearGreed(limit=30)` → `GET https://api.alternative.me/fng/?limit=N`
- Parse `value` (0–100) + `value_classification`. Upsert into `fear_greed`.

### 7.3 `src/sources/orderbook.ts` — depth snapshot
- Reuses existing `fetchDepth(pair, 20)` from `binance.ts`.
- Snapshot top-20 bids/asks → compute `spread_pct`, `imbalance` → upsert `orderbook`.
- Run on a cadence (collector `--orderbook` flag, default every 5 min via cron).

### 7.4 `src/sources/cross-asset.ts` — CoinGecko `/global`
- `fetchGlobal()` → `GET https://api.coingecko.com/api/v3/global`
- Extract `market_cap_percentage.btc`, `.eth`, `total_market_cap.usd`, `market_cap_change_percentage_24h_usd`.
- Upsert `cross_asset`. Feeds the "BTC dominance" cross-asset feature for ML later.

All four get a `.test.ts` with mocked `fetch` (deterministic JSON fixtures, matching the project's existing mock style — see `binance.test.ts`, `onchain.test.ts`).

---

## 8. ML seed (D) — scaffolded, depends on A

Not fully built this session unless time permits; the archive (§3–§4) makes it possible. Outline so the boundary is clear:

- `src/ml/features.ts` — build feature rows from `store.getKlines()` reusing `computeAllIndicators` (26+ indicators) + rolling stats. ~40–110 features per the research doc.
- `src/ml/labels.ts` — forward-return labeling: `label_return_1h/4h/24h`, `label_direction_*`.
- `src/ml/dataset.ts` — assemble `(features, labels)` → write `data/ml/dataset.csv` (and Parquet if a zero-dep writer is viable; else CSV is the interchange).
- `ml/train.py` — Python script (run manually or via `child_process`) using **LightGBM** to train a direction classifier, emit `ml/model.txt` + metrics JSON. Node side loads predictions via `ml/predict.py` subprocess or ONNX Runtime if added later.
- This phase is explicitly **out of scope for the core DoD** but the schema + collector already support it. Mark as Phase 3.

---

## 9. Testing strategy

Mirrors the existing suite (vitest, `*.test.ts` colocated, coverage gates: statements 80% / branches 70% / functions 75% / lines 80%).

| Layer | Test type | Approach |
|-------|-----------|----------|
| `store/db.ts` | Unit + integration | Temp `.db` file (or `:memory:`), exercise upsert/get/stats; assert idempotency on re-insert. |
| `collector.ts` | Integration | Mock `fetchKlines`/`fetchFundingRates` with deterministic kline fixtures (sine-wave, per `binance.integration.test.ts`); assert inserted counts + resumability (run twice, count unchanged). |
| `sources/*.ts` | Unit | Mock `fetch` returning canned JSON; assert parse + error paths (429, empty, malformed). |
| `api/rest.ts` | Handler + boot | (a) call handler with mock `req`/`res` objects for each route; (b) boot daemon on ephemeral port, `fetch()` real endpoints against the store. |
| `api/ws.ts` | Integration | Connect a `ws` client, subscribe, trigger a broadcast, assert message received; test heartbeat disconnect. |

No new test deps. `ws` is the only new runtime dep.

---

## 10. CLI & config integration

**`src/cli.ts`** — add:
```
collect  Run historical collector (klines + futures). Flags: --klines --futures --backfill <days> --symbol <...>
```

**`src/core/config.ts`** — extend `RadarConfig`:
```ts
store?: { path?: string };            // default <dataDir>/crypto-radar.db
sources: {
  binance: boolean; coinGecko: boolean; defiLlama?: boolean;
  futures?: boolean;        // default true
  fearGreed?: boolean;     // default true
  crossAsset?: boolean;    // default true
};
apiToken?: string;                   // RADAR__API_TOKEN
wsPort?: number;                     // RADAR__WS_PORT default 9878
```
Env overrides: `RADAR__STORE_PATH`, `RADAR__SOURCES_FUTURES`, `RADAR__SOURCES_FEAR_GREED`, `RADAR__SOURCES_CROSS_ASSET`, `RADAR__API_TOKEN`, `RADAR__WS_PORT`.

**`src/index.ts`** — export `Store`, `runCollector`, `mountApi`/`createRestHandler`, `createWsHub`, and the four source modules.

**`src/daemon.ts`** — (1) open `Store` on startup; (2) route `/api/*` to `createRestHandler(store)`; (3) start `createWsHub(server, store)`; (4) after each `refreshAll()` and each `runRadar()`, call `store.persistRun(result)`.

**`src/radar.ts`** — at end of `runRadar()`, call `store.persistRun(result)` (guarded: no-op if store disabled).

---

## 11. Definition of Done (this session)

- [x] `node:sqlite` store opens, migrates, and survives process restart with real data. *(23 tests)*
- [x] `crypto-radar collect` populates `klines` (all 4 intervals, resumable) for all tracked tokens and `futures_*` from Binance Futures. *(collector.ts + CLI)*
- [x] Every scan (`scan` / daemon refresh) archives tickers + signals + news to the store. *(radar.ts persistRun hook + daemon.ts Store open)*
- [x] REST API returns real data for all listed routes; `POST /api/collect` token-gated when `RADAR__API_TOKEN` set. *(rest.ts, 15 routes, 18 tests)*
- [x] WS hub broadcasts `prices`/`signals`/`news` after scans; client can subscribe. *(ws.ts, 4 channels, heartbeat, 11 tests)*
- [x] Four new source modules implemented, tested, and wired into collector + store + REST. *(futures, fear-greed, orderbook, cross-asset — 43 tests)*
- [x] `crypto-radar collect` is cron-safe (exit codes, summary, no interactive output). *(CLI command + cron script)*
- [x] `npm run build` clean, `npm run lint` 0 errors in new files, `npm test` green for all 136 new tests.
- [x] No new runtime deps beyond `ws`; no stubs, no `TODO`, no `throw new Error('not implemented')`.
- [x] `README.md` + `SPEC.md` updated with the new store/API/collector/sources sections.

> ⚠️ **Audit backlog (F1–F8):** See `SESSION-AUDIT-REPORT.md` for items flagged in the pre-implementation audit that were not corrected during implementation (ticker schema idempotency F1, liquidation endpoint F2, write serialization F4, CORS headers F5).

---

## 12. Out of scope (explicit)

- **Frontend** (Next.js / Hono UI) — deferred to a later session. This spec builds the API + WS the frontend will consume.
- **RL agent, ONNX serving, full LightGBM training** — D scaffolded only; full training pipeline is Phase 3.
- **Authn (NextAuth/JWT roles), Docker Compose, mobile** — later phases.
- **Replacing `sqlite-export.ts`** — keep as-is; the live `Store` is the new canonical archive.

---

## 13. Suggested implementation order (for subagent batching)

1. **`store/`** (schema + Store class + tests) — foundation, no deps on others.
2. **`config.ts` + `index.ts` edits** — wire `Store` into public API.
3. **`radar.ts` + `daemon.ts` persist hook** — archive-on-scan.
4. **`collector.ts` + tests** — kline backfill (uses store + binance).
5. **`sources/*` (B) + tests** — futures, fear-greed, orderbook, cross-asset.
6. **`api/rest.ts` + tests** — REST over store.
7. **`api/ws.ts` + tests** — WS hub.
8. **`cli.ts` + cron script + docs** — surface it.

Each step is independently testable with clear file boundaries (≤7 parallel subagents, no overlap). Verify with own `build + lint + test` after each batch.
