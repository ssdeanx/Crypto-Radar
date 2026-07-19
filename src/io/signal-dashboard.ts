// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Master SVG Signal Dashboard
// ═══════════════════════════════════════════════════════════════════════
//
// A single comprehensive SVG dashboard combining ALL market intelligence
// into one professional trading-terminal view. Think Bloomberg terminal
// meets crypto trading view — but as a self-contained SVG.
//
// Layout (4-panel, 2×2 grid):
//   ┌─────────────────────────────────────┐
//   │  HEADER: "🛰️ Crypto Radar — Market Intelligence"
//   │  Status bar: tokens, signals, on-chain, timestamp
//   ├───────────────┬─────────────────────┤
//   │  PANEL 1      │  PANEL 2            │
//   │  Top Signals  │  Market Breadth     │
//   │  (signal cards)│  (gauge + sectors)  │
//   ├───────────────┼─────────────────────┤
//   │  PANEL 3      │  PANEL 4            │
//   │  Correlation  │  On-Chain Metrics   │
//   │  (mini heatmap)│  (TVL bars + fees)  │
//   └───────────────┴─────────────────────┘
//   │  FOOTER: generated timestamp, source
//
// Shared utilities now live in shared-svg.ts.
// ═══════════════════════════════════════════════════════════════════════

import type { EnrichedTicker } from '../types.js';
import type { AggregatedSignal, SignalDirection } from '../analysis/strategies.js';
import type { OnChainMetrics } from '../onchain.js';
import type { RegimeResult } from '../analysis/regime.js';
import {
  BG,
  TEXT,
  ACCENT,
  SUBTLE,
  MUTED,
  GRID_LINE,
  escapeXml,
  fmtDollar,
  fmtPct,
  clamp,
  lerpColor,
  correlationColor,
  shortPct,
  svgClose,
} from './shared-svg.js';

// ── Exported Types ──────────────────────────────────────────────────────

export interface DashboardOptions {
  tickers: EnrichedTicker[];
  aggregatedSignals: AggregatedSignal[];
  onchain: OnChainMetrics | null;
  correlationMatrix?: number[][];
  regimes?: Map<string, RegimeResult>;
  marketBreadth?: { up: number; down: number; total: number };
}

// ── Direction helpers ──────────────────────────────────────────────────

function directionColor(dir: SignalDirection): string {
  switch (dir) {
    case 'strong_buy': return '#16a34a';
    case 'buy': return '#22c55e';
    case 'strong_sell': return '#dc2626';
    case 'sell': return '#ef4444';
    default: return '#64748b';
  }
}

function directionLabel(dir: SignalDirection): string {
  switch (dir) {
    case 'strong_buy': return 'STRONG BUY';
    case 'buy': return 'BUY';
    case 'strong_sell': return 'STRONG SELL';
    case 'sell': return 'SELL';
    default: return 'NEUTRAL';
  }
}

// ── CSS Styles ──────────────────────────────────────────────────────────

