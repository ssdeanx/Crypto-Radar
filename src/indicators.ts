// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Technical Indicators
// ═══════════════════════════════════════════════════════════════════════

import type { Kline, TechnicalIndicators, BBandsResult, MACDResult, StochasticResult, IchimokuResult, ParabolicSarResult, KeltnerChannelsResult, StochRSIResult, ElderRayResult, KSTResult } from './types.js';

/**
 * Simple Moving Average.
 * @param values Input price array
 * @param period Window length
 * @returns SMA value or null if insufficient data
 */
export function sma(values: number[], period: number): number | null {
  if (!values || values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

/**
 * Exponential Moving Average.
 * @param values Input price array
 * @param period EMA period
 * @returns EMA value or null if insufficient data
 */
export function ema(values: number[], period: number): number | null {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    emaVal = values[i]! * k + emaVal * (1 - k);
  }
  return emaVal;
}

/**
 * Compute an EMA series for all positions.
 * @param values Input price array
 * @param period EMA period
 * @returns Array of EMA values (null for first period-1 positions)
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  if (!values || values.length < period) return new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(values.length).fill(null);
  result[period - 1] = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    result[i] = values[i]! * k + (result[i - 1] ?? 0) * (1 - k);
  }
  return result;
}

/**
 * Compute Relative Strength Index.
 * @param closes Closing price array
 * @param period RSI period (default: 14)
 * @returns RSI value (0-100) or null if insufficient data
 */
export function computeRSI(closes: number[], period = 14): number | null {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

/**
 * Compute Money Flow Index.
 * @param highs High price array
 * @param lows Low price array
 * @param closes Close price array
 * @param volumes Volume array
 * @param period MFI period (default: 14)
 * @returns MFI value (0-100) or null if insufficient data
 */
export function computeMFI(
  highs: number[], lows: number[], closes: number[], volumes: number[], period = 14,
): number | null {
  if (!closes || closes.length < period + 1) return null;
  const typicalPrices = closes.map((c, i) => (highs[i]! + lows[i]! + c) / 3);
  const rawMFs = typicalPrices.map((tp, i) => tp * volumes[i]!);
  let posSum = 0, negSum = 0;
  for (let i = 1; i <= period; i++) {
    if (typicalPrices[i]! > typicalPrices[i - 1]!) posSum += rawMFs[i]!;
    else if (typicalPrices[i]! < typicalPrices[i - 1]!) negSum += rawMFs[i]!;
  }
  let posMF = posSum / period;
  let negMF = negSum / period;
  for (let i = period + 1; i < rawMFs.length; i++) {
    const pos = typicalPrices[i]! > typicalPrices[i - 1]! ? rawMFs[i]! : 0;
    const neg = typicalPrices[i]! < typicalPrices[i - 1]! ? rawMFs[i]! : 0;
    posMF = (posMF * (period - 1) + pos) / period;
    negMF = (negMF * (period - 1) + neg) / period;
  }
  if (negMF === 0) return 100;
  return 100 - (100 / (1 + posMF / negMF));
}

/**
 * Compute MACD (Moving Average Convergence Divergence).
 * @param closes Closing price array
 * @returns MACDResult with macd, signal, and histogram, or nulls if insufficient data
 */
export function computeMACD(closes: number[]): MACDResult {
  if (!closes || closes.length < 26) {
    return { macd: null, signal: null, histogram: null };
  }
  const ema12Series = emaSeries(closes, 12);
  const ema26Series = emaSeries(closes, 26);
  const macdSeries = closes.map((_, i) =>
    ema12Series[i] != null && ema26Series[i] != null ? ema12Series[i]! - ema26Series[i]! : null
  );
  const validMacd = macdSeries.filter((v): v is number => v != null);
  if (validMacd.length < 9) return { macd: null, signal: null, histogram: null };
  const signalSeries = emaSeries(validMacd, 9);
  const macd = validMacd[validMacd.length - 1]!;
  const signal = signalSeries[signalSeries.length - 1]!;
  return { macd, signal, histogram: macd - signal };
}

/**
 * Compute Bollinger Bands.
 * @param closes Closing price array
 * @param period BB period (default: 20)
 * @param multiplier Standard deviation multiplier (default: 2)
 * @returns BBandsResult or null if insufficient data
 */
export function computeBB(closes: number[], period = 20, multiplier = 2): BBandsResult | null {
  if (!closes || closes.length < period) return null;
  const window = closes.slice(-period);
  const middle = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stddev = Math.sqrt(variance);
  const upper = middle + multiplier * stddev;
  const lower = middle - multiplier * stddev;
  const width = middle > 0 ? (upper - lower) / middle : 0;
  const close = closes[closes.length - 1]!;
  const position = upper - lower > 0 ? (close - lower) / (upper - lower) : 0.5;
  return { upper, middle, lower, width, position };
}

/**
 * Compute Average True Range percentage.
 * @param highs High price array
 * @param lows Low price array
 * @param closes Close price array
 * @param period ATR period (default: 14)
 * @returns ATR as a percentage of current close, or null if insufficient data
 */
export function computeATR(
  highs: number[], lows: number[], closes: number[], period = 14,
): number | null {
  if (!closes || closes.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    trueRanges.push(Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    ));
  }
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }
  const currentClose = closes[closes.length - 1]!;
  return currentClose > 0 ? (atr / currentClose) * 100 : null;
}

