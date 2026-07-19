// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Shared SVG Primitives
// ═══════════════════════════════════════════════════════════════════════
//
// Single source of truth for SVG rendering utilities used across all
// chart generators. Eliminates code duplication and ensures consistent
// visual quality across price charts, advanced charts, and dashboards.
// ═══════════════════════════════════════════════════════════════════════

import type { Kline } from '../types.js';

// ── Constants ──

export const BG = '#0f172a';
export const TEXT = '#f1f5f9';
export const ACCENT = '#22d3ee';
export const SUBTLE = '#64748b';
export const MUTED = '#1e293b';
export const GRID_LINE = '#1e293b';

// ── Type ──

export interface ChartLayout {
  padding: { top: number; right: number; bottom: number; left: number };
  width: number;
  height: number;
  plotW: number;
  plotH: number;
}

// ── String Utilities ──

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtDollar(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(6)}`;
}

export function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function shortPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function formatYLabel(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(6)}`;
}

/** Clamp v to [min, max] */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ── Color Utilities ──

/**
 * Interpolate between two hex colors.
 * Each color is a 6-char hex string with optional '#' prefix.
 */
export function lerpColor(c1: string, c2: string, t: number): string {
  const a = parseInt(c1.replace('#', ''), 16);
  const b = parseInt(c2.replace('#', ''), 16);
  const r = Math.round(((a >> 16) & 0xff) * (1 - t) + ((b >> 16) & 0xff) * t);
  const g = Math.round(((a >> 8) & 0xff) * (1 - t) + ((b >> 8) & 0xff) * t);
  const bl = Math.round((a & 0xff) * (1 - t) + (b & 0xff) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

/**
 * Map a correlation value [-1, 1] to a color.
 * 1.0 → #166534 (dark green)
 * 0.5 → #22c55e (light green)
 * 0.0 → #334155 (neutral)
 * -0.5 → #ef4444 (light red)
 * -1.0 → #991b1b (dark red)
 */
export function correlationColor(v: number): string {
  const vv = clamp(v, -1, 1);
  if (vv >= 0) {
    if (vv <= 0.5) return lerpColor('#334155', '#22c55e', vv / 0.5);
    return lerpColor('#22c55e', '#166534', (vv - 0.5) / 0.5);
  }
  const abs = Math.abs(vv);
  if (abs <= 0.5) return lerpColor('#334155', '#ef4444', abs / 0.5);
  return lerpColor('#ef4444', '#991b1b', (abs - 0.5) / 0.5);
}

// ── Layout ──

export function getLayout(width: number, height: number, bottomPad = 50): ChartLayout {
  const padding = { top: 30, right: 20, bottom: bottomPad, left: 60 };
  return {
    padding,
    width,
    height,
    plotW: width - padding.left - padding.right,
    plotH: height - padding.top - padding.bottom,
  };
}

// ── SVG Boilerplate ──

/** Shared CSS styles block injected into every chart-type SVG */
export function chartStyles(): string {
  return `<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;display=swap');
    .bg { fill: #0f172a; }
    .title { fill: #f1f5f9; font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 13px; font-weight: 700; }
    .grid-line { stroke: #1e293b; stroke-width: 1; }
    .grid-label { fill: #475569; font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 10px; }
    .price-line { fill: none; stroke: url(#priceGrad); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .price-fill { fill: url(#priceFillGrad); }
    .ema20-line { fill: none; stroke: #f59e0b; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
    .ema50-line { fill: none; stroke: #8b5cf6; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
    .crosshair-line { stroke: rgba(148,163,184,0.5); stroke-width: 1; stroke-dasharray: 4,4; }
    .label-bg { fill: #1e293b; stroke: rgba(34,211,238,0.3); rx: 4; }
    .label-text { fill: #22d3ee; font-family: 'Inter', monospace; font-size: 11px; font-weight: 700; }
    .label-text-white { fill: #f1f5f9; font-family: 'Inter', monospace; font-size: 10px; }
    .minmax-line { stroke: #facc15; stroke-width: 1; stroke-dasharray: 3,2; }
    .minmax-text { fill: #facc15; font-family: 'Inter', monospace; font-size: 9px; }
    .vol-bar-up { fill: rgba(34,197,94,0.5); }
    .vol-bar-down { fill: rgba(239,68,68,0.5); }
    .candle-up { fill: rgba(34,197,94,0.7); stroke: #22c55e; }
    .candle-down { fill: rgba(239,68,68,0.7); stroke: #ef4444; }
    .wick-up { stroke: #22c55e; stroke-width: 1; }
    .wick-down { stroke: #ef4444; stroke-width: 1; }
    .watermark { fill: rgba(148,163,184,0.25); font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 10px; }
    .axis-label { fill: #64748b; font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 9px; }
    .rsi-line { fill: none; stroke: url(#rsiGrad); stroke-width: 1.5; stroke-linejoin: round; }
    .rsi-label { fill: #94a3b8; font-family: 'Inter', monospace; font-size: 9px; }
    .rsi-ob { stroke: rgba(239,68,68,0.5); stroke-width: 1; stroke-dasharray: 4,3; }
    .rsi-os { stroke: rgba(34,197,94,0.5); stroke-width: 1; stroke-dasharray: 4,3; }
    .rsi-bound { stroke: rgba(148,163,184,0.15); stroke-width: 1; }
    .vp-bar-normal { fill: rgba(148,163,184,0.15); }
    .vp-bar-hvn { fill: rgba(34,197,94,0.35); }
    .vp-bar-lvn { fill: rgba(239,68,68,0.3); }
    .vp-poc-line { stroke: #22d3ee; stroke-width: 1.5; stroke-dasharray: 3,2; }
    .vp-poc-label { fill: #22d3ee; font-family: 'Inter', monospace; font-size: 9px; font-weight: 700; }
    .vp-label { fill: #64748b; font-family: 'Inter', monospace; font-size: 9px; }
    .vp-va-area { fill: rgba(34,211,238,0.06); stroke: rgba(34,211,238,0.15); stroke-width: 0.5; }
    .comp-grid-line { stroke: #1e293b; stroke-width: 1; }
    .comp-grid-line-zero { stroke: #334155; stroke-width: 2; stroke-dasharray: 5,3; }
    .comp-grid-label { fill: #475569; font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 9px; }
    .comp-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .comp-hover-dot { fill: transparent; }
    .comp-legend-text { fill: #f1f5f9; font-family: 'Inter', monospace; font-size: 10px; }
    .comp-pct-up { fill: #22c55e; }
    .comp-pct-down { fill: #ef4444; }
    .comp-pct-zero { fill: #94a3b8; }
    .latest-candle { animation: pulse-glow 2s ease-in-out infinite; }
    .pulse-dot { animation: pulse-glow 2s ease-in-out infinite; }
    .data-point { transition: opacity 0.3s, stroke-width 0.3s, r 0.3s; }
    .data-point:hover { opacity: 1; stroke-width: 3; r: 5; }
    .frame-counter { fill: rgba(148,163,184,0.3); font-family: 'Inter', monospace; font-size: 8px; }
    .panel { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); background: rgba(30, 41, 59, 0.8); border-radius: 8px; }
    .tabular-nums { font-variant-numeric: tabular-nums; }
    @keyframes pulse-glow {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
    @keyframes gradient-shift {
      0% { stop-color: #0f172a; }
      50% { stop-color: #1e293b; }
      100% { stop-color: #0f172a; }
    }
    @media (prefers-color-scheme: light) {
      .bg { fill: #ffffff; }
      .title { fill: #1e293b; }
      .grid-line { stroke: #e2e8f0; }
      .grid-label { fill: #475569; }
      .axis-label { fill: #64748b; }
      .label-bg { fill: #f1f5f9; stroke: rgba(34,211,238,0.4); }
      .label-text { fill: #0891b2; }
      .label-text-white { fill: #1e293b; }
      .rsi-label { fill: #64748b; }
      .watermark { fill: rgba(100,116,139,0.35); }
      .comp-grid-line { stroke: #e2e8f0; }
      .comp-grid-line-zero { stroke: #cbd5e1; }
      .comp-grid-label { fill: #64748b; }
      .comp-legend-text { fill: #1e293b; }
      .vol-bar-up { fill: rgba(22,163,74,0.35); }
      .vol-bar-down { fill: rgba(220,38,38,0.35); }
      .candle-up { fill: rgba(22,163,74,0.6); stroke: #16a34a; }
      .candle-down { fill: rgba(220,38,38,0.6); stroke: #dc2626; }
      .wick-up { stroke: #16a34a; }
      .wick-down { stroke: #dc2626; }
      .panel { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); background: rgba(255, 255, 255, 0.9); }
    }
    @media (prefers-reduced-motion: reduce) {
      .latest-candle, .pulse-dot, .data-point { animation: none; transition: none; }
    }
  </style>`;
}

/** Shared defs block: gradients used across chart types */
export function chartDefs(): string {
  return `<defs>
    <linearGradient id="priceGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.5"/>
      <stop offset="50%" stop-color="#22d3ee" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.95"/>
    </linearGradient>
    <linearGradient id="priceFillGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.02"/>
    </linearGradient>
    <linearGradient id="volGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.25"/>
    </linearGradient>
    <linearGradient id="rsiGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="candleVolUpGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="rgba(34,197,94,0.1)"/>
      <stop offset="100%" stop-color="rgba(34,197,94,0.5)"/>
    </linearGradient>
    <linearGradient id="candleVolDownGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="rgba(239,68,68,0.1)"/>
      <stop offset="100%" stop-color="rgba(239,68,68,0.5)"/>
    </linearGradient>
    <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="glassMorphism" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="blur"/>
      <feSpecularLighting in="blur" surfaceScale="2" specularConstant="0.2" specularExponent="20" lighting-color="#ffffff" result="specOut">
        <fePointLight x="200" y="100" z="200"/>
      </feSpecularLighting>
      <feComposite in="specOut" in2="SourceAlpha" operator="in" result="specOut2"/>
      <feComposite in="SourceGraphic" in2="specOut2" operator="arithmetic" k1="0" k2="1" k3="0.08" k4="0"/>
    </filter>
    <linearGradient id="bgGradShift" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a">
        <animate attributeName="stop-color" values="#0f172a;#1e293b;#0f172a" dur="8s" repeatCount="indefinite"/>
      </stop>
      <stop offset="100%" stop-color="#0f172a">
        <animate attributeName="stop-color" values="#0f172a;#1e293b;#0f172a" dur="8s" repeatCount="indefinite"/>
      </stop>
    </linearGradient>
    <!-- MACD gradient -->
    <linearGradient id="macdGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.9"/>
    </linearGradient>
    <!-- Equity curve gradient -->
    <linearGradient id="eqGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="eqFillGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.02"/>
    </linearGradient>
  </defs>`;
}

export function svgOpen(width: number, height: number, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeXml(title)}">
  ${chartStyles()}
  ${chartDefs()}
  <rect width="${width}" height="${height}" class="bg" rx="8"/>`;
}

export const SVG_CLOSE = '</svg>';

export function svgClose(): string {
  return SVG_CLOSE;
}

export function renderTitle(width: number, y: number, title: string): string {
  return `<text x="${(width / 2).toFixed(1)}" y="${y}" text-anchor="middle" class="title">${escapeXml(title)}</text>`;
}

export function renderWatermark(width: number, height: number): string {
  return `<text x="${(width - 12).toFixed(1)}" y="${(height - 8).toFixed(1)}" text-anchor="end" class="watermark">🛰️ Hermes Crypto Radar</text>`;
}

// ── Grid & Axis ──

export function renderYGrid(layout: ChartLayout, min: number, max: number, lines = 5): string {
  const { padding, plotH, width } = layout;
  const range = max - min || 1;
  let out = '';
  for (let i = 0; i <= lines; i++) {
    const yRatio = i / lines;
    const y = padding.top + plotH * yRatio;
    const val = max - range * yRatio;
    out += `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" class="grid-line"/>\n`;
    out += `<text x="${(padding.left - 8).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="grid-label">${formatYLabel(val)}</text>\n`;
  }
  return out;
}

