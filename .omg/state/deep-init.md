# Deep Init Summary

## Objective
Fix the 95% extra calls problem for indicators by bypassing redundant TypeScript calculations in `src/indicators.ts` and leveraging the batched Python pandas-ta implementation in `ml/indicators.py`, without breaking `cron.ts` JSONL outputs.

## Architecture Boundaries
- **Node.js**: `src/radar.ts` loops over tokens, currently calling `computeAllIndicators` for each.
- **Node.js**: `src/cli.ts` writes `radar-tickers.jsonl` by mapping `EnrichedTicker` through `toJSONLine` after `runRadar` completes.
- **Python**: `ml/indicators.py` computes indicators using `pandas-ta`. It reads from `sys.stdin` (JSON) and writes to `sys.stdout`.

## High-Risk Zones
- **`src/radar.ts`**: The radar engine must still return fully populated `EnrichedTicker` objects with `TechnicalIndicators`. Modifying how indicators are fetched could cause fields to become undefined, breaking `toJSONLine` (which emits the JSONL dataset for ML).
- **`src/indicators.ts`**: Used across tests, ML feature engineering (`src/ml/features.ts`), and the REST API. Changing the signature or behavior here might break downstream dependents.

## Goal
Implement a batched offload to Python in `src/radar.ts` or as a batch API in `src/indicators.ts`, ensuring that all token data is aggregated, passed to `ml/indicators.py` in ONE subprocess call, and the resulting indicators are correctly mapped back onto the tokens before being formatted into the `radar-tickers.jsonl` append log.
