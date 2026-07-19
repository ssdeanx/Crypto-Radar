// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Volume Profile Analysis
// ═══════════════════════════════════════════════════════════════════════
//
// Analyzes volume distribution across price levels (Market Profile style).
// Identifies:
//   - High Volume Nodes (HVN) — price levels with heavy trading = support/resistance
//   - Low Volume Nodes (LVN) — price levels with light trading = potential breakouts
//   - Point of Control (POC) — the price level with the highest volume
//   - Value Area — the price range containing 70% of volume
//
// No external deps — pure math on existing kline data.

import type { Kline } from '../types.js';
import { mean, sum, weightedQuantile } from '../math/index.js';

// ── Types ──

export interface VolumeNode {
  priceLow: number;
  priceHigh: number;
  volume: number;
  volumePercent: number;   // % of total volume
  type: 'hvn' | 'lvn' | 'normal';
}

export interface VolumeProfileResult {
  symbol: string;
  /** Point of Control — price with highest volume */
  poc: number;
  /** Value Area High — top of 70% volume range */
  vah: number;
  /** Value Area Low — bottom of 70% volume range */
  val: number;
  /** All volume nodes, sorted by price */
  nodes: VolumeNode[];
  /** Number of price buckets used */
  bucketCount: number;
  /** Total volume analyzed */
  totalVolume: number;
  timestamp: string;
}

export interface VolumeProfileOptions {
  /** Number of price buckets (default: 24) */
  buckets?: number;
  /** Value area percentage (default: 0.70 = 70%) */
  valueAreaPct?: number;
}

// ── Helpers ──

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(6);
  return n.toFixed(8);
}

// ── Core Algorithm ──

/**
 * Compute volume profile from kline data.
 * Divides price range into buckets, sums volume in each bucket.
 *
 * Algorithm:
 * 1. Find price range (min low to max high) over the lookback period
 * 2. Divide range into N buckets (default 24)
 * 3. For each candle, allocate its volume proportionally across the buckets it spans
 * 4. Sum volume per bucket
 * 5. POC = bucket with highest total volume
 * 6. Value Area = sort buckets by volume descending, add until 70% of total volume reached
 * 7. HVN = buckets with volume > 2× average bucket volume
 * 8. LVN = buckets with volume < 0.5× average bucket volume
 */
