// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Chart Generation
// ═══════════════════════════════════════════════════════════════════════
//
// SVG charts conforming to 2026 best practices:
//   - Self-contained (no external CSS/JS/deps)
//   - CSS-in-<style> for maintainable styling
//   - <linearGradient> for depth and visual polish
//   - viewBox for responsive scaling
//   - role="img" + aria-label for accessibility
//   - <title> tooltips on data points
//   - Crosshair effects at latest candle
//   - Dark theme (#0f172a bg), cyan/green/red palette
//   - Inter font stack
//   - Branding watermark
//
// Chart types:
//   1. priceSvgChart      — basic line chart with gradient fill
//   2. multiPanelSvgChart — price + RSI dashboard
//   3. candlestickSvgChart — OHLCV candlestick chart with EMA overlays
//
// Shared rendering primitives now live in shared-svg.ts.
// ═══════════════════════════════════════════════════════════════════════

import asciichart from 'asciichart';
import pc from 'picocolors';
import type { Kline } from '../types.js';
import { findSupportResistance } from '../analysis/support-resistance.js';
import { logWarn } from '../core/errors.js';
import type { PriceLevel } from '../analysis/support-resistance.js';
import type {
  ChartLayout,
} from './shared-svg.js';
import {
  escapeXml,
  formatYLabel,
  formatTime,
  getLayout,
  chartStyles,
  chartDefs,
  svgOpen as sharedSvgOpen,
  SVG_CLOSE,
  renderWatermark as sharedRenderWatermark,
  renderTitle as sharedRenderTitle,
  renderYGrid,
  renderXLabels,
  renderMinMaxMarkers,
  renderCrosshair,
  renderVolumeBars,
  calcCandleWidth,
  applyLogScale,
} from './shared-svg.js';

// Re-export for backward compatibility
export type { ChartLayout } from './shared-svg.js';
export { escapeXml, formatYLabel, formatTime, getLayout } from './shared-svg.js';

// ── Terminal ASCII Charts ──

export interface ChartOptions {
  height?: number;
  showLabels?: boolean;
  /** Desired terminal width for downsampling indicator rows (default: 60) */
  width?: number;
  /** Show support/resistance levels below the chart */
  showSR?: boolean;
  /** Period for trend direction analysis (default: 5) */
  trendPeriod?: number;
}

// ── Format helpers ──

/**
 * Format a price value for compact display.
 * Auto-scales: $1.23K, $1.23M, $0.00001234, etc.
 */
function formatPriceCompact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  if (v >= 0.0001) return v.toFixed(6);
  return v.toExponential(2);
}

/**
 * Sample an array down to fit within `maxLen` elements
 * using nearest-neighbor decimation.
 */
function downsample<T>(arr: T[], maxLen: number): T[] {
  if (arr.length <= maxLen || maxLen <= 0) return [...arr];
  const step = arr.length / maxLen;
  const result: T[] = [];
  for (let i = 0; i < maxLen; i++) {
    result.push(arr[Math.min(Math.floor(i * step), arr.length - 1)]!);
  }
  return result;
}

// ── Indicator rows ──

/**
 * Render a colorful volume-bars row using picocolors.
 * Down-sampled to fit the specified width.
 */
function renderVolumeBarsRow(volumes: number[], width: number): string {
  const maxVol = Math.max(...volumes) || 1;
  const sampled = downsample(volumes, width);
  return sampled.map(v => {
    const ratio = v / maxVol;
    if (ratio > 0.8) return pc.cyan('█');
    if (ratio > 0.6) return pc.cyan('▓');
    if (ratio > 0.3) return pc.cyan('▒');
    return pc.dim('░');
  }).join('');
}

/**
 * Render a color-coded RSI indicator row.
 *   Green  █  oversold (≤30)
 *   Yellow ▓  approaching extremes (30-40 / 60-70)
 *   Red    █  overbought (≥70)
 *   Dim    ░  neutral zone
 */
function renderRSIRow(rsiValues: (number | null)[], width: number): string {
  const sampled = downsample(rsiValues, width);
  return sampled.map(r => {
    if (r == null) return ' ';
    if (r >= 80) return pc.red('█');
    if (r >= 70) return pc.red('▓');
    if (r >= 60) return pc.yellow('▒');
    if (r >= 40) return pc.dim('░');
    if (r >= 30) return pc.yellow('▒');
    if (r >= 20) return pc.green('▓');
    return pc.green('█');
  }).join('');
}

/**
 * Render a volume-profile row showing bid/ask imbalance.
 * Uses takerBuyQuoteVol vs total quoteVolume to show buying pressure.
 * C > 75% = strong buying (green), < 25% = strong selling (red).
 */
function renderVolumeProfileRow(
  takerBuyQuoteVols: number[],
  quoteVolumes: number[],
  width: number,
): string {
  const ratios = takerBuyQuoteVols.map((t, i) => {
    const total = quoteVolumes[i] ?? 1;
    return total > 0 ? t / total : 0.5;
  });
  const sampled = downsample(ratios, width);
  return sampled.map(r => {
    if (r > 0.75) return pc.green('█');
    if (r > 0.6) return pc.green('▓');
    if (r > 0.45) return pc.dim('░');
    if (r > 0.25) return pc.red('▓');
    return pc.red('█');
  }).join('');
}

// ── Marker helpers ──

/**
 * Find the min and max value indices in a series.
 */
function findMinMaxIndices(values: number[]): { minIdx: number; maxIdx: number; minVal: number; maxVal: number } {
  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[minIdx]!) minIdx = i;
    if (values[i]! > values[maxIdx]!) maxIdx = i;
  }
  return { minIdx, maxIdx, minVal: values[minIdx]!, maxVal: values[maxIdx]! };
}

/**
 * Compute a simple trend direction string from recent prices.
 */
function computeTrendLine(closes: number[], period: number): string {
  if (closes.length < 2) return '—';
  const lookback = Math.min(period, closes.length);
  const start = closes[closes.length - lookback]!;
  const end = closes[closes.length - 1]!;
  const change = ((end - start) / (start || 1)) * 100;
  const arrow = change > 2 ? pc.green('↑') : change > 0.5 ? pc.green('↗') : change < -2 ? pc.red('↓') : change < -0.5 ? pc.red('↘') : pc.dim('→');
  const sign = change >= 0 ? '+' : '';
  return `${arrow} ${sign}${change.toFixed(1)}%`;
}

/**
 * Render a support/resistance level summary line.
 */
function renderSRSummary(
  closes: number[],
  klines: Kline[],
  symbol: string,
): string {
  if (klines.length < 21) return '';
  try {
    const sr = findSupportResistance(symbol, klines, { maxLevels: 3 });
    if (!sr.nearestSupport && !sr.nearestResistance) return '';
    const parts: string[] = [];
    const support: PriceLevel | null = sr.nearestSupport;
    const resistance: PriceLevel | null = sr.nearestResistance;
    if (support) {
      parts.push(`${pc.green('▲')} ${support.label} ${pc.green(formatPriceCompact(support.price))}`);
    }
    if (resistance) {
      parts.push(`${pc.red('▼')} ${resistance.label} ${pc.red(formatPriceCompact(resistance.price))}`);
    }
    if (parts.length > 0) {
      return `SR  ${parts.join('  │  ')}`;
    }
  } catch (err) {
    logWarn("charts", "Chart rendering error", err);
    // S/R detection may fail on insufficient data
  }
  return '';
}

// ── Existing ASCII chart functions (refactored) ──

/**
 * Generate a terminal sparkline chart for price data.
 * Enhanced with picocolors, volume bars, mini RSI, and optional S/R overlay.
 */