function dashboardStyles(): string {
  return `<style>
    .d-bg { fill: #0f172a; }
    .d-header-title { fill: #f1f5f9; font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 15px; font-weight: 800; }
    .d-status { fill: #64748b; font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 9px; }
    .d-status-val { fill: #f1f5f9; font-family: 'Inter', monospace; font-size: 9px; font-weight: 600; }
    .d-panel-title { fill: #22d3ee; font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 11px; font-weight: 700; }
    .d-label { fill: #94a3b8; font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 9px; }
    .d-value { fill: #f1f5f9; font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 600; }
    .d-small { fill: #64748b; font-family: 'Inter', monospace; font-size: 9px; }
    .d-up { fill: #22c55e; }
    .d-down { fill: #ef4444; }
    .d-neutral { fill: #94a3b8; }
    .d-card-bg { fill: rgba(30, 41, 59, 0.7); stroke: rgba(148, 163, 184, 0.1); rx: 5; }
    .d-badge { font-family: 'Inter', sans-serif; font-size: 9px; font-weight: 700; rx: 3; }
    .d-conf-bg { fill: #1e293b; rx: 3; }
    .d-conf-fill { rx: 3; }
    .d-bar-bg { fill: #1e293b; }
    .d-bar-up { fill: rgba(34, 197, 94, 0.8); }
    .d-bar-down { fill: rgba(239, 68, 68, 0.8); }
    .d-grid-line { stroke: #1e293b; stroke-width: 1; }
    .d-gauge-track { fill: none; stroke: #1e293b; stroke-width: 12; stroke-linecap: round; }
    .d-gauge-fill { fill: none; stroke-linecap: round; }
    .d-watermark { fill: rgba(148, 163, 184, 0.2); font-family: 'Inter', system-ui, -apple-system, sans-serif; font-size: 9px; }
    .d-onchain-bar { rx: 3; }
    /* Light mode overrides with fixed panel backgrounds */
    @media (prefers-color-scheme: light) {
      .d-bg { fill: #ffffff; }
      .d-header-title { fill: #0f172a; }
      .d-status { fill: #475569; }
      .d-status-val { fill: #0f172a; }
      .d-panel-title { fill: #0891b2; }
      .d-label { fill: #475569; }
      .d-value { fill: #0f172a; }
      .d-small { fill: #64748b; }
      .d-card-bg { fill: rgba(241, 245, 249, 0.85); stroke: rgba(100, 116, 139, 0.15); }
      .d-bar-bg { fill: #e2e8f0; }
      .d-conf-bg { fill: #e2e8f0; }
      .d-grid-line { stroke: #e2e8f0; }
      .d-watermark { fill: rgba(100, 116, 139, 0.35); }
      .d-gauge-track { stroke: #e2e8f0; }
    }
    /* Hyperframe animations */
    @keyframes pulse-glow {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
    @keyframes gradient-shift {
      0% { stop-color: #0f172a; }
      50% { stop-color: #1e293b; }
      100% { stop-color: #0f172a; }
    }
    .d-pulse { animation: pulse-glow 2s ease-in-out infinite; }
    .d-hover-data { transition: opacity 0.3s, r 0.3s, stroke-width 0.3s; }
    .d-hover-data:hover { opacity: 1; stroke-width: 3; r: 5; }
    .d-frame-counter { fill: rgba(148,163,184,0.3); font-family: 'Inter', monospace; font-size: 8px; }
    /* Glassmorphism panel */
    .d-glass { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); background: rgba(30, 41, 59, 0.8); border-radius: 8px; }
    @media (prefers-color-scheme: light) {
      .d-glass { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); background: rgba(255, 255, 255, 0.9); }
    }
    /* Typography */
    .d-tabnums { font-variant-numeric: tabular-nums; }
    @media (prefers-reduced-motion: reduce) {
      .d-pulse, .d-hover-data { animation: none; transition: none; }
    }
  </style>`;
}

function svgOpen(w: number, h: number, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeXml(title)}">\n${dashboardStyles()}\n<rect width="${w}" height="${h}" class="d-bg" rx="8"/>`;
}

// ── Panel Dividers ──────────────────────────────────────────────────────

function renderDivider(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(148,163,184,0.3)" stroke-width="1"/>`;
}

// ── Main Export ─────────────────────────────────────────────────────────

/**
 * Generate a master SVG signal dashboard combining all market intelligence
 * into a single 4-panel trading-terminal view.
 *
 * @param options  Dashboard data (tickers, signals, on-chain, correlations, etc.)
 * @param width    SVG width (default 800)
 * @param height   SVG height (default 900)
 * @returns        Inline SVG string
 */
