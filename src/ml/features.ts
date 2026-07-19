// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Feature Engineering
// ═══════════════════════════════════════════════════════════════════════
//
// Builds feature rows from store klines + indicators + cross-asset + futures
// data. Handles gap detection (F9), timestamp alignment (F2), and NaN/Infinity
// handling with training-median fallback (F5).
// ═══════════════════════════════════════════════════════════════════════

import type { KlineRow, CrossAssetRow, FundingRow } from '../types.js';
import type { FeatureRow, FeatureOpts } from './types.js';
import { computeAllIndicators } from '../indicators.js';
import type { TechnicalIndicators } from '../types.js';
import { detectRegime } from '../analysis/regime.js';
import { computeTrendRegression } from '../analysis/trend-regression.js';
import { computeVolumeProfile } from '../analysis/volume-profile.js';
import { computePCA, computeCorrelationMatrix } from '../analysis/correlation.js';

/** Minimum data points needed for any indicator computation */
const MIN_WARMUP = 30;

/** Maximum lookback window for indicators (matches computeAllIndicators) */
const INDICATOR_WINDOW = 200;

/** Gap tolerance multiplier — rows with gaps > 1.5× interval are skipped */
const GAP_TOLERANCE = 1.5;
/** Interval → ms lookup */
const INTERVAL_MS: Record<string, number> = {
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

/**
 * Build feature rows from klines with optional cross-asset and futures alignment.
 *
 * F9: Detects kline gaps — if open_time - prev_open_time > 1.5× interval, the
 *     row is skipped (would produce misaligned return calculations).
 * F2: Cross-asset and futures data are aligned by nearest-neighbor forward-fill
 *     (the most recent snapshot before each kline's open_time).
 * F5: NaN/Infinity in output features are set to null for downstream filtering.
 */
export function buildFeatures(
  symbol: string,
  interval: string,
  klines: KlineRow[],
  opts: FeatureOpts = {},
  crossAsset?: CrossAssetRow[],
  funding?: FundingRow[],
  referenceKlines?: Map<string, number[]>,
): FeatureRow[] {
  const intervalMs = INTERVAL_MS[interval] ?? 3_600_000;
  const features: FeatureRow[] = [];

  if (klines.length < MIN_WARMUP) {
    return features; // Not enough data for indicators
  }

  const includeReturns = opts.includeReturns ?? true;
  const includeIndicators = opts.includeIndicators ?? true;
  const includeCrossAsset = opts.includeCrossAsset ?? true;
  const includeFutures = opts.includeFutures ?? true;
  const includeTemporal = opts.includeTemporal ?? true;

  // Pre-process cross-asset into sorted array for alignment (F2)
  const sortedCrossAsset = crossAsset
    ? [...crossAsset].sort((a, b) => a.ts - b.ts)
    : [];

  // Pre-process funding into sorted array keyed by symbol
  const sortedFunding = funding
    ? [...funding].sort((a, b) => a.ts - b.ts)
    : [];

  for (let i = MIN_WARMUP; i < klines.length; i++) {
    const k = klines[i]!;
    const prev = klines[i - 1]!;

    // F9: Gap detection — skip if gap > GAP_TOLERANCE × expected interval
    const actualGap = k.open_time - prev.open_time;
    if (actualGap > intervalMs * GAP_TOLERANCE) {
      // Skip rows with gaps to avoid misaligned return calculations
      continue;
    }

    // Get the kline window needed for indicators
    const windowStart = Math.max(0, i - INDICATOR_WINDOW);
    const windowKlines = klines.slice(windowStart, i + 1);

    // Convert KlineRow[] to the format computeAllIndicators expects
    const indicatorInput = windowKlines.map(kr => ({
      openTime: kr.open_time,
      open: kr.open,
      high: kr.high,
      low: kr.low,
      close: kr.close,
      volume: kr.volume,
      closeTime: kr.open_time + intervalMs,
      quoteVolume: kr.quote_volume,
      count: 0,
      takerBuyVol: kr.taker_buy_vol,
      takerBuyQuoteVol: kr.taker_buy_quote_vol,
      ignore: 0,
    }));

    const closes = indicatorInput.map(k => k.close);

    const row: FeatureRow = {
      symbol,
      interval,
      open_time: k.open_time,
    };

    // ── Price features ──
    row.open = k.open;
    row.high = k.high;
    row.low = k.low;
    row.close = k.close;
    row.volume = k.volume;
    row.quote_volume = k.quote_volume;

    // ── Returns (F9: requires contiguous klines, which we've verified above) ──
    if (includeReturns) {
      row.return_1 = safeRatio(k.close, klines[i - 1]!.close);
      row.return_5 = i >= 5 ? safeRatio(k.close, klines[i - 5]!.close) : null;
      row.return_10 = i >= 10 ? safeRatio(k.close, klines[i - 10]!.close) : null;
      row.return_20 = i >= 20 ? safeRatio(k.close, klines[i - 20]!.close) : null;
      row.log_return_1 = i >= 1 ? safeLogRatio(k.close, klines[i - 1]!.close) : null;
      row.log_return_5 = i >= 5 ? safeLogRatio(k.close, klines[i - 5]!.close) : null;
      row.log_return_10 = i >= 10 ? safeLogRatio(k.close, klines[i - 10]!.close) : null;

      // Volume ratios
      const volSlice5 = klines.slice(Math.max(0, i - 5), i).map(kr => kr.volume);
      const volSlice20 = klines.slice(Math.max(0, i - 20), i).map(kr => kr.volume);
      const volMean5 = mean(volSlice5);
      const volMean20 = mean(volSlice20);
      row.volume_sma_5 = volMean5;
      row.volume_sma_20 = volMean20;
      row.volume_ratio_5 = safeRatio(k.volume, volMean5 ?? 0);
      row.volume_ratio_20 = safeRatio(k.volume, volMean20 ?? 0);
    }

    // ── Technical indicators (reuse computeAllIndicators) ──
    if (includeIndicators) {
      const techs = computeAllIndicators(indicatorInput);
      if (techs) {
        addTechnicalFeatures(row, techs, closes, windowKlines, referenceKlines);
      }
    }

    // ── Cross-asset alignment (F2: nearest-neighbor forward-fill) ──
    if (includeCrossAsset && sortedCrossAsset.length > 0) {
      const alignedCA = findNearestBefore(sortedCrossAsset, k.open_time, 'ts');
      if (alignedCA) {
        row.btc_dominance = alignedCA.btc_dominance;
        row.total_mcap = alignedCA.total_mcap;
        row.total_mcap_change_24h = alignedCA.total_mcap_change_24h;
        row.eth_dominance = alignedCA.eth_dominance;
      }
    }

    // ── Futures alignment (F2) ──
    if (includeFutures && sortedFunding.length > 0) {
      const alignedF = findNearestBefore(sortedFunding, k.open_time, 'ts');
      if (alignedF) {
        row.funding_rate = alignedF.rate;
        // Funding rate change: compare with previous funding snapshot
        const fIdx = sortedFunding.indexOf(alignedF);
        if (fIdx > 0) {
          const prevF = sortedFunding[fIdx - 1];
          if (prevF && prevF.rate !== null && prevF.rate !== undefined) {
            row.funding_rate_change = alignedF.rate !== null && alignedF.rate !== undefined
              ? alignedF.rate - prevF.rate
              : null;
          }
        }
      }
    }

    // ── Temporal features ──
    if (includeTemporal) {
      const d = new Date(k.open_time);
      row.hour_of_day = d.getUTCHours();
      row.day_of_week = d.getUTCDay();
      row.day_of_month = d.getUTCDate();
      row.month = d.getUTCMonth() + 1;
      row.is_weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 1 : 0;
    }

    // F5: Clean NaN/Infinity — set to null
    sanitizeRow(row);

    features.push(row);
  }

  return features;
}

/**
 * Add technical indicator features from computeAllIndicators output.
 */
function addTechnicalFeatures(row: FeatureRow, techs: TechnicalIndicators, closes: number[], rawKlines: KlineRow[], referenceKlines?: Map<string, number[]>): void {
  // RSI
  row.rsi = techs.rsi;

  // MFI
  row.mfi = techs.mfi;

  // MACD
  if (techs.macd) {
    row.macd_macd = techs.macd.macd;
    row.macd_signal = techs.macd.signal;
    row.macd_histogram = techs.macd.histogram;
  }

  // Bollinger Bands
  if (techs.bb) {
    row.bb_upper = techs.bb.upper;
    row.bb_middle = techs.bb.middle;
    row.bb_lower = techs.bb.lower;
    row.bb_width = techs.bb.width;
    row.bb_position = techs.bb.position;
  }

  // ATR
  row.atr_pct = techs.atrPct;
  // Volatility ratio: current ATR vs SMA of ATR (rough market regime indicator)
  row.volatility_ratio = techs.atrPct !== null && techs.atrPct !== undefined
    ? techs.volTrend !== null && techs.volTrend !== undefined && techs.volTrend !== 0
      ? techs.atrPct / techs.volTrend
      : null
    : null;

  // Market regime: soft confidence votes from detectRegime
  if (techs.adx != null) {
    const regimeResult = detectRegime({
      adx: techs.adx,
      bbWidth: techs.bb?.width ?? null,
      atrPct: techs.atrPct,
      volRatio: techs.volVsAvg,
      closes,
    });
    row.regime_trending = regimeResult.confidence * (regimeResult.regime === 'trending' ? 1 : 0);
    row.regime_ranging = regimeResult.confidence * (regimeResult.regime === 'ranging' ? 1 : 0);
    row.regime_volatile = regimeResult.confidence * (regimeResult.regime === 'volatile' ? 1 : 0);
    row.regime_quiet = regimeResult.confidence * (regimeResult.regime === 'quiet' ? 1 : 0);
  }

  // Trend regression R² and slope
  if (closes.length >= 20) {
    const tr10 = computeTrendRegression(closes, 10);
    const tr20 = computeTrendRegression(closes, 20);
    if (tr10) { row.trend_r2_10 = tr10.rSquared; row.trend_slope_10 = tr10.slope; }
    if (tr20) { row.trend_r2_20 = tr20.rSquared; row.trend_slope_20 = tr20.slope; }
    if (closes.length >= 50) {
      const tr50 = computeTrendRegression(closes, 50);
      if (tr50) { row.trend_r2_50 = tr50.rSquared; row.trend_slope_50 = tr50.slope; }
    }
  }

  // Volume
  row.vol_trend = techs.volTrend;
  row.vol_vs_avg = techs.volVsAvg;

  // EMA distance
  row.ema50_dist_pct = techs.priceVsEma50;

  // OBV
  row.obv = techs.obv;

  // Stochastic
  if (techs.stochastic) {
    row.stoch_k = techs.stochastic.k;
    row.stoch_d = techs.stochastic.d;
  }

  // Ichimoku
  if (techs.ichimoku) {
    row.ichimoku_conversion = techs.ichimoku.conversionLine;
    row.ichimoku_base = techs.ichimoku.baseLine;
    row.ichimoku_span_a = techs.ichimoku.spanA;
    row.ichimoku_span_b = techs.ichimoku.spanB;
  }

  // Williams %R
  row.williams_r = techs.williamsR;

  // CMF
  row.cmf = techs.cmf;

  // TSI
  row.tsi = techs.tsi;

  // ADX
  row.adx = techs.adx;
  row.adx_strength = techs.adx !== null && techs.adx !== undefined
    ? techs.adx >= 40 ? 2 : techs.adx >= 25 ? 1 : 0
    : null;

  // Parabolic SAR
  if (techs.psar) {
    row.psar = techs.psar.sar;
  }

  // CCI
  row.cci = techs.cci;

  // Keltner
  if (techs.keltner) {
    row.keltner_width = techs.keltner.width;
    row.keltner_position = techs.keltner.position;
  }

  // ROC
  row.roc = techs.roc;

  // VWAP
  row.vwap = techs.vwap;

  // Force Index
  row.force_index = techs.forceIndex;

  // ADL
  row.adl = techs.adl;

  // Chaikin Osc
  row.chaikin_osc = techs.chaikinOsc;

  // StochRSI
  if (techs.stochRsi) {
    row.stoch_rsi = techs.stochRsi.stochRsi;
    row.stoch_rsi_k = techs.stochRsi.k;
    row.stoch_rsi_d = techs.stochRsi.d;
  }

  // TRIX
  row.trix = techs.trix;

  // KST
  if (techs.kst) {
    row.kst = techs.kst.kst;
    row.kst_signal = techs.kst.signal;
  }

  // Elder Ray
  if (techs.elderRay) {
    row.elder_bull_power = techs.elderRay.bullPower;
    row.elder_bear_power = techs.elderRay.bearPower;
  }

  // Fisher Transform
  row.fisher = techs.fisher;

  // Mass Index
  row.mass_index = techs.massIndex;

  // ── Cross-asset trailing correlation ──
  if (referenceKlines && closes.length >= 20) {
    const btcCloses = referenceKlines.get('BTCUSDT');
    if (btcCloses && btcCloses.length >= 20) {
      const btcRets = btcCloses.slice(1).map((c, i) => (c - btcCloses[i]!) / btcCloses[i]!);
      const symRets = closes.slice(1).map((c, i) => (c - closes[i]!) / closes[i]!);
      row.corr_btc_20 = rollingCorrelation(symRets, btcRets, 20);
      row.corr_btc_10 = rollingCorrelation(symRets, btcRets, 10);
    }
    const ethCloses = referenceKlines.get('ETHUSDT');
    if (ethCloses && ethCloses.length >= 20) {
      const ethRets = ethCloses.slice(1).map((c, i) => (c - ethCloses[i]!) / ethCloses[i]!);
      const symRets = closes.slice(1).map((c, i) => (c - closes[i]!) / closes[i]!);
      row.corr_eth_20 = rollingCorrelation(symRets, ethRets, 20);
      row.corr_eth_10 = rollingCorrelation(symRets, ethRets, 10);
    }
    const solCloses = referenceKlines.get('SOLUSDT');
    if (solCloses && solCloses.length >= 20) {
      const solRets = solCloses.slice(1).map((c, i) => (c - solCloses[i]!) / solCloses[i]!);
      const symRets = closes.slice(1).map((c, i) => (c - closes[i]!) / closes[i]!);
      row.corr_sol_20 = rollingCorrelation(symRets, solRets, 20);
      row.corr_sol_10 = rollingCorrelation(symRets, solRets, 10);
    }
    const polCloses = referenceKlines.get('POLUSDT');
    if (polCloses && polCloses.length >= 20) {
      const polRets = polCloses.slice(1).map((c, i) => (c - polCloses[i]!) / polCloses[i]!);
      const symRets = closes.slice(1).map((c, i) => (c - closes[i]!) / closes[i]!);
      row.corr_pol_20 = rollingCorrelation(symRets, polRets, 20);
      row.corr_pol_10 = rollingCorrelation(symRets, polRets, 10);
    }
  }

  // Volume profile value area position
  if (rawKlines.length >= 24) {
    const vpKlines = rawKlines.slice(-48);
    const vpInput = vpKlines.map(k => ({
      openTime: k.open_time, open: k.open, high: k.high, low: k.low,
      close: k.close, volume: k.volume, closeTime: k.open_time + 3600000,
      quoteVolume: k.quote_volume, count: 0, takerBuyVol: k.taker_buy_vol,
      takerBuyQuoteVol: k.taker_buy_quote_vol, ignore: 0,
    }));
    const vp = computeVolumeProfile(row.symbol, vpInput, { buckets: 24, valueAreaPct: 0.70 });
    if (vp) {
      const lastClose = rawKlines[rawKlines.length - 1]!.close;
      row.vah = vp.vah;
      row.val = vp.val;
      row.poc = vp.poc;
      row.va_position = vp.vah !== vp.val ? (lastClose - vp.val) / (vp.vah - vp.val) : 0.5;
    }
  }
}

/**
 * Find the element in a sorted array whose timestamp field is the closest
 * before or equal to the target (nearest-neighbor forward-fill).
 */
function findNearestBefore<T>(sorted: T[], target: number, field: keyof T): T | undefined {
  if (sorted.length === 0) return undefined;
  if (Number(sorted[0]![field]) > target) return sorted[0]; // before first snapshot, use first

  let lo = 0;
  let hi = sorted.length - 1;
  let best: T | undefined;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midVal = Number(sorted[mid]![field]);
    if (midVal <= target) {
      best = sorted[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

// ── Helpers ──

/** Safe (a / b) - 1 ratio, returns null on division by zero or non-finite */
function safeRatio(a: number, b: number): number | null {
  if (b === 0 || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (a - b) / b;
}

/** Safe log ratio ln(a/b) */
function safeLogRatio(a: number, b: number): number | null {
  if (b <= 0 || a <= 0 || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.log(a / b);
}

/** Mean of an array, null if empty */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * F5: Sanitize a feature row — replace NaN/Infinity with null
 * for all numeric feature values.
 */
function sanitizeRow(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    const val = row[key];
    if (typeof val === 'number' && !Number.isFinite(val)) {
      row[key] = null;
    }
  }
}

/**
 * Compute a single trailing Pearson correlation value between two arrays.
 * Returns null if either array has fewer than `window` elements.
 */
function rollingCorrelation(values: number[], reference: number[], window: number): number | null {
  if (values.length < window || reference.length < window) return null;
  const vSlice = values.slice(-window);
  const rSlice = reference.slice(-window);
  const n = window;
  const vMean = vSlice.reduce((a, b) => a + b, 0) / n;
  const rMean = rSlice.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vVar = 0, rVar = 0;
  for (let i = 0; i < n; i++) {
    const vDiff = vSlice[i]! - vMean;
    const rDiff = rSlice[i]! - rMean;
    cov += vDiff * rDiff;
    vVar += vDiff * vDiff;
    rVar += rDiff * rDiff;
  }
  const denom = Math.sqrt(vVar * rVar);
  if (denom === 0) return null;
  const r = cov / denom;
  return Math.max(-1, Math.min(1, r));
}

/**
 * Enrich feature rows with market-level signals from multi-symbol analysis.
 * Currently adds PCA market breadth (PC1 explained variance ratio).
 */
export function enrichFeatures(
  rows: FeatureRow[],
  allKlinesBySymbol: Map<string, number[]>,
): void {
  if (rows.length === 0) return;

  const symbolSet = new Set<string>();
  for (const sym of allKlinesBySymbol.keys()) {
    const clean = sym.includes(':') ? sym.split(':')[0]! : sym;
    symbolSet.add(clean);
  }

  if (symbolSet.size < 2) return;

  const priceMap = new Map<string, number[]>();
  for (const sym of symbolSet) {
    let closes = allKlinesBySymbol.get(sym);
    if (!closes) {
      for (const [key, val] of allKlinesBySymbol) {
        if (key.startsWith(sym)) { closes = val; break; }
      }
    }
    if (closes && closes.length >= 20) {
      priceMap.set(sym, closes);
    }
  }

  if (priceMap.size < 2) return;

  try {
    const corrMatrix = computeCorrelationMatrix(priceMap);
    const pca = computePCA(corrMatrix.matrix);
    if (pca.explainedVariance.length > 0) {
      const breadth = pca.explainedVariance[0]!;
      for (const row of rows) {
        row.pca_market_breadth = breadth;
      }
    }
  } catch {
    // PCA computation failed — skip enrichment silently
  }
}