export function priceSparkline(klines: Kline[], opts: ChartOptions = {}): string {
  const closes = klines.map(k => k.close);
  const chartWidth = opts.width ?? 60;
  const height = opts.height ?? 10;

  const chart = asciichart.plot(closes, { height });

  // Color based on overall trend
  const trend = closes.length > 1 && closes[closes.length - 1]! >= closes[0]! ? 'up' : 'down';
  const colorFn = trend === 'up' ? pc.green : pc.red;
  const coloredChart = colorFn(chart);

  // Volume bars row (enhanced)
  const volumes = klines.map(k => k.quoteVolume);
  const volRow = renderVolumeBarsRow(volumes, chartWidth);

  // Color-coded RSI row
  const rsiValues = calculateSeriesRsi(closes, 14);
  const rsiRow = renderRSIRow(rsiValues, chartWidth);

  // Min/max price labels
  const lastPrice = closes[closes.length - 1]!;
  const { minVal, maxVal } = findMinMaxIndices(closes);
  const header = `${pc.yellow('⤒')} ${pc.bold(pc.yellow(formatPriceCompact(maxVal)))}  ${pc.yellow('⤓')} ${pc.bold(pc.yellow(formatPriceCompact(minVal)))}`;

  // Trend line
  const trendLine = computeTrendLine(closes, opts.trendPeriod ?? 5);
  const lastRsi = rsiValues.filter((v): v is number => v != null).pop();
  const rsiStr = lastRsi != null ? `RSI(14) ${lastRsi.toFixed(1)}` : '';

  // Stats line
  const stats = [
    trendLine,
    rsiStr,
    `Latest ${pc.cyan(formatPriceCompact(lastPrice))}`,
  ].filter(Boolean).join('  │  ');

  let result = `${coloredChart}\n`;
  result += `${header}\n`;
  result += `${stats}\n`;
  result += `Vol ${volRow}\n`;
  result += `RSI ${rsiRow}\n`;

  // S/R overlay if requested
  if (opts.showSR) {
    const sr = renderSRSummary(closes, klines, '');
    if (sr) result += `${sr}\n`;
  }

  return result;
}

/**
 * Generate a dual-line sparkline (price + volume).
 * Enhanced with picocolors, volume bars, and stats.
 */
export function dualSparkline(klines: Kline[], opts: ChartOptions = {}): string {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.quoteVolume);
  const chartWidth = opts.width ?? 60;
  const height = opts.height ?? 12;

  const chart = asciichart.plot([closes, volumes], {
    height,
    colors: [
      asciichart.green,
      asciichart.cyan,
    ],
  });

  // Color based on trend
  const trend = closes.length > 1 && closes[closes.length - 1]! >= closes[0]! ? 'up' : 'down';
  const colorFn = trend === 'up' ? pc.green : pc.red;
  const coloredChart = colorFn(chart);

  // Enhanced volume bars row
  const volRow = renderVolumeBarsRow(volumes, chartWidth);

  // RSI row (color-coded)
  const rsiValues = calculateSeriesRsi(closes, 14);
  const rsiRow = renderRSIRow(rsiValues, chartWidth);

  // Latest price + stats
  const lastPrice = closes[closes.length - 1]!;
  const trendLine = computeTrendLine(closes, opts.trendPeriod ?? 5);
  const lastRsi = rsiValues.filter((v): v is number => v != null).pop();
  const rsiStr = lastRsi != null ? `RSI ${lastRsi.toFixed(1)}` : '';

  const stats = [
    trendLine,
    rsiStr,
    `Latest ${pc.cyan(formatPriceCompact(lastPrice))}`,
  ].filter(Boolean).join('  │  ');

  // Min/max
  const { minVal, maxVal } = findMinMaxIndices(closes);
  const header = `${pc.yellow('⤒')} ${formatPriceCompact(maxVal)}  ${pc.yellow('⤓')} ${formatPriceCompact(minVal)}`;

  let result = `${coloredChart}\n`;
  result += `${header}\n`;
  result += `${stats}\n`;
  result += `Vol ${volRow}\n`;
  result += `RSI ${rsiRow}\n`;

  // S/R overlay
  if (opts.showSR) {
    const sr = renderSRSummary(closes, klines, '');
    if (sr) result += `${sr}\n`;
  }

  return result;
}

/**
 * Multi-series chart: price, EMA20, EMA50
 * Enhanced with picocolors, volume bars, color-coded RSI, trendlines, and S/R overlay.
 */
export function multiMaSparkline(klines: Kline[], opts: ChartOptions = {}): string {
  const closes = klines.map(k => k.close);
  const chartWidth = opts.width ?? 60;
  const height = opts.height ?? 12;

  const ema20 = calculateSeriesEma(closes, 20).map(v => v ?? 0);
  const ema50 = calculateSeriesEma(closes, 50).map(v => v ?? 0);

  const chart = asciichart.plot([closes, ema20, ema50], {
    height,
    colors: [
      asciichart.green,
      asciichart.yellow,
      asciichart.red,
    ],
  });

  // Color based on trend
  const trend = closes.length > 1 && closes[closes.length - 1]! >= closes[0]! ? 'up' : 'down';
  const colorFn = trend === 'up' ? pc.green : pc.red;
  const coloredChart = colorFn(chart);

  // Enhanced volume bars row
  const volumes = klines.map(k => k.quoteVolume);
  const volRow = renderVolumeBarsRow(volumes, chartWidth);

  // Color-coded RSI indicator row
  const rsiValues = calculateSeriesRsi(closes, 14);
  const rsiRow = renderRSIRow(rsiValues, chartWidth);

  // Volume profile (bid/ask imbalance)
  const takerBuyVols = klines.map(k => k.takerBuyQuoteVol);
  const vpRow = renderVolumeProfileRow(takerBuyVols, volumes, chartWidth);

  // Min/max
  const lastPrice = closes[closes.length - 1]!;
  const { minVal, maxVal } = findMinMaxIndices(closes);
  const header = `${pc.yellow('⤒')} ${pc.bold(pc.yellow(formatPriceCompact(maxVal)))}  ${pc.yellow('⤓')} ${pc.bold(pc.yellow(formatPriceCompact(minVal)))}`;

  // Trend + stats
  const trendLine = computeTrendLine(closes, opts.trendPeriod ?? 5);
  const lastRsi = rsiValues.filter((v): v is number => v != null).pop();
  const rsiStr = lastRsi != null ? `RSI(14) ${lastRsi.toFixed(1)}` : '';
  const stats = [
    trendLine,
    rsiStr,
    `Latest ${pc.cyan(formatPriceCompact(lastPrice))}`,
  ].filter(Boolean).join('  │  ');

  let result = `${coloredChart}\n`;
  result += `${header}\n`;
  result += `${stats}\n`;
  result += `Vol ${volRow}\n`;
  result += `Bid ${vpRow}\n`;
  result += `RSI ${rsiRow}\n`;

  // S/R overlay
  if (opts.showSR) {
    const sr = renderSRSummary(closes, klines, '');
    if (sr) result += `${sr}\n`;
  }

  return result;
}

// ── Multi-pane ASCII layout ──

export interface MultiPaneOptions {
  /** Whether to show the price chart pane */
  showPrice?: boolean;
  /** Whether to show the volume chart pane */
  showVolume?: boolean;
  /** Whether to show the RSI indicator pane */
  showRSI?: boolean;
  /** Height for each pane (default: 8) */
  paneHeight?: number;
  /** Width for downsampling indicator rows (default: 60) */
  width?: number;
}

/**
 * Generate a multi-pane ASCII terminal layout combining price, volume, and RSI.
 * Each pane is stacked vertically with clear headers and annotations.
 *
 * Layout:
 *   ┌─ Price ─────────────────────────┐
 *   │  [asciichart price sparkline]   │
 *   │  S/R levels, min/max markers    │
 *   ├─ Volume ────────────────────────┤
 *   │  [asciichart volume series]     │
 *   │  Bid/Ask imbalance row          │
 *   ├─ RSI ───────────────────────────┤
 *   │  [color-coded RSI indicator]    │
 *   │  Value + zone label             │
 *   └─────────────────────────────────┘
 */
