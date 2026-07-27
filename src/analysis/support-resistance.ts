// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Support & Resistance Detection
// ═══════════════════════════════════════════════════════════════════════
//
// Detects key price levels from historical kline data using:
//   1. Pivot points — local highs (resistance) and lows (support)
//   2. Cluster detection — group nearby pivots into zones
//   3. Volume confirmation — levels with higher volume are stronger
//   4. Psychological levels — round numbers (1000, 5000, 50000, etc.)
//
// No external deps — pure math on existing kline data.

import type { Kline } from '../types.js';
import { mean } from '../math/index.js';

// ── Exported Types ────────────────────────────────────────────────────

/** A detected price level with strength metadata */
export interface PriceLevel {
  price: number;
  type: 'support' | 'resistance' | 'psychological';
  /** Strength 0–1 based on touch count and volume confirmation */
  strength: number;
  /** How many times price touched this level */
  touchCount: number;
  /** Human label, e.g. "S1", "R2", "PSY-50000" */
  label: string;
}

/** Full support/resistance analysis result */
export interface SupportResistanceResult {
  symbol: string;
  /** Support levels sorted ascending (closest to price first) */
  support: PriceLevel[];
  /** Resistance levels sorted ascending (closest to price first) */
  resistance: PriceLevel[];
  /** Psychological round-number levels near current price */
  psychological: PriceLevel[];
  /** Nearest support level below current price */
  nearestSupport: PriceLevel | null;
  /** Nearest resistance level above current price */
  nearestResistance: PriceLevel | null;
  /** % gain to nearest resistance, or null */
  upsideTarget: number | null;
  /** % loss to nearest support, or null */
  downsideRisk: number | null;
  /** ISO timestamp of the analysis */
  timestamp: string;
}

/** Configuration for detection sensitivity */
export interface SROptions {
  /** Minimum distance between pivot points as % (default: 1%) */
  clusterThreshold?: number;
  /** Minimum touches to consider a level valid (default: 2) */
  minTouches?: number;
  /** Lookback period for pivot detection (default: 10) */
  pivotWindow?: number;
  /** Include psychological levels (round numbers) (default: true) */
  includePsychological?: boolean;
  /** Proximity threshold for counting a touch as % (default: 0.5%) */
  touchThreshold?: number;
  /** Maximum number of resistance levels to return (default: 5) */
  maxLevels?: number;
}

// ── Internal types ────────────────────────────────────────────────────

interface PivotPoint {
  price: number;
  index: number;
  volume: number;
}

interface PivotCluster {
  price: number;        // volume-weighted average
  pivots: PivotPoint[];
  volume: number;       // total pivot volume
  pivotCount: number;
}

// ── Defaults ──────────────────────────────────────────────────────────

const DEFAULTS: Required<SROptions> = {
  clusterThreshold: 1,
  minTouches: 2,
  pivotWindow: 10,
  includePsychological: true,
  touchThreshold: 0.5,
  maxLevels: 5,
};

// ═══════════════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════════════

/**
 * Find support and resistance levels from kline data.
 *
 * @param symbol  Token symbol (e.g. "BTCUSDT")
 * @param klines  Array of kline data (at least 2×pivotWindow + 1 periods)
 * @param options Sensitivity configuration (see SROptions)
 */