export function signalDashboard(
  options: DashboardOptions,
  width = 800,
  height = 900,
): string {
  const {
    tickers,
    aggregatedSignals,
    onchain,
    correlationMatrix,
    regimes,
    marketBreadth,
  } = options;

  // ── Layout constants ──
  const pad = 14;
  const headerH = 54;
  const footerH = 22;
  const dividerGap = 8; // gap between panels
  const availW = width - pad * 2;
  const availH = height - headerH - footerH - pad * 2;
  const halfW = (availW - dividerGap) / 2;
  const halfH = (availH - dividerGap) / 2;

  // Panel regions (top-left, top-right, bottom-left, bottom-right)
  const panel1 = { x: pad, y: headerH + pad, w: halfW, h: halfH };
  const panel2 = { x: pad + halfW + dividerGap, y: headerH + pad, w: halfW, h: halfH };
  const panel3 = { x: pad, y: headerH + pad + halfH + dividerGap, w: halfW, h: halfH };
  const panel4 = { x: pad + halfW + dividerGap, y: headerH + pad + halfH + dividerGap, w: halfW, h: halfH };

  // ── Timestamp (auto-generated on every call — always fresh) ──
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  let svg = svgOpen(width, height, 'Crypto Radar — Master Signal Dashboard');

  // ── Glow gradient for Top Signals panel ──
  svg += `<defs>
    <radialGradient id="topSignalsGlow" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="rgba(34,211,238,0.08)"/>
      <stop offset="100%" stop-color="rgba(34,211,238,0)"/>
    </radialGradient>
    <filter id="dGlass" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="blur"/>
      <feSpecularLighting in="blur" surfaceScale="2" specularConstant="0.2" specularExponent="20" lighting-color="#ffffff" result="specOut">
        <fePointLight x="400" y="200" z="200"/>
      </feSpecularLighting>
      <feComposite in="specOut" in2="SourceAlpha" operator="in" result="specOut2"/>
      <feComposite in="SourceGraphic" in2="specOut2" operator="arithmetic" k1="0" k2="1" k3="0.08" k4="0"/>
    </filter>
    <!-- Gradient-shift animated background -->
    <linearGradient id="dBgShift" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a">
        <animate attributeName="stop-color" values="#0f172a;#1e293b;#0f172a" dur="8s" repeatCount="indefinite"/>
      </stop>
      <stop offset="100%" stop-color="#0f172a">
        <animate attributeName="stop-color" values="#0f172a;#1e293b;#0f172a" dur="8s" repeatCount="indefinite"/>
      </stop>
    </linearGradient>
    <!-- Gradient for thermometer gauge -->
    <linearGradient id="brGaugeGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.9"/>
      <stop offset="50%" stop-color="#64748b" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#22c55e"/>
    </linearGradient>
  </defs>`;

  // ── HEADER ──
  svg += `<text x="${pad}" y="${24}" class="d-header-title">🛰️ Crypto Radar <tspan fill="${SUBTLE}" font-weight="400">— Market Intelligence</tspan></text>\n`;

  // Status bar line
  const statusY = 44;
  const tokensOnline = tickers.length;
  const signalCount = aggregatedSignals.length;
  const onchainStatus = onchain ? `🟢 ${onchain.protocols.length} protocols` : '⚫ No on-chain';
  const regCount = regimes ? regimes.size : 0;
  const breadthStatus = marketBreadth
    ? `📊 ${marketBreadth.up}/${marketBreadth.down}/${marketBreadth.total}`
    : '';

  let statusLine = `<text x="${pad}" y="${statusY}" class="d-status">Tokens: <tspan class="d-status-val">${tokensOnline}</tspan> &middot; Signals: <tspan class="d-status-val">${signalCount}</tspan> &middot; On-Chain: <tspan class="d-status-val">${escapeXml(onchainStatus)}</tspan>`;
  if (regCount > 0) statusLine += ` &middot; Regimes: <tspan class="d-status-val">${regCount}</tspan>`;
  if (breadthStatus) statusLine += ` &middot; Breadth: <tspan class="d-status-val">${escapeXml(breadthStatus)}</tspan>`;
  statusLine += `</text>\n`;
  svg += statusLine;

  // Right-aligned timestamp in header
  svg += `<text x="${width - pad}" y="${statusY}" text-anchor="end" class="d-status">${escapeXml(timestamp)}</text>\n`;

  // Frame counter in header
  svg += `<text x="${width - pad}" y="${statusY + 12}" text-anchor="end" class="d-frame-counter">FRM-${Math.floor(Math.random() * 90000 + 10000)}</text>\n`;

  // ── Panel Dividers ──
  const midX = pad + halfW + dividerGap / 2;
  const midY = headerH + pad + halfH + dividerGap / 2;
  // Vertical divider
  svg += renderDivider(midX, headerH + pad, midX, headerH + pad + availH);
  // Horizontal divider
  svg += renderDivider(pad, midY, width - pad, midY);

  // ═══════════════════════════════════════════════════════════════════
  // PANEL 1 — Top Signals
  // ═══════════════════════════════════════════════════════════════════
  {
    const px = panel1.x;
    const py = panel1.y;
    const pw = panel1.w;
    const ph = panel1.h;
    const innerPad = 8;
    const titleY = py + 14;
    svg += `<text x="${px + innerPad}" y="${titleY}" class="d-panel-title">⚡ Top Signals</text>\n`;
    // Subtle glow behind signal cards
    svg += `<rect x="${px + innerPad}" y="${titleY + 8}" width="${pw - innerPad * 2}" height="${ph - 24}" fill="url(#topSignalsGlow)" rx="8"/>`;

    const sorted = [...aggregatedSignals].sort((a, b) => b.compositeConfidence - a.compositeConfidence);
    const topSignals = sorted.slice(0, 6);

    if (topSignals.length === 0) {
      svg += `<text x="${px + pw / 2}" y="${py + ph / 2}" text-anchor="middle" class="d-label">No signals generated</text>\n`;
    } else {
      const cardStartY = titleY + 12;
      const cardH = Math.min(48, (ph - 30) / topSignals.length);
      const cardGap = 4;

      for (let i = 0; i < topSignals.length; i++) {
        const sig = topSignals[i]!;
        const cy = cardStartY + i * (cardH + cardGap);
        const ch = cardH - cardGap;
        if (cy + ch > py + ph - 4) break; // don't overflow panel

        // Card background
        svg += `<rect x="${px + innerPad}" y="${cy}" width="${pw - innerPad * 2}" height="${ch}" class="d-card-bg"/>\n`;

        // Direction badge
        const dir = sig.direction;
        const dirCol = directionColor(dir);
        const badgeW = dir === 'neutral' ? 45 : 72;
        const badgeH = 14;
        svg += `<g class="d-pulse">
        <rect x="${px + innerPad + 4}" y="${cy + 4}" width="${badgeW}" height="${badgeH}" fill="${dirCol}" class="d-badge">
          <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze"/>
        </rect>
        <text x="${px + innerPad + 4 + badgeW / 2}" y="${cy + 4 + 10}" text-anchor="middle" fill="#ffffff" class="d-badge">${directionLabel(dir)}</text>
        </g>\n`;
        svg += `<title>${escapeXml(sig.symbol)}: ${directionLabel(dir)} (${(sig.compositeConfidence * 100).toFixed(0)}% confidence)</title>\n`;

        // Symbol + price
        const labelX = px + innerPad + badgeW + 10;
        svg += `<text x="${labelX}" y="${cy + 12}" class="d-value" font-size="10">${escapeXml(sig.symbol)}</text>\n`;
        svg += `<text x="${labelX}" y="${cy + ch - 3}" class="d-small">${fmtDollar(sig.lastPrice)}</text>\n`;

        // Price change
        const changeColor = sig.priceChangePercent >= 0 ? '#22c55e' : '#ef4444';
        svg += `<text x="${px + pw - innerPad - 4}" y="${cy + 12}" text-anchor="end" fill="${changeColor}" font-family="'Inter', monospace" font-size="10" font-weight="600">${shortPct(sig.priceChangePercent)}</text>\n`;

        // Confidence bar
        const barW = 80;
        const barHc = 6;
        const barX = px + pw - innerPad - 4 - barW;
        const barY = cy + ch - 3 - barHc;
        svg += `<rect x="${barX}" y="${barY}" width="${barW}" height="${barHc}" class="d-conf-bg"/>\n`;
        const fillW = clamp(sig.compositeConfidence, 0, 1) * (barW - 2);
        const barFillColor = sig.compositeConfidence >= 0.7 ? '#22c55e' : sig.compositeConfidence >= 0.4 ? '#eab308' : '#ef4444';
        svg += `<rect x="${barX + 1}" y="${barY + 1}" width="${fillW.toFixed(1)}" height="${barHc - 2}" fill="${barFillColor}" class="d-conf-fill"/>\n`;
        svg += `<text x="${barX + barW + 4}" y="${barY + barHc - 1}" class="d-small" font-size="9">${(sig.compositeConfidence * 100).toFixed(0)}%</text>\n`;
        svg += `<title>${escapeXml(sig.symbol)} — Confidence: ${(sig.compositeConfidence * 100).toFixed(1)}% — Reason: ${sig.compositeReason ?? sig.signals.map(s => s.reason).join('; ')}</title>\n`;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PANEL 2 — Market Breadth
  // ═══════════════════════════════════════════════════════════════════
  {
    const px = panel2.x;
    const py = panel2.y;
    const pw = panel2.w;
    const ph = panel2.h;
    const innerPad = 8;
    svg += `<text x="${px + innerPad}" y="${py + 14}" class="d-panel-title">📊 Market Breadth</text>\n`;

    // Compute breadth stats from tickers
    const upCount = tickers.filter(t => (t.priceChangePercent ?? 0) >= 0).length;
    const downCount = tickers.filter(t => (t.priceChangePercent ?? 0) < 0).length;
    const totalTokens = tickers.length;
    const upPct = totalTokens > 0 ? (upCount / totalTokens) * 100 : 50;

    // ── Thermometer gauge (left side) ──
    const gaugeCX = px + 40;
    const gaugeTop = py + 30;
    const gaugeH = Math.min(80, ph * 0.55);
    const gaugeW = 14;

    // Background track
    svg += `<rect x="${(gaugeCX - gaugeW / 2).toFixed(1)}" y="${gaugeTop}" width="${gaugeW}" height="${gaugeH}" rx="${gaugeW / 2}" fill="${GRID_LINE}"/>\n`;

    // Fill — use pre-defined gradient from defs (no inline <defs> bug)
    const fillH = (upPct / 100) * gaugeH;
    const fillTop = gaugeTop + gaugeH - fillH;
    svg += `<rect x="${(gaugeCX - gaugeW / 2 + 2).toFixed(1)}" y="${fillTop.toFixed(1)}" width="${(gaugeW - 4).toFixed(1)}" height="${Math.max(1, fillH).toFixed(1)}" rx="${(gaugeW - 4) / 2}" fill="url(#brGaugeGrad)">
      <animate attributeName="height" from="0" to="${Math.max(1, fillH).toFixed(1)}" dur="0.8s" fill="freeze"/>
      <animate attributeName="y" from="${gaugeTop + gaugeH}" to="${fillTop.toFixed(1)}" dur="0.8s" fill="freeze"/>
    </rect>\n`;

    // Bulb
    svg += `<circle cx="${gaugeCX}" cy="${(gaugeTop + gaugeH).toFixed(1)}" r="${(gaugeW / 2 + 2)}" fill="${BG}" stroke="${MUTED}" stroke-width="1.5"/>\n`;
    const bulbColor = lerpColor('#ef4444', ACCENT, upPct / 100);
    svg += `<circle cx="${gaugeCX}" cy="${(gaugeTop + gaugeH).toFixed(1)}" r="${(gaugeW / 2 - 1)}" fill="${bulbColor}"/>\n`;
    svg += `<title>${fmtPct(upPct / 100)} bullish — ${upCount} up / ${downCount} down</title>\n`;

    // Percentage text above gauge
    svg += `<text x="${gaugeCX}" y="${(gaugeTop - 6).toFixed(1)}" text-anchor="middle" fill="${TEXT}" font-family="'Inter', sans-serif" font-size="11" font-weight="700">${fmtPct(upPct / 100)} Up</text>\n`;
    svg += `<text x="${gaugeCX}" y="${(gaugeTop + gaugeH + 16).toFixed(1)}" text-anchor="middle" class="d-label" font-size="9">Bull <tspan fill="#22c55e">${upCount}</tspan> / Bear <tspan fill="#ef4444">${downCount}</tspan></text>\n`;

    // ── Gainers / Losers list (right of gauge) ──
    const listX = gaugeCX + 40;
    const listTop = gaugeTop - 2;

    // Sort tickers by change
    const sortedByChange = [...tickers]
      .map(t => ({ symbol: t.symbol, change: t.priceChangePercent ?? 0 }))
      .sort((a, b) => b.change - a.change);
    const top3 = sortedByChange.slice(0, 3);
    const bottom3 = sortedByChange.slice(-3).reverse();

    svg += `<text x="${listX}" y="${listTop + 10}" class="d-label" font-size="9" fill="#22c55e">Top Gainers</text>\n`;
    for (let i = 0; i < top3.length; i++) {
      const t = top3[i]!;
      const ly = listTop + 22 + i * 13;
      svg += `<text x="${listX}" y="${ly}" class="d-value" font-size="9">${escapeXml(t.symbol)}</text>\n`;
      svg += `<text x="${listX + 80}" y="${ly}" text-anchor="end" fill="#22c55e" font-family="'Inter', monospace" font-size="9" font-weight="600">${shortPct(t.change)}</text>\n`;
      svg += `<title>${escapeXml(t.symbol)}: ${shortPct(t.change)}</title>\n`;
    }

    const losersY = listTop + 60;
    svg += `<text x="${listX}" y="${losersY + 10}" class="d-label" font-size="9" fill="#ef4444">Top Losers</text>\n`;
    for (let i = 0; i < bottom3.length; i++) {
      const t = bottom3[i]!;
      const ly = losersY + 22 + i * 13;
      svg += `<text x="${listX}" y="${ly}" class="d-value" font-size="9">${escapeXml(t.symbol)}</text>\n`;
      svg += `<text x="${listX + 80}" y="${ly}" text-anchor="end" fill="#ef4444" font-family="'Inter', monospace" font-size="9" font-weight="600">${shortPct(t.change)}</text>\n`;
      svg += `<title>${escapeXml(t.symbol)}: ${shortPct(t.change)}</title>\n`;
    }

    // ── Sector / Chain breakdown (small bar chart at bottom of panel) ──
    const sectorY = py + ph - 42;
    svg += `<text x="${px + innerPad}" y="${sectorY}" class="d-label" font-size="9">Chain Breakdown</text>\n`;

    // Group tickers by chain
    const chainMap = new Map<string, { up: number; down: number; total: number }>();
    for (const t of tickers) {
      const chain = t.chain ?? 'Other';
      if (!chainMap.has(chain)) chainMap.set(chain, { up: 0, down: 0, total: 0 });
      const entry = chainMap.get(chain)!;
      entry.total++;
      if ((t.priceChangePercent ?? 0) >= 0) entry.up++;
      else entry.down++;
    }
    const chainEntries = [...chainMap.entries()].sort((a, b) => b[1].total - a[1].total);
    const maxChainCt = Math.max(...chainEntries.map(e => e[1].total), 1);

    const chainBarX = px + innerPad;
    const chainBarY = sectorY + 12;
    const chainBarMaxW = pw - innerPad * 2;
    const chainBarH = 8;
    const chainGap = 3;

    for (let i = 0; i < Math.min(chainEntries.length, 4); i++) {
      const [name, stats] = chainEntries[i]!;
      const by = chainBarY + i * (chainBarH + chainGap);
      const barW = Math.max(chainBarMaxW * (stats.total / maxChainCt), 10);
      svg += `<rect x="${chainBarX}" y="${by}" width="${chainBarMaxW}" height="${chainBarH}" class="d-bar-bg" rx="2"/>\n`;
      svg += `<rect x="${chainBarX}" y="${by}" width="${barW.toFixed(1)}" height="${chainBarH}" class="d-bar-up d-hover-data" rx="2">
        <animate attributeName="width" from="0" to="${barW.toFixed(1)}" dur="0.5s" fill="freeze"/>
      </rect>\n`;
      svg += `<text x="${chainBarX + 4}" y="${by + chainBarH - 2}" fill="${TEXT}" font-family="'Inter', sans-serif" font-size="9" font-weight="600">${escapeXml(name)}</text>\n`;
      svg += `<text x="${chainBarX + chainBarMaxW - 4}" y="${by + chainBarH - 2}" text-anchor="end" fill="#94a3b8" font-family="'Inter', monospace" font-size="9">${stats.up}/${stats.down}</text>\n`;
      svg += `<title>${escapeXml(name)}: ${stats.total} tokens (${stats.up} up, ${stats.down} down)</title>\n`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PANEL 3 — Correlation Heatmap
  // ═══════════════════════════════════════════════════════════════════
  {
    const px = panel3.x;
    const py = panel3.y;
    const pw = panel3.w;
    const ph = panel3.h;
    const innerPad = 8;
    svg += `<text x="${px + innerPad}" y="${py + 14}" class="d-panel-title">🔗 Correlation Matrix</text>\n`;

    // Pick top tokens for heatmap (up to 6)
    const topTokens = aggregatedSignals.slice(0, 6).map(s => s.symbol);
    const tokenCount = topTokens.length;

    if (tokenCount < 2 || !correlationMatrix || correlationMatrix.length < tokenCount) {
      svg += `<text x="${px + pw / 2}" y="${py + ph / 2}" text-anchor="middle" class="d-label">Not enough data for correlation</text>\n`;
      svg += `<text x="${px + pw / 2}" y="${py + ph / 2 + 14}" text-anchor="middle" class="d-small">Need at least 2 tokens with signal data</text>\n`;
    } else {
      // Build a mini 6×6 heatmap
      const n = tokenCount;
      const cellArea = Math.min(pw - innerPad * 2 - 50, ph - 40);
      const cellSize = cellArea / n;
      const gridX = px + 50;
      const gridY = py + 30;

      // Color legend bar (small)
      const legendY = py + 18;
      const legendX = px + pw - innerPad - 70;
      const legendW = 60;
      const legendH = 4;
      for (let i = 0; i < 20; i++) {
        const t = (i / 19) * 2 - 1;
        const lx = legendX + (i / 20) * legendW;
        svg += `<rect x="${lx.toFixed(1)}" y="${legendY}" width="${Math.max(1, legendW / 20 + 1).toFixed(1)}" height="${legendH}" fill="${correlationColor(t)}"/>\n`;
      }
      svg += `<text x="${legendX}" y="${(legendY + legendH + 9).toFixed(1)}" class="d-small" font-size="9">-1</text>\n`;
      svg += `<text x="${(legendX + legendW).toFixed(1)}" y="${(legendY + legendH + 9).toFixed(1)}" text-anchor="end" class="d-small" font-size="9">+1</text>\n`;

      // Cells
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (c > r) continue; // lower triangle only
          const v = correlationMatrix[r]?.[c] ?? correlationMatrix[c]?.[r] ?? 0;
          const x = gridX + c * cellSize;
          const y = gridY + r * cellSize;
          const color = correlationColor(v);
          svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cellSize - 1).toFixed(1)}" height="${(cellSize - 1).toFixed(1)}" fill="${color}" rx="1" class="d-hover-data">\n`;
          svg += `  <title>${escapeXml(topTokens[r]!)} / ${escapeXml(topTokens[c]!)}: ${v.toFixed(3)}</title>\n`;
          svg += `</rect>\n`;

          // Value text if cell is large enough
          if (cellSize > 28) {
            const textColor = Math.abs(v) > 0.6 ? '#ffffff' : '#94a3b8';
            svg += `<text x="${(x + cellSize / 2).toFixed(1)}" y="${(y + cellSize / 2 + 3).toFixed(1)}" text-anchor="middle" fill="${textColor}" font-family="'Inter', monospace" font-size="${Math.min(8, cellSize * 0.25)}" font-weight="600">${v.toFixed(2)}</text>\n`;
          }
        }
      }

      // Y-axis labels
      for (let r = 0; r < n; r++) {
        const y = gridY + r * cellSize + cellSize / 2;
        svg += `<text x="${(gridX - 4).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" fill="#f1f5f9" font-family="'Inter', sans-serif" font-size="${n > 5 ? 7 : 8}" font-weight="600">${escapeXml(topTokens[r]!)}</text>\n`;
      }

      // X-axis labels
      for (let c = 0; c < n; c++) {
        const x = gridX + c * cellSize + cellSize / 2;
        const y = gridY + n * cellSize + 4;
        const rotDeg = n > 5 ? 30 : 0;
        svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${rotDeg > 0 ? 'end' : 'middle'}" transform="rotate(${rotDeg}, ${x.toFixed(1)}, ${y.toFixed(1)})" fill="#f1f5f9" font-family="'Inter', sans-serif" font-size="${n > 5 ? 7 : 8}" font-weight="600">${escapeXml(topTokens[c]!)}</text>\n`;
      }

      // Diagonal
      svg += `<line x1="${gridX}" y1="${gridY}" x2="${(gridX + n * cellSize).toFixed(1)}" y2="${(gridY + n * cellSize).toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="2,2"/>\n`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PANEL 4 — On-Chain Metrics
  // ═══════════════════════════════════════════════════════════════════
  {
    const px = panel4.x;
    const py = panel4.y;
    const pw = panel4.w;
    const ph = panel4.h;
    const innerPad = 8;
    svg += `<text x="${px + innerPad}" y="${py + 14}" class="d-panel-title">⛓️ On-Chain Metrics</text>\n`;

    if (!onchain || onchain.protocols.length === 0) {
      svg += `<text x="${px + pw / 2}" y="${py + ph / 2}" text-anchor="middle" class="d-label">No on-chain data available</text>\n`;
      svg += `<text x="${px + pw / 2}" y="${py + ph / 2 + 14}" text-anchor="middle" class="d-small">Enable DeFiLlama data source</text>\n`;
    } else {
      // ── Top 5 protocols by TVL ──
      const sortedProtocols = [...onchain.protocols].sort((a, b) => b.tvl - a.tvl);
      const top5 = sortedProtocols.slice(0, 5);
      const maxTvl = top5[0]?.tvl ?? 1;

      const barStartY = py + 30;
      const barH = 14;
      const barGap = 4;
      const barMaxW = pw - innerPad * 2 - 10;

      for (let i = 0; i < top5.length; i++) {
        const p = top5[i]!;
        const by = barStartY + i * (barH + barGap);
        const tw = Math.max(barMaxW * (p.tvl / maxTvl), 8);

        // Background
        svg += `<rect x="${px + innerPad}" y="${by}" width="${barMaxW}" height="${barH}" class="d-bar-bg" rx="3"/>\n`;

        // Fill with gradient
        const tvlColors = ['#22d3ee', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899'];
        const fillColor = tvlColors[i % tvlColors.length]!;
        svg += `<rect x="${px + innerPad + 1}" y="${by + 1}" width="${(tw - 1).toFixed(1)}" height="${barH - 2}" fill="${fillColor}" opacity="0.8" class="d-onchain-bar d-hover-data">
          <animate attributeName="width" from="0" to="${(tw - 1).toFixed(1)}" dur="0.5s" fill="freeze"/>
        </rect>\n`;

        // Protocol name (in the bar)
        svg += `<text x="${px + innerPad + 5}" y="${by + barH - 3}" fill="#ffffff" font-family="'Inter', sans-serif" font-size="9" font-weight="700">${escapeXml(p.name)}</text>\n`;

        // TVL value (right side)
        svg += `<text x="${px + innerPad + barMaxW - 4}" y="${by + barH - 3}" text-anchor="end" fill="#f1f5f9" font-family="'Inter', monospace" font-size="9" font-weight="600">${fmtDollar(p.tvl)}</text>\n`;
        svg += `<title>${escapeXml(p.name)}: TVL ${fmtDollar(p.tvl)}${p.fees1d ? ` | 1d fees: ${fmtDollar(p.fees1d)}` : ''}</title>\n`;

        // Fee badge if available
        if (p.fees1d != null && tw > 80) {
          svg += `<text x="${(px + innerPad + barMaxW + 6).toFixed(1)}" y="${(by + barH - 3).toFixed(1)}" class="d-small" font-size="9">fees: ${fmtDollar(p.fees1d)}/1d</text>\n`;
        }
      }

      // ── Chain TVL breakdown (small text summary below bars) ──
      if (onchain.chains && onchain.chains.length > 0) {
        const chainY = barStartY + top5.length * (barH + barGap) + 8;
        svg += `<text x="${px + innerPad}" y="${chainY}" class="d-label" font-size="9">Chain TVL</text>\n`;

        const sortedChains = [...onchain.chains].sort((a, b) => b.tvl - a.tvl);
        const topChains = sortedChains.slice(0, 4);
        const maxChainTvl = topChains[0]?.tvl ?? 1;
        const chainBarStartY = chainY + 10;
        const chainBarH = 8;
        const chainBarGap = 3;

        for (let i = 0; i < topChains.length; i++) {
          const c = topChains[i]!;
          const cby = chainBarStartY + i * (chainBarH + chainBarGap);
          const ctw = Math.max(barMaxW * (c.tvl / maxChainTvl), 8);

          svg += `<rect x="${px + innerPad}" y="${cby}" width="${barMaxW}" height="${chainBarH}" class="d-bar-bg" rx="2"/>\n`;
          svg += `<rect x="${px + innerPad + 1}" y="${cby + 1}" width="${(ctw - 1).toFixed(1)}" height="${chainBarH - 2}" fill="#64748b" opacity="0.7" class="d-onchain-bar"/>\n`;
          svg += `<text x="${px + innerPad + 4}" y="${cby + chainBarH - 2}" fill="${TEXT}" font-family="'Inter', sans-serif" font-size="9" font-weight="600">${escapeXml(c.chain)}</text>\n`;
          svg += `<text x="${px + innerPad + barMaxW - 4}" y="${cby + chainBarH - 2}" text-anchor="end" fill="#94a3b8" font-family="'Inter', monospace" font-size="9">${fmtDollar(c.tvl)}</text>\n`;
          svg += `<title>${escapeXml(c.chain)}: TVL ${fmtDollar(c.tvl)}</title>\n`;
        }
      }

      // Timestamp
      svg += `<text x="${px + pw - innerPad}" y="${py + ph - 6}" text-anchor="end" class="d-small">Updated: ${escapeXml(onchain.fetchedAt)}</text>\n`;
    }
  }

  // ── FOOTER ──
  const footerY = height - 8;
  svg += `<text x="${pad}" y="${footerY}" class="d-watermark">🛰️ Hermes Crypto Radar &middot; Generated ${escapeXml(timestamp)}</text>\n`;
  svg += `<text x="${width - pad}" y="${footerY}" text-anchor="end" class="d-watermark">Sources: Binance · DeFiLlama · Strategy Engine</text>\n`;

  svg += svgClose();
  return svg;
}