/**
 * Compute volume trend (recent 7 vs prior 7 periods).
 * @param volumes Volume array
 * @returns Ratio change (e.g. 0.2 = +20%), or null if insufficient data
 */
export function computeVolTrend(volumes: number[]): number | null {
  if (!volumes || volumes.length < 14) return null;
  const recent = volumes.slice(-7);
  const older = volumes.slice(-14, -7);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  if (olderAvg === 0) return 0;
  return (recentAvg / olderAvg) - 1;
}

/**
 * Compute Stochastic Oscillator (%K and %D).
 *
 * Measures where current close sits within the recent high-low range.
 * %K > 80 suggests overbought, %K < 20 suggests oversold.
 * A %K cross above %D is a bullish signal; cross below is bearish.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param period Lookback period (default: 14)
 * @param smoothK Smoothing period for %K (default: 3)
 * @param smoothD Smoothing period for %D (default: 3)
 * @returns { k, d } values or nulls if insufficient data
 */
export function computeStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
  smoothK = 3,
  smoothD = 3,
): StochasticResult {
  if (!closes || closes.length < period) return { k: null, d: null };

  // Compute raw %K values for each completed period window
  const rawK: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const highN = Math.max(...highs.slice(i - period + 1, i + 1));
    const lowN = Math.min(...lows.slice(i - period + 1, i + 1));
    const range = highN - lowN;
    rawK.push(range === 0 ? 50 : ((closes[i]! - lowN) / range) * 100);
  }

  // Need enough rawK to produce smoothed values
  if (rawK.length < smoothK) return { k: null, d: null };

  // Compute smoothed %K series via SMA
  const kSeries: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const window = rawK.slice(i - smoothK + 1, i + 1);
    kSeries.push(window.reduce((a, b) => a + b, 0) / smoothK);
  }

  const k = kSeries[kSeries.length - 1]!;
  const d = kSeries.length >= smoothD
    ? (() => {
        const window = kSeries.slice(kSeries.length - smoothD);
        return window.reduce((a, b) => a + b, 0) / smoothD;
      })()
    : null;

  return { k, d };
}

/**
 * Compute Ichimoku Cloud lines.
 *
 * Provides conversion line (Tenkan-sen), base line (Kijun-sen),
 * leading spans (Senkou Span A & B), and lagging span (Chikou Span).
 * Key signals: price above/below cloud, TK cross, cloud twist.
 *
 * Note: Span A and Span B are normally plotted `displacement` periods
 * ahead. Here we return the raw computed values; the caller should
 * interpret displacement in charting context.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param conversionPeriod Tenkan-sen period (default: 9)
 * @param basePeriod Kijun-sen period (default: 26)
 * @param spanBPeriod Senkou Span B period (default: 52)
 * @param displacement Displacement for spans (default: 26)
 * @returns IchimokuResult with computed line values
 */
export function computeIchimoku(
  highs: number[],
  lows: number[],
  closes: number[],
  conversionPeriod = 9,
  basePeriod = 26,
  spanBPeriod = 52,
  displacement = 26,
): IchimokuResult {
  if (!closes || closes.length < basePeriod) {
    return { conversionLine: null, baseLine: null, spanA: null, spanB: null, laggingSpan: null };
  }

  const highConv = Math.max(...highs.slice(-conversionPeriod));
  const lowConv = Math.min(...lows.slice(-conversionPeriod));
  const conversionLine = (highConv + lowConv) / 2;

  const highBase = Math.max(...highs.slice(-basePeriod));
  const lowBase = Math.min(...lows.slice(-basePeriod));
  const baseLine = (highBase + lowBase) / 2;

  // Span A = (Conversion + Base) / 2 (normally shifted forward by displacement)
  const spanA = (conversionLine + baseLine) / 2;

  // Span B requires spanBPeriod data; if insufficient, return null for spanB
  let spanB: number | null = null;
  if (closes.length >= spanBPeriod) {
    const highSpanB = Math.max(...highs.slice(-spanBPeriod));
    const lowSpanB = Math.min(...lows.slice(-spanBPeriod));
    spanB = (highSpanB + lowSpanB) / 2;
  }

  // Lagging span is the current close, normally plotted `displacement`
  // periods behind. We return the close from `displacement` periods ago.
  const laggingSpanIndex = Math.max(0, closes.length - 1 - displacement);
  const laggingSpan = closes[laggingSpanIndex]!;

  return { conversionLine, baseLine, spanA, spanB, laggingSpan };
}

/**
 * Compute Williams %R.
 *
 * Measures overbought/oversold levels. Values below -80 indicate
 * oversold (potential bounce), above -20 indicate overbought
 * (potential pullback). Inverse of Stochastic %K in interpretation.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param period Lookback period (default: 14)
 * @returns Williams %R value (-100 to 0) or null if insufficient data
 */