export function renderXLabels(layout: ChartLayout, klines: Kline[], count = 5): string {
  const { padding, plotW, height } = layout;
  const n = klines.length;
  if (n === 0) return '';
  const step = Math.max(1, Math.floor(n / (count - 1)));
  let out = '';
  for (let i = 0; i < n; i += step) {
    const x = padding.left + (i / (n - 1)) * plotW;
    const k = klines[i];
    if (!k) continue;
    const label = formatTime(k.openTime);
    out += `<text x="${x.toFixed(1)}" y="${(height - padding.bottom + 18).toFixed(1)}" text-anchor="middle" class="axis-label">${escapeXml(label)}</text>\n`;
  }
  return out;
}

// ── Chart Elements ──

/**
 * Render crosshair at the latest candle with price/date tooltip.
 * Tooltip positions are clamped to prevent overflow beyond SVG bounds.
 */
export function renderCrosshair(layout: ChartLayout, klines: Kline[], min: number, max: number): string {
  const { padding, plotW, plotH, width, height } = layout;
  const range = max - min || 1;
  const n = klines.length;
  const lastK = klines[n - 1];
  if (!lastK) return '';

  const x = padding.left + plotW;
  const y = padding.top + plotH - ((lastK.close - min) / range) * plotH;

  // Clamp tooltip positions to prevent SVG overflow
  const tooltipW = 90;
  const tooltipH = 20;

  // Right-side price label: if label would overflow right edge, place it to the left
  const rlx = (x + 5 + tooltipW) > width ? x - tooltipW - 5 : x + 5;

  // Left-side date label: clamp to prevent overflow
  const llx = Math.max(5, padding.left - 5);

  // Clamp vertical position so tooltip doesn't overflow top/bottom
  const clampLabelY = (labelY: number): number => {
    return Math.max(padding.top + 2, Math.min(height - padding.bottom - tooltipH - 2, labelY));
  };
  const clampedY = clampLabelY(y - 10);

  return `<line x1="${x.toFixed(1)}" y1="${(padding.top - 5).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(padding.top + plotH + 5).toFixed(1)}" class="crosshair-line"/>\n` +
    `<rect x="${rlx.toFixed(1)}" y="${clampedY.toFixed(1)}" width="${tooltipW}" height="${tooltipH}" rx="4" class="label-bg"/>\n` +
    `<text x="${(rlx + 5).toFixed(1)}" y="${(clampedY + 13).toFixed(1)}" class="label-text">${formatYLabel(lastK.close)}</text>\n` +
    `<rect x="${llx.toFixed(1)}" y="${clampedY.toFixed(1)}" width="${tooltipW}" height="${tooltipH}" rx="4" class="label-bg"/>\n` +
    `<text x="${(llx + 5).toFixed(1)}" y="${(clampedY + 13).toFixed(1)}" class="label-text">${formatTime(lastK.openTime)}</text>\n`;
}