export function multiPaneAsciiChart(
  klines: Kline[],
  symbol: string,
  opts: MultiPaneOptions = {},
): string {
  const { showPrice = true, showVolume = true, showRSI = true, paneHeight = 8, width = 60 } = opts;
  const lines: string[] = [];
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.quoteVolume);
  const takerBuyVols = klines.map(k => k.takerBuyQuoteVol);
  const rsiValues = calculateSeriesRsi(closes, 14);

  const sep = pc.dim('─').repeat(width + 6);

  // ── Price Pane ──
  if (showPrice && closes.length > 0) {
    const priceChart = asciichart.plot(closes, { height: paneHeight });
    const trend = closes.length > 1 && closes[closes.length - 1]! >= closes[0]! ? 'up' : 'down';
    const colorFn = trend === 'up' ? pc.green : pc.red;
    lines.push(pc.bold(pc.cyan('┌─ Price ')) + pc.dim('─'.repeat(width - 4)));
    lines.push(colorFn(priceChart));
    lines.push('');

    // Min/max markers
    const { minVal, maxVal } = findMinMaxIndices(closes);
    lines.push(`  ${pc.yellow('⤒')} ${pc.bold(pc.yellow(formatPriceCompact(maxVal)))}  ${pc.yellow('⤓')} ${pc.bold(pc.yellow(formatPriceCompact(minVal)))}`);

    // Trend annotation
    const trendLine = computeTrendLine(closes, 5);
    const lastPrice = closes[closes.length - 1]!;
    const latestLabel = `${pc.cyan('◀')} Latest ${pc.bold(pc.cyan(formatPriceCompact(lastPrice)))}`;
    lines.push(`  ${trendLine}  │  ${latestLabel}`);

    // Volume bars row
    const volRow = renderVolumeBarsRow(volumes, width);
    lines.push(`  Vol ${volRow}`);

    // S/R levels
    try {
      const sr = findSupportResistance(symbol, klines, { maxLevels: 3 });
      const srParts: string[] = [];
      if (sr.nearestSupport) {
        srParts.push(`${pc.green('▲')} ${sr.nearestSupport.label} ${pc.green(formatPriceCompact(sr.nearestSupport.price))}`);
      }
      if (sr.nearestResistance) {
        srParts.push(`${pc.red('▼')} ${sr.nearestResistance.label} ${pc.red(formatPriceCompact(sr.nearestResistance.price))}`);
      }
      if (srParts.length > 0) {
        lines.push(`  SR  ${srParts.join('  │  ')}`);
      }
    } catch (err) {
      logWarn("charts", "Chart rendering error", err);
    }

    lines.push(pc.dim(`  ${sep}`));
  }

  // ── Volume Pane ──
  if (showVolume && volumes.length > 0) {
    lines.push(pc.bold(pc.magenta('┌─ Volume ')) + pc.dim('─'.repeat(width - 3)));
    const volChart = asciichart.plot(volumes, { height: paneHeight });
    lines.push(pc.cyan(volChart));
    lines.push('');

    // Bid/Ask imbalance row
    const vpRow = renderVolumeProfileRow(takerBuyVols, volumes, width);
    lines.push(`  Bid/Ask ${vpRow}`);

    // Volume min/max
    const { minVal: vMin, maxVal: vMax } = findMinMaxIndices(volumes);
    lines.push(`  ${pc.yellow('⤒')} ${pc.bold(pc.yellow(formatPriceCompact(vMax)))}  ${pc.yellow('⤓')} ${pc.bold(pc.yellow(formatPriceCompact(vMin)))}`);

    lines.push(pc.dim(`  ${sep}`));
  }

  // ── RSI Pane ──
  if (showRSI) {
    const lastRsi = rsiValues.filter((v): v is number => v != null).pop();
    const rsiValue = lastRsi != null ? lastRsi.toFixed(1) : 'N/A';
    let zoneLabel: string;
    let zoneColor: typeof pc.green;
    if (lastRsi == null) { zoneLabel = '—'; zoneColor = pc.dim; }
    else if (lastRsi >= 70) { zoneLabel = 'Overbought'; zoneColor = pc.red; }
    else if (lastRsi >= 60) { zoneLabel = 'Upper Neutral'; zoneColor = pc.yellow; }
    else if (lastRsi >= 40) { zoneLabel = 'Neutral'; zoneColor = pc.dim; }
    else if (lastRsi >= 30) { zoneLabel = 'Lower Neutral'; zoneColor = pc.yellow; }
    else { zoneLabel = 'Oversold'; zoneColor = pc.green; }

    lines.push(pc.bold(pc.yellow('┌─ RSI(14) ')) + pc.dim('─'.repeat(width - 6)));

    // Full RSI indicator row
    const rsiRow = renderRSIRow(rsiValues, width);
    lines.push(`  ${rsiRow}`);
    lines.push('');

    // RSI value with zone
    lines.push(`  RSI ${pc.bold(zoneColor(rsiValue))}  —  ${zoneColor(zoneLabel)}`);

    // Overbought/Oversold markers
    lines.push(`  ${pc.red('┄'.repeat(Math.round(width * 0.7)))} 70 OB`);
    lines.push(`  ${pc.green('┄'.repeat(Math.round(width * 0.3)))} 30 OS`);

    lines.push(pc.dim(`  ${sep}`));
  }

  return lines.join('\n');
}

// ── Shared Helpers (kept for SVG code compatibility) ──

function calculateSeriesEma(values: number[], period: number): (number | null)[] {
  if (!values || values.length < period) return new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(values.length).fill(null);
  result[period - 1] = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    result[i] = values[i]! * k + (result[i - 1] ?? result[period - 1]!) * (1 - k);
  }
  return result;
}

function calculateSeriesRsi(values: number[], period: number): (number | null)[] {
  if (!values || values.length < period + 1) return new Array(values.length).fill(null);
  const result: (number | null)[] = new Array(values.length).fill(null);
  const changes: number[] = [];
  for (let i = 1; i < values.length; i++) {
    changes.push(values[i]! - values[i - 1]!);
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += Math.max(changes[i]!, 0);
    avgLoss += Math.max(-changes[i]!, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.001))));
  for (let i = period + 1; i < values.length; i++) {
    const change = changes[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.001))));
  }
  return result;
}

// ── Local SVG helpers (keep localized for backward compat) ──

/** Wrapper using shared svgOpen — alias for internal use */
function svgOpen(width: number, height: number, title: string): string {
  // Re-use shared boilerplate, then layer chart-specific style/def extensions
  const base = sharedSvgOpen(width, height, title);
  const extStyles = chartStyles();
  const extDefs = chartDefs();
  // Inject extensions just before the closing of the opening tag block
  return base.replace('</defs>', `${extDefs.replace(/^<defs>|<\/defs>$/g, '')}</defs>`)
             .replace('</style>', `${extStyles.replace(/^<style>|<\/style>$/g, '')}</style>`);
}

/** Render title centered with shared primitive */
function renderTitle(layout: ChartLayout, title: string): string {
  return sharedRenderTitle(layout.width, 20, title);
}

/** Render watermark branding with shared primitive */
function renderWatermark(layout: ChartLayout): string {
  return sharedRenderWatermark(layout.width, layout.height);
}

// ── SVG Chart Generation ──

/**
 * Generate an inline SVG price chart (line chart).
 * Enhanced with gradients, crosshair, tooltips, axis labels, min/max markers, and branding.
 * Supports optional log scale via logScale parameter.
 */