export function computeWilliamsR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (!closes || closes.length < period) return null;
  const highN = Math.max(...highs.slice(-period));
  const lowN = Math.min(...lows.slice(-period));
  const range = highN - lowN;
  if (range === 0) return -50; // neutral when no range
  return ((highN - closes[closes.length - 1]!) / range) * -100;
}

/**
 * Compute Chaikin Money Flow (CMF).
 *
 * Measures buying/selling pressure over a period by combining
 * price position within the high-low range with volume.
 * Positive values indicate buying pressure, negative indicates
 * selling pressure.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param volumes Volume array
 * @param period Lookback period (default: 20)
 * @returns CMF value (-1 to 1) or null if insufficient data
 */
export function computeCMF(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  period = 20,
): number | null {
  if (!closes || closes.length < period) return null;

  let mfVolumeSum = 0;
  let volumeSum = 0;

  const startIdx = closes.length - period;
  for (let i = startIdx; i < closes.length; i++) {
    const high = highs[i]!;
    const low = lows[i]!;
    const close = closes[i]!;
    const range = high - low;
    // Money Flow Multiplier: ((C - L) - (H - C)) / (H - L)
    // Ranges from -1 (close at low) to +1 (close at high)
    const multiplier = range > 0 ? ((close - low) - (high - close)) / range : 0;
    mfVolumeSum += multiplier * volumes[i]!;
    volumeSum += volumes[i]!;
  }

  if (volumeSum === 0) return 0;
  return mfVolumeSum / volumeSum;
}

/**
 * Compute True Strength Index (TSI).
 *
 * A momentum oscillator that uses double smoothing of price changes
 * to reduce noise while capturing trend strength.
 * Positive values indicate bullish momentum, negative values bearish.
 *
 * @param closes Closing price array
 * @param longPeriod Long EMA period for first smoothing (default: 25)
 * @param shortPeriod Short EMA period for second smoothing (default: 13)
 * @returns TSI value (-100 to 100) or null if insufficient data
 */
export function computeTSI(
  closes: number[],
  longPeriod = 25,
  shortPeriod = 13,
): number | null {
  if (!closes || closes.length < longPeriod + shortPeriod) return null;

  // Momentum = price change (first difference)
  const momentum: number[] = [];
  const absMomentum: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    momentum.push(diff);
    absMomentum.push(Math.abs(diff));
  }

  // First smooth: EMA of momentum (and abs momentum) with long period
  const ema1Series = emaSeries(momentum, longPeriod);
  const absEma1Series = emaSeries(absMomentum, longPeriod);

  const validEma1 = ema1Series.filter((v): v is number => v != null);
  const validAbsEma1 = absEma1Series.filter((v): v is number => v != null);

  if (validEma1.length < shortPeriod || validAbsEma1.length < shortPeriod) return null;

  // Second smooth: EMA of first-smoothed series with short period
  const ema2Series = emaSeries(validEma1, shortPeriod);
  const absEma2Series = emaSeries(validAbsEma1, shortPeriod);

  const ema2 = ema2Series[ema2Series.length - 1];
  const absEma2 = absEma2Series[absEma2Series.length - 1];

  if (ema2 == null || absEma2 == null || absEma2 === 0) return 0;

  return (ema2 / absEma2) * 100;
}

/**
 * Compute all technical indicators for a given set of klines.
 * @param klines Array of Kline data
 * @returns TechnicalIndicators with all computed values
 */
export function computeAllIndicators(klines: Kline[]): TechnicalIndicators {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const currentClose = closes[closes.length - 1] ?? 0;
  const ema50 = ema(closes, 50);
  const priceVsEma50 = ema50 !== null && ema50 > 0
    ? ((currentClose - ema50) / ema50) * 100
    : null;
  // Same-window range position (0=period low, 1=period high) for the kline
  // window these indicators are computed over. Divergence detection must use
  // THIS (not the 24h ticker rangePosPct) so price extremes and the
  // oscillator share one window (finding #2).
  const periodHigh = highs.length ? Math.max(...highs) : 0;
  const periodLow = lows.length ? Math.min(...lows) : 0;
  const range = periodHigh - periodLow;
  const rangePosWindow = range > 0 && Number.isFinite(currentClose)
    ? (currentClose - periodLow) / range
    : 0.5;
  return {
    rsi: computeRSI(closes),
    mfi: computeMFI(highs, lows, closes, volumes),
    bb: computeBB(closes),
    macd: computeMACD(closes),
    atrPct: computeATR(highs, lows, closes),
    volTrend: computeVolTrend(volumes),
    priceVsEma50,
    obv: computeOBV(closes, volumes),
    volVsAvg: computeVolVsAvg(volumes),
    stochastic: computeStochastic(highs, lows, closes),
    ichimoku: computeIchimoku(highs, lows, closes),
    williamsR: computeWilliamsR(highs, lows, closes),
    cmf: computeCMF(highs, lows, closes, volumes),
    tsi: computeTSI(closes),
    adx: computeADX(highs, lows, closes),
    psar: computePSAR(highs, lows, closes),
    cci: computeCCI(highs, lows, closes),
    keltner: computeKeltner(highs, lows, closes),
    roc: computeROC(closes),
    vwap: computeVWAP(highs, lows, closes, volumes),
    forceIndex: computeForceIndex(closes, volumes),
    adl: computeADL(highs, lows, closes, volumes),
    chaikinOsc: computeChaikinOsc(highs, lows, closes, volumes),
    stochRsi: computeStochRSI(closes),
    trix: computeTRIX(closes),
    kst: computeKST(closes),
    elderRay: computeElderRay(highs, lows, closes),
    fisher: computeFisher(highs, lows, closes),
    massIndex: computeMassIndex(highs, lows),
    rangePosWindow,
  };
}

