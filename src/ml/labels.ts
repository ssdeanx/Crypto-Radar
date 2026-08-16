// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Institutional Label Generation (Option A)
// ═══════════════════════════════════════════════════════════════════════
//
// Computes forward-return labels, multi-horizon returns (15m, 1h, 4h, 24h),
// Alpha vs. BTC benchmark, and Marcos López de Prado Triple-Barrier
// labels (Take-Profit barrier, Stop-Loss barrier, Time-expiration barrier).
// ═══════════════════════════════════════════════════════════════════════

import type { KlineRow } from '../types.js';
import type { LabelRow } from './types.js';

/** Default noise threshold — returns within ±this are labeled neutral (0) */
const DEFAULT_NOISE_THRESHOLD = 0.002; // 0.2%

/** Minimum ATR ratio for volatility adjustment (avoids division by zero) */
const MIN_ATR_RATIO = 0.0001;

export interface LabelOpts {
  /** Noise threshold for tri-class labeling (default 0.002 = 0.2%).
   *  When klines are provided and useVolatilityThreshold is true,
   *  this becomes a multiplier of ATR/close. */
  noiseThreshold?: number;
  /** Label horizon to use for tri-class label_class (default 5).
   *  Must match one of: 1 | 5 | 20 | 60. */
  classHorizon?: 1 | 5 | 20 | 60;
  /** Use volatility-adjusted threshold instead of fixed percentage.
   *  When enabled, noiseThreshold acts as a multiplier of ATR/close ratio. */
  useVolatilityThreshold?: boolean;
  /** Optional Take-Profit ATR multiplier for Triple Barrier (default: 2.0) */
  takeProfitAtrMultiplier?: number;
  /** Optional Stop-Loss ATR multiplier for Triple Barrier (default: 1.0) */
  stopLossAtrMultiplier?: number;
  /** Vertical barrier / Max holding window in candles (default: 24) */
  maxHoldingCandles?: number;
}

/**
 * Compute ATR(14) from kline data for volatility adjustment.
 */
export function computeAtr14(klines: KlineRow[]): number[] {
  const atrs: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i < 14) {
      atrs.push(0);
      continue;
    }
    const ranges: number[] = [];
    for (let j = i - 13; j <= i; j++) {
      const k = klines[j]!;
      const prev = klines[j - 1]!;
      const tr = Math.max(
        k.high - k.low,
        Math.abs(k.high - prev.close),
        Math.abs(k.low - prev.close),
      );
      ranges.push(tr);
    }
    const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    atrs.push(atr);
  }
  return atrs;
}

/**
 * Compute forward-return labels for a kline series.
 *
 * Labels can only be computed where the lookahead window exists.
 * The last N rows of the output will have null labels (usable for
 * inference but not training).
 *
 * @param closes - Sorted array of closing prices (oldest first)
 * @param interval - Kline interval string
 * @param opts - Label options
 * @param klines - Optional full kline data for volatility-adjusted thresholds & Triple-Barrier
 * @param btcCloses - Optional benchmark closes for Alpha calculation
 * @returns Array of LabelRow with computed forward returns
 */