export function priceSvgChart(
  title: string,
  klines: Kline[],
  width = 600,
  height = 300,
  logScale = false,
): string {
  const closes = klines.map(k => k.close);
  const n = closes.length;

  // Division-by-zero guard: early return if no data or single datapoint
  if (n < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><rect width="200" height="40" fill="#0f172a" rx="4"/><text x="100" y="24" text-anchor="middle" fill="#94a3b8" font-family="'Inter', sans-serif" font-size="12">${n === 0 ? 'No data' : 'Insufficient data points'}</text></svg>`;
  }

  // Apply log scale if enabled
  const scaledCloses = logScale ? closes.map(v => applyLogScale(v, true)) : closes;

  const min = Math.min(...scaledCloses);
  const max = Math.max(...scaledCloses);
  const range = max - min || 1;
  const layout = getLayout(width, height);
  const { padding, plotW, plotH } = layout;

  // Generate SVG path data
  const points = scaledCloses.map((v, i) => {
    const x = padding.left + (i / (n - 1)) * plotW;
    const y = padding.top + plotH - ((v - min) / range) * plotH;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathData = points.join(' ');

  // Original min/max for labels
  const origMin = Math.min(...closes);
  const origMax = Math.max(...closes);

  // Tooltip <title> elements on every data point
  let tooltipSvg = '';
  for (let i = 0; i < n; i++) {
    const x = padding.left + (i / (n - 1)) * plotW;
    const y = padding.top + plotH - ((scaledCloses[i]! - min) / range) * plotH;
    tooltipSvg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="data-point">
      <title>${formatTime(klines[i]!.openTime)} — ${formatYLabel(closes[i]!)}${logScale ? ' (log)' : ''}</title>
    </circle>\n`;
  }

  const svg = `${svgOpen(width, height, `Price Chart: ${title}`)}
  ${renderTitle(layout, title)}

  <!-- Grid & Y-axis (show original prices on labels) -->
  ${renderYGrid(layout, origMin, origMax)}

  <!-- Volume bars -->
  ${renderVolumeBars(layout, klines, 20)}

  <!-- Price fill (gradient) -->
  <path d="${pathData} L${(padding.left + plotW).toFixed(1)},${(padding.top + plotH).toFixed(1)} L${padding.left.toFixed(1)},${(padding.top + plotH).toFixed(1)} Z" class="price-fill"/>

  <!-- Price line (gradient) -->
  <path d="${pathData}" class="price-line"/>

  <!-- Tooltips -->
  ${tooltipSvg}

  <!-- Crosshair + labels -->
  ${renderCrosshair(layout, klines, origMin, origMax)}

  <!-- Pulsing latest data point -->
  <circle cx="${(padding.left + plotW).toFixed(1)}" cy="${(padding.top + plotH - ((scaledCloses[n - 1]! - min) / range) * plotH).toFixed(1)}" r="4" class="pulse-dot data-point"/>

  <!-- Frame counter -->
  <text x="6" y="${(height - 8).toFixed(1)}" class="frame-counter">FRM-${Math.floor(Math.random() * 90000 + 10000)}</text>

  <!-- Min/max markers -->
  ${renderMinMaxMarkers(layout, klines, origMin, origMax)}

  <!-- X-axis labels -->
  ${renderXLabels(layout, klines)}

  <!-- Branding -->
  ${renderWatermark(layout)}

${SVG_CLOSE}`;

  return svg;
}

/**
 * Generate a multi-panel SVG dashboard with price + RSI.
 * Panels are perfectly aligned with equal-width axes and no overlapping elements.
 */
