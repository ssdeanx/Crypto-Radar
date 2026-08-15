# Crypto Radar — Production Hardening Sprint

> **Project:** Crypto Radar v2.8.1 (backend daemon)
> **Goal:** Close production-readiness gaps across build integrity, API hardening, concurrency safety, and test coverage.
> **Approach:** 4 independent parallel workstreams, each with clear file boundaries, dispatched via subagents.

---

## Scope Summary

| # | Workstream | Files Changed | Impact |
|---|-----------|--------------|--------|
| 1 | Build Integrity | `.oxlintrc.json`, `src/ws.test.ts` (delete), `src/daemon.test.ts` | Fix broken lint, 2 test failures → clean CI |
| 2 | API Zod Schemas | `src/api/fastify/routes/rest.ts` | Input validation on all GET query params |
| 3 | Concurrent Write Protection | `src/core/file-lock.ts` (new), `src/cli.ts`, `src/news.ts` | Prevent data corruption from concurrent collector runs |
| 4 | ML Test Coverage | `src/ml/drift.test.ts`, `src/ml/online.test.ts`, `src/ml/monitor.ts` (new) | 0% → meaningful coverage on ML subprocess wrappers |

**Out of scope:** Frontend, infra automation (Terraform/deploy.sh), ML Python side, RADAR__AI_API_KEY (actively used in openai-compatible.ts/gemini.ts), rate limiter (actively used in collector + sources).

---

## Workstream 1: Build Integrity

### Problem
- **oxlint** fails to parse `.oxlintrc.json` with oxlint v1.75.0 — config format regression
- **ws.test.ts** (263 lines) imports from `./ws.js` — module was deleted in commit `d073b7f` (WebSocket removal)
- **daemon.test.ts** fails with `EADDRINUSE: address already in use 0.0.0.0:9877` — port leak from prior test runs

### Solution
1. Simplify `.oxlintrc.json` — remove problematic group nesting, use flat rule format that v1.75.0 accepts. Include `ignorePatterns` for `dist/`, `coverage/`, `ml/`.
2. Delete `src/ws.test.ts` entirely — the WebSocket module it tests no longer exists
3. Fix `daemon.test.ts` to avoid real port binding — use `vi.spyOn(fastify, 'listen').mockResolvedValue(...)` so the test doesn't need a real TCP port

### Verification
- `npm run lint` exits 0
- `npm test` — all test files pass, no port conflicts
- `npm run build` still passes

---

## Workstream 2: API Zod Schemas

### Problem
All 16 GET routes in `rest.ts` cast query params with raw `as` casts (e.g., `request.query as { symbol?: string; chain?: string }`) with zero validation. Invalid params pass silently, produce 500 errors, or return wrong data.

### Solution
Add Zod schemas for every route's `querystring` using Fastify's built-in schema support:

| Route | Schema Validates | Default |
|-------|-----------------|---------|
| `GET /api/tickers` | symbol, chain, limit (int ≥1) | limit=200 |
| `GET /api/tickers/:symbol` | symbol param (alphanumeric) | — |
| `GET /api/signals` | symbol, minScore (0-100), direction (enum), limit | limit=200 |
| `GET /api/signals/:symbol` | symbol param | — |
| `GET /api/klines/:symbol` | interval (enum: 15m/1h/4h/1d), from (int), to (int), limit | interval=1h, limit=500 |
| `GET /api/futures/:symbol` | type (enum: funding/oi/lsratio/liquidations), limit | type=funding, limit=50 |
| `GET /api/orderbook/:symbol` | limit | limit=50 |
| `GET /api/news` | symbol, limit | limit=50 |
| `GET /api/regime/:symbol` | interval, limit | interval=1h, limit=200 |
| `GET /api/fear-greed` | limit | limit=30 |
| `GET /api/cross-asset` | limit | limit=50 |
| `GET /api/predictions` | symbol, model_id, minConfidence (0-1), limit | limit=200 |
| `GET /api/predictions/:symbol` | limit | limit=50 |
| `GET /api/portfolio/trades` | profile, status (open/closed) | profile=trader1 |
| `GET /api/portfolio` | profile | profile=trader1 |
| `GET /api/stats` | — | — |

Use Zod's `coerce.number` for numeric params (query strings arrive as strings) and `z.enum` for constrained values. Fastify automatically returns 400 with structured errors on schema violation.

### Verification
- `npm run build` passes
- Schemas compiled at type-check time
- Querying `GET /api/tickers?limit=-1` returns 400, not 500

