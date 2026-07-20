# Validation Protocol

## Pre-computation Requirements
- Run `npm run check:python` to verify Python type safety and linting.
- Validate `npm run test` still passes for untouched components (e.g., `collector.test.ts`, `ml.test.ts`). Note: `indicators.test.ts` and `fuzz.test.ts` may need updates or skips depending on how we migrate `computeAllIndicators`.

## Functional Requirements
- **JSONL Output**: The JSONL output written by `src/cli.ts` to `data/crypto-radar/radar-tickers.jsonl` MUST maintain its schema. No fields should become `undefined` or drop off.
- **Batched Fetch**: A trace of `src/radar.ts` execution must prove only ONE call is made to spawn `ml/indicators.py` per run (or per interval batch), reducing process overhead by 95%.
- **Correctness**: The values returned by the Python process must map 1:1 to the `EnrichedTicker` fields expected by the UI and the ML training pipeline.
