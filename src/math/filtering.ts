// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Signal Filtering & Mathematical Regime Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Advanced mathematical noise reduction and time-series regime analysis:
// - 1D Kalman Filter (optimal state & velocity estimation)
// - Robust Outlier Z-Score via Median Absolute Deviation (MAD)
// - Hurst Exponent (H < 0.5 Mean-Reverting, H > 0.5 Trending, H ≈ 0.5 Random)
// ═══════════════════════════════════════════════════════════════════════

import * as math from 'mathjs';

/**
 * 1D Kalman Filter state for price series smoothing and velocity estimation.
 */
export interface KalmanState {
  estimate: number;
  errorEstimate: number;
  velocity: number;
}

/**
 * Applies a 1-Dimensional Kalman filter across a sequential price series.
 *
 * @param series - Array of raw price measurements
 * @param processNoise - Process noise covariance Q (default: 1e-4)
 * @param measurementNoise - Measurement noise covariance R (default: 1e-2)
 * @returns Array of smoothed price estimates and velocity
 */
export function applyKalmanFilter(
  series: number[],
  processNoise = 0.0001,
  measurementNoise = 0.01,
): { smoothed: number[]; velocities: number[] } {
  if (series.length === 0) return { smoothed: [], velocities: [] };

  const smoothed: number[] = [];
  const velocities: number[] = [];

  let currentEstimate = series[0]!;
  let currentError = 1.0;
  let prevEstimate = currentEstimate;

  for (const measurement of series) {
    // 1. Prediction step
    const predictedEstimate = currentEstimate;
    const predictedError = currentError + processNoise;

    // 2. Update / Measurement step
    const kalmanGain = predictedError / (predictedError + measurementNoise);
    currentEstimate = predictedEstimate + kalmanGain * (measurement - predictedEstimate);
    currentError = (1 - kalmanGain) * predictedError;

    const velocity = currentEstimate - prevEstimate;
    prevEstimate = currentEstimate;

    smoothed.push(Number(currentEstimate.toFixed(6)));
    velocities.push(Number(velocity.toFixed(6)));
  }

  return { smoothed, velocities };
}

/**
 * Computes Robust Z-Scores using Median Absolute Deviation (MAD).
 * Unlike standard standard deviation, MAD is resistant to crypto flash crashes and outliers.
 *
 * Robust Z = (x - median) / (1.4826 * MAD)
 */
export function computeRobustZScore(values: number[]): number[] {
  if (values.length < 3) return values.map(() => 0);

  const med = Number(math.median(values));
  const absoluteDeviations = values.map(v => Math.abs(v - med));
  const mad = Number(math.median(absoluteDeviations));

  if (mad === 0 || !Number.isFinite(mad)) {
    return values.map(() => 0);
  }

  const scale = 1.4826 * mad;
  return values.map(v => Number(((v - med) / scale).toFixed(4)));
}

/**
 * Computes the Hurst Exponent using multi-scale Rescaled Range (R/S) regression.
 *
 * Interpretation:
 * - H < 0.45: Mean-Reverting / Anti-persistent series (Mean-Reversion strategies favored)
 * - 0.45 <= H <= 0.55: Geometric Brownian Motion / Random Walk (Caution)
 * - H > 0.55: Persistent / Trending series (Trend-Following & Momentum strategies favored)
 *
 * @param series - Sequential price series (minimum 16 data points)
 */
export function computeHurstExponent(series: number[]): {
  hurst: number;
  regime: 'mean_reverting' | 'random_walk' | 'trending';
} {
  if (series.length < 16) {
    return { hurst: 0.5, regime: 'random_walk' };
  }

  const scales = [8, 16, 32].filter(s => s <= Math.floor(series.length / 2));
  if (scales.length === 0) {
    return { hurst: 0.5, regime: 'random_walk' };
  }

  const logScales: number[] = [];
  const logRS: number[] = [];

  for (const scale of scales) {
    const numSubsets = Math.floor(series.length / scale);
    let totalRS = 0;
    let validSubsets = 0;

    for (let i = 0; i < numSubsets; i++) {
      const subset = series.slice(i * scale, (i + 1) * scale);
      const meanVal = Number(math.mean(subset));
      const stdVal = Number(math.std(subset));

      if (stdVal > 0 && Number.isFinite(stdVal)) {
        let cumulative = 0;
        let maxDev = -Infinity;
        let minDev = Infinity;

        for (const val of subset) {
          cumulative += val - meanVal;
          if (cumulative > maxDev) maxDev = cumulative;
          if (cumulative < minDev) minDev = cumulative;
        }

        const r = maxDev - minDev;
        totalRS += r / stdVal;
        validSubsets++;
      }
    }

    if (validSubsets > 0) {
      const avgRS = totalRS / validSubsets;
      if (avgRS > 0) {
        logScales.push(Math.log(scale));
        logRS.push(Math.log(avgRS));
      }
    }
  }

  if (logScales.length < 2) {
    return { hurst: 0.5, regime: 'random_walk' };
  }

  // Linear regression slope of log(R/S) vs log(scale)
  const meanX = Number(math.mean(logScales));
  const meanY = Number(math.mean(logRS));
  let num = 0;
  let den = 0;

  for (let i = 0; i < logScales.length; i++) {
    const dx = logScales[i]! - meanX;
    const dy = logRS[i]! - meanY;
    num += dx * dy;
    den += dx * dx;
  }

  let h = den > 0 ? num / den : 0.5;
  h = Number(Math.min(Math.max(h, 0.05), 0.95).toFixed(3));

  let regime: 'mean_reverting' | 'random_walk' | 'trending' = 'random_walk';
  if (h > 0.55) regime = 'trending';
  else if (h < 0.45) regime = 'mean_reverting';

  return { hurst: h, regime };
}