export function multiPanelSvgChart(
  title: string,
  klines: Kline[],
  rsiValues: (number | null)[],
  width = 600,
  height = 400,
): string {
  const closes = klines.map(k => k.close);
  const n = klines.length;

  // Division-by-zero guard
  if (n < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><rect width="200" height="40" fill="#0f172a" rx="4"/><text x="100" y="24" text-anchor="middle" fill="#94a3b8" font-family="'Inter', sans-serif" font-size="12">${n === 0 ? 'No data' : 'Insufficient data points'}</text></svg>`;
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  // ── Layout: divide height evenly between price and RSI panels ──
  const panelGap = 24;           // gap between panels (divider + padding)
  const panelH = Math.floor((height - panelGap) / 2);
  const titleH = 20;             // top title area height
  const availPlotH = panelH - titleH;
  const padding = { top: 0, right: 20, bottom: 0, left: 60 };
  const plotW = width - padding.left - padding.right;

  // Price panel
  const pricePad = { top: titleH, right: 20, bottom: 0, left: 60 };
  const pricePlotH = availPlotH - 26; // leave room for x-labels at bottom
  const priceBottom = 26;

  // RSI panel
  const rsiPad = { top: 8, right: 20, bottom: 12, left: 60 };
  const rsiPlotH = availPlotH - rsiPad.top - rsiPad.bottom;
  const rsiPanelTop = titleH + availPlotH + panelGap;

  const priceLayout: ChartLayout = {
    padding: pricePad, width, height,
    plotW,
    plotH: pricePlotH,
  };
  const rsiLayout: ChartLayout = {
    padding: rsiPad, width, height: rsiPlotH,
    plotW,
    plotH: rsiPlotH,
  };

  // ── Price panel: line path ──
  const points = closes.map((v, i) => {
    const x = padding.left + (i / (n - 1)) * plotW;
    const y = pricePad.top + pricePlotH - ((v - min) / range) * pricePlotH;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathData = points.join(' ');

  // Tooltips for price panel
  let priceTooltips = '';
  for (let i = 0; i < n; i++) {
    const x = padding.left + (i / (n - 1)) * plotW;
    const y = pricePad.top + pricePlotH - ((closes[i]! - min) / range) * pricePlotH;
    priceTooltips += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="data-point">
      <title>${formatTime(klines[i]!.openTime)} — ${formatYLabel(closes[i]!)}</title>
    </circle>\n`;
  }

  // ── Price panel grid ──
  let priceGrid = '';
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const yRatio = i / gridLines;
    const y = pricePad.top + pricePlotH * yRatio;
    const val = max - range * yRatio;
    priceGrid += `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" class="grid-line"/>\n`;
    priceGrid += `<text x="${(padding.left - 8).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="grid-label">${formatYLabel(val)}</text>\n`;
  }

  // ── Price crosshair ──
  const lastK = klines[n - 1];
  const crossX = padding.left + plotW;
  const crossY = pricePad.top + pricePlotH - ((lastK?.close ?? min) - min) / range * pricePlotH;
  let priceCrosshair = '';
  if (lastK) {
    const tooltipW = 90;
    const rlx = crossX + 5 + tooltipW > width ? crossX - tooltipW - 5 : crossX + 5;
    const clampedY = Math.max(pricePad.top + 2, Math.min(pricePad.top + pricePlotH - 20, crossY - 10));
    priceCrosshair = `<line x1="${crossX.toFixed(1)}" y1="${(pricePad.top - 5).toFixed(1)}" x2="${crossX.toFixed(1)}" y2="${(pricePad.top + pricePlotH + 5).toFixed(1)}" class="crosshair-line"/>\n` +
      `<rect x="${rlx.toFixed(1)}" y="${clampedY.toFixed(1)}" width="${tooltipW}" height="20" rx="4" class="label-bg"/>\n` +
      `<text x="${(rlx + 5).toFixed(1)}" y="${(clampedY + 13).toFixed(1)}" class="label-text">${formatYLabel(lastK.close)}</text>\n`;
  }

  // ── Price min/max markers ──
  let highest = klines[0]?.high ?? 0, lowest = klines[0]?.low ?? 0;
  for (let i = 1; i < n; i++) {
    if ((klines[i]?.high ?? 0) > highest) { highest = klines[i]!.high; }
    if ((klines[i]?.low ?? Infinity) < lowest) { lowest = klines[i]!.low; }
  }
  const highY = pricePad.top + pricePlotH - ((highest - min) / range) * pricePlotH;
  const lowY = pricePad.top + pricePlotH - ((lowest - min) / range) * pricePlotH;
  let priceMarkers = '';
  const mmClampY = (y: number) => Math.max(pricePad.top + 2, Math.min(pricePad.top + pricePlotH - 18, y - 8));
  priceMarkers += `<line x1="${padding.left}" y1="${highY.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${highY.toFixed(1)}" class="minmax-line"/>\n`;
  priceMarkers += `<rect x="${(padding.left + 4).toFixed(1)}" y="${mmClampY(highY).toFixed(1)}" width="72" height="16" rx="3" fill="#1e293b" stroke="rgba(250,204,21,0.3)"/>\n`;
  priceMarkers += `<text x="${(padding.left + 8).toFixed(1)}" y="${(mmClampY(highY) + 12).toFixed(1)}" class="minmax-text">⬆ ${formatYLabel(highest)}</text>\n`;
  priceMarkers += `<line x1="${padding.left}" y1="${lowY.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${lowY.toFixed(1)}" class="minmax-line"/>\n`;
  priceMarkers += `<rect x="${(padding.left + 4).toFixed(1)}" y="${mmClampY(lowY).toFixed(1)}" width="72" height="16" rx="3" fill="#1e293b" stroke="rgba(250,204,21,0.3)"/>\n`;
  priceMarkers += `<text x="${(padding.left + 8).toFixed(1)}" y="${(mmClampY(lowY) + 12).toFixed(1)}" class="minmax-text">⬇ ${formatYLabel(lowest)}</text>\n`;

  // ── Price volume bars ──
  const volumes = klines.map(k => k.quoteVolume);
  const maxVol = Math.max(...volumes) || 1;
  const volBarMax = 12;
  let volSvg = '';
  for (let i = 0; i < n; i++) {
    const volRatio = volumes[i]! / maxVol;
    const x = padding.left + (i / (n - 1)) * plotW;
    const barH = volRatio * volBarMax;
    const barY = pricePad.top + pricePlotH + 4;
    volSvg += `<rect x="${(x - 1).toFixed(1)}" y="${(barY - barH).toFixed(1)}" width="2" height="${barH.toFixed(1)}" fill="url(#volGrad)">
      <animate attributeName="height" from="0" to="${barH.toFixed(1)}" dur="0.5s" fill="freeze"/>
      <animate attributeName="y" from="${barY}" to="${(barY - barH).toFixed(1)}" dur="0.5s" fill="freeze"/>
    </rect>\n`;
  }

  // ── Price x-axis labels ──
  let priceXLabels = '';
  const xLabelCount = 5;
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / (xLabelCount - 1)))) {
    const x = padding.left + (i / (n - 1)) * plotW;
    const label = formatTime(klines[i]!.openTime);
    priceXLabels += `<text x="${x.toFixed(1)}" y="${(pricePad.top + pricePlotH + priceBottom - 4).toFixed(1)}" text-anchor="middle" class="axis-label">${escapeXml(label)}</text>\n`;
  }

  // ── RSI panel ──
  const rsiMin = 0;
  const rsiMax = 100;

  let rsiPath = '';
  let rsiIdx = 0;
  for (let i = 0; i < n; i++) {
    const rsi = rsiValues[i];
    if (rsi == null) continue;
    const x = rsiLayout.padding.left + (i / (n - 1)) * rsiLayout.plotW;
    const y = rsiPanelTop + rsiPad.top + rsiPlotH - ((rsi - rsiMin) / (rsiMax - rsiMin)) * rsiPlotH;
    rsiPath += `${rsiIdx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    rsiIdx++;
  }

  // Overbought/oversold/mid lines
  const obY = rsiPanelTop + rsiPad.top + rsiPlotH - ((70 - rsiMin) / (rsiMax - rsiMin)) * rsiPlotH;
  const osY = rsiPanelTop + rsiPad.top + rsiPlotH - ((30 - rsiMin) / (rsiMax - rsiMin)) * rsiPlotH;
  const midY = rsiPanelTop + rsiPad.top + rsiPlotH - ((50 - rsiMin) / (rsiMax - rsiMin)) * rsiPlotH;

  // RSI tooltips
  let rsiTooltips = '';
  for (let i = 0; i < n; i++) {
    const rsi = rsiValues[i];
    if (rsi == null) continue;
    const x = rsiLayout.padding.left + (i / (n - 1)) * rsiLayout.plotW;
    const y = rsiPanelTop + rsiPad.top + rsiPlotH - ((rsi - rsiMin) / (rsiMax - rsiMin)) * rsiPlotH;
    rsiTooltips += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="data-point">
      <title>${formatTime(klines[i]!.openTime)} — RSI: ${rsi.toFixed(1)}</title>
    </circle>\n`;
  }

  // RSI crosshair
  const lastRsi = rsiValues.filter((v): v is number => v != null).pop();
  let rsiCrosshair = '';
  if (lastRsi != null) {
    const rsiCrossY = rsiPanelTop + rsiPad.top + rsiPlotH - ((lastRsi - rsiMin) / (rsiMax - rsiMin)) * rsiPlotH;
    const rsiCrossX = rsiLayout.padding.left + rsiLayout.plotW;
    const rlx = rsiCrossX + 5 + 60 > width ? rsiCrossX - 60 - 5 : rsiCrossX + 5;
    const clampedY = Math.max(rsiPanelTop + rsiPad.top + 2, Math.min(rsiPanelTop + rsiPad.top + rsiPlotH - 18, rsiCrossY - 10));
    rsiCrosshair = `<line x1="${rsiCrossX.toFixed(1)}" y1="${(rsiPanelTop + rsiPad.top - 5).toFixed(1)}" x2="${rsiCrossX.toFixed(1)}" y2="${(rsiPanelTop + rsiPad.top + rsiPlotH + 5).toFixed(1)}" class="crosshair-line"/>\n`;
    rsiCrosshair += `<rect x="${rlx.toFixed(1)}" y="${clampedY.toFixed(1)}" width="60" height="18" rx="4" class="label-bg"/>\n`;
    rsiCrosshair += `<text x="${(rlx + 5).toFixed(1)}" y="${(clampedY + 12).toFixed(1)}" class="label-text">RSI ${lastRsi.toFixed(1)}</text>\n`;
  }

  // RSI grid
  let rsiGrid = '';
  for (let v = 0; v <= 100; v += 10) {
    const y = rsiPanelTop + rsiPad.top + rsiPlotH - ((v - rsiMin) / (rsiMax - rsiMin)) * rsiPlotH;
    rsiGrid += `<line x1="${rsiLayout.padding.left}" y1="${y.toFixed(1)}" x2="${(width - rsiLayout.padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#1e293b" stroke-width="${v === 50 ? 0.5 : 0.3}"/>\n`;
    if (v > 0 && v < 100) {
      rsiGrid += `<text x="${(rsiLayout.padding.left - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="grid-label">${v}</text>\n`;
    }
  }

  const svg = `${svgOpen(width, height, `Dashboard: ${title}`)}
  ${renderTitle({ ...priceLayout, width, height: pricePlotH }, title)}

  <!-- ==================== PRICE PANEL ==================== -->
  <g>
    <!-- Panel bg -->
    <rect x="${padding.left}" y="${pricePad.top}" width="${plotW}" height="${pricePlotH}" fill="rgba(255,255,255,0.01)" rx="2"/>

    <!-- Grid & Y-axis -->
    ${priceGrid}

    <!-- Price fill (gradient) -->
    <path d="${pathData} L${(padding.left + plotW).toFixed(1)},${(pricePad.top + pricePlotH).toFixed(1)} L${padding.left.toFixed(1)},${(pricePad.top + pricePlotH).toFixed(1)} Z" class="price-fill"/>

    <!-- Price line -->
    <path d="${pathData}" class="price-line"/>

    <!-- Tooltips -->
    ${priceTooltips}

    <!-- Crosshair -->
    ${priceCrosshair}

    <!-- Volume bars -->
    ${volSvg}

    <!-- Min/max markers -->
    ${priceMarkers}

    <!-- X-axis labels -->
    ${priceXLabels}
  </g>

  <!-- ==================== RSI PANEL ==================== -->
  <g>
    <!-- Divider -->
    <line x1="${rsiLayout.padding.left}" y1="${rsiPanelTop - panelGap / 2}" x2="${(width - rsiLayout.padding.right)}" y2="${rsiPanelTop - panelGap / 2}" stroke="#334155" stroke-width="1"/>

    <!-- Panel bg -->
    <rect x="${rsiLayout.padding.left}" y="${(rsiPanelTop + rsiPad.top)}" width="${rsiLayout.plotW}" height="${rsiPlotH}" fill="rgba(255,255,255,0.01)" rx="2"/>

    <!-- RSI Grid -->
    ${rsiGrid}

    <!-- Overbought line (70) -->
    <line x1="${rsiLayout.padding.left}" y1="${obY.toFixed(1)}" x2="${(width - rsiLayout.padding.right).toFixed(1)}" y2="${obY.toFixed(1)}" class="rsi-ob"/>
    <text x="${(width - rsiLayout.padding.right - 5).toFixed(1)}" y="${(obY + 3).toFixed(1)}" text-anchor="end" class="rsi-label" fill="rgba(239,68,68,0.6)">70</text>

    <!-- Oversold line (30) -->
    <line x1="${rsiLayout.padding.left}" y1="${osY.toFixed(1)}" x2="${(width - rsiLayout.padding.right).toFixed(1)}" y2="${osY.toFixed(1)}" class="rsi-os"/>
    <text x="${(width - rsiLayout.padding.right - 5).toFixed(1)}" y="${(osY + 3).toFixed(1)}" text-anchor="end" class="rsi-label" fill="rgba(34,197,94,0.6)">30</text>

    <!-- Mid line (50) -->
    <line x1="${rsiLayout.padding.left}" y1="${midY.toFixed(1)}" x2="${(width - rsiLayout.padding.right).toFixed(1)}" y2="${midY.toFixed(1)}" class="rsi-bound"/>

    <!-- RSI line -->
    <path d="${rsiPath}" class="rsi-line"/>

    <!-- RSI tooltips -->
    ${rsiTooltips}

    <!-- RSI crosshair -->
    ${rsiCrosshair}

    <!-- Pulsing latest data point -->
    ${lastRsi != null ? `<circle cx="${(rsiLayout.padding.left + rsiLayout.plotW).toFixed(1)}" cy="${(rsiPanelTop + rsiPad.top + rsiPlotH - ((lastRsi - rsiMin) / (rsiMax - rsiMin)) * rsiPlotH).toFixed(1)}" r="4" class="pulse-dot data-point"/>` : ''}

    <!-- Label -->
    <text x="${rsiLayout.padding.left.toFixed(1)}" y="${(rsiPanelTop + rsiPad.top + rsiPlotH + rsiPad.bottom - 6).toFixed(1)}" class="rsi-label">RSI (14)</text>
  </g>

  <!-- Watermark (single, bottom-right of full chart) -->
  <text x="${(width - 12).toFixed(1)}" y="${(height - 8).toFixed(1)}" text-anchor="end" class="watermark">🛰️ Hermes Crypto Radar</text>

  <!-- Frame counter -->
  <text x="6" y="${(height - 8).toFixed(1)}" class="frame-counter">FRM-${Math.floor(Math.random() * 90000 + 10000)}</text>

${SVG_CLOSE}`;

  return svg;
}

