# Ultragoal Brief: Enterprise Code Audit, Deep Synchronization, Comprehensive References & Live Token Scan Verification

## Objectives
1. **Full Trace & Code Smells Audit**:
   - Deep review of core TypeScript and Python engines (`src/radar.ts`, `src/signals.ts`, `src/paper-trade.ts`, `src/math/`, `src/analysis/`, `ml/indicators.py`, `ml/predict.py`, `ml/train_paper_agent.py`, `ml/train.py`).
   - Fix all code smells, type inconsistencies, edge cases, and eliminate any remaining legacy "Hermes Crypto Radar" headers across all files.
2. **Synchronize All Core Documentation**:
   - **`CHANGELOG.md`**: Comprehensive log of all releases and the v2.9.0 / v2.10.0 Quantitative Math & AI Eval updates.
   - **`README.md`**: Complete, accurate, state-of-the-art documentation with token counts, indicators, MathJS quantitative engine, ML architecture, promptfoo benchmarks, API routes, and CLI usage.
   - **`SPEC.md`**: Full architectural specification updated to cover all mathematical modules, agent eval scorecards, Promptfoo pipelines, and multi-asset sizing.
   - **`SKILL.md` & `skills/crypto-radar/SKILL.md`**: Synchronized Hermes Agent skill definitions with exact tool signatures, argument hints, and subagent contracts.
3. **Comprehensive Reference Library (`docs/references/`)**:
   - Add detailed, production-grade architectural and operational references:
     - `math-engine.md`: Quantitative math, portfolio optimization, Kalman filtering, Markov chains, spectral PCA.
     - `ml-pipeline.md`: CatBoost/LightGBM training, River online learning, Optuna, drift detection, telemetry.
     - `signal-engine.md`: Strategy aggregation, divergence detection, multi-timeframe calculations.
     - `paper-trading.md`: Simulation engine, fractional Kelly sizing, telemetry datasets, execution models.
     - `api-daemon-ws.md`: Fastify REST API, WebSocket streams, warm daemon protocol.
     - `eval-benchmarks.md`: Promptfoo testing, Autoevals, Brier score, ECE calibration.
4. **End-to-End Live Verification**:
   - Run `npm test`, `pytest`, `npm run build`, `npm run lint`.
   - Execute CLI live token scan (`node dist/cli.js scan --limit 5` or `npx tsx src/cli.ts scan`) to verify real-time Binance/CoinGecko market ingestion, technical indicator calculation, and signal synthesis.