/**
 * Render min/max price markers with horizontal lines and labels.
 * Label positions are clamped within plot area to prevent SVG overflow.
 */
export function renderMinMaxMarkers(layout: ChartLayout, klines: Kline[], min: number, max: number): string {
  const { padding, plotW, plotH, width } = layout;
  const range = max - min || 1;
  const n = klines.length;
  if (n === 0) return '';
  let out = '';

  const clampLabelX = (anchorX: number, labelW: number): number => {
    const lx = anchorX + 4;
    const rightEdge = lx + labelW;
    if (rightEdge > width - padding.right) return width - padding.right - labelW - 4;
    if (lx < padding.left + 4) return padding.left + 4;
    return lx;
  };
  const clampLabelY = (labelY: number): number => {
    const labelH = 16;
    if (labelY - labelH / 2 < padding.top) return padding.top + 2;
    if (labelY + labelH / 2 > padding.top + plotH) return padding.top + plotH - labelH - 2;
    return labelY;
  };

  // Highest high
  let highIdx = 0;
  let highest = klines[0]?.high ?? 0;
  for (let i = 1; i < n; i++) {
    if ((klines[i]?.high ?? 0) > highest) { highest = klines[i]!.high; highIdx = i; }
  }
  const highX = padding.left + (highIdx / Math.max(1, n - 1)) * plotW;
  const highY = padding.top + plotH - ((highest - min) / range) * plotH;
  const highLabelW = 72;
  const clampedHighX = clampLabelX(highX, highLabelW);
  const clampedHighY = clampLabelY(highY) - 8;
  out += `<line x1="${padding.left}" y1="${highY.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${highY.toFixed(1)}" class="minmax-line"/>\n`;
  out += `<rect x="${clampedHighX.toFixed(1)}" y="${clampedHighY.toFixed(1)}" width="${highLabelW}" height="16" rx="3" fill="#1e293b" stroke="rgba(250,204,21,0.3)"/>\n`;
  out += `<text x="${(clampedHighX + 4).toFixed(1)}" y="${(clampedHighY + 12).toFixed(1)}" class="minmax-text">⬆ ${formatYLabel(highest)}</text>\n`;

  // Lowest low
  let lowIdx = 0;
  let lowest = klines[0]?.low ?? 0;
  for (let i = 1; i < n; i++) {
    if ((klines[i]?.low ?? Infinity) < lowest) { lowest = klines[i]!.low; lowIdx = i; }
  }
  const lowX = padding.left + (lowIdx / Math.max(1, n - 1)) * plotW;
  const lowY = padding.top + plotH - ((lowest - min) / range) * plotH;
  const lowLabelW = 72;
  const clampedLowX = clampLabelX(lowX, lowLabelW);
  const clampedLowY = clampLabelY(lowY) - 8;
  out += `<line x1="${padding.left}" y1="${lowY.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${lowY.toFixed(1)}" class="minmax-line"/>\n`;
  out += `<rect x="${clampedLowX.toFixed(1)}" y="${clampedLowY.toFixed(1)}" width="${lowLabelW}" height="16" rx="3" fill="#1e293b" stroke="rgba(250,204,21,0.3)"/>\n`;
  out += `<text x="${(clampedLowX + 4).toFixed(1)}" y="${(clampedLowY + 12).toFixed(1)}" class="minmax-text">⬇ ${formatYLabel(lowest)}</text>\n`;

  return out;
}

