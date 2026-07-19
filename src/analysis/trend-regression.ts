// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Trend Regression
// ═══════════════════════════════════════════════════════════════════════
//
// Statistically sound trend strength via linear regression:
//   - slope  → directional bias and magnitude
//   - R²     → trend consistency (0-1, higher = more consistent)
//   - projection → next-period extrapolation
//
// Not wired into the signal engine — consumers opt in.

import { linearRegression, linearRegressionLine, rSquared } from '../math/index.js';

export interface TrendRegressionResult {
  slope: number;
  rSquared: number;
  projection: number;
}

/**
 * Compute linear regression on the most recent `period` price values.
 *
 * Returns slope (per-index-unit), R² goodness-of-fit, and a 1-step-ahead
 * price projection. Returns null when there's insufficient data.
 *
 * @param prices  Full price series (uses last `period` values)
 * @param period  Lookback window
 */
export function computeTrendRegression(
  prices: number[],
  period: number,
): TrendRegressionResult | null {
  if (prices.length < period || period < 3) return null;

  const window = prices.slice(-period);

  // Build [x, y] pairs where x = 0, 1, ..., period-1
  const data: number[][] = window.map((price, i) => [i, price]);

  const reg = linearRegression(data);
  const regLine = linearRegressionLine(reg);
  const r2 = rSquared(data, regLine);

  return {
    slope: reg.m,
    rSquared: r2,
    projection: regLine(period),
  };
}
