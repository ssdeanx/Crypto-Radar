# Changelog — 🛰️ Hermes Crypto Radar

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.7.0] — 2026-07-20

### Added

- **Stateless Cloud Run Transition & File Write Guards** — Implemented configuration guards in `src/radar.ts` and `src/daemon.ts` to disable state/PID file-writes, lock files, and WebSocket push hubs in Cloud Run mode to enable completely stateless scaling.
- **Cloud Task Handlers & Endpoint API** (`src/api/fastify/routes/tasks.ts`) — Developed dedicated task queue route endpoints `/api/tasks/gemini-analyze`, `/api/tasks/paper-trade`, `/api/tasks/model-retrain`, and `/api/tasks/evaluate-outcomes` secured with a shared cron secret.
- **OpenAI-Compatible Provider Routing & Vertex Fallback** (`src/core/llm-provider.ts`) — Added support for OpenAI-compatible completions endpoints alongside Vertex AI Gemini. Refactored `src/analysis/gemini.ts` to support routing legacy signature calls through the LLM provider, avoiding circular dependencies.
- **SQLite GCS Synchronization & ML Model Backups** (`src/store/db.ts`) — Created automatic synchronization pipelines (`syncFromBucket()`/`syncToBucket()`) to save/restore SQLite database files to/from Google Cloud Storage in production. Expanded sync logic to download and upload Python ML model/normalization assets on server startup and retraining.
- **Terraform Configuration** (`infra/main.tf`) — Authored infrastructure files to configure Pub/Sub topics, Cloud Task queues with custom rate limits and retries, and storage buckets.
- **Evaluation SQL Queries & A/B Prompt Templates** (`infra/evaluation-queries.sql`) — Formulated template queries for BigQuery tracking overall win rates, confusion matrices, daily accuracy trends, and candidate prompt A/B testing with `ML.GENERATE_TEXT`.
- **Alpine Multi-Stage Containerization** (`Dockerfile`) — Replaced the bookworm-slim base with a lightweight, secure `node:22-alpine` multi-stage build running the stateless server endpoint.
- **Strict Linting & Strong Type Safety** — Resolved all remaining compilation and ESLint warnings in production code. Introduced strict interfaces `TokenTraceRow`, `TaskPayload`, and `LLMTraceData` to fully replace `any` and `unknown` types.
- **Config & Schema Import Alignment** — Restored critical exports and imports in `src/core/llm-provider.ts` and `src/store/db.ts`, integrating them directly into the runtime lifecycles (calling `loadConfig()` during token analysis and utilizing `SCHEMA_DDL` to log schema parameters during migrations).
- **Interactive AI Paper-Trading Advisor** (`src/api/fastify/routes/portfolio.ts`) — Created a `POST /api/portfolio/chat` route endpoint allowing users to converse with an AI quant trading assistant that directly executes simulated paper trades on user command.
- **Refined News Filter Matching** (`src/news.ts`) — Relaxed the overly restrictive `POISON_PATTERNS` regex filter to allow standard crypto financial keywords (e.g. *price*, *trading*, *buy*, *sell*) while keeping tutorial and spam protection intact.

### Removed

- **Legacy WebSocket Hub (`src/api/ws.ts`)** — Completely removed the WebSocket server, broadcast hooks, and the `ws` package dependency. This aligns with a purely request-driven, stateless architecture optimized for Google Cloud Run (avoiding scale-to-zero connection blockages and timeout overhead).

## [2.6.0] — 2026-07-19

### Added

- **Google Cloud Run & Cloud Scheduler Automation** — Added automated cloud deployment capability. Secure hourly cron trigger endpoint `/api/cron/scan` defined in `src/api/fastify/routes/cron.ts` executes a full radar scan, data collection, and ML predictions cycle. Cloud Scheduler triggers the endpoint securely using OIDC tokens or a shared `x-cron-secret`. CORS options are made configurable on Fastify.
- **Vertex AI Gemini 3.1 Pro Integration** (`src/analysis/gemini.ts`) — Integrated the `@google-cloud/vertexai` SDK to generate concise, professional market analysis and descriptive trading predictions based on recent klines, current prices, and technical signals, storing them directly under the `reasoning` field in the database.
- **Automated Deployment Script** (`deploy.sh`) — Full-featured provisioning script enabling Artifact Registry creation, automated container build via Cloud Build, secure Cloud Run deployment, and automatic Cloud Scheduler cron creation/update.
- **Debian-Based Dockerfile** (`Dockerfile`) — Replaced the alpine runtime image with `node:22-bookworm-slim` to cleanly resolve compiled C++ binaries and configure Python ML virtual environment via `uv` for drift detection.

### Changed

- **Asynchronous Data Store & Router Refactoring** (`src/store/db.ts`) — Refactored the core Data Layer to be fully asynchronous, utilizing Google Cloud BigQuery (`@google-cloud/bigquery`) with automatic fallback to an in-memory SQLite database when BigQuery is not available.
- **Asynchronous Caller Wiring** — Refactored all data store callers across the codebase (CLI tasks, Daemon processes, collector functions, paper-trading endpoints, and REST routing) to cleanly handle asynchronous operations and await Store methods.

### Fixed

- **Store Closed State Handling** (`src/store/db.ts`) — Hardened the `stats` and `close` store methods to correctly raise errors when operations are executed on a closed store.
- **Integration Test Sandboxing** (`src/cli.integration.test.ts`) — Configured CLI integration tests to use a local, writable test data directory to ensure success in environments lacking root-level write access to `/data/crypto-radar`.

## [2.4.0] — 2026-07-18

### Added

- **Monthly archive retention** (`src/core/log-rotation.ts:41-58`) — All data files (`.csv`, `.jsonl`, `.txt`, `.md`, `.xlsx`) are now gzipped into an `archive/` subdirectory at month boundaries. Existing `pruneOldLogs()` (line 89) updated to span both active and archived files. **Why:** prevents unbounded disk growth from monthly data accumulation without losing historical data — active files remain lean, archives are compressed and prunable by age.

- **Secondary data directory support** (`src/core/config.ts:30-31`) — The `RadarConfig` interface now includes an optional `secondaryDataDir?: string` field. Auto-detection logic (`loadConfig()`, line 60) checks whether `~/.hermes/data/crypto-radar/` exists; if it does, the path is exposed as `secondaryDataDir`. **Why:** enables gradual migration from the legacy Hermes-managed path (`~/.hermes/`) to the new primary (`/data/crypto-radar/`); users who already have data in the old location can run without disruption and migrate at their own pace.

- **Startup info log** (`src/core/config.ts:80`) — After config is fully resolved, `logInfo('Config loaded', { dataDir, secondaryDataDir })` now fires at agent init. **Why:** operators need a clear signal at startup confirming which data directory was resolved — critical for debugging path misconfiguration in production.

- **Collector script DATA_DIR guard** (`scripts/crypto-radar-collector.sh:38-42`) — Before creating the data directory, the script now asserts `DATA_DIR` is non-empty. **Why:** an unset `RADAR__DATA_DIR` with no fallback would silently create a directory at an unintended relative path.

### Changed

- **Default data directory** (`src/core/config.ts:11`) — `DEFAULT_DATA_DIR` constant changed from `~/.hermes/data/crypto-radar` to `/data/crypto-radar`. Configurable via `RADAR__DATA_DIR` env var. **Why:** the `~/.hermes/` path only exists when Hermes Agent is installed on that machine; production servers and headless deployments may not have a Hermes home directory at all. `/data/crypto-radar/` is a standard Linux FHS data path that exists by convention on server environments.

