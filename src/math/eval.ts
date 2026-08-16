// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Quantitative Financial Analytics Engine
// ═══════════════════════════════════════════════════════════════════════
//
// High-performance financial risk, calibration, and execution metrics
// built on mathjs vector/matrix operations.
//
// Includes:
// - Brier Score & Expected Calibration Error (ECE) for probability honesty
// - Sharpe, Sortino & Calmar Ratios for risk-adjusted performance
// - Maximum Adverse Excursion (MAE) & Maximum Favorable Excursion (MFE)
// - Alpha vs. Benchmark (BTC / Market)
// ═══════════════════════════════════════════════════════════════════════

import * as math from 'mathjs';

/**
 * Computes the Brier Score for probabilistic predictions:
 * BS = (1/N) * sum((p_i - y_i)^2)
 *
 * Lower is better (0.0 = perfect prediction, 0.25 = random 50/50 baseline).
 *
 * @param probabilities - Predicted probabilities of positive class (0.0 to 1.0)
 * @param outcomes - Binary ground truth outcomes (0 or 1)
 */
export function computeBrierScore(probabilities: number[], outcomes: number[]): number {
  if (probabilities.length === 0 || outcomes.length === 0) return 0;
  if (probabilities.length !== outcomes.length) {
    throw new Error('Probabilities and outcomes must have equal length');
  }

  const n = probabilities.length;
  let sumSquaredDiff = 0;

  for (let i = 0; i < n; i++) {
    const p = Math.min(Math.max(probabilities[i] ?? 0, 0), 1);
    const y = outcomes[i] ? 1 : 0;
    const diff = p - y;
    sumSquaredDiff += diff * diff;
  }

  return Number((sumSquaredDiff / n).toFixed(6));
}

/**
 * Expected Calibration Error (ECE) with equal-width probability binning.
 * Measures the difference between model confidence and empirical accuracy.
 *
 * @param confidences - Predicted confidence scores (0.0 to 1.0)
 * @param outcomes - Binary ground truth outcomes (0 or 1)
 * @param numBins - Number of bins (default: 10)
 */
export function computeExpectedCalibrationError(
  confidences: number[],
  outcomes: number[],
  numBins = 10,
): number {
  if (confidences.length === 0 || outcomes.length === 0) return 0;
  if (confidences.length !== outcomes.length) {
    throw new Error('Confidences and outcomes must have equal length');
  }

  const n = confidences.length;
  const binSize = 1.0 / numBins;
  const binCounts = new Array<number>(numBins).fill(0);
  const binAccuracies = new Array<number>(numBins).fill(0);
  const binConfidences = new Array<number>(numBins).fill(0);

  for (let i = 0; i < n; i++) {
    const conf = Math.min(Math.max(confidences[i] ?? 0, 0), 0.999999);
    const binIdx = Math.floor(conf / binSize);
    binCounts[binIdx] = (binCounts[binIdx] ?? 0) + 1;
    binConfidences[binIdx] = (binConfidences[binIdx] ?? 0) + conf;
    binAccuracies[binIdx] = (binAccuracies[binIdx] ?? 0) + (outcomes[i] ? 1 : 0);
  }

  let totalEce = 0;
  for (let b = 0; b < numBins; b++) {
    const count = binCounts[b] ?? 0;
    if (count > 0) {
      const avgConf = (binConfidences[b] ?? 0) / count;
      const avgAcc = (binAccuracies[b] ?? 0) / count;
      const binWeight = count / n;
      totalEce += binWeight * Math.abs(avgAcc - avgConf);
    }
  }

  return Number(totalEce.toFixed(6));
}

/**
 * Annualized Sharpe Ratio:
 * Sharpe = (mean(R) - Rf) / std(R) * sqrt(periodsPerYear)
 *
 * @param returns - Periodic percentage returns (e.g. [0.02, -0.01, 0.015])
 * @param riskFreeRate - Annualized risk-free rate (default: 0.0)
 * @param periodsPerYear - Frequency multiplier (default: 365 for daily, 8760 for hourly)
 */
export function computeSharpeRatio(
  returns: number[],
  riskFreeRate = 0,
  periodsPerYear = 365,
): number {
  if (returns.length < 2) return 0;

  const rMean = Number(math.mean(returns)) * periodsPerYear;
  const rStd = Number(math.std(returns)) * Math.sqrt(periodsPerYear);

  if (rStd === 0 || !Number.isFinite(rStd)) return 0;
  const sharpe = (rMean - riskFreeRate) / rStd;
  return Number.isFinite(sharpe) ? Number(sharpe.toFixed(4)) : 0;
}