---

## Workstream 3: Concurrent Write Protection

### Problem
Two sites use `fs.appendFileSync` for accumulating data files with no write-lock protection:
1. **`src/cli.ts:160,173`** — CSV ticker data appended during scan output
2. **`src/news.ts:511`** — RSS news cache appends

If the collector cron fires while a prior run is still writing, these files can interleave writes and produce corrupted rows.

The existing `radar.lock` (PID file in `src/radar.ts`) only prevents concurrent radar scans — it doesn't protect against concurrent write access from other paths (e.g., collector API endpoint + cron run simultaneously).

### Solution
Create `src/core/file-lock.ts` — a lightweight advisory file lock using `mkdir` atomicity (POSIX atomic directory creation):

```typescript
export class FileLock {
  private lockDir: string;
  constructor(basePath: string, name: string) { ... }
  async acquire(timeoutMs?: number): Promise<boolean> { ... }
  release(): void { ... }
}
```

Wrap the append sites:
- `cli.ts` — `FileLock` around `appendFileSync` calls
- `news.ts` — same pattern

Lock files live under `os.tmpdir()` or `dataDir` + `.locks/` so they don't pollute data output.

### Verification
- `npm test` passes (existing tests mock `fs` — verify mocks still work)
- Manual: concurrent `node -e "require('./dist/cli.js')"` runs don't corrupt output

---

## Workstream 4: ML Test Coverage

### Problem
Three ML TypeScript modules have zero test files:
- **`drift.ts`** — subprocess wrapper around `ml/detect_drift.py` with store query fallback logic
- **`online.ts`** — subprocess wrapper around `ml/online.py` with train/predict/metrics/reset/autoRetrain
- **`monitor.ts`** — calibration computation with bucketing, ECE, store queries

Testing these requires mocking `child_process.spawn` and the Store interface. All three are pure-logic modules (no side effects beyond their dependencies).

### Solution
Create three test files:

**`src/ml/drift.test.ts`** (~80 lines)
- Mock spawn to return a process-like object with stdout/stderr events
- Test `detectDrift` returns empty report when script file doesn't exist (mocked `existsSync`)
- Test empty report when < 10 predictions in store
- Test successful drift report parsing from subprocess stdout
- Test timeout kills subprocess and rejects
- Test subprocess non-zero exit returns error

**`src/ml/online.test.ts`** (~120 lines)
- Mock spawn for `onlineTrain`, `onlinePredict`, `onlineMetrics`, `onlineReset`
- Test `onlinePredict` returns uniform fallback when subprocess fails (wrapped try/catch)
- Test `autoRetrain` path: drift detected → reset called
- Test `autoRetrain` path: no drift → no reset
- Test timeout rejection
- Test subprocess error handling

**`src/ml/monitor.test.ts`** (~100 lines)
- Mock `store.getPredictions` and `store.getKlines`
- Test `computeCalibration` returns empty report with no predictions
- Test single correct prediction generates proper bucket
- Test ECE calculation with known values
- Test `isCalibrated` flag based on ECE threshold (< 0.1)
- Test MAX_AGE_MS filtering

### Verification
- `npm test` passes — 3 new test files, all tests green
- Coverage report shows lines covered in `drift.ts`, `online.ts`, `monitor.ts`

---

## Execution Plan

```
                    ┌─────────────────────────────┐
                    │   Design Doc Approved        │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     Stream 1          Stream 2          Stream 3     Stream 4
   Build Integrity   API Zod Schemas   Write Locks   ML Tests
   (subagent 1)      (subagent 2)     (subagent 3)  (subagent 4)
        │                 │               │              │
        └─────────────────┼───────────────┴──────────────┘
                          ▼
              ┌──────────────────────┐
              │  Parent Verification │
              │  - npm run build     │
              │  - npm test          │
              │  - npm run lint      │
              │  - spot-check results│
              └──────────────────────┘
```

All 4 subagents dispatched in parallel. Parent runs verification after all complete. No overlapping file writes between streams.

---

## Success Criteria

1. `npm run lint` exits 0
2. `npm test` — 1209+ tests pass, 0 failures across 56 test files
3. `npm run build` — 0 errors
4. Zod schemas reject invalid query params with structured 400 errors
5. Concurrent file appends protected by advisory lock (no corruption under concurrent writes)
6. ML modules (drift, online, monitor) have measurable unit test coverage
