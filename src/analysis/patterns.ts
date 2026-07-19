// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Candlestick Pattern Recognition
// ═══════════════════════════════════════════════════════════════════════
//
// Detects classic candlestick patterns from OHLCV kline data.
// All patterns detected purely algorithmically — no ML, no external API.
//
// Patterns detected:
//   Single-candle: Doji, Hammer, Shooting Star, Marubozu, Spinning Top
//   Two-candle:   Bullish/Bearish Engulfing, Harami, Piercing, Dark Cloud
//   Three-candle: Morning Star, Evening Star, Three White Soldiers,
//                 Three Black Crows, Abandoned Baby

import type { Kline } from '../types.js';

// ─── Exported Types ───────────────────────────────────────────────────────

export type PatternType =
  | 'doji' | 'hammer' | 'shooting_star' | 'marubozu' | 'spinning_top'
  | 'bullish_engulfing' | 'bearish_engulfing'
  | 'bullish_harami' | 'bearish_harami'
  | 'piercing_pattern' | 'dark_cloud_cover'
  | 'morning_star' | 'evening_star'
  | 'three_white_soldiers' | 'three_black_crows'
  | 'abandoned_baby';

export type PatternDirection = 'bullish' | 'bearish' | 'neutral';

export interface DetectedPattern {
  type: PatternType;
  direction: PatternDirection;
  confidence: number;      // 0-1 based on how well-formed
  index: number;           // candle index where pattern completes
  description: string;     // human-readable
}