export function computeLabels(
  closes: number[],
  interval: string,
  opts: LabelOpts = {},
  klines?: KlineRow[],
  btcCloses?: number[],
): LabelRow[] {
  const noiseThreshold = opts.noiseThreshold ?? DEFAULT_NOISE_THRESHOLD;
  const actualClassHorizon = opts.classHorizon ?? 5;
  const useVolatility = opts.useVolatilityThreshold ?? false;
  const tpMultiplier = opts.takeProfitAtrMultiplier ?? 2.0;
  const slMultiplier = opts.stopLossAtrMultiplier ?? 1.0;
  const maxHolding = opts.maxHoldingCandles ?? 24;

  // Pre-compute ATR for volatility adjustment if klines are provided
  const atrs = klines && klines.length >= 14 ? computeAtr14(klines) : [];
  const atrRatios: number[] = [];
  if (useVolatility && klines && atrs.length > 0) {
    for (let i = 0; i < klines.length; i++) {
      const close = klines[i]?.close ?? 0;
      const ratio = close > 0 ? (atrs[i] ?? 0) / close : MIN_ATR_RATIO;
      atrRatios.push(Math.max(ratio, MIN_ATR_RATIO));
    }
  }

  const labels: LabelRow[] = [];

  for (let i = 0; i < closes.length; i++) {
    const currentClose = closes[i]!;

    // Compute standard horizon returns
    const ret1 = i + 1 < closes.length ? (closes[i + 1]! - currentClose) / currentClose : null;
    const ret5 = i + 5 < closes.length ? (closes[i + 5]! - currentClose) / currentClose : null;
    const ret20 = i + 20 < closes.length ? (closes[i + 20]! - currentClose) / currentClose : null;
    const ret60 = i + 60 < closes.length ? (closes[i + 60]! - currentClose) / currentClose : null;

    // Multi-horizon returns for Option A (15m, 1h, 4h, 24h approximation)
    const ret15m = ret1;
    const ret1h = ret5;
    const ret4h = ret20;
    const ret24h = ret60;

    // Alpha vs BTC over 5-period horizon
    let alphaVsBtc: number | null = null;
    if (btcCloses && i + 5 < btcCloses.length && btcCloses[i]! > 0 && ret5 !== null) {
      const btcRet5 = (btcCloses[i + 5]! - btcCloses[i]!) / btcCloses[i]!;
      alphaVsBtc = Number((ret5 - btcRet5).toFixed(6));
    }

    // Volatility-adjusted threshold: noiseThreshold × (ATR/close)
    const adjustedThreshold = useVolatility && i < atrRatios.length
      ? Math.max(noiseThreshold * atrRatios[i]!, MIN_ATR_RATIO)
      : noiseThreshold;

    // Option A: Triple-Barrier Labeling
    let barrierHit: -1 | 0 | 1 | null = null;
    let rMultiple: number | null = null;

    if (klines && i < klines.length) {
      const currentAtr = (atrs[i] && atrs[i]! > 0) ? atrs[i]! : (currentClose * 0.02);
      const upperBarrier = currentClose + (currentAtr * tpMultiplier);
      const lowerBarrier = currentClose - (currentAtr * slMultiplier);
      const maxWindow = Math.min(i + maxHolding, klines.length);

      if (i + maxHolding < klines.length) {
        let hit = 0 as -1 | 0 | 1;
        for (let j = i + 1; j < maxWindow; j++) {
          const k = klines[j]!;
          if (k.high >= upperBarrier) {
            hit = 1; // Take-Profit Hit
            break;
          }
          if (k.low <= lowerBarrier) {
            hit = -1; // Stop-Loss Hit
            break;
          }
        }
        barrierHit = hit;
        const exitClose = klines[maxWindow - 1]?.close ?? currentClose;
        const rawReturn = (exitClose - currentClose) / currentClose;
        const riskUnit = (currentAtr * slMultiplier) / currentClose;
        rMultiple = riskUnit > 0 ? Number((rawReturn / riskUnit).toFixed(2)) : 0;
      }
    }

    const row: LabelRow = {
      symbol: '',
      interval,
      open_time: 0,
      label_return_1: ret1,
      label_return_5: ret5,
      label_return_20: ret20,
      label_return_60: ret60,
      label_direction_1: ret1 !== null ? (ret1 > adjustedThreshold ? 1 : ret1 < -adjustedThreshold ? -1 : 0) : null,
      label_direction_5: ret5 !== null ? (ret5 > adjustedThreshold ? 1 : ret5 < -adjustedThreshold ? -1 : 0) : null,
      label_direction_20: ret20 !== null ? (ret20 > adjustedThreshold ? 1 : ret20 < -adjustedThreshold ? -1 : 0) : null,
      label_direction_60: ret60 !== null ? (ret60 > adjustedThreshold ? 1 : ret60 < -adjustedThreshold ? -1 : 0) : null,
      label_class: null,
      label_barrier_hit: barrierHit,
      label_r_multiple: rMultiple,
      alpha_vs_btc: alphaVsBtc,
      ret_15m: ret15m,
      ret_1h: ret1h,
      ret_4h: ret4h,
      ret_24h: ret24h,
    };

    // Tri-class label at the configured horizon
    const classReturn = actualClassHorizon === 1 ? ret1
      : actualClassHorizon === 5 ? ret5
      : actualClassHorizon === 20 ? ret20
      : ret60;

    row.label_class = classReturn !== null
      ? (classReturn > adjustedThreshold ? 1 : classReturn < -adjustedThreshold ? -1 : 0)
      : null;

    labels.push(row);
  }

  return labels;
}

/**
 * Returns recommended class weights for imbalanced crypto datasets.
 */
export function getDefaultClassWeights(): Record<string, number> {
  return {
    '-1': 1.5,
    '0': 0.6,
    '1': 1.0,
  };
}

/**
 * Compute class distribution from label rows.
 * Useful for checking imbalance before training.
 */
export function computeClassDistribution(labels: LabelRow[]): Record<string, number> {
  const counts: { '-1': number; '0': number; '1': number } = { '-1': 0, '0': 0, '1': 0 };
  let total = 0;
  for (const row of labels) {
    const cls = row.label_class;
    if (cls === -1) { counts['-1']++; total++; }
    else if (cls === 0) { counts['0']++; total++; }
    else if (cls === 1) { counts['1']++; total++; }
  }
  return {
    '-1': total > 0 ? counts['-1'] / total : 0,
    '0': total > 0 ? counts['0'] / total : 0,
    '1': total > 0 ? counts['1'] / total : 0,
  };
}