/**
 * Compute Wilder smoothing (used by ADX).
 * First value is SMA of initial `period` values,
 * subsequent values use Wilder's EMA: ((prev * (period-1)) + current) / period.
 */
function wilderSmooth(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  result.push(sum / period);
  for (let i = period; i < values.length; i++) {
    result.push(((result[result.length - 1]!) * (period - 1) + values[i]!) / period);
  }
  return result;
}

/**
 * Compute Average Directional Index (ADX).
 *
 * Measures trend strength regardless of direction.
 * ADX > 25 indicates trending market (strong signals),
 * ADX < 20 indicates choppy/range-bound market.
 * Uses Wilder's original method with smoothed +DI/-DI.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param period ADX period (default: 14)
 * @returns ADX value (0-100) or null if insufficient data
 */
export function computeADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (!closes || closes.length < period * 2) return null;

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const trueRange = Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    );
    tr.push(trueRange);

    const upMove = highs[i]! - highs[i - 1]!;
    const downMove = lows[i - 1]! - lows[i]!;

    // +DM and -DM are mutually exclusive
    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
      minusDM.push(0);
    } else if (downMove > upMove && downMove > 0) {
      plusDM.push(0);
      minusDM.push(downMove);
    } else {
      plusDM.push(0);
      minusDM.push(0);
    }
  }

  const smoothedTR = wilderSmooth(tr, period);
  const smoothedPlusDM = wilderSmooth(plusDM, period);
  const smoothedMinusDM = wilderSmooth(minusDM, period);

  const plusDI: number[] = [];
  const minusDI: number[] = [];
  for (let i = 0; i < smoothedTR.length; i++) {
    const sTR = smoothedTR[i]!;
    plusDI.push(sTR > 0 ? (smoothedPlusDM[i]! / sTR) * 100 : 0);
    minusDI.push(sTR > 0 ? (smoothedMinusDM[i]! / sTR) * 100 : 0);
  }

  const dx: number[] = [];
  for (let i = 0; i < plusDI.length; i++) {
    const sum = plusDI[i]! + minusDI[i]!;
    dx.push(sum > 0 ? (Math.abs(plusDI[i]! - minusDI[i]!) / sum) * 100 : 0);
  }

  const adxSeries = wilderSmooth(dx, period);
  return adxSeries.length > 0 ? adxSeries[adxSeries.length - 1]! : null;
}

/**
 * Compute a series of RSI values for each position in the input array.
 *
 * @param closes Closing price array
 * @param period RSI period (default: 14)
 * @returns Array of RSI values (null for first `period` positions)
 */
export function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (!closes || closes.length < period + 1) return new Array(closes.length).fill(null);

  // Compute initial average gain/loss
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    if (delta > 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }
  avgGain /= period;
  avgLoss /= period;

  // Fill first `period` entries with null
  for (let i = 0; i < period; i++) result.push(null);

  // First RSI value after initial period
  result.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));

  // Subsequent values using Wilder's smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
  }

  return result;
}

/**
 * Compute On-Balance Volume.
 * @param closes Closing price array
 * @param volumes Volume array
 * @returns OBV value, or null if fewer than 2 data points
 */
export function computeOBV(closes: number[], volumes: number[]): number | null {
  if (closes.length < 2 || volumes.length < closes.length) return null;
  let obv = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i]! > closes[i - 1]!) obv += volumes[i]!;
    else if (closes[i]! < closes[i - 1]!) obv -= volumes[i]!;
  }
  return obv;
}

/**
 * Compute current volume vs 20-period average volume ratio.
 * @param volumes Volume array
 * @returns Ratio change (e.g. 0.5 = +50%), or null if insufficient data
 */
export function computeVolVsAvg(volumes: number[]): number | null {
  if (!volumes || volumes.length < 20) return null;
  const currentVolume = volumes[volumes.length - 1]!;
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  if (avgVolume === 0) return null;
  return (currentVolume / avgVolume) - 1;
}

// ═══════════════════════════════════════════════════════════════════════
// NEW HIGH-VALUE INDICATORS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute Parabolic SAR (Stop and Reverse).
 *
 * Tracks price reversals by plotting dots below price in uptrends
 * and above price in downtrends. The acceleration factor increases
 * as the trend extends, causing the SAR to converge on price.
 *
 * Uses Wilder's original method: initial trend determined from first
 * `start` bars, AF starts at `accelStart`, increments by `accelIncrement`
 * each time a new extreme point is made, capped at `accelMax`.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Close price array (for initial trend detection)
 * @param accelStart Acceleration factor start (default: 0.02)
 * @param accelIncrement Acceleration increment (default: 0.02)
 * @param accelMax Maximum acceleration factor (default: 0.20)
 * @returns ParabolicSarResult or null if insufficient data
 */