export interface PatternResult {
  symbol: string;
  patterns: DetectedPattern[];
  /** Most recent pattern detected (highest index) */
  latest: DetectedPattern | null;
  /** Count by direction */
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  timestamp: string;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────

/** Absolute body size (|close - open|) */
function bodySize(c: Kline): number {
  return Math.abs(c.close - c.open);
}

/** Total price range (high - low) */
function totalRange(c: Kline): number {
  return c.high - c.low;
}

/** Body-to-range ratio — 0 = no body, 1 = full body. */
function bodyRatio(c: Kline): number {
  const tr = totalRange(c);
  if (tr === 0) return 1;
  return bodySize(c) / tr;
}

/** Upper wick length (high - max(open, close)) */
function upperWick(c: Kline): number {
  return c.high - Math.max(c.open, c.close);
}

/** Lower wick length (min(open, close) - low) */
function lowerWick(c: Kline): number {
  return Math.min(c.open, c.close) - c.low;
}

function isGreen(c: Kline): boolean {
  return c.close > c.open;
}

function isRed(c: Kline): boolean {
  return c.close < c.open;
}

/** Safely get klines[idx] or undefined */
function klineAt(klines: Kline[], idx: number): Kline | undefined {
  return idx >= 0 && idx < klines.length ? klines[idx]! : undefined;
}

/** Average body size over a range of candles */
function avgBody(klines: Kline[], from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let i = from; i <= to; i++) {
    const c = klineAt(klines, i);
    if (!c) continue;
    sum += bodySize(c);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/** True if candle at i has body > 1.8× the average of the prior `lookback` candles */
function isLongCandle(klines: Kline[], i: number, lookback = 5): boolean {
  if (i - lookback < 0) return false;
  const c = klineAt(klines, i);
  if (!c) return false;
  const avg = avgBody(klines, i - lookback, i - 1);
  if (avg === 0) return bodySize(c) > 0;
  return bodySize(c) > avg * 1.8;
}

/** Check if price was trending down over the `lookback` candles before `i` */
function wasDowntrend(klines: Kline[], i: number, lookback = 5): boolean {
  if (i - lookback < 0) return false;
  const start = klineAt(klines, i - lookback);
  const end = klineAt(klines, i - 1);
  if (!start || !end) return false;
  return end.close < start.close;
}

/** Check if price was trending up over the `lookback` candles before `i` */
function wasUptrend(klines: Kline[], i: number, lookback = 5): boolean {
  if (i - lookback < 0) return false;
  const start = klineAt(klines, i - lookback);
  const end = klineAt(klines, i - 1);
  if (!start || !end) return false;
  return end.close > start.close;
}

/** Clamp a value between 0 and 1 */
function clamp(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Get a candle with null guard; also returns null if index out of range. */
function getCandle(klines: Kline[], i: number): Kline | null {
  if (i < 0 || i >= klines.length) return null;
  return klines[i] ?? null;
}

// ─── Single-Candle Pattern Detectors ──────────────────────────────────────

/**
 * Doji — open ≈ close. The smaller the body relative to range, the higher
 * the confidence.
 */
function detectDoji(c: Kline): DetectedPattern | null {
  const br = bodyRatio(c);
  if (br >= 0.1) return null;

  const confidence = clamp(1 - br / 0.1);
  return {
    type: 'doji',
    direction: 'neutral',
    confidence,
    index: -1,
    description: confidence > 0.8
      ? 'Perfect doji — open and close are nearly equal'
      : 'Doji — indecision candle with tiny body',
  };
}

/**
 * Hammer — body at top of range, long lower wick (>= 2× body), small/no
 * upper wick. Bullish reversal after a downtrend.
 */
function detectHammer(c: Kline): DetectedPattern | null {
  const b = bodySize(c);
  if (b === 0) return null;

  const lw = lowerWick(c);
  const uw = upperWick(c);
  const br = bodyRatio(c);

  if (br > 0.4) return null;
  if (lw < b * 2) return null;
  if (uw > lw / 3) return null;

  const wickRatio = Math.min(lw / (b * 2), 4) / 4;
  const bodyPosScore = br < 0.25 ? 1 : 1 - (br - 0.25) / 0.15;
  const confidence = clamp(0.5 + wickRatio * 0.3 + bodyPosScore * 0.2);

  return {
    type: 'hammer',
    direction: 'bullish',
    confidence,
    index: -1,
    description: 'Hammer — bullish reversal pattern with long lower wick',
  };
}

/**
 * Shooting Star — body at bottom of range, long upper wick (>= 2× body),
 * small/no lower wick. Bearish reversal after an uptrend.
 */
function detectShootingStar(c: Kline): DetectedPattern | null {
  const b = bodySize(c);
  if (b === 0) return null;

  const lw = lowerWick(c);
  const uw = upperWick(c);
  const br = bodyRatio(c);

  if (br > 0.4) return null;
  if (uw < b * 2) return null;
  if (lw > uw / 3) return null;

  const wickRatio = Math.min(uw / (b * 2), 4) / 4;
  const bodyPosScore = br < 0.25 ? 1 : 1 - (br - 0.25) / 0.15;
  const confidence = clamp(0.5 + wickRatio * 0.3 + bodyPosScore * 0.2);

  return {
    type: 'shooting_star',
    direction: 'bearish',
    confidence,
    index: -1,
    description: 'Shooting Star — bearish reversal pattern with long upper wick',
  };
}

/**
 * Marubozu — no (or very small) wicks. Close = high (bullish) or close = low
 * (bearish). Strong directional conviction.
 */
function detectMarubozu(c: Kline): DetectedPattern | null {
  const b = bodySize(c);
  if (b === 0) return null;

  const uw = upperWick(c);
  const lw = lowerWick(c);
  const tr = totalRange(c);

  if ((uw + lw) / tr > 0.05) return null;

  const confidence = clamp(0.7 + (1 - (uw + lw) / (tr * 0.05)) * 0.3);
  const bullish = isGreen(c);

  return {
    type: 'marubozu',
    direction: bullish ? 'bullish' : 'bearish',
    confidence,
    index: -1,
    description: bullish
      ? 'Bullish Marubozu — strong buying with no upper wick'
      : 'Bearish Marubozu — strong selling with no lower wick',
  };
}

/**
 * Spinning Top — small body with wicks on both sides. Market indecision.
 */
function detectSpinningTop(c: Kline): DetectedPattern | null {
  const b = bodySize(c);
  if (b === 0) return null;

  const uw = upperWick(c);
  const lw = lowerWick(c);
  const br = bodyRatio(c);

  if (br > 0.5) return null;
  if (uw < b * 0.5 || lw < b * 0.5) return null;
  const maxWick = Math.max(uw, lw);
  const minWick = Math.min(uw, lw);
  if (maxWick > minWick * 4) return null;

  const balance = 1 - Math.abs(uw - lw) / (uw + lw);
  const confidence = clamp(0.5 + balance * 0.4);

  return {
    type: 'spinning_top',
    direction: 'neutral',
    confidence,
    index: -1,
    description: 'Spinning Top — indecision with small body and wicks on both sides',
  };
}

// ─── Two-Candle Pattern Detectors ─────────────────────────────────────────

/**
 * Bullish Engulfing — second candle (bullish) fully engulfs first (bearish).
 */
function detectBullishEngulfing(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const p = getCandle(klines, i - 1);
  const c = getCandle(klines, i);
  if (!p || !c) return null;

  if (!isRed(p) || !isGreen(c)) return null;
  if (c.open <= p.close || c.close <= p.open) return null;
  if (c.high <= p.high || c.low >= p.low) return null;

  const bodyRatio_ = bodySize(c) / bodySize(p);
  const confidence = clamp(0.6 + Math.min(bodyRatio_, 4) / 4 * 0.35);

  return {
    type: 'bullish_engulfing',
    direction: 'bullish',
    confidence,
    index: i,
    description: 'Bullish Engulfing — green candle fully engulfs prior red candle',
  };
}

/**
 * Bearish Engulfing — second candle (bearish) fully engulfs first (bullish).
 */
function detectBearishEngulfing(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const p = getCandle(klines, i - 1);
  const c = getCandle(klines, i);
  if (!p || !c) return null;

  if (!isGreen(p) || !isRed(c)) return null;
  if (c.open >= p.close || c.close >= p.open) return null;
  if (c.high <= p.high || c.low >= p.low) return null;

  const bodyRatio_ = bodySize(c) / bodySize(p);
  const confidence = clamp(0.6 + Math.min(bodyRatio_, 4) / 4 * 0.35);

  return {
    type: 'bearish_engulfing',
    direction: 'bearish',
    confidence,
    index: i,
    description: 'Bearish Engulfing — red candle fully engulfs prior green candle',
  };
}

/**
 * Bullish Harami — small green body entirely inside previous large red body.
 */
function detectBullishHarami(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const p = getCandle(klines, i - 1);
  const c = getCandle(klines, i);
  if (!p || !c) return null;

  if (!isRed(p) || !isGreen(c)) return null;
  if (!isLongCandle(klines, i - 1, 5) && bodySize(p) < avgBody(klines, 0, i - 1)) return null;
  if (c.open <= p.close || c.close >= p.open) return null;
  if (c.open > c.close) return null;

  const sizeRatio = bodySize(c) / bodySize(p);
  if (sizeRatio > 0.75) return null;

  const confidence = clamp(0.6 + (1 - sizeRatio / 0.75) * 0.35);

  return {
    type: 'bullish_harami',
    direction: 'bullish',
    confidence,
    index: i,
    description: 'Bullish Harami — small green candle inside prior large red candle',
  };
}

/**
 * Bearish Harami — small red body entirely inside previous large green body.
 */
function detectBearishHarami(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const p = getCandle(klines, i - 1);
  const c = getCandle(klines, i);
  if (!p || !c) return null;

  if (!isGreen(p) || !isRed(c)) return null;
  if (!isLongCandle(klines, i - 1, 5) && bodySize(p) < avgBody(klines, 0, i - 1)) return null;
  if (c.close >= p.open || c.open <= p.close) return null;
  if (c.open < c.close) return null;

  const sizeRatio = bodySize(c) / bodySize(p);
  if (sizeRatio > 0.75) return null;

  const confidence = clamp(0.6 + (1 - sizeRatio / 0.75) * 0.35);

  return {
    type: 'bearish_harami',
    direction: 'bearish',
    confidence,
    index: i,
    description: 'Bearish Harami — small red candle inside prior large green candle',
  };
}

/**
 * Piercing Pattern — bullish 2-candle: a red candle followed by a green
 * candle that opens below prior close but closes above the midpoint of
 * the prior body.
 */
function detectPiercingPattern(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const p = getCandle(klines, i - 1);
  const c = getCandle(klines, i);
  if (!p || !c) return null;

  if (!isRed(p) || !isGreen(c)) return null;
  if (c.open >= p.close) return null;
  const midPoint = (p.open + p.close) / 2;
  if (c.close <= midPoint) return null;
  if (c.close >= p.open) return null;

  const penetration = (c.close - midPoint) / (p.open - p.close);
  const confidence = clamp(0.55 + Math.min(penetration, 1) * 0.35);

  return {
    type: 'piercing_pattern',
    direction: 'bullish',
    confidence,
    index: i,
    description: 'Piercing Pattern — green candle closes into upper half of prior red candle',
  };
}

/**
 * Dark Cloud Cover — bearish 2-candle: a green candle followed by a red
 * candle that opens above prior close but closes below the midpoint of
 * the prior body.
 */
function detectDarkCloudCover(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const p = getCandle(klines, i - 1);
  const c = getCandle(klines, i);
  if (!p || !c) return null;

  if (!isGreen(p) || !isRed(c)) return null;
  if (c.open <= p.close) return null;
  const midPoint = (p.open + p.close) / 2;
  if (c.close >= midPoint) return null;
  if (c.close <= p.open) return null;

  const penetration = (midPoint - c.close) / (p.close - p.open);
  const confidence = clamp(0.55 + Math.min(penetration, 1) * 0.35);

  return {
    type: 'dark_cloud_cover',
    direction: 'bearish',
    confidence,
    index: i,
    description: 'Dark Cloud Cover — red candle closes into lower half of prior green candle',
  };
}

// ─── Three-Candle Pattern Detectors ───────────────────────────────────────

/**
 * Morning Star — long bearish, short indecisive (doji/hammer), long bullish.
 * Major bullish reversal.
 */
function detectMorningStar(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const c1 = getCandle(klines, i - 2);
  const c2 = getCandle(klines, i - 1);
  const c3 = getCandle(klines, i);
  if (!c1 || !c2 || !c3) return null;

  if (!isRed(c1) || !isGreen(c3)) return null;
  if (!isLongCandle(klines, i - 2, 5)) return null;
  if (!isLongCandle(klines, i, 5)) return null;

  const br2 = bodyRatio(c2);
  if (br2 > 0.5) return null;
  if (bodySize(c2) > bodySize(c1) * 0.5) return null;

  // Gap down then gap up (bodies don't overlap)
  if (Math.min(c2.open, c2.close) > c1.close) return null;
  if (Math.max(c2.open, c2.close) > c3.close) return null;

  const confidence = clamp(0.65 +
    (1 - br2 / 0.5) * 0.15 +
    (isLongCandle(klines, i, 3) ? 0.1 : 0));

  return {
    type: 'morning_star',
    direction: 'bullish',
    confidence,
    index: i,
    description: 'Morning Star — major bullish reversal: long red, indecision, long green',
  };
}

/**
 * Evening Star — long bullish, short indecisive (doji/shooting), long bearish.
 * Major bearish reversal.
 */
function detectEveningStar(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const c1 = getCandle(klines, i - 2);
  const c2 = getCandle(klines, i - 1);
  const c3 = getCandle(klines, i);
  if (!c1 || !c2 || !c3) return null;

  if (!isGreen(c1) || !isRed(c3)) return null;
  if (!isLongCandle(klines, i - 2, 5)) return null;
  if (!isLongCandle(klines, i, 5)) return null;

  const br2 = bodyRatio(c2);
  if (br2 > 0.5) return null;
  if (bodySize(c2) > bodySize(c1) * 0.5) return null;

  if (Math.max(c2.open, c2.close) < c1.close) return null;
  if (Math.min(c2.open, c2.close) < c3.close) return null;

  const confidence = clamp(0.65 +
    (1 - br2 / 0.5) * 0.15 +
    (isLongCandle(klines, i, 3) ? 0.1 : 0));

  return {
    type: 'evening_star',
    direction: 'bearish',
    confidence,
    index: i,
    description: 'Evening Star — major bearish reversal: long green, indecision, long red',
  };
}

/**
 * Three White Soldiers — three consecutive long bullish candles, each closing
 * at or near its high. Strong uptrend.
 */
function detectThreeWhiteSoldiers(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const c1 = getCandle(klines, i - 2);
  const c2 = getCandle(klines, i - 1);
  const c3 = getCandle(klines, i);
  if (!c1 || !c2 || !c3) return null;

  if (!isGreen(c1) || !isGreen(c2) || !isGreen(c3)) return null;
  if (!isLongCandle(klines, i - 2, 5)) return null;
  if (!isLongCandle(klines, i - 1, 5)) return null;
  if (!isLongCandle(klines, i, 5)) return null;

  const wick1 = upperWick(c1);
  const wick2 = upperWick(c2);
  const wick3 = upperWick(c3);
  const tr1 = totalRange(c1);
  const tr2 = totalRange(c2);
  const tr3 = totalRange(c3);

  if (wick1 / tr1 > 0.15 || wick2 / tr2 > 0.15 || wick3 / tr3 > 0.15) return null;
  if (c2.close <= c1.close || c3.close <= c2.close) return null;
  if (c2.open < c1.low || c3.open < c2.low) return null;

  const wickBonus = clamp(1 - (wick1 / tr1 + wick2 / tr2 + wick3 / tr3) / 0.45);
  const confidence = clamp(0.65 + wickBonus * 0.3);

  return {
    type: 'three_white_soldiers',
    direction: 'bullish',
    confidence,
    index: i,
    description: 'Three White Soldiers — three consecutive strong bullish candles',
  };
}

/**
 * Three Black Crows — three consecutive long bearish candles, each closing
 * at or near its low. Strong downtrend.
 */
function detectThreeBlackCrows(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const c1 = getCandle(klines, i - 2);
  const c2 = getCandle(klines, i - 1);
  const c3 = getCandle(klines, i);
  if (!c1 || !c2 || !c3) return null;

  if (!isRed(c1) || !isRed(c2) || !isRed(c3)) return null;
  if (!isLongCandle(klines, i - 2, 5)) return null;
  if (!isLongCandle(klines, i - 1, 5)) return null;
  if (!isLongCandle(klines, i, 5)) return null;

  const wick1 = lowerWick(c1);
  const wick2 = lowerWick(c2);
  const wick3 = lowerWick(c3);
  const tr1 = totalRange(c1);
  const tr2 = totalRange(c2);
  const tr3 = totalRange(c3);

  if (wick1 / tr1 > 0.15 || wick2 / tr2 > 0.15 || wick3 / tr3 > 0.15) return null;
  if (c2.close >= c1.close || c3.close >= c2.close) return null;
  if (c2.open > c1.high || c3.open > c2.high) return null;

  const wickBonus = clamp(1 - (wick1 / tr1 + wick2 / tr2 + wick3 / tr3) / 0.45);
  const confidence = clamp(0.65 + wickBonus * 0.3);

  return {
    type: 'three_black_crows',
    direction: 'bearish',
    confidence,
    index: i,
    description: 'Three Black Crows — three consecutive strong bearish candles',
  };
}

/**
 * Abandoned Baby — rare major reversal: gap down → doji → gap up (morning
 * star variant with doji gapped on both sides).
 */
function detectAbandonedBaby(
  klines: Kline[],
  i: number,
): DetectedPattern | null {
  const c1 = getCandle(klines, i - 2);
  const c2 = getCandle(klines, i - 1);
  const c3 = getCandle(klines, i);
  if (!c1 || !c2 || !c3) return null;

  // Middle candle must be a doji
  if (bodyRatio(c2) >= 0.1) return null;

  const c1BodyTop = Math.max(c1.open, c1.close);
  const c2BodyBottom = Math.min(c2.open, c2.close);
  const c2BodyTop = Math.max(c2.open, c2.close);
  const c3BodyBottom = Math.min(c3.open, c3.close);
  const c3BodyTop = Math.max(c3.open, c3.close);

  if (isRed(c1) && isGreen(c3)) {
    // Bullish: gap down into doji, gap up out
    if (c2BodyBottom >= c1BodyTop) return null;
    if (c3BodyBottom <= c2BodyTop) return null;

    const confidence = clamp(0.7 + (bodyRatio(c2) < 0.05 ? 0.15 : 0));
    return {
      type: 'abandoned_baby',
      direction: 'bullish',
      confidence,
      index: i,
      description: 'Bullish Abandoned Baby — rare reversal: gap down, doji, gap up',
    };
  }

  if (isGreen(c1) && isRed(c3)) {
    // Bearish: gap up into doji, gap down out
    if (c2BodyTop <= c1BodyTop) return null;
    if (c3BodyTop >= c2BodyBottom) return null;

    const confidence = clamp(0.7 + (bodyRatio(c2) < 0.05 ? 0.15 : 0));
    return {
      type: 'abandoned_baby',
      direction: 'bearish',
      confidence,
      index: i,
      description: 'Bearish Abandoned Baby — rare reversal: gap up, doji, gap down',
    };
  }

  return null;
}

// ─── Pattern Scan Dispatchers ─────────────────────────────────────────────

/**
 * Detect single-candle patterns at a given index.
 */
function detectSinglePatterns(
  klines: Kline[],
  i: number,
): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const c = klineAt(klines, i);
  if (!c) return results;

  const doji = detectDoji(c);
  if (doji) { doji.index = i; results.push(doji); }

  // Hammer needs downtrend context
  const hammer = detectHammer(c);
  if (hammer && wasDowntrend(klines, i)) {
    hammer.index = i;
    results.push(hammer);
  }

  // Shooting Star needs uptrend context
  const shooting = detectShootingStar(c);
  if (shooting && wasUptrend(klines, i)) {
    shooting.index = i;
    results.push(shooting);
  }

  const marubozu = detectMarubozu(c);
  if (marubozu) { marubozu.index = i; results.push(marubozu); }

  const spinning = detectSpinningTop(c);
  if (spinning) { spinning.index = i; results.push(spinning); }

  return results;
}

/**
 * Detect two-candle patterns ending at index i.
 */
function detectTwoCandlePatterns(
  klines: Kline[],
  i: number,
): DetectedPattern[] {
  const results: DetectedPattern[] = [];

  const be = detectBullishEngulfing(klines, i);
  if (be) results.push(be);

  const bfe = detectBearishEngulfing(klines, i);
  if (bfe) results.push(bfe);

  const bh = detectBullishHarami(klines, i);
  if (bh) results.push(bh);

  const bfh = detectBearishHarami(klines, i);
  if (bfh) results.push(bfh);

  const pp = detectPiercingPattern(klines, i);
  if (pp) results.push(pp);

  const dcc = detectDarkCloudCover(klines, i);
  if (dcc) results.push(dcc);

  return results;
}

/**
 * Detect three-candle patterns ending at index i.
 */
function detectThreeCandlePatterns(
  klines: Kline[],
  i: number,
): DetectedPattern[] {
  const results: DetectedPattern[] = [];

  const ms = detectMorningStar(klines, i);
  if (ms) results.push(ms);

  const es = detectEveningStar(klines, i);
  if (es) results.push(es);

  const tws = detectThreeWhiteSoldiers(klines, i);
  if (tws) results.push(tws);

  const tbc = detectThreeBlackCrows(klines, i);
  if (tbc) results.push(tbc);

  const ab = detectAbandonedBaby(klines, i);
  if (ab) results.push(ab);

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Scan klines for ALL known candlestick patterns.
 *
 * @param symbol  Trading pair symbol (e.g. 'BTCUSDT')
 * @param klines  Array of Kline candles, **most recent last**. At least 10
 *                candles recommended for reliable trend context.
 * @returns PatternResult with all detected patterns, summary stats, and
 *          the most recent (latest) pattern.
 */
export function scanPatterns(
  symbol: string,
  klines: Kline[],
): PatternResult {
  const all: DetectedPattern[] = [];

  if (klines.length >= 1) {
    for (let i = 0; i < klines.length; i++) {
      const singles = detectSinglePatterns(klines, i);
      all.push(...singles);

      if (i >= 1) {
        const twos = detectTwoCandlePatterns(klines, i);
        all.push(...twos);
      }

      if (i >= 2) {
        const threes = detectThreeCandlePatterns(klines, i);
        all.push(...threes);
      }
    }
  }

  // Sort by index (ascending)
  all.sort((a, b) => a.index - b.index);

  // Find latest (highest index)
  const latest = all.length > 0 ? all[all.length - 1]! : null;

  // Count by direction
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  for (const p of all) {
    if (p.direction === 'bullish') bullishCount++;
    else if (p.direction === 'bearish') bearishCount++;
    else neutralCount++;
  }

  return {
    symbol,
    patterns: all,
    latest,
    bullishCount,
    bearishCount,
    neutralCount,
    timestamp: new Date().toISOString(),
  };
}
