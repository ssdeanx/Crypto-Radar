# Project Map

## Modules and Responsibilities
- `src/radar.ts`: Market scanner. Fetches klines, iterates over token lists, calculates technicals, aggregates scores, returns `EnrichedTicker[]`.
- `src/cli.ts`: Entrypoint and orchestration. Handles writing `radar-runlog.jsonl` and `radar-tickers.jsonl` from the output of `runRadar()`.
- `src/api/fastify/routes/cron.ts`: Runs scheduled cycle. Triggers `runRadar()`, `runCollector()`, and ML `batchPredict`.
- `ml/indicators.py`: Feature engineering layer. A Python CLI tool designed to take JSON representations of OHLCV data on `sys.stdin` and output calculated Technical Indicators via `sys.stdout`.
- `src/indicators.ts`: Legacy Node.js-based indicator implementation.

## Dependency Hotspots
- `computeAllIndicators(klines)` is tightly coupled in `radar.ts` at the innermost loop per-token/per-interval.
- `toJSONLine` depends strictly on all properties (including indicators like `obv`, `rsi`, `macd`) being correctly filled in by the time `src/cli.ts` iterates over the `runRadar()` results.