export function computePSAR(
  highs: number[],
  lows: number[],
  closes: number[],
  accelStart = 0.02,
  accelIncrement = 0.02,
  accelMax = 0.20,
): ParabolicSarResult | null {
  if (!highs || highs.length < 5) return null;

  // Determine initial trend from first few bars
  let isUp = closes[1]! >= closes[0]!;
  let sar: number;
  let ep: number;
  let af = accelStart;

  if (isUp) {
    sar = Math.min(...lows.slice(0, 2));
    ep = Math.max(...highs.slice(0, 2));
  } else {
    sar = Math.max(...highs.slice(0, 2));
    ep = Math.min(...lows.slice(0, 2));
  }

  let prevSar = sar;
  let prevEp = ep;
  let prevAf = af;
  let reversal = false;

  for (let i = 2; i < highs.length; i++) {
    const hi = highs[i]!;
    const lo = lows[i]!;
    const prevHi = highs[i - 1]!;
    const prevLo = lows[i - 1]!;

    // Calculate SAR for this bar
    sar = prevSar + prevAf * (prevEp - prevSar);

    if (isUp) {
      // SAR cannot be above the prior two lows
      sar = Math.min(sar, prevLo, i >= 3 ? lows[i - 2]! : prevLo);
      // If price crosses below SAR → reversal
      if (lo < sar) {
        isUp = false;
        reversal = true;
        sar = prevEp;
        ep = lo;
        af = accelStart;
      } else {
        reversal = false;
        if (hi > prevEp) {
          ep = hi;
          af = Math.min(af + accelIncrement, accelMax);
        }
      }
    } else {
      // SAR cannot be below the prior two highs
      sar = Math.max(sar, prevHi, i >= 3 ? highs[i - 2]! : prevHi);
      // If price crosses above SAR → reversal
      if (hi > sar) {
        isUp = true;
        reversal = true;
        sar = prevEp;
        ep = hi;
        af = accelStart;
      } else {
        reversal = false;
        if (lo < prevEp) {
          ep = lo;
          af = Math.min(af + accelIncrement, accelMax);
        }
      }
    }

    prevSar = sar;
    prevEp = ep;
    prevAf = af;
  }

  return { sar, acceleration: af, isReversal: reversal };
}

/**
 * Compute Commodity Channel Index (CCI).
 *
 * Measures current price level relative to an average over a period.
 * CCI above +100 indicates overbought (above avg), below -100 oversold.
 * Commonly used for cyclical detection and divergence spotting.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param period Lookback period (default: 20)
 * @returns CCI value or null if insufficient data
 */
export function computeCCI(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20,
): number | null {
  if (!closes || closes.length < period) return null;

  const startIdx = closes.length - period;
  const typicalPrices: number[] = [];

  for (let i = startIdx; i < closes.length; i++) {
    typicalPrices.push((highs[i]! + lows[i]! + closes[i]!) / 3);
  }

  const sma = typicalPrices.reduce((a, b) => a + b, 0) / period;
  let meanDev = 0;
  for (const tp of typicalPrices) {
    meanDev += Math.abs(tp - sma);
  }
  meanDev /= period;

  const currentTP = typicalPrices[typicalPrices.length - 1]!;
  if (meanDev === 0) return 0;

  return (currentTP - sma) / (0.015 * meanDev);
}

/**
 * Compute Keltner Channels.
 *
 * Volatility bands centred on an EMA with ATR-based width.
 * Price touching upper band indicates overextension;
 * channel width expands/contracts with volatility.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param period EMA period (default: 20)
 * @param multiplier ATR multiplier (default: 2)
 * @returns KeltnerChannelsResult or null if insufficient data
 */
export function computeKeltner(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20,
  multiplier = 2,
): KeltnerChannelsResult | null {
  if (!closes || closes.length < period + 1) return null;

  const middle = ema(closes, period);
  if (middle === null) return null;

  // Compute ATR over the same period
  const trueRanges: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    trueRanges.push(Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    ));
  }
  const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;

  const upper = middle + multiplier * atr;
  const lower = middle - multiplier * atr;
  const width = middle > 0 ? (upper - lower) / middle : 0;
  const close = closes[closes.length - 1]!;
  const position = upper - lower > 0 ? (close - lower) / (upper - lower) : 0.5;

  return { upper, middle, lower, width, position };
}

/**
 * Compute Rate of Change (ROC).
 *
 * Simple momentum oscillator measuring percentage change between
 * current price and the price N periods ago.
 * Positive = upward momentum, Negative = downward momentum.
 *
 * @param closes Closing price array
 * @param period Lookback period (default: 12)
 * @returns ROC as percentage or null if insufficient data
 */
export function computeROC(closes: number[], period = 12): number | null {
  if (!closes || closes.length <= period) return null;
  const current = closes[closes.length - 1]!;
  const prior = closes[closes.length - 1 - period]!;
  if (prior === 0) return 0;
  return ((current - prior) / prior) * 100;
}