/** Render volume bars with gradient fill */
export function renderVolumeBars(layout: ChartLayout, klines: Kline[], barMaxHeight: number): string {
  const { padding, plotW, height } = layout;
  const n = klines.length;
  const volumes = klines.map(k => k.quoteVolume);
  const maxVol = Math.max(...volumes) || 1;
  let out = '';
  for (let i = 0; i < n; i++) {
    const volRatio = volumes[i]! / maxVol;
    const x = padding.left + (i / (n - 1)) * plotW;
    const barH = volRatio * barMaxHeight;
    const barY = height - padding.bottom + 5;
    out += `<rect x="${(x - 1).toFixed(1)}" y="${(barY - barH).toFixed(1)}" width="2" height="${barH.toFixed(1)}" fill="url(#volGrad)">
      <animate attributeName="height" from="0" to="${barH.toFixed(1)}" dur="0.5s" fill="freeze"/>
      <animate attributeName="y" from="${barY}" to="${(barY - barH).toFixed(1)}" dur="0.5s" fill="freeze"/>
    </rect>\n`;
  }
  return out;
}

// ── Log Scale ──

/**
 * Convert a value to log scale if enabled.
 * If logScale is true, maps the value to a logarithmic scale.
 * Small epsilon added to handle zero prices.
 */
export function applyLogScale(v: number, logScale: boolean): number {
  if (!logScale) return v;
  return Math.log(Math.max(v, 0.000001));
}

// ── Responsive Candle Width ──

/**
 * Calculate responsive candle width based on number of candles and available plot width.
 * Returns a width that looks good whether you have 10 candles or 1000.
 */
export function calcCandleWidth(plotW: number, n: number, minW = 2, maxW = 12): number {
  if (n < 2) return maxW;
  const raw = (plotW / n) * 0.7;
  return Math.max(minW, Math.min(maxW, raw));
}