export function findSupportResistance(
  symbol: string,
  klines: Kline[],
  options: SROptions = {},
): SupportResistanceResult {
  const opts: Required<SROptions> = { ...DEFAULTS, ...options };
  const now = new Date().toISOString();

  // ── Validate ──────────────────────────────────────────────────────
  const minRequired = 2 * opts.pivotWindow + 1;
  if (!klines || klines.length < minRequired) {
    return emptyResult(symbol, now);
  }

  // Use only valid klines
  const valid = klines.filter(k => k.high > 0 && k.low > 0 && k.volume > 0);
  if (valid.length < minRequired) {
    return emptyResult(symbol, now);
  }

  const lastPrice = valid[valid.length - 1]!.close;
  const avgVolume = mean(valid.map(k => k.volume));

  // ── 1. Detect pivot highs & lows ──────────────────────────────────
  const pivotHighs = detectPivotHighs(valid, opts.pivotWindow);
  const pivotLows = detectPivotLows(valid, opts.pivotWindow);

  // ── 2. Cluster nearby pivots ──────────────────────────────────────
  const resistanceClusters = clusterPivots(pivotHighs, opts.clusterThreshold);
  const supportClusters = clusterPivots(pivotLows, opts.clusterThreshold);

  // ── 3. Count touches & calculate strength ─────────────────────────
  const touchThreshDecimal = opts.touchThreshold / 100;

  const resistanceLevels: PriceLevel[] = resistanceClusters
    .map(c => {
      const { count, volume } = countTouches(c.price, valid, 'resistance', touchThreshDecimal);
      return {
        price: c.price,
        type: 'resistance' as const,
        strength: calculateStrength(count, volume, avgVolume, opts.minTouches),
        touchCount: count,
        label: '',
      };
    })
    .filter(l => l.touchCount >= opts.minTouches)
    .sort((a, b) => b.price - a.price)       // desc
    .slice(0, opts.maxLevels);

  const supportLevels: PriceLevel[] = supportClusters
    .map(c => {
      const { count, volume } = countTouches(c.price, valid, 'support', touchThreshDecimal);
      return {
        price: c.price,
        type: 'support' as const,
        strength: calculateStrength(count, volume, avgVolume, opts.minTouches),
        touchCount: count,
        label: '',
      };
    })
    .filter(l => l.touchCount >= opts.minTouches)
    .sort((a, b) => a.price - b.price)       // asc
    .slice(0, opts.maxLevels);

  // ── 4. Label levels ───────────────────────────────────────────────
  // Resistance: R1 is closest above price, R2 next, etc.
  const resistanceAbove = resistanceLevels
    .filter(l => l.price > lastPrice)
    .sort((a, b) => a.price - b.price);      // closest first
  resistanceAbove.forEach((l, i) => { l.label = `R${i + 1}`; });

  const resistanceBelow = resistanceLevels
    .filter(l => l.price <= lastPrice);
  resistanceBelow.forEach((l, i) => { l.label = `R${resistanceAbove.length + i + 1}`; });

  // Support: S1 is closest below price, S2 next, etc.
  const supportBelow = supportLevels
    .filter(l => l.price < lastPrice)
    .sort((a, b) => b.price - a.price);      // closest first
  supportBelow.forEach((l, i) => { l.label = `S${i + 1}`; });

  const supportAbove = supportLevels
    .filter(l => l.price >= lastPrice);
  supportAbove.forEach((l, i) => { l.label = `S${supportBelow.length + i + 1}`; });

  // Re-sort for final output: support asc, resistance desc
  const sortedSupport = [...supportBelow.reverse(), ...supportAbove].sort((a, b) => a.price - b.price);
  const sortedResistance = [...resistanceBelow, ...resistanceAbove].sort((a, b) => b.price - a.price);
  // Now reorder so closest to price comes first in each list
  // Actually let's keep support asc, resistance desc as the spec says.

  // ── 5. Psychological levels ────────────────────────────────────────
  let psychologicalLevels: PriceLevel[] = [];
  if (opts.includePsychological) {
    psychologicalLevels = buildPsychologicalLevels(lastPrice, sortedSupport, sortedResistance);
  }

  // ── 6. Nearest levels & targets ────────────────────────────────────
  const nearestSupport = sortedSupport.length > 0 ? sortedSupport[sortedSupport.length - 1]! : null;
  const nearestResistance = resistanceAbove.length > 0 ? resistanceAbove[0]! : null;

  // Use the properly computed nearest support/resistance for targets
  const nearestS = nearestSupport;
  const nearestR = nearestResistance;

  const upsideTarget = nearestR && lastPrice > 0 ? ((nearestR.price - lastPrice) / lastPrice) * 100 : null;
  const downsideRisk = nearestS && lastPrice > 0 ? ((lastPrice - nearestS.price) / lastPrice) * 100 : null;

  return {
    symbol,
    support: sortedSupport,
    resistance: sortedResistance,
    psychological: psychologicalLevels,
    nearestSupport: nearestS,
    nearestResistance: nearestR,
    upsideTarget: upsideTarget !== null ? Math.round(upsideTarget * 100) / 100 : null,
    downsideRisk: downsideRisk !== null ? Math.round(downsideRisk * 100) / 100 : null,
    timestamp: now,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Pivot detection
// ═══════════════════════════════════════════════════════════════════════

/**
 * Find pivot highs: candles where high is the maximum in the
 * lookback window (N before, N after).
 */
function detectPivotHighs(klines: Kline[], window: number): PivotPoint[] {
  const pivots: PivotPoint[] = [];
  for (let i = window; i < klines.length - window; i++) {
    const current = klines[i]!;
    let isPivot = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (klines[j]!.high >= current.high) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) {
      pivots.push({ price: current.high, index: i, volume: current.volume });
    }
  }
  return pivots;
}

/**
 * Find pivot lows: candles where low is the minimum in the
 * lookback window (N before, N after).
 */
function detectPivotLows(klines: Kline[], window: number): PivotPoint[] {
  const pivots: PivotPoint[] = [];
  for (let i = window; i < klines.length - window; i++) {
    const current = klines[i]!;
    let isPivot = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (klines[j]!.low <= current.low) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) {
      pivots.push({ price: current.low, index: i, volume: current.volume });
    }
  }
  return pivots;
}