/**
 * Compute VWAP (Volume Weighted Average Price).
 *
 * Calculated as the cumulative sum of (Typical Price × Volume)
 * divided by cumulative volume over the available data window.
 * Often used as an intraday fair-value benchmark.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param volumes Volume array
 * @returns VWAP value or null if insufficient data
 */
export function computeVWAP(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): number | null {
  if (!closes || closes.length < 1) return null;

  let tpvSum = 0;
  let volSum = 0;

  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i]! + lows[i]! + closes[i]!) / 3;
    tpvSum += tp * volumes[i]!;
    volSum += volumes[i]!;
  }

  if (volSum === 0) return null;
  return tpvSum / volSum;
}

/**
 * Compute Force Index.
 *
 * Measures momentum of price movements adjusted by volume.
 * Positive Force Index confirms upward price movement,
 * negative confirms downward movement. Smoothed with EMA.
 *
 * @param closes Closing price array
 * @param volumes Volume array
 * @param period Smoothing period (default: 13)
 * @returns Force Index value or null if insufficient data
 */
export function computeForceIndex(
  closes: number[],
  volumes: number[],
  period = 13,
): number | null {
  if (!closes || closes.length < period + 1) return null;

  // Raw 1-period force index: volume * (close_t - close_t-1)
  const rawForce: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    rawForce.push(volumes[i]! * (closes[i]! - closes[i - 1]!));
  }

  // Smooth with EMA
  return ema(rawForce, period);
}

/**
 * Compute Accumulation/Distribution Line (ADL).
 *
 * A volume-weighted measure of cumulative money flow.
 * Rises when price closes in the upper portion of the range,
 * falls when price closes in the lower portion.
 * Divergence between ADL and price can signal trend reversals.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param volumes Volume array
 * @returns ADL value or null if insufficient data
 */
export function computeADL(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): number | null {
  if (!closes || closes.length < 2) return null;

  let adl = 0;
  for (let i = 0; i < closes.length; i++) {
    const hi = highs[i]!;
    const lo = lows[i]!;
    const range = hi - lo;
    // CLV (Close Location Value): ranges from -1 to +1
    const clv = range > 0 ? ((closes[i]! - lo) - (hi - closes[i]!)) / range : 0;
    adl += clv * volumes[i]!;
  }

  return adl;
}

/**
 * Compute Chaikin Oscillator.
 *
 * The MACD of the Accumulation/Distribution Line. Calculated as
 * the difference between a short-period EMA of ADL and a
 * long-period EMA of ADL.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param volumes Volume array
 * @param shortPeriod Short EMA period (default: 3)
 * @param longPeriod Long EMA period (default: 10)
 * @returns Chaikin Oscillator value or null if insufficient data
 */
export function computeChaikinOsc(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  shortPeriod = 3,
  longPeriod = 10,
): number | null {
  if (!closes || closes.length < longPeriod + 2) return null;

  // Build the ADL series
  const adlSeries: number[] = [];
  let adl = 0;
  for (let i = 0; i < closes.length; i++) {
    const hi = highs[i]!;
    const lo = lows[i]!;
    const range = hi - lo;
    const clv = range > 0 ? ((closes[i]! - lo) - (hi - closes[i]!)) / range : 0;
    adl += clv * volumes[i]!;
    adlSeries.push(adl);
  }

  const shortEma = ema(adlSeries, shortPeriod);
  const longEma = ema(adlSeries, longPeriod);

  if (shortEma === null || longEma === null) return null;
  return shortEma - longEma;
}

/**
 * Compute StochRSI.
 *
 * Applies the Stochastic Oscillator formula to RSI values rather
 * than price data. Identifies overbought/oversold conditions in
 * RSI itself. Values near 1.0 indicate RSI is near its high,
 * values near 0 indicate RSI is near its low.
 *
 * @param closes Closing price array
 * @param rsiPeriod RSI period (default: 14)
 * @param stochPeriod Stochastic lookback period (default: 14)
 * @param smoothK %K smoothing factor (default: 3)
 * @param smoothD %D smoothing factor (default: 3)
 * @returns StochRSIResult with stochRsi (raw 0-1), k and d (0-100)
 */