/**
 * Sortino Ratio (penalizes downside volatility only):
 * Sortino = (mean(R) - Rf) / downsideStd * sqrt(periodsPerYear)
 *
 * @param returns - Periodic percentage returns
 * @param targetReturn - Minimum acceptable return threshold (default: 0)
 * @param periodsPerYear - Frequency multiplier (default: 365)
 */
export function computeSortinoRatio(
  returns: number[],
  targetReturn = 0,
  periodsPerYear = 365,
): number {
  if (returns.length < 2) return 0;

  const rMean = Number(math.mean(returns)) * periodsPerYear;
  const downsideDiffs = returns
    .map(r => Math.min(0, r - targetReturn))
    .filter(diff => diff < 0);

  if (downsideDiffs.length === 0) {
    return rMean > targetReturn ? 99.99 : 0;
  }

  const sumSquares = downsideDiffs.reduce((acc, v) => acc + v * v, 0);
  const downsideDeviation = Math.sqrt(sumSquares / returns.length) * Math.sqrt(periodsPerYear);

  if (downsideDeviation === 0 || !Number.isFinite(downsideDeviation)) return 0;
  const sortino = (rMean - targetReturn) / downsideDeviation;
  return Number.isFinite(sortino) ? Number(sortino.toFixed(4)) : 0;
}

/**
 * Maximum Peak-to-Trough Drawdown
 *
 * @param equityCurve - Array of portfolio values over time
 */
export function computeMaxDrawdown(equityCurve: number[]): {
  maxDrawdownPct: number;
  peakIndex: number;
  troughIndex: number;
} {
  if (equityCurve.length < 2) {
    return { maxDrawdownPct: 0, peakIndex: 0, troughIndex: 0 };
  }

  let peak = equityCurve[0] ?? 0;
  let peakIdx = 0;
  let maxDd = 0;
  let bestPeakIdx = 0;
  let bestTroughIdx = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    const val = equityCurve[i] ?? 0;
    if (val > peak) {
      peak = val;
      peakIdx = i;
    } else if (peak > 0) {
      const dd = (peak - val) / peak;
      if (dd > maxDd) {
        maxDd = dd;
        bestPeakIdx = peakIdx;
        bestTroughIdx = i;
      }
    }
  }

  return {
    maxDrawdownPct: Number((maxDd * 100).toFixed(2)),
    peakIndex: bestPeakIdx,
    troughIndex: bestTroughIdx,
  };
}

/**
 * Maximum Favorable Excursion (MFE) & Maximum Adverse Excursion (MAE)
 * for a trade over a kline path.
 *
 * @param entryPrice - Execution price
 * @param isLong - True for buy/long, false for sell/short
 * @param klines - Kline high/low series during holding period
 */
export function computeMfeMaeExcursions(
  entryPrice: number,
  isLong: boolean,
  klines: { high: number; low: number }[],
): {
  mfePercent: number;
  maePercent: number;
  mfeToMaeRatio: number;
} {
  if (entryPrice <= 0 || klines.length === 0) {
    return { mfePercent: 0, maePercent: 0, mfeToMaeRatio: 1.0 };
  }

  let maxFavorable = 0;
  let maxAdverse = 0;

  for (const k of klines) {
    if (isLong) {
      const favorable = (k.high - entryPrice) / entryPrice;
      const adverse = (entryPrice - k.low) / entryPrice;
      if (favorable > maxFavorable) maxFavorable = favorable;
      if (adverse > maxAdverse) maxAdverse = adverse;
    } else {
      const favorable = (entryPrice - k.low) / entryPrice;
      const adverse = (k.high - entryPrice) / entryPrice;
      if (favorable > maxFavorable) maxFavorable = favorable;
      if (adverse > maxAdverse) maxAdverse = adverse;
    }
  }

  const mfePct = Number((maxFavorable * 100).toFixed(2));
  const maePct = Number((maxAdverse * 100).toFixed(2));
  const ratio = maePct > 0 ? Number((mfePct / maePct).toFixed(2)) : mfePct > 0 ? 10.0 : 1.0;

  return {
    mfePercent: mfePct,
    maePercent: maePct,
    mfeToMaeRatio: ratio,
  };
}

/**
 * Alpha vs. Benchmark (e.g. Token Return minus BTC Return over same period)
 */
export function computeAlphaVsBenchmark(
  assetReturns: number[],
  benchmarkReturns: number[],
): number[] {
  const n = Math.min(assetReturns.length, benchmarkReturns.length);
  const alpha: number[] = [];

  for (let i = 0; i < n; i++) {
    const a = assetReturns[i] ?? 0;
    const b = benchmarkReturns[i] ?? 0;
    alpha.push(Number((a - b).toFixed(6)));
  }

  return alpha;
}