export function computeVolumeProfile(
  symbol: string,
  klines: Kline[],
  options: VolumeProfileOptions = {},
): VolumeProfileResult {
  const { buckets = 24, valueAreaPct: rawValueAreaPct = 0.70 } = options;
  const valueAreaPct = clamp(rawValueAreaPct, 0.01, 0.99);
  const n = klines.length;
  if (n === 0) {
    return {
      symbol,
      poc: 0,
      vah: 0,
      val: 0,
      nodes: [],
      bucketCount: buckets,
      totalVolume: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // 1. Find price range
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const k of klines) {
    if (k.low < minPrice) minPrice = k.low;
    if (k.high > maxPrice) maxPrice = k.high;
  }

  // Guard against flat price
  if (maxPrice <= minPrice) {
    // All candles at same price — single bucket
    const totalVol = sum(klines.map(k => k.volume));
    const mid = (minPrice + maxPrice) / 2 || minPrice;
    const node: VolumeNode = {
      priceLow: minPrice,
      priceHigh: maxPrice || minPrice + 1,
      volume: totalVol,
      volumePercent: 100,
      type: 'hvn',
    };
    return {
      symbol,
      poc: mid,
      vah: mid,
      val: mid,
      nodes: [node],
      bucketCount: buckets,
      totalVolume: totalVol,
      timestamp: new Date().toISOString(),
    };
  }

  const priceRange = maxPrice - minPrice;
  const bucketSize = priceRange / buckets;

  // 2. Initialise buckets
  const bucketVolumes = new Array(buckets).fill(0);
  const bucketLows = new Array(buckets).fill(0);
  const bucketHighs = new Array(buckets).fill(0);
  for (let i = 0; i < buckets; i++) {
    bucketLows[i] = minPrice + i * bucketSize;
    bucketHighs[i] = minPrice + (i + 1) * bucketSize;
  }

  // 3. Allocate volume
  for (const k of klines) {
    const candleLow = k.low;
    const candleHigh = k.high;
    const candleVol = k.volume;

    // Find overlapping bucket range
    const firstBucket = Math.max(0, Math.floor((candleLow - minPrice) / bucketSize));
    const lastBucket = Math.min(buckets - 1, Math.floor((candleHigh - minPrice) / bucketSize));

    if (firstBucket === lastBucket) {
      // Candle fits entirely in one bucket
      bucketVolumes[firstBucket] += candleVol;
    } else {
      // Candle spans multiple buckets — distribute proportionally by price overlap
      for (let b = firstBucket; b <= lastBucket; b++) {
        const overlapLow = Math.max(candleLow, bucketLows[b]);
        const overlapHigh = Math.min(candleHigh, bucketHighs[b]);
        const overlap = Math.max(0, overlapHigh - overlapLow);
        const fraction = overlap / (candleHigh - candleLow);
        bucketVolumes[b] += candleVol * fraction;
      }
    }
  }

  // 4. Compute totals & classify
  const totalVolume = sum(bucketVolumes);
  const avgVolume = mean(bucketVolumes);
  const hvnThreshold = avgVolume * 2;
  const lvnThreshold = avgVolume * 0.5;

  // Find POC (highest volume bucket)
  let pocIdx = 0;
  for (let i = 1; i < buckets; i++) {
    if (bucketVolumes[i] > bucketVolumes[pocIdx]) pocIdx = i;
  }

  // Build nodes sorted by price (ascending)
  const nodes: VolumeNode[] = [];
  for (let i = 0; i < buckets; i++) {
    const vol = bucketVolumes[i];
    const volPct = totalVolume > 0 ? (vol / totalVolume) * 100 : 0;
    let type: 'hvn' | 'lvn' | 'normal';
    if (vol > hvnThreshold) type = 'hvn';
    else if (vol < lvnThreshold) type = 'lvn';
    else type = 'normal';
    nodes.push({
      priceLow: bucketLows[i],
      priceHigh: bucketHighs[i],
      volume: vol,
      volumePercent: volPct,
      type,
    });
  }

  // 5. Value Area — volume-weighted quantiles (preserves price continuity)
  const bucketMids = nodes.map(n => (n.priceLow + n.priceHigh) / 2);
  const bucketVols = nodes.map(n => n.volume);
  const lowQ = (1 - valueAreaPct) / 2;
  const highQ = (1 + valueAreaPct) / 2;
  const valVal = weightedQuantile(bucketMids, bucketVols, lowQ);
  const vahVal = weightedQuantile(bucketMids, bucketVols, highQ);

  // POC price = midpoint of the POC bucket
  const poc = (bucketLows[pocIdx] + bucketHighs[pocIdx]) / 2;

  return {
    symbol,
    poc,
    vah: vahVal,
    val: valVal === Infinity ? 0 : valVal,
    nodes,
    bucketCount: buckets,
    totalVolume,
    timestamp: new Date().toISOString(),
  };
}

// ── ASCII Terminal Output ──

/**
 * Format volume profile as ASCII histogram for terminal display.
 */
export function formatVolumeProfile(
  result: VolumeProfileResult,
  width: number = 40,
): string {
  const { symbol, poc, vah, val, nodes, totalVolume, timestamp } = result;
  if (nodes.length === 0) return 'No volume profile data.';

  const maxVol = Math.max(...nodes.map(n => n.volume));
  if (maxVol === 0) return 'All buckets have zero volume.';

  const barChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

  let out = '';
  out += `📊 Volume Profile — ${symbol}\n`;
  out += `${'─'.repeat(width + 20)}\n`;
  out += `POC: ${fmtPrice(poc)}  |  VA: ${fmtPrice(val)} – ${fmtPrice(vah)}\n`;
  out += `Total Vol: ${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n`;
  out += `${'─'.repeat(width + 20)}\n`;

  // Render from high to low (top-down price axis)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    const ratio = node.volume / maxVol;
    const barLen = Math.round(ratio * width);
    const bar = barChars[Math.min(7, Math.floor(ratio * 8))] || ' ';

    // Marker
    let marker = '  ';
    if (node.type === 'hvn') marker = '▰ ';
    else if (node.type === 'lvn') marker = '▱ ';

    const priceLabel = fmtPrice((node.priceLow + node.priceHigh) / 2);
    const volBar = bar.repeat(Math.max(1, barLen));
    const pctStr = node.volumePercent.toFixed(1).padStart(5);

    out += `${marker}${priceLabel.padStart(10)} │${volBar} ${pctStr}%\n`;
  }

  out += `${'─'.repeat(width + 20)}\n`;
  out += `HVN ▰  LVN ▱  POC: ${fmtPrice(poc)}\n`;
  out += `VA: ${fmtPrice(val)} – ${fmtPrice(vah)}  |  ${new Date(timestamp).toLocaleString()}\n`;
  return out;
}