// ── Candlestick Chart ──

/**
 * Generate an inline SVG candlestick chart with volume and EMA overlays.
 * Candlesticks: green body with wick for up candles, red for down.
 * EMA20 (amber), EMA50 (purple) overlay lines.
 *
 * Uses responsive candle width calculation that adapts to the number of candles.
 */
export function candlestickSvgChart(
  title: string,
  klines: Kline[],
  width = 700,
  height = 400,
  volumeProfile?: {
    poc: number;
    vah: number;
    val: number;
    nodes: Array<{ priceLow: number; priceHigh: number; volumePercent: number; type: string }>;
  },
): string {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const n = klines.length;

  // Division-by-zero guard
  if (n < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><rect width="200" height="40" fill="#0f172a" rx="4"/><text x="100" y="24" text-anchor="middle" fill="#94a3b8" font-family="'Inter', sans-serif" font-size="12">${n === 0 ? 'No data' : 'Insufficient data points'}</text></svg>`;
  }

  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;
  const layout = getLayout(width, height);
  // Adjust right padding for volume profile panel
  if (volumeProfile) {
    layout.padding.right = 100;
    layout.plotW = width - layout.padding.left - layout.padding.right;
  }
  const { padding, plotW, plotH } = layout;

  // ── Responsive candle width ──
  const candleWidth = calcCandleWidth(plotW, n);

  let candleSvg = '';
  let volSvg = '';
  const volumes = klines.map(k => k.volume);
  const maxVol = Math.max(...volumes) || 1;
  const volBarMax = 40;

  for (let i = 0; i < n; i++) {
    const k = klines[i]!;
    const isUp = k.close >= k.open;

    const x = padding.left + (i / (n - 1)) * plotW;
    const openY = padding.top + plotH - ((k.open - min) / range) * plotH;
    const closeY = padding.top + plotH - ((k.close - min) / range) * plotH;
    const highY = padding.top + plotH - ((k.high - min) / range) * plotH;
    const lowY = padding.top + plotH - ((k.low - min) / range) * plotH;

    // Wick (high-low line)
    const wickX = x.toFixed(1);
    const wickClass = isUp ? 'wick-up' : 'wick-down';
    candleSvg += `<line x1="${wickX}" y1="${highY.toFixed(1)}" x2="${wickX}" y2="${lowY.toFixed(1)}" class="${wickClass}"/>\n`;

    // Body (open-close rect)
    const bodyTop = isUp ? closeY : openY;
    const bodyBottom = isUp ? openY : closeY;
    const bodyH = Math.max(1, bodyBottom - bodyTop);
    const candleClass = isUp ? 'candle-up' : 'candle-down';

    candleSvg += `<rect x="${(x - candleWidth / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${bodyH.toFixed(1)}" class="${candleClass}${i === n - 1 ? ' latest-candle' : ''}">${i === n - 1 ? `<animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze"/>` : ''}</rect>\n`;

    // Tooltip
    candleSvg += `<rect x="${(x - candleWidth / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="transparent" style="pointer-events:visible">
      <title>${formatTime(k.openTime)}
O: ${formatYLabel(k.open)}
H: ${formatYLabel(k.high)}
L: ${formatYLabel(k.low)}
C: ${formatYLabel(k.close)}
Vol: ${(k.volume / 1).toFixed(1)}</title>
    </rect>\n`;

    // Volume bar (matching candle color)
    const volRatio = volumes[i]! / maxVol;
    const barH = volRatio * volBarMax;
    const barY = height - padding.bottom + 5;
    const volClass = isUp ? 'vol-bar-up' : 'vol-bar-down';
    volSvg += `<rect x="${(x - 1).toFixed(1)}" y="${(barY - barH).toFixed(1)}" width="2" height="${barH.toFixed(1)}" class="${volClass}">
      <animate attributeName="height" from="0" to="${barH.toFixed(1)}" dur="0.5s" fill="freeze"/>
      <animate attributeName="y" from="${barY}" to="${(barY - barH).toFixed(1)}" dur="0.5s" fill="freeze"/>
    </rect>\n`;
  }

  // ── EMA overlays ──
  const ema20 = calculateSeriesEma(closes, 20);
  const ema50 = calculateSeriesEma(closes, 50);

  function emaPath(ema: (number | null)[]): string | null {
    let start = -1;
    for (let i = 0; i < ema.length; i++) {
      if (ema[i] != null) { start = i; break; }
    }
    if (start === -1) return null;
    const pts: string[] = [];
    for (let i = start; i < ema.length; i++) {
      const v = ema[i]!;
      const x = padding.left + (i / (n - 1)) * plotW;
      const y = padding.top + plotH - ((v - min) / range) * plotH;
      pts.push(`${i === start ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' ');
  }

  const ema20Path = emaPath(ema20);
  const ema50Path = emaPath(ema50);

  // ── Crosshair ──
  const lastClose = closes[n - 1] ?? 0;
  const crossX = padding.left + plotW;
  const crossY = padding.top + plotH - ((lastClose - min) / range) * plotH;

  // ── EMA Legend ──
  const legendSvg = `<rect x="${(padding.left + 4).toFixed(1)}" y="${(padding.top + 4).toFixed(1)}" width="120" height="48" rx="4" fill="rgba(15,23,42,0.85)" stroke="rgba(148,163,184,0.15)"/>
  <line x1="${(padding.left + 10).toFixed(1)}" y1="${(padding.top + 16).toFixed(1)}" x2="${(padding.left + 26).toFixed(1)}" y2="${(padding.top + 16).toFixed(1)}" stroke="#f59e0b" stroke-width="1.5"/>
  <text x="${(padding.left + 30).toFixed(1)}" y="${(padding.top + 19).toFixed(1)}" fill="#f59e0b" font-family="'Inter', monospace" font-size="9">EMA20</text>
  <line x1="${(padding.left + 10).toFixed(1)}" y1="${(padding.top + 32).toFixed(1)}" x2="${(padding.left + 26).toFixed(1)}" y2="${(padding.top + 32).toFixed(1)}" stroke="#8b5cf6" stroke-width="1.5"/>
  <text x="${(padding.left + 30).toFixed(1)}" y="${(padding.top + 35).toFixed(1)}" fill="#8b5cf6" font-family="'Inter', monospace" font-size="9">EMA50</text>
  <rect x="${(padding.left + 10).toFixed(1)}" y="${(padding.top + 38).toFixed(1)}" width="16" height="8" rx="1" fill="rgba(34,197,94,0.7)" stroke="#22c55e"/>
  <text x="${(padding.left + 30).toFixed(1)}" y="${(padding.top + 49).toFixed(1)}" fill="#22c55e" font-family="'Inter', monospace" font-size="9">Price</text>`;

  // ── Volume Profile overlay ──
  let vpSvg = '';
  if (volumeProfile) {
    const vpLeft = padding.left + plotW + 4;
    const vpRight = width - 5;
    const vpWidth = vpRight - vpLeft;

    // Background panel
    vpSvg += `<rect x="${vpLeft.toFixed(1)}" y="${padding.top.toFixed(1)}" width="${vpWidth.toFixed(1)}" height="${plotH.toFixed(1)}" fill="rgba(15,23,42,0.6)" rx="2"/>\n`;

    // Value Area highlight (VAH to VAL)
    const valY = padding.top + plotH - ((volumeProfile.val - min) / range) * plotH;
    const vahY = padding.top + plotH - ((volumeProfile.vah - min) / range) * plotH;
    vpSvg += `<rect x="${vpLeft.toFixed(1)}" y="${valY.toFixed(1)}" width="${vpWidth.toFixed(1)}" height="${Math.max(1, vahY - valY).toFixed(1)}" class="vp-va-area"/>\n`;

    // Volume nodes as horizontal bars
    for (const node of volumeProfile.nodes) {
      const yTop = padding.top + plotH - ((node.priceHigh - min) / range) * plotH;
      const yBot = padding.top + plotH - ((node.priceLow - min) / range) * plotH;
      const barY = yBot;
      const barH_n = Math.max(1, yTop - yBot);
      const barW_n = (node.volumePercent / 100) * vpWidth;

      let barClass = 'vp-bar-normal';
      if (node.type === 'hvn') barClass = 'vp-bar-hvn';
      else if (node.type === 'lvn') barClass = 'vp-bar-lvn';

      vpSvg += `<rect x="${vpLeft.toFixed(1)}" y="${barY.toFixed(1)}" width="${Math.max(1, barW_n).toFixed(1)}" height="${barH_n.toFixed(1)}" class="${barClass}" />\n`;
    }

    // POC line — cyan dashed
    const pocY = padding.top + plotH - ((volumeProfile.poc - min) / range) * plotH;
    vpSvg += `<line x1="${vpLeft.toFixed(1)}" y1="${pocY.toFixed(1)}" x2="${vpRight.toFixed(1)}" y2="${pocY.toFixed(1)}" class="vp-poc-line"/>\n`;
    vpSvg += `<text x="${(vpLeft + 2).toFixed(1)}" y="${(pocY - 3).toFixed(1)}" class="vp-poc-label">POC ${formatYLabel(volumeProfile.poc)}</text>\n`;

    // VAH / VAL labels
    vpSvg += `<text x="${(vpLeft + 2).toFixed(1)}" y="${(vahY + 11).toFixed(1)}" class="vp-label">VAH</text>\n`;
    vpSvg += `<text x="${(vpLeft + 2).toFixed(1)}" y="${(valY - 3).toFixed(1)}" class="vp-label">VAL</text>\n`;

    // Volume Profile title
    vpSvg += `<text x="${(vpLeft + vpWidth / 2).toFixed(1)}" y="${(padding.top + 12).toFixed(1)}" text-anchor="middle" fill="#64748b" font-family="'Inter', sans-serif" font-size="9">VP</text>\n`;
  }

  const svg = `${svgOpen(width, height, `Candlestick Chart: ${title}`)}
  ${renderTitle(layout, title)}

  <!-- Grid & Y-axis -->
  ${renderYGrid(layout, min, max)}

  <!-- Candlestick bodies & wicks -->
  ${candleSvg}

  <!-- Volume bars -->
  ${volSvg}

  <!-- EMA20 overlay -->
  ${ema20Path ? `<path d="${ema20Path}" class="ema20-line"/>` : ''}

  <!-- EMA50 overlay -->
  ${ema50Path ? `<path d="${ema50Path}" class="ema50-line"/>` : ''}

  <!-- Crosshair at latest candle -->
  <line x1="${crossX.toFixed(1)}" y1="${(padding.top - 5).toFixed(1)}" x2="${crossX.toFixed(1)}" y2="${(padding.top + plotH + 5).toFixed(1)}" class="crosshair-line"/>
  <rect x="${(crossX + 5).toFixed(1)}" y="${(crossY - 10).toFixed(1)}" width="90" height="20" rx="4" class="label-bg"/>
  <text x="${(crossX + 10).toFixed(1)}" y="${(crossY + 3).toFixed(1)}" class="label-text">${formatYLabel(lastClose)}</text>
  <rect x="${(padding.left - 5).toFixed(1)}" y="${(crossY - 10).toFixed(1)}" width="100" height="20" rx="4" class="label-bg"/>
  <text x="${padding.left.toFixed(1)}" y="${(crossY + 3).toFixed(1)}" class="label-text">${formatTime(klines[n - 1]?.openTime ?? 0)}</text>

  <!-- Pulsing latest data point -->
  <circle cx="${crossX.toFixed(1)}" cy="${crossY.toFixed(1)}" r="4" class="pulse-dot data-point"/>

  <!-- Frame counter -->
  <text x="6" y="${(height - 8).toFixed(1)}" class="frame-counter">FRM-${Math.floor(Math.random() * 90000 + 10000)}</text>

  <!-- Min/max markers -->
  ${renderMinMaxMarkers(layout, klines, min, max)}

  <!-- X-axis labels -->
  ${renderXLabels(layout, klines)}

  <!-- EMA Legend -->
  ${legendSvg}

  <!-- Volume Profile -->
  ${vpSvg}

  <!-- Branding -->
  ${renderWatermark(layout)}

${SVG_CLOSE}`;

  return svg;
}