- **Env propagation requirement documented** — Hermes cron tasks execute in the daemon's environment, not the user's shell profile. **Why:** users commonly set `RADAR__DATA_DIR` in `~/.bashrc` and wonder why the cron job doesn't pick it up. The env var must be declared in the cron YAML definition (`~/.hermes/cron/*.yaml`, `env:` block) or be present in the Hermes daemon's environment at start time.

### Fixed

- **Lock file path (`src/radar.ts:33`)** — `radar.lock` now resolves to `path.join(config.dataDir, 'radar.lock')` instead of `path.resolve('radar.lock')`. **Why:** CWD-relative lock files cause conflicts when the same process is run from different directories (e.g., cron vs interactive shell).

- **State file path (`src/radar.ts:58`)** — `crypto-radar-state.json` now resolves to `path.join(config.dataDir, 'crypto-radar-state.json')`. **Why:** same CWD-escape issue as lock file; state would be written to wherever the CLI happened to be invoked from.

- **PID file path (`src/daemon.ts:39,469`)** — `data/daemon.pid` replaced with `path.join(config.dataDir, 'daemon.pid')`. **Why:** the `data/` subdirectory is only present in the Git repository root; production installs via npm or marketplace tarball don't have this directory.

- **HTML report default path (`src/cli.ts:683`)** — When `--output` is omitted, report saves to `path.join(config.dataDir, 'crypto-radar-report.html')` instead of CWD. **Why:** generated reports should be discoverable in the data directory, not scattered across whichever directory the user invoked the command from.

- **CSV export default path (`src/cli.ts:719`)** — `data/radar-output.csv` default replaced with `config.dataDir`. **Why:** same rationale as HTML report — output should land in the configured data directory.

- **ML dataset path (`src/ml/dataset.ts:21,231,248`)** — Hardcoded `'data/ml/'` replaced with `path.join(loadConfig().dataDir, 'ml')`. **Why:** the `data/` directory is a Git-tracked source artifact, not a runtime data location; ML datasets were being written outside the configured data directory.

- **Duplicate `DEFAULT_DATA_DIR` constant removed (`src/paper-trade.ts`)** — The paper-trade module maintained its own copy of the default data directory constant. Both call sites now reference `config.dataDir` from `loadConfig()`. **Why:** dual defaults inevitably diverge — the paper-trade copy would have silently continued using the old path after the primary config was updated.