export function computeStochRSI(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3,
): StochRSIResult | null {
  // Need enough data for RSI + stochastic period
  if (!closes || closes.length < rsiPeriod + stochPeriod + 1) {
    return { stochRsi: null, k: null, d: null };
  }

  // Get the RSI series
  const rsiVals = rsiSeries(closes, rsiPeriod);
  const validRsi: number[] = rsiVals.filter((v): v is number => v != null);

  if (validRsi.length < stochPeriod) {
    return { stochRsi: null, k: null, d: null };
  }

  // Compute raw stochRSI (0 to 1)
  const window = validRsi.slice(-stochPeriod);
  const minRsi = Math.min(...window);
  const maxRsi = Math.max(...window);
  const currentRsi = validRsi[validRsi.length - 1]!;
  const range = maxRsi - minRsi;
  const stochRsi = range === 0 ? 0.5 : (currentRsi - minRsi) / range;

  // Compute smoothed %K and %D (0-100 scale) similar to computeStochastic
  const rawK: number[] = [];
  for (let i = stochPeriod - 1; i < validRsi.length; i++) {
    const slice = validRsi.slice(i - stochPeriod + 1, i + 1);
    const sliceMin = Math.min(...slice);
    const sliceMax = Math.max(...slice);
    const sliceRange = sliceMax - sliceMin;
    rawK.push(sliceRange === 0 ? 50 : ((validRsi[i]! - sliceMin) / sliceRange) * 100);
  }

  if (rawK.length < smoothK) {
    return { stochRsi, k: null, d: null };
  }

  const kSeries: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const w = rawK.slice(i - smoothK + 1, i + 1);
    kSeries.push(w.reduce((a, b) => a + b, 0) / smoothK);
  }

  const k = kSeries[kSeries.length - 1]!;
  const d = kSeries.length >= smoothD
    ? kSeries.slice(kSeries.length - smoothD).reduce((a, b) => a + b, 0) / smoothD
    : null;

  return { stochRsi, k, d };
}

/**
 * Compute TRIX (Triple Exponential Average).
 *
 * Applies three EMAs to price data and computes the period-over-period
 * percentage change of the final EMA. Filters out short-term noise
 * while capturing underlying momentum.
 * Positive values indicate upward momentum, negative downward.
 *
 * @param closes Closing price array
 * @param period EMA period (default: 15)
 * @returns TRIX value as percentage change, or null if insufficient data
 */
export function computeTRIX(closes: number[], period = 15): number | null {
  // Need at least 3 * period data points for triple smoothing
  if (!closes || closes.length < period * 3) return null;

  const ema1 = emaSeries(closes, period);
  const validEma1: number[] = ema1.filter((v): v is number => v != null);

  if (validEma1.length < period) return null;

  const ema2 = emaSeries(validEma1, period);
  const validEma2: number[] = ema2.filter((v): v is number => v != null);

  if (validEma2.length < period) return null;

  const ema3 = emaSeries(validEma2, period);
  const validEma3: number[] = ema3.filter((v): v is number => v != null);

  if (validEma3.length < 2) return null;

  const current = validEma3[validEma3.length - 1]!;
  const prior = validEma3[validEma3.length - 2]!;

  if (prior === 0) return 0;
  return ((current - prior) / prior) * 100;
}

/**
 * Compute KST (Know Sure Thing).
 *
 * A summed ROC oscillator that combines four different rate-of-change
 * calculations, each smoothed separately, then weighted and summed.
 * Designed to identify major trend shifts with reduced noise.
 *
 * Standard configuration:
 *   RCMA1 = SMA(ROC(close, 10), 10)  weight 1
 *   RCMA2 = SMA(ROC(close, 15), 10)  weight 2
 *   RCMA3 = SMA(ROC(close, 20), 10)  weight 3
 *   RCMA4 = SMA(ROC(close, 30), 15)  weight 4
 *   KST   = sum of weighted RCMAs
 *   Signal = SMA(KST, 9)
 *
 * @param closes Closing price array
 * @returns KSTResult with kst and signal line, or null if insufficient data
 */
export function computeKST(closes: number[]): KSTResult | null {
  // Need at least 30 (ROC4 period) + 15 (SMA period) = 45 bars
  if (!closes || closes.length < 45) return { kst: 0, signal: null };

  const rocPeriods = [10, 15, 20, 30];
  const smaPeriods = [10, 10, 10, 15];
  const weights = [1, 2, 3, 4];

  const rcmas: number[] = [];

  for (let r = 0; r < rocPeriods.length; r++) {
    const rocPeriod = rocPeriods[r]!;
    const smaPeriod = smaPeriods[r]!;

    // Compute ROC series
    const rocSeries: number[] = [];
    for (let i = rocPeriod; i < closes.length; i++) {
      const prior = closes[i - rocPeriod]!;
      rocSeries.push(prior !== 0 ? ((closes[i]! - prior) / prior) * 100 : 0);
    }

    if (rocSeries.length < smaPeriod) return null;

    // SMA of ROC series
    const smaVal = rocSeries.slice(-smaPeriod).reduce((a, b) => a + b, 0) / smaPeriod;
    rcmas.push(smaVal);
  }

  // Weighted sum
  let kst = 0;
  for (let r = 0; r < rcmas.length; r++) {
    kst += rcmas[r]! * weights[r]!;
  }

  // Signal line: compute trailing KST history then SMA of last 9
  const kstHistory: number[] = [];
  const maxHistory = Math.min(30, closes.length - 50);
  for (let offset = 0; offset < maxHistory; offset++) {
    const kstComp: number[] = [];
    let enough = true;

    for (let r = 0; r < rocPeriods.length; r++) {
      const rocP = rocPeriods[r]!;
      const smaP = smaPeriods[r]!;
      const endIdx = closes.length - 1 - offset;

      if (endIdx < rocP + smaP) { enough = false; break; }

      const rocSeries: number[] = [];
      for (let i = endIdx - smaP + 1; i <= endIdx; i++) {
        if (i < rocP) { enough = false; break; }
        const prior = closes[i - rocP]!;
        rocSeries.push(prior !== 0 ? ((closes[i]! - prior) / prior) * 100 : 0);
      }
      if (!enough) break;

      if (rocSeries.length < smaP) { enough = false; break; }
      const smaV = rocSeries.reduce((a, b) => a + b, 0) / smaP;
      kstComp.push(smaV);
    }

    if (enough && kstComp.length === 4) {
      const kstVal = kstComp[0]! * weights[0]! + kstComp[1]! * weights[1]! +
                     kstComp[2]! * weights[2]! + kstComp[3]! * weights[3]!;
      kstHistory.push(kstVal);
    }
  }

  const signal = kstHistory.length >= 9
    ? kstHistory.slice(0, 9).reduce((a, b) => a + b, 0) / 9
    : null;

  return { kst, signal };
}