// ── Comparison Chart (multi-token overlay) ──

/**
 * Generate an SVG chart overlaying multiple token price series.
 * Each token gets a different colored line.
 * Prices are normalized to percentage change from start for fair comparison.
 * Dark theme matching existing charts. Y-axis shows percentage change (0% at center).
 * Now includes timestamps instead of #1, #2, ... labels.
 */
export function comparisonSvgChart(
  title: string,
  priceMap: Map<string, number[]>, // symbol → close prices
  symbols: string[],               // ordered list to display
  width = 700,
  height = 400,
  timestamps?: number[],           // optional timestamps for x-axis labels
): string {
  const n = symbols.length;
  if (n === 0 || priceMap.size === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><rect width="200" height="40" fill="#0f172a" rx="4"/><text x="100" y="24" text-anchor="middle" fill="#94a3b8" font-family="\'Inter\', sans-serif" font-size="12">No data</text></svg>';
  }

  // Color palette for tokens — high contrast, colorblind-safe
  const palette = ['#06b6d4', '#f59e0b', '#c084fc', '#34d399', '#fb923c', '#fb7185', '#2dd4bf', '#eab308'];
  const lineColors = new Map<string, string>();
  symbols.forEach((s, i) => lineColors.set(s, palette[i % palette.length]!));

  // Normalize each series to percentage change from first value
  const normalizedMap = new Map<string, number[]>();
  let globalMin = 0;
  let globalMax = 0;

  for (const sym of symbols) {
    const prices = priceMap.get(sym);
    if (!prices || prices.length < 2) continue;
    const base = prices[0]!;
    if (base === 0) continue;
    const pctChanges = prices.map(p => ((p - base) / base) * 100);
    normalizedMap.set(sym, pctChanges);
    const seriesMin = Math.min(...pctChanges);
    const seriesMax = Math.max(...pctChanges);
    if (seriesMin < globalMin) globalMin = seriesMin;
    if (seriesMax > globalMax) globalMax = seriesMax;
  }

  if (normalizedMap.size === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><rect width="200" height="40" fill="#0f172a" rx="4"/><text x="100" y="24" text-anchor="middle" fill="#94a3b8" font-family="\'Inter\', sans-serif" font-size="12">No valid data</text></svg>';
  }

  // Expand range to at least ±5% and round to nice grid values
  const absMax = Math.max(Math.abs(globalMin), Math.abs(globalMax), 5);
  const chartMax = Math.ceil(absMax / 5) * 5;

  // Use consistent layout matching other chart types
  const layout = getLayout(width, height);
  const { padding, plotW, plotH } = layout;

  const yRange = chartMax * 2; // from -chartMax to +chartMax
  const centerY = padding.top + plotH / 2;

  // For each series, compute max data points for x-spacing
  let maxPoints = 0;
  const pathMap = new Map<string, string>();
  const hoverDotsMap = new Map<string, string>();

  for (const sym of symbols) {
    const pctChanges = normalizedMap.get(sym);
    if (!pctChanges || pctChanges.length < 2) continue;
    const seriesLen = pctChanges.length;
    if (seriesLen > maxPoints) maxPoints = seriesLen;
  }

  if (maxPoints < 2) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><rect width="200" height="40" fill="#0f172a" rx="4"/><text x="100" y="24" text-anchor="middle" fill="#94a3b8" font-family="\'Inter\', sans-serif" font-size="12">Insufficient data</text></svg>';
  }

  for (const sym of symbols) {
    const pctChanges = normalizedMap.get(sym);
    if (!pctChanges || pctChanges.length < 2) continue;
    const seriesLen = pctChanges.length;

    let path = '';
    let hoverDots = '';
    for (let i = 0; i < seriesLen; i++) {
      const x = padding.left + (i / Math.max(1, maxPoints - 1)) * plotW;
      const y = centerY - (pctChanges[i]! / yRange) * plotH;
      path += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      hoverDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="data-point" style="pointer-events:visible">
        <title>${escapeXml(sym)}: ${pctChanges[i]!.toFixed(2)}%</title>
      </circle>\n`;
    }

    pathMap.set(sym, path);
    hoverDotsMap.set(sym, hoverDots);
  }

  // ── Y-axis: percentage change grid ──
  let yGridSvg = '';
  const gridLevels: number[] = [];
  for (let v = -chartMax; v <= chartMax; v += 5) {
    gridLevels.push(v);
  }
  if (gridLevels[gridLevels.length - 1] !== chartMax) gridLevels.push(chartMax);

  for (const v of gridLevels) {
    const y = centerY - (v / yRange) * plotH;
    const isCenter = v === 0;
    const cls = isCenter ? 'comp-grid-line-zero' : 'comp-grid-line';
    yGridSvg += `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" class="${cls}"/>\n`;
    yGridSvg += `<text x="${(padding.left - 8).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="comp-grid-label">${v >= 0 ? '+' : ''}${v}%</text>\n`;
  }

  // ── Legend (top-right corner, dynamic width based on longest label) ──
  const maxLabelLen = Math.max(...symbols.map(s => s.length), 4);
  const legendItemH = 18;
  const legendPad = 6;
  const legendW = Math.max(80, maxLabelLen * 7 + 32);
  const legendH_val = n * legendItemH + legendPad * 2;
  const legendRightX = width - padding.right;
  let legendSvg = `<rect x="${(legendRightX - legendW - 4).toFixed(1)}" y="${(padding.top + 4).toFixed(1)}" width="${legendW}" height="${legendH_val}" rx="4" fill="rgba(15,23,42,0.85)" stroke="rgba(148,163,184,0.15)"/>\n`;
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]!;
    const color = lineColors.get(sym) ?? '#22d3ee';
    const ly = padding.top + 4 + legendPad + i * legendItemH;
    const lx = legendRightX - legendW - 4;
    legendSvg += `<line x1="${(lx + 8).toFixed(1)}" y1="${(ly + 7).toFixed(1)}" x2="${(lx + 22).toFixed(1)}" y2="${(ly + 7).toFixed(1)}" stroke="${color}" stroke-width="2"/>\n`;
    legendSvg += `<text x="${(lx + 26).toFixed(1)}" y="${(ly + 10).toFixed(1)}" class="comp-legend-text">${escapeXml(sym)}</text>\n`;
  }

  // ── X-axis labels (using timestamps if available) ──
  let xLabelsSvg = '';
  const xLabelCount = 5;
  for (let i = 0; i <= xLabelCount; i++) {
    const x = padding.left + (i / xLabelCount) * plotW;
    const idx = Math.round((i / xLabelCount) * (maxPoints - 1));
    let labelText: string;
    if (timestamps && timestamps.length > idx) {
      labelText = formatTime(timestamps[idx]!);
    } else {
      // Use index-based label as fallback
      labelText = `#${idx + 1}`;
    }
    xLabelsSvg += `<text x="${x.toFixed(1)}" y="${(height - padding.bottom + 18).toFixed(1)}" text-anchor="${i === 0 ? 'start' : (i === xLabelCount ? 'end' : 'middle')}" class="axis-label">${escapeXml(labelText)}</text>\n`;
  }

  // ── Zero center label ──
  const zeroLabelHtml = `<text x="${(width - padding.right - 4).toFixed(1)}" y="${(centerY + 3.5).toFixed(1)}" text-anchor="end" class="comp-grid-label">0%</text>`;

  const svg = `${svgOpen(width, height, `Comparison Chart: ${title}`)}
  ${renderTitle(layout, title)}

  <!-- Percentage grid -->
  ${yGridSvg}
  ${zeroLabelHtml}

  <!-- Price lines (normalized) + end-of-line labels + glow -->
  ${symbols.map(sym => {
    const path = pathMap.get(sym);
    const color = lineColors.get(sym) ?? '#22d3ee';
    if (!path) return '';
    const pctChanges = normalizedMap.get(sym);
    const lastVal = pctChanges?.[pctChanges.length - 1] ?? 0;
    const lastX = padding.left + plotW;
    const lastY = centerY - ((pctChanges?.[pctChanges.length - 1] ?? 0) / yRange) * plotH;
    const pctSign = lastVal >= 0 ? '+' : '';
    return `${path ? `<path d="${path}" class="comp-line" stroke="${color}" filter="url(#lineGlow)"/>` : ''}
    <rect x="${(lastX + 4).toFixed(1)}" y="${(lastY - 7).toFixed(1)}" width="50" height="14" rx="3" fill="rgba(15,23,42,0.85)" stroke="${color}" stroke-width="0.5"/>
    <text x="${(lastX + 8).toFixed(1)}" y="${(lastY + 3).toFixed(1)}" fill="${color}" font-family="'Inter', monospace" font-size="9" font-weight="700">${pctSign}${lastVal.toFixed(1)}%</text>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" class="pulse-dot data-point" fill="${color}"/>`;
  }).filter(Boolean).join('\n')}

  <!-- Hover tooltips -->
  ${symbols.map(sym => hoverDotsMap.get(sym) ?? '').join('\n')}

  <!-- Legend -->
  ${legendSvg}

  <!-- X-axis (timestamps) -->
  ${xLabelsSvg}

  <!-- Branding -->
  ${renderWatermark(layout)}

  <!-- Frame counter -->
  <text x="6" y="${(height - 8).toFixed(1)}" class="frame-counter">FRM-${Math.floor(Math.random() * 90000 + 10000)}</text>

${SVG_CLOSE}`;

  return svg;
}