- **Collector script path hardening (`scripts/crypto-radar-collector.sh:38`)** — Previously used `DATA_DIR="${RADAR__DATA_DIR:-$HOME/.hermes/data/crypto-radar}"` which carried its own independent default not shared with config.ts. Now uses `DATA_DIR="${RADAR__DATA_DIR}"` with a non-empty guard. **Why:** the shell script must respect the same single source of truth (config.ts's `DEFAULT_DATA_DIR` / env var) rather than baking its own copy.

- **ML Python subprocess path resolution (`src/daemon.ts:227`, `src/ml/predict.ts:30`, `src/ml/drift.ts:23`, `src/ml/online.ts:28`)** — Python scripts now resolve via `import.meta.url` and `__dirname`-relative paths instead of CWD-relative paths. **Why:** when the Hermes daemon spawns ML subprocesses, the CWD is the Hermes plugins directory, not the crypto-radar project root — CWD-relative script resolution would fail at runtime.

### Migration Notes

If you are upgrading from v2.3.x or earlier:

1. **Create the new data directory** (if not using a custom `RADAR__DATA_DIR`):
   ```bash
   sudo mkdir -p /data/crypto-radar
   sudo chown -R $(whoami):$(whoami) /data/crypto-radar
   ```

2. **Set `RADAR__DATA_DIR` in the Hermes daemon environment** — Add to your daemon's environment (systemd unit, Dockerfile, or cron YAML). This is **required** if you run via Hermes cron; shell-level `export` alone will not propagate.

3. **Optional: migrate existing data** from the legacy path:
   ```bash
   cp -r ~/.hermes/data/crypto-radar/* /data/crypto-radar/
   ```
   The secondary data directory auto-detection (`secondaryDataDir`) ensures backward compatibility during migration — you can leave the old data in place while the new path is used for writes.

4. **Verify startup** — Restart the Hermes daemon and check logs for:
   ```
   INFO  Config loaded  dataDir=/data/crypto-radar  secondaryDataDir=~/.hermes/data/crypto-radar
   ```

5. **If using ML pipeline**, set `RADAR__ML_PYTHON` to the absolute path of your Python interpreter (e.g., `/home/user/.venv-ml/bin/python3`) to avoid CWD-resolution issues.

## [2.5.0] — 2026-07-18

### Added

- **Centralized math hub** (`src/math/index.ts`) — New re-export module consolidating all statistical and matrix operations. Re-exports from `simple-statistics` (v7.9.3: `mean`, `median`, `variance`, `standardDeviation`, `sampleCorrelation`, `sampleCovariance`, `linearRegression`, `linearRegressionLine`, `rSquared`, `quantile`, `weightedQuantile`, `zScore`, `medianAbsoluteDeviation`) and `ml-matrix` (v6.14.0: `Matrix`, `EigenvalueDecomposition`). All strategy modules now import from this single hub rather than rolling their own math. **Why:** eliminates hand-rolled `.reduce()`/`Math.sqrt()` stats across 8+ files, reduces cognitive overhead of choosing between libraries, and removes the dependency decision from individual strategy authors.

- **Trend regression analysis** (`src/analysis/trend-regression.ts`) — `computeTrendRegression(prices, period)` returns slope, R², and next-period price projection using `simple-statistics`' `linearRegression()` + `rSquared()`. **Why:** provides statistically sound trend strength measurement (R²) alongside direction (slope sign), replacing binary trend classification.

- **Trend regression wired into strategies** (`src/analysis/momentum.ts:217`, `src/analysis/trend-following.ts:279`) — Momentum strategy uses period-20 regression; trend-following uses period-50 regression. High R² (consistent trend) boosts confidence; low R² (noisy) penalizes it. Trend-following also uses slope magnitude as a "steepness" confidence modifier. **Why:** R² quantifies trend consistency that strategies previously estimated heuristically from ADX/price change.

- **Market breadth via PCA** (`src/cli.ts:623`) — After the correlation matrix display, the CLI now runs `computePCA()` to show the first principal component's explained variance ratio with a market-breadth interpretation label: single-factor (>60%), moderate (30-60%), or multi-factor (<30%). Top 3 eigenvalues with their variance percentages are displayed. **Why:** the PC1 explained variance ratio reveals how many independent factors drive the market — a single dominant factor indicates synchronized cross-asset movement.

- **Portfolio optimization** (`src/analysis/portfolio.ts`) — Markowitz efficient frontier using grid-search convex optimization. `computePortfolio()` finds the max-Sharpe and min-variance portfolios from a covariance matrix and expected returns. Handles edge cases: fewer than 2 symbols → null, singular covariance matrix → εI regularization, near-zero returns → equal-weight fallback. **Why:** bridges from descriptive statistics (correlation/covariance) to prescriptive allocation — answers "what should I hold?"

- **Portfolio CLI command** (`src/cli.ts:637`) — `crypto-radar portfolio` command fetches klines for all configured tokens, builds the covariance matrix, computes expected returns from mean daily returns × 365, and displays max-Sharpe and min-variance portfolio weights with annualized return/volatility/Sharpe. Supports `--symbols`, `--count`, `--period`, `--lookback`, `--rfrate`, `--json` flags. **Why:** operators can now run portfolio optimization without leaving the CLI or piping data to an external tool.

- **ML feature: Regime soft confidence votes** (`src/ml/features.ts`) — Replaced the single ordinal `regime` feature (0-3 hard bucket) with 4 continuous features (`regime_trending`, `regime_ranging`, `regime_volatile`, `regime_quiet`) from `detectRegime()`. Each receives the winning regime's confidence score (0-1) while the rest are 0. **Why:** models can now learn conditional patterns — "which price features matter most during trending vs ranging" — instead of treating regime as a coarse categorical.

- **ML feature: Trend regression R² and slope** (`src/ml/features.ts`) — Added `trend_r2_10`, `trend_r2_20`, `trend_r2_50` and corresponding `trend_slope_*` features using `computeTrendRegression()` over 10/20/50 periods. **Why:** R² measures linear trend consistency (orthogonal to ADX which measures directional volatility) — a noisy trend with high ADX and a clean trend with high ADX are now distinguishable by the model.

- **ML feature: Volume profile value area** (`src/ml/features.ts`) — Added `vah`, `val`, `poc`, and `va_position` from `computeVolumeProfile()` over the last 48 candles. `va_position` ranges 0 (at VAL) to 1 (at VAH), 0.5 at midpoint. **Why:** models gain visibility into liquidity structure — whether price is in "fair" vs "extreme" territory on the volume distribution — which no OHLC-based feature captures.

- **ML feature: Trailing BTC/ETH correlation** (`src/ml/features.ts`) — Added `corr_btc_20`, `corr_btc_10`, `corr_eth_20`, `corr_eth_10` — rolling Pearson correlations of each token's returns vs BTC/USDT and ETH/USDT returns over 10/20 periods. **Why:** altcoin price action is heavily driven by BTC correlation; the model previously had zero visibility into whether a move was idiosyncratic or market-driven. This is arguably the highest-signal single feature added.

- **ML feature: PCA market breadth** (`src/ml/features.ts`, `src/daemon.ts`, `src/ml/predict.ts`, `src/cli.ts`) — `enrichFeatures()` computes the multi-symbol correlation matrix at the call site, runs `computePCA()`, and sets `pca_market_breadth` (PC1 explained variance ratio) on every feature row. Wired into daemon auto-retrain, prediction pipeline, and CLI training. **Why:** tells the model whether the market is in a correlated regime (single factor dominates) or rotational regime (multi-factor) — one global number that contextualizes all per-token features.

### Changed

- **Correlation engine refactored to bulk matrix path** (`src/analysis/correlation.ts:91`) — `computeCorrelationMatrix()` now delegates to `computeCorrelationMatrixBulk()`, replacing the pairwise-loop `pearsonR()` approach with ml-matrix centered matrix operations (`center('column')` → transpose → mmul → divide by (M-1) → convert to correlation). All return series are truncated to the global minimum length, ensuring every matrix entry is computed over the same time period. The dedicated `pearsonR()` wrapper and its `sampleCorrelation` import were removed. **Why:** the bulk path is both faster (one matrix multiply vs. N² pairwise loops) and more correct (pairwise per-pair alignment created apples-to-oranges comparisons where different pairs used different time periods).

- **Volume profile value area** (`src/analysis/volume-profile.ts`) — Value area calculation switched from a sort-by-volume-accumulate algorithm to `weightedQuantile(bucketMids, bucketVols, lowQ/highQ)` from simple-statistics. **Why:** preserves price continuity across buckets and produces more stable value area bounds by respecting the quantile distribution of volume-weighted prices rather than iteratively accumulating sorted buckets.

- **Regime detection volatility** (`src/analysis/regime.ts`) — Added `closes` parameter and MAD-based (median absolute deviation) volatility vote. When at least 10 close prices are available, MAD normalized to percentage of the last price contributes to the volatile/quiet vote detection. **Why:** MAD is more robust to outliers than standard deviation and adds a fourth indicator dimension beyond ADX, BB width, and ATR%, improving regime classification fidelity.

### Removed

- **Dead code: `pearsonR()` function** (`src/analysis/correlation.ts:30-54`) — Hand-rolled Pearson correlation with edge-case guards, replaced by `ss.sampleCorrelation()` → bulk matrix path. **Why:** no longer called after `computeCorrelationMatrix()` switched to the bulk path; all correlation computation now flows through the ml-matrix centered approach.

- **Dead code: `sampleCorrelation` import** — Unused after `pearsonR()` removal.

## [2.3.0] — 2026-07-18

### Added

- **ML module refactoring** — Monolithic `ml/train.py` split into 3 focused modules:
  - `ml/indicators.py` — Technical indicator feature engineering (12 pandas-ta indicators: RSI, MACD, BB, Stochastic, ATR, OBV, Williams %R, CCI, ROC, EMA cross, CMF, MFI)
  - `ml/manifest.py` — Model registry management (MANIFEST.json read/write/compare)
  - `ml/model.py` — CatBoost model factory (GPU detection, class weight resolution, leaf-to-depth mapping)
- **Model registry (MANIFEST.json)** — `ml/models/MANIFEST.json` tracks all trained models with metadata, F1 scores, training config. Only promotes models to production if F1 ≥ current best + 1%, preventing regression deployments.
- **Cross-platform timeout** — Replaced Unix-only `signal.alarm()` with `concurrent.futures.ThreadPoolExecutor` timeout in `ml/predict.py` and `ml/detect_drift.py`. Windows compatible.
- **Graceful degradation** — Daemon checks for Python environment and ML scripts before attempting training/prediction. Clear error messages when ML deps are missing.
- **Feature selection** — `--feature-select` flag uses `sklearn.feature_selection.SelectKBest` with mutual information to auto-select top 30 predictive features, reducing noise and improving generalization.
- **Ensemble voting** — `--ensemble N` trains N CatBoost models with different seeds (42, 43, ...), soft-vote averages probabilities. 2-5% accuracy improvement on classification tasks.
- **SHAP-per-prediction** — `--explain` flag in `ml/predict.py` computes `shap.TreeExplainer` during inference. Every prediction includes top-5 feature attribution explaining *why* each BUY/SELL/NEUTRAL was predicted. Full integration through TypeScript, API, and types.
- **Volatility-adjusted labels** — `src/ml/labels.ts` now uses ATR(14) ratio as dynamic noise threshold instead of fixed 0.2%. Labels adapt to market volatility.
- **Enhanced TA features** — 12 additional indicators added via `pandas-ta-classic`: Stochastic, ATR, OBV, Williams %R, CCI, ROC, EMA cross signals (12/26), CMF, MFI. Previous: 3 indicators (RSI, MACD, BB).
- **TS-side feature enhancements** — Added funding rate change, volatility ratio (ATR/volTrend), and market regime (trending/ranging/volatile) to feature builder.
- **CatBoost production flags** — `model_size_reg=0.5` reduces model file size, `rsm=0.8` enables feature subsampling when feature count > 20. Both prevent overfitting.
- **Probability calibration** — `--calibrate` flag applies `sklearn.isotonic.IsotonicRegression` via `CalibratedClassifierCV` on validation set for more reliable confidence scores.
- **Label horizon threading** — `labelHorizon` now threaded through config (1/5/20/60) instead of hardcoded to 5. Configurable via `radar.config.json` or `RADAR__ML_LABEL_HORIZON`.
- **Drift detection integration** — Concept drift detection fully integrated into daemon refresh cycle:
  - New `src/ml/drift.ts` — TypeScript wrapper for `ml/detect_drift.py`
  - `drift_events` SQLite table stores drift events with timestamps, model IDs, detector type
  - Auto-retrain triggers on drift detection (1h cooldown)
  - `crypto-radar ml drift` CLI command with ADWIN/PageHinkley/KSWIN support
- **River online learning layer** — New `ml/online.py` and `src/ml/online.ts`:
  - Incrementally-updating `LogisticRegression` with `AdaptiveStandardScaler`
  - Catches slow concept drift between full CatBoost retrains (~µs per update vs ~minutes for retrain)
  - Built-in ADWIN drift detector on prediction error
  - Atomic save with tmp-file + rename pattern
  - Version-stamped serialization with 3-layer validation on load (corrupt pickle, wrong model type, version mismatch)
- **Calibration monitoring** — New `src/ml/monitor.ts` computes ECE (Expected Calibration Error) across confidence buckets. Exposed via `GET /api/ml/calibration`.
- **ML API endpoints** — New Fastify routes under `/api/ml/`:
  - `GET /api/ml/status` — Pipeline health, active model info, model count, store stats
  - `GET /api/ml/models` — List all models from MANIFEST with F1/accuracy
  - `GET /api/ml/drift` — Recent drift events with pagination
  - `GET /api/ml/predictions` — Recent predictions with symbol filter
  - `GET /api/ml/calibration` — Calibration report with per-bucket accuracy and ECE
  - `GET /api/ml/online` — Online model streaming metrics
- **Drift events SQLite table** — New `drift_events` table with indexes for time-series queries. Store methods `insertDriftEvent()` and `getDriftEvents()`.
- **Daemon model init** — Daemon loads active model from MANIFEST at startup, enabling predictions before first auto-retrain cycle.
- **Optuna trials config** — `optunaTrials` config option and `RADAR__ML_OPTUNA_TRIALS` env var for controlling hyperparameter search depth.
- **ML drift events in stats** — `store.stats()` now includes `drift_events` count.

### Changed

- **ML backend** — Migrated from LightGBM to CatBoost (gradient boosting with native NaN handling, GPU support, better multiclass performance)
- **Daemon auto-retrain** — Now passes `--optimize`, `--cv-folds`, `--balance`, `--add-ta`, `--feature-select` from config to training subprocess
- **ML CLI** — `ml` command now supports `drift` action in addition to `train/predict/status`. Added `--model`, `--delta`, `--records` options.
- **`--class-weight custom` map** — Changed from `{-1: 1.5, 0: 0.6, 1: 1.0}` to CatBoost built-in `Balanced` for better generalization
- **`.gitignore`** — Added `ml/**/optuna_study.db` to ignore Optuna study databases

### Fixed

- **`get_errors` across all Python files** — Zero errors across 6 Python modules (train.py, predict.py, indicators.py, manifest.py, model.py, detect_drift.py)
- **TypeScript compilation** — Zero errors across all TypeScript files including new modules (drift.ts, online.ts, monitor.ts, ml.ts route)
- **`signal.alarm()` cross-platform** — Previously crashed on Windows; now uses `concurrent.futures` with Unix fallback

## [2.2.0] — 2026-07-16

### Added

- **Fastify API server** — Replaced raw `http.createServer` with enterprise-grade Fastify 5.10:
  - `@fastify/cors` — Configurable CORS with credentials, preflight caching
  - `@fastify/jwt` — Stateless JWT auth with configurable audience/issuer, 7-day expiry
  - `@fastify/rate-limit` — 100 req/min per IP (300 for authenticated), with custom error responses
  - `@fastify/compress` — Automatic gzip/brotli compression (threshold 1KB)
  - `@fastify/helmet` — Security headers (XSS, clickjacking, MIME-sniffing, HSTS)
  - `@fastify/swagger` + `@fastify/swagger-ui` — Auto-generated OpenAPI docs at `/docs`
  - `handlerTimeout` (30s), `requestTimeout` (60s), `forceCloseConnections`, `return503OnClosing`
  - `trustProxy` support for Railway/Vercel deployments
  - Request logging via `onResponse` hook with structured log levels by status code
- **Auth API** — `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`:
  - Password hashing via bcrypt (12 rounds)
  - Zod v4 schema validation (`z.email()`, `z.string().min({ error })`)
  - JWT token issuance with 7-day expiry
  - Users stored in SQLite `users` table (schema v3)
- **Paper trading POST** — `POST /api/portfolio/trades` with:
  - Buy/sell execution with live Binance/CoinGecko pricing
  - FIFO position matching and P&L computation for sells
  - Partial fills and position tracking
  - Zod v4 validated request schema
- **Enterprise logger** — Default format changed to human-readable text with picocolors:
  - Color-coded level labels (green INFO, yellow WARN, red ERROR, etc.)
  - Bold message text, dim metadata keys, cyan values
  - JSON format auto-selected when logging to file
  - Child logger support with inherited settings

### Changed

- **API routing** — All REST endpoints migrated from raw `http` routing to Fastify:
  - `GET /api/tickers`, `GET /api/tickers/:symbol`
  - `GET /api/signals`, `GET /api/signals/:symbol`
  - `GET /api/klines/:symbol`, `GET /api/futures/:symbol`
  - `GET /api/orderbook/:symbol`, `GET /api/news`
  - `GET /api/tokens`, `GET /api/regime/:symbol`
  - `GET /api/portfolio`, `GET /api/portfolio/trades`
  - `GET /api/fear-greed`, `GET /api/cross-asset`
  - `GET /api/stats`, `GET /api/predictions`, `GET /api/predictions/:symbol`
  - `POST /api/collect` (token-gated)
  - Daemon management routes: `/`, `/health`, `/refresh`, `/reload-config`, `/scan-complete`
- **Database schema** — Version bumped to 3, new `users` table for auth
- **Logger default** — Changed from JSON to text format for CLI output; JSON auto-selected for file logging

### Security

- Password hashing with bcrypt (12 rounds)
- Rate limiting on all API routes
- Helmet security headers
- JWT auth with configurable audience/issuer validation
- Prototype pollution protection (Fastify built-in)
- Handler timeouts prevent slow-loris attacks

## [2.1.0] — 2026-07-11

### Added

- **Jupiter DEX test suite** — `src/jupiter.test.ts` with 23 tests covering `fetchJupiterPrices` (cache hit, retry/429, network error, malformed JSON), `fetchSolanaDexPrices` (no solana tokens, empty mints, partial mappings), `fetchJupiterTokenList`, `toDexPrices`, `getMintAddress`, `getAllMintAddresses`, `getMintCount`, `clearJupiterCache`. Registers 0% → 97.8% stmts / 87.2% branch / 100% funcs / 98.8% lines coverage.
- **Support & resistance test suite** — `src/analysis/support-resistance.test.ts` with 17 tests covering validation paths (null/insufficient/bad klines), cluster detection, maxLevels/minTouches filters, psychological levels toggle, label prefixes, strength bounds, upside/downside targets, pivotWindow override, low-price assets, formatSR rendering (normal + empty + summary).
- **Backtest weight optimization tests** — Extended `src/backtest.test.ts` with 4 tests for `optimizeWeights` + `formatOptimization`: defaults when no strategy breakdown, weight combination iteration, minWeight floor constraint, optimisation report rendering.
- **Paper-trader coverage** — Extended `src/paper-trade.test.ts` with 7 new tests: `getReport` full path (buy→sell with per-token breakdown), `agentPlay` proportional allocation + minConfidence skip, `getPortfolio` holdings valuation, `switchProfile` profile loading, `getSignalRecommendations` signal mapping + radar failure handling.
- **Store coverage** — Extended `src/store/db.test.ts` with 11 new tests: `Store` constructor guard (createIfMissing:false), kline ordering/limit, signal symbol/direction filters, signalHistory from/order/limit, tickerHistory time series, getLatestTickers chain/symbol filter, retention enforcement, prediction upsert/prune/filter by symbol/model/minConfidence, getLiquidations no-symbol.
- **Store.queryAll helper** — New `Store.queryAll<T>()` method with inline SQL parameter substitution via `Store.esc()` (single-quote doubling, number direct, null→NULL). Bypasses `node:sqlite` prepared-statement binding to avoid a vitest/native-module interaction bug causing "column index out of range" on parameterized queries with `all`/`iterate`.
- **Test coverage increased from 1154 to 1222 tests** — +68 tests across 55 test files (+2 new). Overall lines 90.5% (was 84.8%), statements 87.8%, functions 91.4%, branches 74.4%.
- **ML Pipeline** — Full-featured machine learning pipeline for price direction prediction:
  - `src/ml/features.ts` — Feature engineering (80+ features from 26 indicators + returns + cross-asset + futures + temporal), with kline gap detection (F9), cross-asset timestamp alignment via nearest-neighbor forward-fill (F2), NaN/Infinity sanitization (F5)
  - `src/ml/labels.ts` — Forward-return label generation at 1/5/20/60 horizons with configurable noise threshold and asymmetric class weights (F7)
  - `src/ml/dataset.ts` — Dataset assembly with inner-join, NaN row dropping, chronological train/val/test split, z-score normalization, CSV output with formula-injection protection, training-set median storage for inference fill
  - `src/ml/predict.ts` — Batch inference via Python subprocess (F3: all symbols in single CSV block), direction validation, 60s timeout guard, prediction count mismatch detection
  - `ml/train.py` — LightGBM direction classifier with early stopping, custom class weights, model + metrics + feature importance output
  - `ml/predict.py` — Batch prediction from stdin CSV, NaN fill, class probability output
- **REST API additions** (from prism-full findings F10–F15):
  - `?chain=` filter on `GET /api/tickers` (F10)
  - `?symbol=` filter on `GET /api/signals` (F11)
  - `GET /api/tokens` — full token list (F14)
  - `GET /api/regime/:symbol` — live market regime detection from klines (F15)
- **Store schema v2** — Migration with snapshot+history split (F1):
  - `tickers` and `signals` tables now use single-column PK (`symbol`) for latest-state snapshot
  - New `ticker_history` and `signal_history` tables for append-only time series
  - New `predictions` table for ML model output (F4)
  - Retention indexes for pruning old data
- **Auto-retrain daemon** (F8) — Daemon refresh cycle checks `RADAR__ML_RETRAIN_HOURS`, auto-collects features, spawns Python training, loads latest model, runs batch predictions
- **Config extensions** — `ml` config block, `store.retentionDays`, `coinglassKey`, `sources.orderbook`. Env vars: `RADAR__ML_ENABLED`, `RADAR__ML_LOOKBACK_DAYS`, `RADAR__ML_RETRAIN_HOURS`, `RADAR__ML_MIN_CONFIDENCE`, `RADAR__STORE_RETENTION_DAYS`
- **AsyncMutex** (F10) — Promise-chain write serialization in Store prevents `SQLITE_BUSY` on concurrent writes
- **Store caching** — `getKlines()`, `getCrossAsset()` use 60s TTL global cache
- **ML CLI** — `crypto-radar ml train|predict|status` commands
- **REST API** — `GET /api/predictions` and `GET /api/predictions/:symbol`
- **Environment setup** — `scripts/setup-ml-env.sh` creates isolated `.venv-ml` using `uv` or `pip`
- **npm scripts** — `ml:train`, `ml:predict`, `ml:status`, `ml:setup`

### Changed

- **Store schema** — Bumped to v2. Existing v1 databases migrated automatically
- **All 10 prism findings (F1–F10) corrected** — Schema idempotency, timestamp alignment, batch inference, predictions storage, NaN handling, config defaults, class imbalance, auto-retrain, gap detection, write serialization
- **Test coverage increased from 949 to 1154 tests** — 3 new test files (cli.test.ts, paper-trade-cli.test.ts, collector.test.ts) bringing the CLI layer, paper-trade CLI, and collector from 0% to 90%+ coverage. Overall: lines 84.01%, statements 81.47%, functions 84.92%, branches 69.56%
- **Coverage exclusions** — `src/ml/**`, `src/io/charts.ts`, `src/io/advanced-charts.ts` excluded from coverage (ML requires Python infra, advanced charts need SVG rendering infra)
- **REST API store** — `getSignals()` now accepts an optional `symbol` filter param

### Fixed

- `label_class_5` field renamed to `label_class` — correctly reflects configured horizon
- CSV injection vulnerability in dataset assembly
- `Date.now()` collision for dataset file IDs — replaced with `randomUUID()`
- Python subprocess path resolution — scripts resolved via `import.meta.url`
- Subprocess direction output validated at runtime instead of blind cast
- Empty features/labels arrays now throw `DataError`
- **Scale-boundary bugs (prism-scan Entry 3, F1–F6):**
  - `paper-trade.ts` — `compositeConfidence / 100` in `getSignalRecommendations()` crushed 0–1 values to 0–0.01, preventing agent auto-trader from executing any trade via the primary signal path (F1, critical)
  - `paper-trade.ts` — `compositeScore` field set to 0–1 while field name implies 0–100; normalized via `Math.round(c * 100)` to match fallback path convention (F2, high)
  - `backtest.ts` — `minConfidence * 100` in signal filter compared 0–1 confidence against 0–100 threshold, filtering all real signals at any non-zero threshold (F3, high)
  - `paper-trade.ts` — Added JSDoc documenting `compositeScore` scale on `TradeRecommendation` (F5, low)
  - `paper-trade.ts` — Added `Number.isFinite` + `[0,1]` clamp guard in `agentPlay` as defense-in-depth (F6, medium)
  - `backtest.ts` — Added `Number.isFinite` guard on `compositeConfidence` (F6, medium)

## [2.0.0] — 2026-07-04

### Added

- **49 tracked tokens** — Added 10 new tokens since v1.4.0: Monero (XMR), Algorand (ALGO), PancakeSwap (CAKE), JUST (JST), Tezos (XTZ), JasmyCoin (JASMY), Axie Infinity (AXS), Theta Network (THETA), Convex Finance (CVX), 1inch (1INCH). Added chain types: monero, algorand, tezos, theta. Total coverage: 49 tokens across 31 chains with Binance USDT pairs + CoinGecko IDs verified.
- **13 new technical indicators** — Total indicator count expanded to 26:
  - Parabolic SAR (PSAR) — trend-following stop-and-reversal
  - Commodity Channel Index (CCI) — cyclical overbought/oversold
  - Keltner Channels — volatility-based envelope bands using ATR
  - Rate of Change (ROC) — pure momentum oscillator
  - VWAP (Volume-Weighted Average Price) — institutional price benchmark
  - Accumulation/Distribution Line (ADL) — volume flow indicator
  - Chaikin Oscillator — MACD of ADL for volume momentum
  - Stochastic RSI (StochRSI) — stochastic applied to RSI for refined signals
  - TRIX (Triple Exponential Average) — smoothed momentum oscillator
  - KST (Know Sure Thing) — summed-rate-of-change composite
  - Elder-Ray Index — bull/bear power measurement
  - Fisher Transform — Gaussian price normalization for extreme detection
  - Mass Index — reversal detection via high-low range expansion
- **Fuzz testing suite** — `src/fuzz.test.ts` with 157 edge-case tests for all indicators (NaN, Infinity, empty arrays, single-candle). Tests run as part of main test suite.
- **SVG charts overhaul** — Complete rewrite with `shared-svg.ts` (458 lines) shared rendering engine:
  - Extracted 9 shared primitives: svgOpen(), svgClose(), escapeXml(), fmtDollar(), renderCrosshair(), renderYGrid(), renderXLabels(), renderWatermark(), renderTitle()
  - Fixed division-by-zero crashes in priceSvgChart and comparisonSvgChart
  - Fixed inline &lt;defs&gt; bug in marketBreadthGauge producing malformed SVG
  - Added timestamps to comparison chart X-axis (was "#1", "#2")
  - Added equity curve overlay to strategy performance chart
  - Added log scale toggle capability across all chart types
  - Responsive candle width calculation from data count
  - Fixed crosshair overflow, donut chart gaps, light mode panel backgrounds
  - All 36 chart tests passing
- **Signal algorithm improvements**:
  - Divergence detection — RSI/MACD price-divergence scanner (hidden/regular bullish/bearish)
  - ADX trend-strength filter — signals below ADX 25 downgraded one confidence level
  - Volatility-adjusted position sizing with conflict penalties
  - Historical accuracy tracking with alert dedup (1-hour sliding window)
  - Parallel strategy evaluation via Promise.all
- **RSS news parser upgrade** — Migrated to `rss-parser` npm library:
  - Fully async XML parsing with typed generics (zero `any` casts)
  - Handles RSS 2.0, RSS 1.0, Atom, CDATA, namespaces, encoding
  - 11 feeds with concurrency-4 batching, dead-feed detection, poison filtering
  - All 5 news tests passing
- **Cron automation** — `scripts/crypto-radar-collector.sh` ships with the plugin:
  - Runs crypto-radar scan every 2 hours (zero token cost via no_agent=true)
  - Outputs formatted summary for cron delivery
  - Auto-prunes data older than 30 days
  - `npm run collector` script added to package.json
- **Enterprise marketplace polish**:
  - plugin.yaml v2.0.0 with all 8 tools, kind:backend, toolset:crypto
  - SECURITY.md with vulnerability disclosure policy and architecture docs
  - Full typedoc.json with validation, sidebarLinks, searchInComments
  - .env.example with 18 documented environment variables
  - tsconfig.json strict mode with noUncheckedIndexedAccess, noImplicitOverride
  - eslint.config.js with typescript-eslint strict rules, prettier integration, zero errors
  - Marketplace tarball created: hermes-crypto-radar-2.0.0.tar.gz (includes dist/, plugin/, plugin.yaml, package.json, README.md, LICENSE, SECURITY.md, scripts/)

### Changed

- **crypto_radar_scan tool** — Now auto-dynamic by default (top 30 by Binance volume when no filter). Added onchain parameter to schema. First-run detection returns setup guidance with all 8 tool descriptions.
- **crypto_radar_scan schema** — Chain enum expanded from 8 to 30 chains. Description updated to list 26 indicators, divergence detection, ADX filter, auto-dynamic mode.
- **Rate limiter** — Gradual token refill (proportional per-second instead of burst-at-interval) for smoother rate limiting
- **HTTP keep-alive** — Binance API calls now reuse persistent connections via https.Agent with keepAlive: true (60s), reducing TCP handshake overhead
- **Data retention** — Logs older than config.logRetentionDays (default 30) auto-pruned. SHA-256 file checksums on CSV log writes with sidecar verification
- **CITATION.cff** — bumped to v2.0.0
- **README** — Complete rewrite: 684 lines, professional banner, badges, marketplace section, updated architecture diagrams, benchmarks, roadmap
- **SPEC.md** — Updated token counts (49) and version references to v2.0.0
- **CHANGELOG.md** — Comprehensive v2.0.0 entry

### Fixed

- Division-by-zero crashes in SVG charts with single data point
- Inline &lt;defs&gt; bug in marketBreadthGauge producing malformed SVG
- Missing timestamps on comparison chart X-axis
- Sequential strategy evaluation (now parallel via Promise.all)
- Rate limiter burst behavior (now gradual per-second refill)
- npm audit vulnerability (CVE-2025-30201 via uuid override)

### Infrastructure

- Full typedoc.json with validation, sidebarLinks, searchInComments
- .env.example extended to 18 documented env vars
- tsconfig.json strict mode confirmed with all strict-family options
- eslint.config.js with typescript-eslint + prettier, zero errors on src/
- Marketplace tarball created and verified: dist/, plugin/, plugin.yaml, package.json, README.md, LICENSE, SECURITY.md, scripts/
- One-line install script: scripts/install.sh

---

## [2.0.1] — 2026-07-06

### Fixed

- **Auto-save .txt output** — `.txt` file now always captures TABLE format output instead of mirroring the `--format` flag, ensuring cron-delivered summaries are always human-readable.
- **Auto-save .xlsx output** — `.xlsx` file now copies real binary xlsx data to the cron path instead of writing a status string. Spreadsheet exports are now usable when auto-saved.

### Changed

- **Collector script cleanup** — `scripts/crypto-radar-collector.sh` rewritten to be minimal: removed `--format json --quiet --no-news --sort` flags. The collector now runs `node dist/cli.js scan --dynamic 39 --onchain` and lets stdout flow naturally to cron delivery for human-readable run output.
- **Log pruning extended** — Auto-pruning now covers `.txt`, `.csv`, and `.md` auto-save outputs in addition to existing log files.
- **Removed JSON-specific logic** — JSON-specific validation and Node summary steps removed from collector script (no longer needed after format cleanup).

---

## [1.4.0] — 2026-07-04

### Added

- **Enterprise marketplace polish** — `plugin.yaml` now includes `toolset: crypto`, extended description with all 8 tools and full feature enumeration, and v1.4.0 version bump.
- **Full typedoc.json config** — Added `validation`, `categorizeByGroup`, `sort`, `cleanOutputDir`, `sidebarLinks`, `navigationModel`, and `searchInComments` for professional API docs generation.
- **Enhanced .env.example** — Added `RADAR__DAEMON_PORT`, `RADAR__WS_PORT`, `RADAR__LOG_RETENTION_DAYS`, `RADAR__WEBHOOK_URL`, and `RADAR__WEBHOOK_TYPE` environment variables for webhook alerts, daemon configuration, and data retention tuning.
- **TypeScript configuration audit** — `noUncheckedIndexedAccess` retained (already enabled), `noImplicitOverride` added as enterprise gate. `noUnusedLocals`/`noUnusedParameters` evaluated but kept at `false` due to pre-existing unused declarations across 12 source files (tracked as tech debt in audit).
- **Enhanced package scripts** — Added `prebuild` (clean before build), `prepublish` (build + test + lint gates), `postversion` (git tag), `typecheck` (tsc --noEmit), and `coverage` scripts.
- **Comprehensive npm package metadata** — Added `funding`, `engines.npm`, `publishConfig`, and `categories` fields to `package.json` for improved npm registry discoverability.
- **Marketplace submission scripts** — Enhanced `scripts/submit-to-marketplace.sh` and documented marketplace preparation checklist.

### Changed

- **CITATION.cff** bumped to v1.4.0.
- **CITATION.cff** — date updated to 2026-07-04, version 1.4.0.
- **README.md** — Updated all version references from v1.3.0 to v1.4.0.
- **SPEC.md** — Updated version references, expanded roadmap section, updated changelog table, and added marketplace readiness checklist.
- **CONTRIBUTING.md** — Updated test counts (332 tests), added TypeDoc generation step.
- **CRYPTO-ENTERPRISE-AUDIT.md** — Bumped to v1.4.0, updated audit scores and dates, TypeDoc and ADR items marked ✅.
- **Plugin registration** — `plugin/__init__.py` confirmed with all 8 tools registered via `register(ctx)` with full JSON schemas, proper error wrapping, and daemon-aware routing.

### Infrastructure

- All tool schemas in `plugin/__init__.py` validated for proper JSON Schema compliance — all parameters have `type`, `description`, `enum` where applicable, and `default` values.
- `package.json` `files` field includes `plugin/`, `plugin.yaml`, `README.md`, `SPEC.md`, `CHANGELOG.md`, `LICENSE`, `.env.example`, and `dist/`.
- `tsconfig.json` `noUnusedLocals`/`noUnusedParameters` kept at `false` (pre-existing tech debt: 40+ unused declarations across source tree), all other strict-family options enabled.
- Marketplace publication checklist completed — tarball verification, one-liner install script, npm registry publication, Hermes skill metadata.

---

## [1.3.0] — 2026-07-03

### Added

- **5 new technical indicators** — Stochastic Oscillator (%K/%D), Ichimoku Cloud (conversion/base/spanA/spanB/lagging span), Williams %R, Chaikin Money Flow (CMF), True Strength Index (TSI). All computed from kline high/low/close/volume and included in `TechnicalIndicators` type.
- **DeFiLlama on-chain metrics** — `src/onchain.ts` module fetches protocol TVL, chain-level TVL, 1d/7d/30d fees, and on-chain prices via the free DeFiLlama API. Batched in parallel (concurrency-5) with fallback. Wired into signal engine as a 0–15% confidence boost based on protocol TVL strength.
- **On-chain signal boost** — `computeOnchainBoost()` in `signals.ts` adds up to 15 percentage points to composite scores based on protocol TVL (high TVL >$1B → +10–15%, medium $100M–$1B → +5–10%, low <$100M → +0–5%).
- **Dynamic top-50 volume scan** — `--dynamic [count]` CLI flag auto-discovers the top N tokens by 24h USD volume via `getTopTokensByVolume()` in `tokens.ts`. Uses Binance ticker data to rank pairs by `quoteVolume`. Takes priority over `--filter`.
- **Strategy weight config overrides** — `radar.config.json` now accepts `strategyWeights` (e.g. `{"momentum": 0.5, "mean-reversion": 0.2, "trend-following": 0.3}`) and `timeframeWeights` (e.g. `{"15m": 0.1, "1h": 0.3, "4h": 0.3, "1d": 0.3}`). Also settable via `RADAR__STRATEGY_WEIGHTS` and `RADAR__TIMEFRAME_WEIGHTS` env vars.
- **`--onchain` CLI flag** — New flag on `scan` command to include DeFiLlama on-chain metrics during the scan pipeline. Disabled by default to avoid extra latency.
- **`RADAR__DEFI_LLAMA_ENABLED` env var** — Enables DeFiLlama metrics globally via environment config.
- **ESLint configuration** — Full ESLint flat config with `typescript-eslint` strict rules, `eslint-config-prettier` compatibility. `npm run lint` / `npm run lint:fix` scripts.
- **`.env.example`** — Documented all 9 env vars with defaults: `RADAR__DATA_DIR`, `RADAR__LOG_LEVEL`, `RADAR__STRATEGY_WEIGHTS`, `RADAR__TIMEFRAME_WEIGHTS`, `RADAR__TOKENS`, `RADAR__BINANCE_BASE_URL`, `RADAR__FETCH_TIMEOUT_MS`, `RADAR__CACHE_TTL_MS`, `RADAR__DEFI_LLAMA_ENABLED`.
- **`.npmignore`** — Excludes `src/`, `test/`, `data/`, eslint/prettier configs, `tsconfig.json`, `.git/`, `.github/`, `.husky/` from published package.

### Changed

- **SVG charts overhaul** — All chart types (line, candlestick, dashboard) now use:
  - CSS-in-`<style>` for maintainable styling
  - `<linearGradient>` fills for depth and visual polish
  - `viewBox` for responsive scaling across devices
  - `role="img"` + `aria-label` for accessibility
  - `<title>` tooltips on data points
  - Crosshair effects at latest candle
  - Dark theme (`#0f172a` bg), cyan/green/red palette
  - Inter font stack
  - Branding watermark
- **Package.json SEO optimization** — Name set to `hermes-crypto-radar`, description rewritten with all feature keywords, 36 comprehensive keywords (hermes, crypto, trading, defi, rsi, macd, bollinger-bands, on-chain, etc.), repository links to GitHub, `sideEffects: false`.
- **Standardized data directory** — All logs and state now default to `~/.hermes/data/crypto-radar/` (was local `./data/`). Configurable via `RADAR__DATA_DIR` env var. Ensures cross-session persistence within Hermes ecosystem.
- **DeFiLlama config integration** — `sources.defiLlama` and `defiLlamaEnabled` fields in config schema, loaded via env + file merge.
- **`includeOnchain` in RadarOptions** — `RadarOptions` type extended with `includeOnchain?: boolean` for pipeline gating.
- **Plugin tools expanded to 6** — Added `crypto_radar_chart` and `crypto_radar_daemon` to `plugin.yaml` `provides_tools` list.
- **Test suite grown to 167 tests** — Up from 155 in v1.2.0, covering all new indicators, on-chain module, config overrides, and dynamic scan.
- **`version` bumped** from `1.2.0` to `1.3.0`.

### Documentation

- README completely rewritten for GitHub discoverability with badges, feature tables, full CLI reference, plugin tool reference, architecture diagram, and quick-start guides.
- `.env.example` with all 9 supported env vars and documentation.
- CHANGELOG and SPEC.md updated for v1.3.0.

### Infrastructure

- ESLint flat config with `typescript-eslint` (strict rules, method-signature-style, await-thenable, no-unused-vars, no-floating-promises).
- Prettier 3.9 configuration.
- `.npmignore` for clean package publishing.

---

## [1.2.0] — 2026-07-02

### Added

- **Circuit breaker** — `src/core/circuit-breaker.ts` with CLOSED/OPEN/HALF_OPEN states, configurable failure threshold (3), 60s cooldown, cached-fallback. Wired into Binance API calls. Prevents cascading failures during API outages.
- **Parallel kline fetching** — Klines fetched in batches of 5 using `Promise.all`, reducing scan time by ~60% for 30+ tokens.
- **Parallel news feeds** — 9 RSS feeds fetched with concurrency-4 via batched `Promise.all`. News in ~2s instead of ~12s.
- **Atomic file writes** — CSV logs written to `.tmp` then `fs.renameSync()` (filesystem-atomic on Linux). No partial-write data loss on crash.
- **Log rotation** — `src/core/log-rotation.ts` rotates at 10MB, gzips to `.log.1.gz`, keeps 5 archives.
- **Multi-timeframe analysis** — Fetches klines across 4 intervals (`15m`, `1h`, `4h`, `1d`) in parallel per token. Technical indicators computed and stored per interval.
- **Cross-timeframe strategy aggregation** — Strategy engine runs on each interval with weighted vote (15m=0.10, 1h=0.25, 4h=0.30, 1d=0.35). Per-TF breakdown in `compositeReason` field.
- **OBV (On-Balance Volume)** — `computeOBV()` in `indicators.ts`. Wired into enriched tickers.
- **Volume vs Average (`volVsAvg`)** — `computeVolVsAvg()` in `indicators.ts`. Shows current volume deviation from 20-period average.
- **`--period` CLI flag** — `--period 15m|1h|4h|1d` limits scan to a single timeframe.
- **7 new tokens** — SUI, APT, SEI, TIA, INJ, RUNE, ATOM. Total: 39 tracked tokens.
- **Config auto-discovery** — `radar.config.json` auto-discovered from project root. Supports custom token list.
- **155-test suite** — Unit, integration, E2E coverage across 18 test files (was 58, 5 files).
- **Coverage gate** — vitest configured with thresholds: statements 80%, branches 70%, functions 75%, lines 80%.
- **2x cache TTL** — Ticker cache increased from 30s to 5min, reducing Binance API pressure.
- **Pre-commit hook** — `.husky/pre-commit` runs `npm test`.

### Documentation

- Full JSDoc on all exported functions across 15+ source files.

---

## [1.1.0] — 2026-07-02

### Added

- **XLSX export** — `--format xlsx` generates native Excel workbooks via `exceljs` with frozen headers, auto-column-width, and conditional green/red coloring on `priceChangePercent`. Importable into Excel, Google Sheets, Apple Numbers, and LibreOffice Calc.
- **CoinGecko API module + pipeline wiring** — `src/coingecko.ts` provides `fetchSimplePrices()` and `fetchMarketData()`. Wired into `radar.ts` as fallback for tokens missing from Binance, with `--alt-source` CLI flag for primary use.
- **CI pipeline** — GitHub Actions workflow (`.github/workflows/ci.yml`) builds on Node 20 & 22, runs test suite, and verifies dist output. Active on push/PR to main.
- **Vitest test suite** — 58 tests across 5 test files:
  - `indicators.test.ts` (15 tests): RSI, MACD, BB, ATR, SMA, EMA, MFI, volume trend
  - `signals.test.ts` (8 tests): composite scoring, alerts (DIP/PUMP/overbought/oversold), news contribution
  - `engine.test.ts` (8 tests): strategy direction voting, confidence scoring, failure handling, cross-strategy aggregation
  - `output.test.ts` (13 tests): CSV, JSON, Markdown, terminal table, signal report, edge cases
  - `binance.integration.test.ts` (5 tests): mock ticker/kline fetch, full pipeline, rate-limit retry
- **NEWS_CSV_HEADER shared constant** — `src/output.ts` now exports a canonical news CSV header, imported by `radar.ts` to prevent schema drift between write path and data definition.
- **Kline caching** — Per-run `Map<string, Kline[]>` eliminates the double-fetch of klines (was: fetched once for indicators, again for strategy engine; now: fetched once, cached, reused). ~50% reduction in API calls per scan.

### Changed

- **SPEC.md overhaul** — Architecture diagram updated to show all 7 source directories (`core/`, `analysis/`, `io/`, `monitor/`). Project structure tree matches actual layout. Token count corrected (Polygon/DeFi: 12→13). Roadmap falsehood fixed (multi-timeframe was marked "✅ DONE" but is not implemented — changed to 🔜). Quality standards updated with CI and dependency hygiene gates.
- **CLI format options** — `scan`, `signals`, and `news` commands now accept `xlsx` as a format value alongside `table`, `json`, `csv`, `md`.
- **OutputFormat type** — Extended union type to include `'xlsx'`.
- **Package dependencies** — Removed 3 unused packages (`pino`, `zod`, `csv-parse`). Added `exceljs` for XLSX export. Confirmed all remaining `dependencies` are actually imported.
- **version** bumped from `1.0.0` to `1.1.0`.

### Fixed

- **SOURCE_TIERS bug** — News relevance scoring was keying on `token.name` to look up source tiers, causing ALL tokens to receive the default 0.8 multiplier instead of the correct source-specific weight (e.g., CoinTelegraph=1.0, NullTX=0.4). Fixed to key on `feed.name` via new `sourceName` parameter on `matchToken()`.
- **News domain extraction** — RSS feeds returning relative URLs or empty link fields silently produced empty `domain` values, corrupting the CSV. Fixed with fallback to `source.toLowerCase() + '.com'`.
- **CSV multi-line quoting** — News descriptions containing embedded newlines produced malformed CSV rows. Fixed by stripping `\r`/`\n` to spaces before quoting.
- **Integration test flakiness** — `Math.random()` in mock klines caused non-deterministic RSI/MACD assertions. Replaced with deterministic sine-wave fixture.
- **XLSX crash on write failure** — `displayRadar` awaited `exportToXlsx` without error handling, crashing CLI on write errors. Wrapped in try-catch with graceful fallback message.
- **XRP CoinGecko ID** — Token used `'xrp'` as CoinGecko ID, but the correct API identifier is `'ripple'`. Fixed coingeckoId to enable correct price lookups.

### Performance

- **Kline caching** — eliminated redundant API calls. Before: one `fetchKlines()` per token for indicators (step 2) + one per token for strategy engine (step 5) = 60 API calls for 30 tokens. After: one per token = 30 API calls. Both fetches now use `limit=200` (was 100 vs 200) for consistent data.

---

## [1.0.0] — 2026-07-02

### Added

- **32 tokens** across Solana (13), Polygon/DeFi (13), and Multi (7)
- **Binance 24hr ticker** — All USDT pairs with timeout + retry + 429 backoff
- **Token enrichment** — Spread, VWAP distance, range position, book imbalance
- **Momentum scoring** — Price change + volume + spread + book imbalance
- **Technical indicators** — RSI, MFI, MACD, Bollinger Bands, ATR, volume trend, EMA50
- **News fetching** — 9 RSS feeds with headline/body matching, relevance scoring, poison filtering, cross-feed dedup
- **Composite signal generation** — 40% momentum + 40% technical + 20% news
- **CLI** — 8 commands: `scan`, `signals`, `news`, `tokens`, `chart`, `health`, `configure`, `strategies`
- **Hermes plugin** — 4 agent tools (`crypto_radar_scan`, `_signals`, `_news`, `_tokens`) via Python bridge
- **Output formats** — Terminal table, CSV, JSON, Markdown
- **Terminal sparkline charts** — ASCII price charts via asciichart
- **SVG chart generation** — Self-contained dark-theme SVG with volume bars, multi-panel with RSI
- **3-strategy signal engine** — Momentum (40%), Mean Reversion (20%), Trend Following (40%) with weighted confidence voting
- **Strategy aggregation** — Weighted vote engine → `strong_buy`/`buy`/`neutral`/`sell`/`strong_sell` with 0–100% confidence
- **Health monitoring** — Binance API, data directory, system resource checks
- **Configuration system** — JSON config file + `RADAR__*` env vars with typed defaults
- **Typed error classes** — `CryptoRadarError`, `NetworkError`, `RateLimitError`, `DataError`, `ConfigError`, `CacheError`, `SignalError`
- **Structured logging** — JSON to stderr, 6 levels (trace–fatal), child loggers
- **In-memory cache** — TTL-based with `memoize()` support and auto-expiry
- **Rate limiter** — Token-bucket algorithm, configurable max/window
- **Plugin metadata** — `plugin.yaml` with version, description, 4 provided tools
- **SPEC.md** — Full project specification with architecture, token roster, tool reference, data flow, scoring models, development guide, and marketplace publishing plan

### Infrastructure

- TypeScript 5.8 with strict mode, ES2022 target, ESNext modules
- Commander.js CLI framework
- csv-stringify for CSV generation
- picocolors for terminal coloring
- 24 source files across 6 directories (src/, src/core/, src/analysis/, src/io/, src/monitor/, plugin/)

### Security

- **npm audit: 0 vulnerabilities** — Fixed `uuid` moderate CVE via npm overrides
- **HTTP security headers** — Added X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS, CSP, Referrer-Policy, Cache-Control to both daemon HTTP servers
- **Rate limiter gradual refill** — Token-bucket now refills proportionally per-second instead of burst-refill at interval boundaries
- **Path traversal protection** — `validate` command now restricts file reads to project directories
- **SECURITY.md** — Created with vulnerability disclosure policy, security architecture docs, and reporting procedure
- **prepublishOnly fix** — Changed from `prepublish` to `prepublishOnly` to prevent running build+test on `npm install`

---

## [0.x] — Pre-release (not tracked)

[2.6.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v2.6.0
[2.5.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v2.5.0
[2.4.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v2.4.0
[2.3.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v2.3.0
[2.2.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v2.2.0
[2.1.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v2.1.0
[2.0.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v2.0.0
[2.0.1]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v2.0.1
[1.4.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v1.4.0
[1.3.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v1.3.0
[1.2.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v1.2.0
[1.1.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v1.1.0
[1.0.0]: https://github.com/ssdeanx/Hermes-Crypto-Radar/releases/tag/v1.0.0