// ── SVG Output ──

/**
 * Format as SVG horizontal histogram.
 *
 * Dark theme, horizontal bars extending left from a vertical center line.
 * POC highlighted in cyan (#22d3ee)
 * HVN in green (#22c55e)
 * LVN in red (#ef4444)
 * Value Area bracket annotation
 */
export function volumeProfileSvg(
  result: VolumeProfileResult,
  width: number = 480,
  height: number = 600,
): string {
  const { symbol, poc, vah, val, nodes, totalVolume, timestamp } = result;
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="Volume Profile — ${escapeXml(symbol)}">
      <rect width="${width}" height="${height}" fill="#0f172a" rx="8"/>
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#64748b" font-family="system-ui, sans-serif" font-size="14">No volume profile data for ${escapeXml(symbol)}</text>
    </svg>`;
  }

  const maxVol = Math.max(...nodes.map(n => n.volume));
  if (maxVol === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="Volume Profile — ${escapeXml(symbol)}">
      <rect width="${width}" height="${height}" fill="#0f172a" rx="8"/>
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#64748b" font-family="system-ui, sans-serif" font-size="14">All buckets zero volume for ${escapeXml(symbol)}</text>
    </svg>`;
  }

  const padding = { top: 48, right: 16, bottom: 40, left: 16 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const barH = plotH / nodes.length;
  const centerX = padding.left + plotW * 0.65; // bars extend left from this line
  const maxBarWidth = centerX - padding.left - 4;

  // SVG parts
  const lines: string[] = [];

  // Opening
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="Volume Profile — ${escapeXml(symbol)}">`);
  lines.push(`<defs>
    <linearGradient id="hvnGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22c55e" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#22c55e" stop-opacity="0.7"/>
    </linearGradient>
    <linearGradient id="lvnGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ef4444" stop-opacity="0.7"/>
    </linearGradient>
    <linearGradient id="pocGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="normGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#64748b" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#64748b" stop-opacity="0.45"/>
    </linearGradient>
  </defs>`);

  // Background
  lines.push(`<rect width="${width}" height="${height}" fill="#0f172a" rx="8"/>`);

  // Title
  lines.push(`<text x="${width / 2}" y="22" text-anchor="middle" fill="#f1f5f9" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700">Volume Profile — ${escapeXml(symbol)}</text>`);

  // Subtitle
  const ts = new Date(timestamp);
  const dateStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  lines.push(`<text x="${width / 2}" y="38" text-anchor="middle" fill="#64748b" font-family="system-ui, sans-serif" font-size="10">${escapeXml(dateStr)}  ·  ${nodes.length} levels  ·  Vol ${formatVolumeCompact(totalVolume)}</text>`);

  // Grid lines (horizontal)
  for (let i = 1; i < 5; i++) {
    const y = padding.top + (i / 5) * plotH;
    lines.push(`<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#1e293b" stroke-width="1"/>`);
  }

  // Center vertical line (POC alignment reference)
  lines.push(`<line x1="${centerX.toFixed(1)}" y1="${padding.top}" x2="${centerX.toFixed(1)}" y2="${(padding.top + plotH).toFixed(1)}" stroke="rgba(34,211,238,0.15)" stroke-width="1" stroke-dasharray="4,3"/>`);

  // Value Area bracket (right side annotation)
  const vaTop = padding.top + plotH - (((vah - nodes[0]!.priceLow) / (nodes[nodes.length - 1]!.priceHigh - nodes[0]!.priceLow)) * plotH);
  const vaBot = padding.top + plotH - (((val - nodes[0]!.priceLow) / (nodes[nodes.length - 1]!.priceHigh - nodes[0]!.priceLow)) * plotH);
  const bracketX = width - padding.right - 2;
  lines.push(`<line x1="${bracketX.toFixed(1)}" y1="${vaTop.toFixed(1)}" x2="${bracketX.toFixed(1)}" y2="${vaBot.toFixed(1)}" stroke="#facc15" stroke-width="2"/>`);
  lines.push(`<line x1="${(bracketX - 4).toFixed(1)}" y1="${vaTop.toFixed(1)}" x2="${bracketX.toFixed(1)}" y2="${vaTop.toFixed(1)}" stroke="#facc15" stroke-width="2"/>`);
  lines.push(`<line x1="${(bracketX - 4).toFixed(1)}" y1="${vaBot.toFixed(1)}" x2="${bracketX.toFixed(1)}" y2="${vaBot.toFixed(1)}" stroke="#facc15" stroke-width="2"/>`);
  lines.push(`<text x="${(bracketX - 8).toFixed(1)}" y="${((vaTop + vaBot) / 2 + 3).toFixed(1)}" text-anchor="end" fill="#facc15" font-family="monospace" font-size="9">VA</text>`);

  // Bars (render from high price to low price)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    const ratio = node.volume / maxVol;
    const barWidth = Math.max(2, ratio * maxBarWidth);

    const y = padding.top + ((nodes.length - 1 - i) / nodes.length) * plotH;
    const x = centerX - barWidth;

    // Pick gradient fill based on type
    let fillUrl: string;
    const midPrice = (node.priceLow + node.priceHigh) / 2;

    // Determine if this node contains the Point of Control (POC)
    const isPoc = node.priceLow <= poc && poc <= node.priceHigh;

    if (isPoc) {
      fillUrl = 'url(#pocGrad)';
    } else if (node.type === 'hvn') {
      fillUrl = 'url(#hvnGrad)';
    } else if (node.type === 'lvn') {
      fillUrl = 'url(#lvnGrad)';
    } else {
      fillUrl = 'url(#normGrad)';
    }

    // Bar
    lines.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(3, barH - 1).toFixed(1)}" rx="1" fill="${fillUrl}">
      <title>${fmtPrice(midPrice)} — Vol: ${formatVolumeCompact(node.volume)} (${node.volumePercent.toFixed(1)}%)${isPoc ? ' [POC]' : ''}</title>
    </rect>`);

    // Price label on the left
    const labelX = Math.max(0, x - 4);
    lines.push(`<text x="${labelX.toFixed(1)}" y="${(y + barH / 2 + 3).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-family="monospace" font-size="8">${fmtPrice(midPrice)}</text>`);
  }

  // POC label on center line
  const pocNodeIdx = nodes.findIndex(n => n.priceLow <= poc && poc <= n.priceHigh);
  if (pocNodeIdx >= 0) {
    const pocY = padding.top + ((nodes.length - 1 - pocNodeIdx) / nodes.length) * plotH;
    lines.push(`<rect x="${(centerX + 4).toFixed(1)}" y="${(pocY + barH / 2 - 8).toFixed(1)}" width="58" height="16" rx="3" fill="#1e293b" stroke="rgba(34,211,238,0.4)"/>`);
    lines.push(`<text x="${(centerX + 8).toFixed(1)}" y="${(pocY + barH / 2 + 3).toFixed(1)}" fill="#22d3ee" font-family="monospace" font-size="9" font-weight="700">POC ${fmtPrice(poc)}</text>`);
  }

  // Legend
  const legendY = height - 12;
  const legendItems = [
    { label: 'POC', color: '#22d3ee', x: padding.left },
    { label: 'HVN', color: '#22c55e', x: padding.left + 80 },
    { label: 'LVN', color: '#ef4444', x: padding.left + 160 },
    { label: 'VA', color: '#facc15', x: padding.left + 240 },
  ];
  for (const item of legendItems) {
    lines.push(`<rect x="${item.x}" y="${(legendY - 7)}" width="8" height="8" rx="1" fill="${item.color}" opacity="0.7"/>`);
    lines.push(`<text x="${(item.x + 11)}" y="${(legendY + 1)}" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="9">${escapeXml(item.label)}</text>`);
  }

  // Watermark
  lines.push(`<text x="${(width - 8)}" y="${legendY}" text-anchor="end" fill="rgba(148,163,184,0.2)" font-family="system-ui, sans-serif" font-size="9">🛰️ Hermes Crypto Radar</text>`);

  lines.push('</svg>');
  return lines.join('\n');
}

// ── Format Helpers ──

function formatVolumeCompact(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toFixed(1);
}