/**
 * Compute Elder Ray Index (Bull/Bear Power).
 *
 * Bull Power = High - EMA(close)
 * Bear Power = Low - EMA(close)
 *
 * Positive Bull Power indicates buyers are in control,
 * negative Bear Power indicates sellers are in control.
 * Divergence between price and these indicators can signal reversals.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param period EMA period (default: 13)
 * @returns ElderRayResult or null if insufficient data
 */
export function computeElderRay(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 13,
): ElderRayResult | null {
  if (!closes || closes.length < period) return null;

  const emaVal = ema(closes, period);
  if (emaVal === null) return null;

  const currentHigh = highs[highs.length - 1]!;
  const currentLow = lows[lows.length - 1]!;

  return {
    bullPower: currentHigh - emaVal,
    bearPower: currentLow - emaVal,
  };
}

/**
 * Compute Fisher Transform.
 *
 * Normalizes price data to a Gaussian distribution, producing
 * an oscillator that highlights extreme price moves with sharp
 * turning points. Values above 2 suggest overbought, below -2
 * suggest oversold.
 *
 * @param highs High price array
 * @param lows Low price array
 * @param closes Closing price array
 * @param period Lookback period (default: 10)
 * @returns Fisher Transform value or null if insufficient data
 */
export function computeFisher(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 10,
): number | null {
  if (!closes || closes.length < period + 1) return null;

  // Compute median prices
  const medians: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    medians.push((highs[i]! + lows[i]!) / 2);
  }

  // For each position, compute Fisher value
  let prevNorm = 0;
  let fisherValue: number | null = null;

  for (let i = period - 1; i < medians.length; i++) {
    const window = medians.slice(i - period + 1, i + 1);
    const minLo = Math.min(...window);
    const maxHi = Math.max(...window);
    const range = maxHi - minLo;

    // Normalize median to -1..1 range
    let norm = range > 0
      ? 0.33 * 2 * ((medians[i]! - minLo) / range - 0.5) + 0.67 * prevNorm
      : prevNorm;

    // Clamp to avoid ln(0) or ln(negative)
    if (norm > 0.999) norm = 0.999;
    if (norm < -0.999) norm = -0.999;

    fisherValue = 0.5 * Math.log((1 + norm) / (1 - norm));
    prevNorm = norm;
  }

  return fisherValue;
}

/**
 * Compute Mass Index.
 *
 * Detects trend reversals by measuring the narrowing and widening
 * of the high-low range. A reversal signal occurs when the Mass
 * Index rises above 27 and then falls below 26.5.
 *
 * Formula:
 *   Range = High - Low
 *   EMA9 = EMA(Range, 9)
 *   EMA9_EMA9 = EMA(EMA9, 9)
 *   Ratio = EMA9 / EMA9_EMA9
 *   Mass Index = Sum of Ratio over the last 25 periods
 *
 * @param highs High price array
 * @param lows Low price array
 * @param period Summation period (default: 25)
 * @returns Mass Index value or null if insufficient data
 */
export function computeMassIndex(
  highs: number[],
  lows: number[],
  period = 25,
): number | null {
  // Need enough data for double EMA9 + summation period
  if (!highs || highs.length < 9 * 2 + period) return null;

  const ranges: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    ranges.push(highs[i]! - lows[i]!);
  }

  const ema9Series = emaSeries(ranges, 9);
  const validEma9: number[] = ema9Series.filter((v): v is number => v != null);

  if (validEma9.length < 9 * 2) return null;

  const ema9ema9Series = emaSeries(validEma9, 9);
  const validEma9ema9: number[] = ema9ema9Series.filter((v): v is number => v != null);

  if (validEma9ema9.length < period) return null;

  // Align the last `period` values of EMA9 and EMA9_EMA9
  const alignedEma9 = validEma9.slice(validEma9.length - period);
  const alignedEma9ema9 = validEma9ema9.slice(-period);

  let massIndex = 0;
  for (let i = 0; i < period; i++) {
    const ema9Val = alignedEma9[i]!;
    const ema9ema9Val = alignedEma9ema9[i]!;
    massIndex += ema9ema9Val > 0 ? ema9Val / ema9ema9Val : 1;
  }

  return massIndex;
}
