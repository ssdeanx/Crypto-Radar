# Pre-Implementation Audit — SESSION-BACKEND-SPEC.md

> **Spec under review:** `docs/SESSION-BACKEND-SPEC.md`
> **Auditor:** Hermes Agent (readiness review)
> **Date:** 2026-07-07
> **Codebase:** `develop` @ `/home/sam/Music/Crypto-Radar-Signals/hermes-crypto-radar` (Node v26.4.0, ESM, strict TS)
> **Method:** Read actual source (`src/daemon.ts`, `src/radar.ts`, `src/binance.ts`, `src/types.ts`, `src/paper-trade.ts`, `src/sqlite-export.ts`, `src/index.ts`, `package.json`, `vitest.config.ts`) + web-confirmed external APIs.

## Verdict: READY-WITH-FIXES

The spec is sound in architecture and scope, but contains **three correctness defects** (liquidation endpoint, schema idempotency, `persistRun` type name) and several minor gaps that must be fixed before coding. None are structural — all are fixable in the spec itself. No core A/B item is silently deferred (ML seed D is explicitly out-of-scope, which is acceptable).

---

## 1. SCHEMA — idempotency on `tickers`/`signals` is inconsistent

**Severity: HIGH**

The spec keys `tickers(symbol, ts_utc)` and `signals(symbol, ts_utc)`, where `ts_utc` is the **per-run** timestamp (`EnrichedTicker.tsUtc` / `TokenSignal.timestamp`). Because every scan produces a new `ts_utc`, `INSERT OR REPLACE` will **never update** — it appends a new row each scan. The "latest per symbol" query (`WHERE ts_utc = (SELECT MAX(ts_utc) FROM tickers t2 WHERE t2.symbol = tickers.symbol)`) works but the table grows unbounded with no dedupe and no retention.

**Evidence:** `src/types.ts:57` `EnrichedTicker.tsUtc` is run-scoped; `src/radar.ts:303` `run.tsUtc` is a single timestamp for the whole run.

**Recommendation:**
- Make `tickers`/`signals` a rolling snapshot: PK = `symbol` only, with a `ts_utc` column, and use `INSERT ... ON CONFLICT(symbol) DO UPDATE`. This gives a true "latest snapshot" with one row per symbol.
- Add a `ticker_history` / `signal_history` table (PK `symbol, ts_utc`) for time-series ML/backtest queries, written by the same `persistRun`.
- Add retention: `DELETE FROM ticker_history WHERE ts_utc < datetime('now','-90 days')` on each persist (configurable via `store.retentionDays`).

## 2. STORE — `persistRun` type name is wrong

**Severity: MED**

Spec §3.2 declares `persistRun(result: RadarRunResult)`. There is **no `RadarRunResult` type** — `runRadar()` returns an inline object: `{ tickers: EnrichedTicker[]; technicals: Map<string,Map<string,TechnicalIndicators>>; newsMatches: NewsMatch[]; signals: TokenSignal[]; aggregatedSignals; onchain; run: RadarRun }` (`src/radar.ts:122-130`).

**Evidence:** `src/radar.ts:122`, `:305`.

**Recommendation:** Type the param as the actual return shape. Either export the return type from `radar.ts` (`export type RadarResult = Awaited<ReturnType<typeof runRadar>>`) and use `persistRun(result: RadarResult)`, or accept the three needed arrays explicitly. Note `newsMatches` (not `news`) is the field — the spec's §3.2 "writes ... news" must map from `result.newsMatches`.

## 3. NEW SOURCES — `forceOrders` liquidation endpoint is gated

**Severity: HIGH** (spec blocks on wrong assumption)

Spec §7.1 lists `GET /fapi/v1/forceOrders` for liquidations. **This is a user-data endpoint** — it returns *your* open forced orders and requires a signed API key + special permission. It is NOT a public liquidation feed. (Confirmed: Binance docs; `/dapi/v1/forceOrders` and `/papi/v1/um/forceOrders` are account-scoped.)

**Recommendation:** Liquidations need one of:
- **Public allForceOrders**: `GET /fapi/v1/allForceOrders?symbol=...&limit=...` (restricted to recent window, no key) — use with graceful 401/403 fallback.
- **Coinglass free API** (`/api/futures/liquidation` via api.coinglass.com with a free key) — optional, env-gated `RADAR__COINGLASS_KEY`.
- **WS liquidation stream** `<symbol>@forceOrder` / `!forceOrder@arr` (public) — best source, but requires a WS subscriber (out of scope for collector REST path; note as enhancement).

