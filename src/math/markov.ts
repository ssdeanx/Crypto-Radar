// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Markov Regime Transition & Stationary State Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Institutional Markov chain mathematical modeling for market regimes:
// - Empirical transition probability matrix estimation with Laplace smoothing
// - Expected regime persistence duration (tau = 1 / (1 - P_ii))
// - Long-run ergodic stationary probability distribution (pi * P = pi)
// - Forward multi-step regime transition probability forecasting
// ═══════════════════════════════════════════════════════════════════════

import * as math from 'mathjs';

export type MarketRegimeType = 'bull' | 'bear' | 'chop';

export interface MarkovRegimeResult {
  states: MarketRegimeType[];
  transitionMatrix: number[][]; // 3x3 row-stochastic matrix
  expectedDuration: Record<MarketRegimeType, number>; // in bars
  stationaryDistribution: Record<MarketRegimeType, number>;
  predictNext: (current: MarketRegimeType) => Record<MarketRegimeType, number>;
}

const REGIME_ORDER: MarketRegimeType[] = ['bull', 'bear', 'chop'];

/**
 * Estimates the empirical 1st-order Markov Transition Probability Matrix from a historical regime sequence.
 *
 * @param sequence - Chronological series of market regimes
 * @param smoothing - Laplace smoothing prior (default: 0.1)
 */
export function estimateMarkovTransitionMatrix(
  sequence: MarketRegimeType[],
  smoothing = 0.1,
): MarkovRegimeResult {
  const n = REGIME_ORDER.length;
  const countMatrix: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => smoothing));

  // Count observed transitions
  for (let t = 0; t < sequence.length - 1; t++) {
    const fromIdx = REGIME_ORDER.indexOf(sequence[t]!);
    const toIdx = REGIME_ORDER.indexOf(sequence[t + 1]!);
    if (fromIdx >= 0 && toIdx >= 0) {
      countMatrix[fromIdx]![toIdx]! += 1;
    }
  }

  // Row normalize to obtain transition matrix P
  const transitionMatrix: number[][] = countMatrix.map(row => {
    const rowSum = row.reduce((a, b) => a + b, 0);
    return row.map(val => Number((rowSum > 0 ? val / rowSum : 1 / n).toFixed(4)));
  });

  // Calculate expected persistence duration: tau_i = 1 / (1 - P_ii)
  const expectedDuration: Record<MarketRegimeType, number> = {
    bull: 1,
    bear: 1,
    chop: 1,
  };

  REGIME_ORDER.forEach((state, i) => {
    const p_ii = transitionMatrix[i]?.[i] ?? 0.33;
    const dur = p_ii >= 0.999 ? 100 : 1 / (1 - p_ii);
    expectedDuration[state] = Number(dur.toFixed(2));
  });

  // Compute stationary distribution pi where pi * P = pi via power iteration with mathjs
  let pi = math.matrix([[1 / 3, 1 / 3, 1 / 3]]);
  const pMatrix = math.matrix(transitionMatrix);

  for (let iter = 0; iter < 40; iter++) {
    pi = math.multiply(pi, pMatrix);
  }

  const piArray: number[] = (pi.toArray() as number[][])[0] ?? [1 / 3, 1 / 3, 1 / 3];
  const stationaryDistribution: Record<MarketRegimeType, number> = {
    bull: Number((piArray[0] ?? 0.3333).toFixed(4)),
    bear: Number((piArray[1] ?? 0.3333).toFixed(4)),
    chop: Number((piArray[2] ?? 0.3333).toFixed(4)),
  };

  const predictNext = (current: MarketRegimeType): Record<MarketRegimeType, number> => {
    const fromIdx = REGIME_ORDER.indexOf(current);
    const row = transitionMatrix[fromIdx] ?? [0.3333, 0.3333, 0.3333];
    return {
      bull: row[0] ?? 0.3333,
      bear: row[1] ?? 0.3333,
      chop: row[2] ?? 0.3333,
    };
  };

  return {
    states: REGIME_ORDER,
    transitionMatrix,
    expectedDuration,
    stationaryDistribution,
    predictNext,
  };
}