// ═══════════════════════════════════════════════════════════════════════
// Clustering
// ═══════════════════════════════════════════════════════════════════════

/**
 * Merge nearby pivot points into volume-weighted clusters.
 * Pivots within `threshold` percent of each other are grouped.
 */
function clusterPivots(pivots: PivotPoint[], threshold: number): PivotCluster[] {
  if (pivots.length === 0) return [];

  // Sort descending so we process highest price first
  const sorted = [...pivots].sort((a, b) => b.price - a.price);

  const clusters: PivotCluster[] = [];

  for (const pivot of sorted) {
    let merged = false;

    for (const cluster of clusters) {
      const diffPct = Math.abs(pivot.price - cluster.price) / cluster.price * 100;
      if (diffPct <= threshold) {
        // Merge: volume-weighted average
        const totalVol = cluster.volume + pivot.volume;
        cluster.price = (cluster.price * cluster.volume + pivot.price * pivot.volume) / totalVol;
        cluster.volume = totalVol;
        cluster.pivots.push(pivot);
        cluster.pivotCount++;
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push({
        price: pivot.price,
        pivots: [pivot],
        volume: pivot.volume,
        pivotCount: 1,
      });
    }
  }

  return clusters;
}

// ═══════════════════════════════════════════════════════════════════════
// Touch counting & strength
// ═══════════════════════════════════════════════════════════════════════

/**
 * Count how many candles' price action touched a level and sum their volume.
 *
 * For resistance: a touch occurs when candle.high is within the band
 *                 around the level (price came up to test it from below).
 * For support:   a touch occurs when candle.low is within the band
 *                 around the level (price came down to test it from above).
 *
 * Also counts the band-intercepted range if the entire candle spans the level.
 */
function countTouches(
  levelPrice: number,
  klines: Kline[],
  type: 'support' | 'resistance',
  threshold: number,   // already decimal, e.g. 0.005 for 0.5%
): { count: number; volume: number } {
  let count = 0;
  let volume = 0;
  const lowerBound = levelPrice * (1 - threshold);
  const upperBound = levelPrice * (1 + threshold);

  for (const k of klines) {
    // Does the candle's price range intersect the level's band?
    const overlaps =
      (k.low <= upperBound && k.high >= lowerBound) ||
      (k.close >= lowerBound && k.close <= upperBound);

    if (!overlaps) continue;

    // Directional filter: for resistance we want price testing from below,
    // for support testing from above. But also count candles that are
    // fully within the band (price sitting at the level).
    let counts;
    if (type === 'resistance') {
      // Price approached from below (high is near level) OR
      // the whole candle is in the band zone
      counts = (k.high >= lowerBound && k.high <= upperBound) ||
               (k.low >= lowerBound && k.high <= upperBound);
    } else {
      // Price approached from above (low is near level) OR
      // the whole candle is in the band zone
      counts = (k.low >= lowerBound && k.low <= upperBound) ||
               (k.low >= lowerBound && k.high <= upperBound);
    }

    if (counts) {
      count++;
      volume += k.volume;
    }
  }

  return { count, volume };
}

/**
 * Calculate level strength 0–1 based on:
 * - Touch count (base score)
 * - Volume confirmation (higher volume at touches = stronger)
 */
function calculateStrength(
  touchCount: number,
  touchVolume: number,
  avgVolume: number,
  minTouches: number,
): number {
  if (touchCount === 0 || avgVolume <= 0) return 0;

  // Touch score: 0–0.6 based on how many touches above minimum
  const touchScore = Math.min((touchCount - minTouches + 1) / 6, 0.6);

  // Volume score: compare average touch volume to overall avg volume
  const avgTouchVolume = touchVolume / touchCount;
  const volumeRatio = avgTouchVolume / avgVolume;
  // Ratio of 1.0 is neutral; >1.2 adds strength, <0.8 subtracts
  const volumeScore = Math.min(Math.max((volumeRatio - 0.8) / 1.5, 0), 0.3);

  // Base floor for any qualifying level
  const base = minTouches > 0 && touchCount >= minTouches ? 0.1 : 0;

  return Math.round(Math.min(base + touchScore + volumeScore, 1.0) * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════════
// Psychological levels
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate psychological round-number levels near the current price.
 * Step size adapts to the price magnitude.
 */
function buildPsychologicalLevels(
  currentPrice: number,
  support: PriceLevel[],
  resistance: PriceLevel[],
): PriceLevel[] {
  const step = getPsychologicalStep(currentPrice);
  const range = step * 5;   // show 5 steps above and below
  const base = Math.floor(currentPrice / step) * step;

  // Collect existing support/resistance prices for dedup
  const existing = new Set<number>();
  for (const l of support) existing.add(l.price);
  for (const l of resistance) existing.add(l.price);

  const levels: PriceLevel[] = [];
  for (let i = -5; i <= 5; i++) {
    const price = base + i * step;
    if (price <= 0) continue;
    if (existing.has(price)) continue;   // already captured by S/R

    // Skip if too far from current price
    if (Math.abs(price - currentPrice) > range) continue;

    const label = price >= 1000
      ? `PSY-${Math.round(price / 1000)}K`
      : price >= 1
        ? `PSY-${Math.round(price)}`
        : `PSY-${price.toPrecision(3)}`;

    levels.push({
      price,
      type: 'psychological',
      strength: 0.3,     // psychological levels are baseline weak
      touchCount: 0,
      label,
    });
  }

  return levels.sort((a, b) => a.price - b.price);
}

/**
 * Determine the step size for psychological levels based on price magnitude.
 */
function getPsychologicalStep(price: number): number {
  if (price >= 100000) return 10000;
  if (price >= 10000) return 1000;
  if (price >= 1000) return 100;
  if (price >= 100) return 10;
  if (price >= 10) return 1;
  if (price >= 1) return 0.5;
  if (price >= 0.1) return 0.1;
  if (price >= 0.01) return 0.01;
  return 0.001;
}

// ═══════════════════════════════════════════════════════════════════════
// Format / display
// ═══════════════════════════════════════════════════════════════════════

/**
 * Render a support/resistance result as a terminal-friendly table.
 */
export function formatSR(result: SupportResistanceResult): string {
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────
  const symbolPart = ` ${result.symbol} `;
  const sep = '━'.repeat(
    Math.max(50, symbolPart.length + 4),
  );
  const pad = Math.floor((sep.length - symbolPart.length) / 2);
  lines.push(sep);
  lines.push('━'.repeat(pad) + symbolPart + '━'.repeat(sep.length - pad - symbolPart.length));
  lines.push(sep);

  if (result.timestamp) {
    lines.push(`  ${result.timestamp.replace('T', ' ').replace(/\.\d+Z/, ' UTC')}`);
    lines.push('');
  }

  // ── Helper: render a row ─────────────────────────────────────────
  const barWidth = 10;

  const fmtPrice = (p: number): string => {
    if (p >= 1000) return p.toFixed(2);
    if (p >= 1) return p.toFixed(4);
    return p.toFixed(6);
  };

  const renderLevel = (l: PriceLevel): string => {
    const label = l.label.padEnd(5);
    const price = fmtPrice(l.price).padStart(12);
    const bar = strengthBar(l.strength, barWidth);
    const pct = `${Math.round(l.strength * 100)}%`.padStart(3);
    const touches = `${l.touchCount} touch${l.touchCount !== 1 ? 'es' : ''}`;
    return `  ${label}  ${price}  ${bar}  ${pct}  ${touches}`;
  };

  // ── Resistance ───────────────────────────────────────────────────
  if (result.resistance.length > 0) {
    lines.push('  RESISTANCE');
    const sorted = [...result.resistance].sort((a, b) => b.price - a.price);
    for (const l of sorted) {
      lines.push(renderLevel(l));
    }
  }

  // ── Current price marker ─────────────────────────────────────────
  const currentPrice = result.nearestSupport
    ? (result.nearestSupport.price + (result.nearestResistance?.price ?? result.nearestSupport.price * 1.02)) / 2
    : result.nearestResistance
      ? result.nearestResistance.price * 0.98
      : 0;

  // Use the computed currentPrice estimate for the marker display.
  if (currentPrice > 0) {
    lines.push(`  ${'─'.repeat(5)} ${fmtPrice(currentPrice)} ← Current ${'─'.repeat(5)}`);
  } else {
    lines.push(`  ${'─'.repeat(18)}`);
  }

  // ── Support ──────────────────────────────────────────────────────
  if (result.support.length > 0) {
    lines.push('  SUPPORT');
    const sorted = [...result.support].sort((a, b) => a.price - b.price);
    for (const l of sorted) {
      lines.push(renderLevel(l));
    }
  }

  // ── Psychological levels ─────────────────────────────────────────
  if (result.psychological.length > 0) {
    lines.push('');
    lines.push('  PSYCHOLOGICAL');
    for (const l of result.psychological) {
      const label = l.label.padEnd(12);
      const price = fmtPrice(l.price).padStart(12);
      lines.push(`  ${label}  ${price}`);
    }
  }

  // ── Footer summary ───────────────────────────────────────────────
  lines.push('');
  const ups = result.upsideTarget !== null ? `+${result.upsideTarget.toFixed(1)}%` : 'n/a';
  const dns = result.downsideRisk !== null ? `-${result.downsideRisk.toFixed(1)}%` : 'n/a';
  lines.push(`  Upside: ${ups}  ·  Downside: ${dns}`);

  const rLabel = result.nearestResistance?.label ?? 'n/a';
  const sLabel = result.nearestSupport?.label ?? 'n/a';
  lines.push(`  To:     ${rLabel}  ·  To: ${sLabel}`);

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────

function strengthBar(strength: number, width: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, strength)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function emptyResult(symbol: string, timestamp: string): SupportResistanceResult {
  return {
    symbol,
    support: [],
    resistance: [],
    psychological: [],
    nearestSupport: null,
    nearestResistance: null,
    upsideTarget: null,
    downsideRisk: null,
    timestamp,
  };
}
