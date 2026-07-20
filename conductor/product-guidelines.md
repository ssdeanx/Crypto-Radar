# Product Guidelines: Crypto Radar

## Tone & Voice
*   **Data-Driven & Objective**: Communications, logs, and generated AI predictions must be objective, precise, and devoid of financial hype.
*   **Professional Financial Analyst**: AI-generated reasoning (Vertex AI Gemini or OpenAI-compatible local models) should maintain the tone of a professional market analyst, referencing specific data points (klines, indicators, TVL, news sentiment) to support all conclusions.
*   **Clear Error Feedback**: System errors must be descriptive, categorized via custom error classes (`src/core/errors.ts`), and present actionable solutions rather than opaque tracebacks.

## UX & Output Layout
*   **Visual Polish**: CLI outputs use clear tabular views (via standard formatter utilities) and terminal colors (`picocolors`) to denote trends (green for bullish, red for bearish, yellow for neutral/warning).
*   **Structured Formats**: All core datasets support clean tabular exports (XLSX with frozen headers and conditional formatting, CSV, JSON, Markdown, and self-contained HTML/PDF reports).
*   **ASCII Sparklines & SVG Charts**: High-density visual charts (SVG candlestick/dashboards) must use clean CSS gradients, responsive viewports, and accessible styling.

## Log Hygiene
*   **Structured Logging**: Production application logs are output in JSON format (suitable for Google Cloud Logging) using standard levels: `info`, `warn`, `error`, and `debug`.
*   **Auditability**: Critical pipelines, database transactions, API calls, and ML inference operations must log identifiers (e.g., scan `runId`, model version hashes, request IDs) for end-to-end tracking.

## Engineering Standards & Constraints

### Technical Indicator Calculations
*   Python (`ml/indicators.py`) is the **single source of truth** for all technical indicator calculations in the pipeline.
*   The TypeScript functions in `src/indicators.ts` are exported for public API consumers and unit tests but are **not used in the production scan pipeline**.
*   The Python indicators must handle empty inputs, flat arrays, and non-finite numbers (NaN, Infinity, -Infinity) gracefully. The `val()` output helper must filter out non-finite floats to prevent invalid JSON.
*   Fallback states and empty lists must return fully populated default structures with null/None values rather than empty dictionaries/objects.

### Batch Execution Architecture
*   All calculations in execution paths (such as `src/radar.ts`) must use `batchComputeAllIndicators(batches)` (which spawns a single `ml/indicators.py` process) to avoid the overhead of spawning individual Python processes per token.
*   See [Migration Plan §2](../docs/cloud-migration-plan.md) for how the production server container handles the Python dependency separation.

### Database Strategy Score Mappings

> [!WARNING]
> **Known Bug ([Migration Plan §2.7](../docs/cloud-migration-plan.md)):** In `src/store/db.ts` lines 470-471, the BigQuery `signal_history` insert currently maps `s.technicalScore → mean_reversion_score` and `s.newsScore → trend_following_score`. This writes **wrong values** to the wrong columns. Scheduled to be fixed in Phase 0 of the cloud migration.

### Cloud-Mode Filesystem Guards
*   When the system is running in cloud mode, all local filesystem operations (logging to file, PID files, lock files, state saves) become no-ops. Scan results are persisted exclusively to BigQuery via `Store.persistRun()`.
*   See [Migration Plan §2.4-2.6](../docs/cloud-migration-plan.md) for the `isCloudMode()` implementation details and the specific functions guarded.

### LLM Provider Routing
*   **Current state**: Two separate modules exist — `src/analysis/gemini.ts` (Vertex AI) and `src/analysis/openai-compatible.ts` (local/dev).
*   **Target state**: A unified provider abstraction that routes based on `RADAR__AI_*` env var presence. See [Migration Plan §4.1-4.2](../docs/cloud-migration-plan.md) for the planned `analyzeToken()` interface and refactoring details.

### Storage Migration Strategy
*   BigQuery is the primary production database store. Local SQLite (`node:sqlite` in WAL mode) serves as a fallback when BigQuery is unavailable or for local development.
*   Cloud Run has no persistent filesystem — all data persistence goes through BigQuery.