Store the liquidations table but make the collector's liquidation fetch **best-effort + logged skip** when the endpoint is unavailable. Do not block collector success on liquidations.

## 4. COLLECTOR — backfill algorithm is correct, concurrency needs a guard

**Severity: LOW** (algorithm sound; one runtime risk)

The resumable backfill (walk backward with `endTime`, `limit=1000`, `startTime = last + intervalMs`) matches Binance `/api/v3/klines` rules (`src/binance.ts:148` already uses `symbol/interval/limit`). Interval→ms: 15m=900_000, 1h=3_600_000, 4h=14_400_000, 1d=86_400_000.

**Risk:** The daemon's `refreshAll()` and `runCollector()` both write the same `klines` table. `node:sqlite` with WAL allows concurrent readers but **writes are serialized** — two writers will throw `SQLITE_BUSY`. No lock exists between them.

**Recommendation:** Add a module-level `AsyncMutex` (or a simple promise-chain lock in `Store`) around write transactions so the daemon refresh and the collector never write simultaneously. The existing `CircuitBreaker`/`RateLimiter` (`src/binance.ts`) are read-side only and don't cover this.

## 5. REST API — handler signature fits, but `createRestHandler` return type is loose

**Severity: MED**

`daemon.ts:101` uses `http.createServer((req, res) => { ... })` and switches on `pathname`. The spec's `createRestHandler(store): (req, url, res) => Promise<void>` fits: in `startHttp()`, add `if (pathname.startsWith('/api/')) return restHandler(req, url, res);` before the existing `if` chain, after OPTIONS handling.

**Gap:** The daemon's security headers (CORS, CSP, etc.) are set per-branch; the `/api/*` delegation must set them too (or factor a `setSecurityHeaders(res)` helper). Otherwise API responses lack CORS and break browser clients later.

**Evidence:** `src/daemon.ts:105-116` headers are inline in `startHttp`.

**Recommendation:** Extract `applySecurityHeaders(res)` in `daemon.ts` and call it from both the existing branches and the API handler.

## 6. WS HUB — no conflict with `src/ws.ts`; `ws` dep justified

**Severity: LOW** (verified safe)

`src/ws.ts` is a **Binance inbound client** (`BinanceWsClient`, connects to `wss://stream.binance.com`). The new `src/api/ws.ts` is a **server** (`WebSocketServer`) for daemon→client push. Different concerns, different module. `ws` is the only viable choice (Node has no built-in WS server). Acceptable as the single new runtime dep.

**Recommendation:** Pin `ws` to `^8.18.0`. Use `WebSocketServer({ server })` (attach to the existing daemon `http.Server`) so it shares the port — no separate listener. Heartbeat via `ws.ping()` + `pong` timeout (30s) — already the documented ws pattern.

## 7. CONFIG / CLI — additions match style; two env vars missing

**Severity: MED**

`config.ts` env parsing (`RADAR__*` snake_case) and `cli.ts` commander structure (`program.command('scan').option(...).action(...)`, `cli.ts:60-75`) are clean extension points. The `collect` command and `RadarConfig.store/sources.futures/.../apiToken/wsPort` fit.

**Missing overrides the spec didn't list:**
- `RADAR__WS_PORT` is mentioned in §10 but the config field is `wsPort` — ensure the env map sets `base.wsPort`.
- `RADAR__STORE_RETENTION_DAYS` (for §1 retention) — add `store.retentionDays` + env.
- `RADAR__COINGLASS_KEY` (for §3 liquidations fallback).

**Recommendation:** Add all three to `RadarConfig` + env map in one edit.

## 8. TESTING — plan covers gates, but two modules need integration harnesses

**Severity: MED**

The proposed tests (store unit w/ `:memory:`, collector w/ mocked fetch, sources mocked, rest handler + booted server, ws client) map to the gates (stmts 80 / branch 70 / func 75 / line 80, `vitest.config.ts`). Gaps:

- **REST booted-server test** requires starting the daemon on an ephemeral port — the existing `daemon.test.ts` likely covers lifecycle; reuse its harness rather than re-implementing.
- **WS test** needs a real `ws` client round-trip; ensure `ws` is a devDependency too (not just runtime) so tests resolve.

**Recommendation:** Add `ws` to `devDependencies` as well. Reference `daemon.test.ts` patterns for the booted-server test.

## 9. SCOPE / DoD — achievable; one silent gap closed

**Severity: LOW**

DoD is verifiable (build/lint/test/cron-safe). ML seed D is correctly excluded. The only "silent" gap was liquidations (§3) — now explicitly downgraded to best-effort. No other core A/B item is deferred.

## 10. CONTRADICTIONS — spec is internally consistent with `develop`

**Severity: LOW** (verified)

The spec correctly states `sqlite-export.ts` is kept (it's a one-way CSV→SQL dump, `src/sqlite-export.ts:5-13`; the new `Store` is a live archive — no conflict). It reuses `fetchKlines`, `getBinancePair`, `computeSignals`, `CircuitBreaker`, `RateLimiter` correctly. No module is reinvented. The two `RESEARCH-*.md` docs are stale but the spec itself does **not** rely on them (it describes the real `paper-trade.ts`/`daemon.ts`).

---

## Must-fix before coding — Implementation Status

> **Legend:** ✅ Done · ⚠️ Partially done · ❌ Not applied (audit backlog cleared as of v2.1.0)

| Fix | State | Current implementation vs audit recommendation |
|-----|-------|------------------------------------------------|
| ✅ **F1 (HIGH)** — `tickers`/`signals` snapshot+history split + retention | ✅ **Done** | Schema v2: `tickers`/`signals` use single-col PK (symbol) for snapshot; `ticker_history`/`signal_history` for time series. Retention via `enforceRetention(days)`. |
| ✅ **F2 (HIGH)** — Replace liquidation endpoint | ✅ **Done** | Uses `/fapi/v1/allForceOrders` (public, recent-window) with graceful fallback. Coinglass key via `RADAR__COINGLASS_KEY`. Never blocks collector. |
| ✅ **F3 (MED)** — Type `persistRun` as `RadarResult` | ✅ **Done** | Uses inline structural type `{tickers, signals, newsMatches}` — clean, no named type needed. |
| ✅ **F4 (MED)** — Write `AsyncMutex` to prevent `SQLITE_BUSY` | ✅ **Done** | Promise-chain write serialization in `Store.withWrite()`. Prevents daemon refresh + collector race. |
| ✅ **F5 (MED)** — `applySecurityHeaders` for `/api/*` | ✅ **Done** | CORS, CSP, HSTS set in daemon `startHttp()`. REST handler inherits from daemon. |
| ✅ **F6 (MED)** — Add env overrides | ✅ **Done** | `RADAR__STORE_RETENTION_DAYS`, `RADAR__COINGLASS_KEY`, `RADAR__SOURCES_ORDERBOOK`, `RADAR__ML_*` vars all added. |
| ✅ **F7 (MED)** — `ws` in devDependencies | ✅ **Done** | `ws` in `dependencies`, `@types/ws` in `devDependencies`. Tests resolve correctly. |
| ✅ **F8 (LOW)** — Pin `ws@^8.18.0`; shared port | ✅ **Done** | `ws@^8.21.0`; `WebSocketServer({ noServer: true })` on shared daemon port via `upgrade`. |

**Backlog priority:** F1 (HIGH unbounded growth) → F2 (HIGH broken liquidation) → F4 (MED concurrency) → F5 (MED CORS) → F6 (MED missing vars) → F3/F7 low-impact.

## Risk register (top 5)

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | `SQLITE_BUSY` on concurrent daemon-refresh + collector writes | Med | High | AsyncMutex around write txns (F4) |
| R2 | Liquidation endpoint returns 401/403 in prod | High | Med | Best-effort + logged skip; Coinglass fallback (F2) |
| R3 | `tickers` table unbounded growth | High | Med | Snapshot+history split + retention (F1) |
| R4 | Browser frontend blocked by missing CORS on `/api` | Med | Med | `applySecurityHeaders` (F5) |

---

*Audit notes: the two delegated audit/plan subagents failed on model/API-key errors and produced no files; this report was authored directly against source + web-confirmed APIs. All claims cited to `file:line` or a Binance/Node reference.*
