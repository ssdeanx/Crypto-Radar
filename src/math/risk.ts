// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Quantitative Risk & Sizing Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Institutional mathematical position sizing, capital allocation, and risk bounds:
// - Fractional & Full Kelly Criterion sizing
// - Volatility-Targeted Position Sizing (Fixed Dollar Risk per ATR)
// - Parametric & Historical Value-at-Risk (VaR)
// - Conditional Value-at-Risk (CVaR / Expected Shortfall)
// ═══════════════════════════════════════════════════════════════════════

import * as math from 'mathjs';

export interface KellyOptions {
  /** Fractional Kelly multiplier (default: 0.5 for Half-Kelly, lower risk) */
  fraction?: number;
  /** Maximum allowable portfolio allocation percentage (default: 0.25 = 25%) */
  maxAllocation?: number;
}

/**
 * Computes optimal position size fraction using the Kelly Criterion:
 * f* = (p * (b + 1) - 1) / b * fraction
 *
 * @param winProb - Probability of winning trade (0.0 to 1.0)
 * @param winLossPayoffRatio - Ratio of average win to average loss (e.g. 2.0 = $200 win vs $100 loss)
 * @param opts - Kelly options (fractional multiplier & max cap)
 * @returns Optimal capital fraction to allocate (0.0 to maxAllocation)
 */
export function computeKellyFraction(
  winProb: number,
  winLossPayoffRatio: number,
  opts: KellyOptions = {},
): number {
  const fraction = opts.fraction ?? 0.5; // Half-Kelly default for safety
  const maxCap = opts.maxAllocation ?? 0.25;

  if (winProb <= 0 || winLossPayoffRatio <= 0) return 0;
  if (winProb >= 1.0) return maxCap;

  const b = winLossPayoffRatio;
  const p = Math.min(Math.max(winProb, 0), 1);
  const q = 1 - p;

  // Full Kelly formula: f = (b*p - q) / b
  const fullKelly = (b * p - q) / b;

  if (fullKelly <= 0 || !Number.isFinite(fullKelly)) {
    return 0; // Negative expectancy -> no allocation
  }

  const sized = fullKelly * fraction;
  return Number(Math.min(Math.max(sized, 0), maxCap).toFixed(4));
}

/**
 * Computes position size based on target dollar risk and ATR stop distance.
 *
 * Position Size = Target Dollar Risk / (Stop Distance in Price)
 *
 * @param accountBalanceUsd - Total available capital in USD
 * @param riskFraction - Target risk per trade (e.g. 0.01 for 1% risk)
 * @param entryPrice - Current asset price
 * @param stopDistanceUsd - Dollar distance to stop loss (e.g. 2.0 * ATR)
 */
export function computeVolatilityTargetedSize(
  accountBalanceUsd: number,
  riskFraction: number,
  entryPrice: number,
  stopDistanceUsd: number,
): {
  targetUnits: number;
  targetUsdValue: number;
  portfolioWeight: number;
} {
  if (accountBalanceUsd <= 0 || entryPrice <= 0 || stopDistanceUsd <= 0 || riskFraction <= 0) {
    return { targetUnits: 0, targetUsdValue: 0, portfolioWeight: 0 };
  }

  const dollarRiskTarget = accountBalanceUsd * Math.min(riskFraction, 0.05); // Cap risk at 5% max
  const units = dollarRiskTarget / stopDistanceUsd;
  const targetUsd = units * entryPrice;
  const weight = Math.min(targetUsd / accountBalanceUsd, 1.0);

  return {
    targetUnits: Number(units.toFixed(6)),
    targetUsdValue: Number(targetUsd.toFixed(2)),
    portfolioWeight: Number(weight.toFixed(4)),
  };
}

/**
 * Historical Value-at-Risk (VaR) and Expected Shortfall (CVaR).
 *
 * @param returns - Historical periodic returns (e.g. daily or hourly)
 * @param confidence - Confidence level (default: 0.95 = 95%)
 */
export function computeValueAtRisk(
  returns: number[],
  confidence = 0.95,
): {
  varPercent: number;
  cvarPercent: number;
} {
  if (returns.length < 5) {
    return { varPercent: 0, cvarPercent: 0 };
  }

  const sorted = [...returns].sort((a, b) => a - b);
  const alpha = 1 - confidence;
  const varIndex = Math.floor(sorted.length * alpha);

  const varVal = Math.abs(sorted[varIndex] ?? 0);
  const tail = sorted.slice(0, varIndex + 1);
  const cvarVal = tail.length > 0 ? Math.abs(Number(math.mean(tail))) : varVal;

  return {
    varPercent: Number((varVal * 100).toFixed(2)),
    cvarPercent: Number((cvarVal * 100).toFixed(2)),
  };
}
