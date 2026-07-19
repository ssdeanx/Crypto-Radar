// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — PDF/HTML Report Generator
// ═══════════════════════════════════════════════════════════════════════
//
// Generates a self-contained HTML report with embedded SVG charts.
// User opens in browser and prints to PDF (File > Print > Save as PDF).
// No external deps — pure string templates.

import type { EnrichedTicker } from './types.js';
import type { AggregatedSignal, SignalDirection } from './analysis/strategies.js';
import type { OnChainMetrics } from './onchain.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface ReportConfig {
  title: string;
  date: string;
  tickers: EnrichedTicker[];
  aggregatedSignals: AggregatedSignal[];
  onchain: OnChainMetrics | null;
  includeCharts?: boolean;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Generate a full HTML report page.
 * Self-contained — all CSS inline, all SVG embedded.
 */
export function generateHtmlReport(config: ReportConfig): string {
  const {
    title,
    date,
    tickers,
    aggregatedSignals,
    onchain,
    includeCharts = true,
  } = config;

  const total = tickers.length;
  const totalGainers = tickers.filter(t => t.priceChangePercent > 0).length;
  const totalLosers = tickers.filter(t => t.priceChangePercent < 0).length;
  const totalVolume = tickers.reduce((s, t) => s + t.quoteVolume, 0);

  const strongBuy = aggregatedSignals.filter(s => s.direction === 'strong_buy').length;
  const buy = aggregatedSignals.filter(s => s.direction === 'buy').length;
  const neutral = aggregatedSignals.filter(s => s.direction === 'neutral').length;
  const sell = aggregatedSignals.filter(s => s.direction === 'sell').length;
  const strongSell = aggregatedSignals.filter(s => s.direction === 'strong_sell').length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — Crypto Radar Report</title>
<style>${CSS_TEMPLATE}</style>
</head>
<body>

<div class="container">

  <!-- Header -->
  <div class="header">
    <h1>🛰️ ${escapeHtml(title)}</h1>
    <div class="subtitle">Generated ${escapeHtml(date)}</div>
  </div>

  <!-- Summary Stats -->
  <div class="summary-grid">
    <div class="stat-card">
      <div class="stat-value">${total}</div>
      <div class="stat-label">Tokens Tracked</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color: #22c55e;">${totalGainers}</div>
      <div class="stat-label">Gainers (24h)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color: #ef4444;">${totalLosers}</div>
      <div class="stat-label">Losers (24h)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${formatVolume(totalVolume)}</div>
      <div class="stat-label">Total Volume (24h)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${aggregatedSignals.length}</div>
      <div class="stat-label">Active Signals</div>
    </div>
  </div>

  <!-- Signal Distribution -->
  ${aggregatedSignals.length > 0 ? `
  <div class="card">
    <h2>📊 Signal Distribution</h2>
    <div class="signal-distribution">
      ${strongBuy ? `<div class="signal-bar"><span class="badge bg-green-700">Strong Buy</span><span class="bar-fill" style="width:${(strongBuy / aggregatedSignals.length * 100).toFixed(1)}%;background:#16a34a;"></span><span class="bar-count">${strongBuy}</span></div>` : ''}
      ${buy ? `<div class="signal-bar"><span class="badge bg-green-600">Buy</span><span class="bar-fill" style="width:${(buy / aggregatedSignals.length * 100).toFixed(1)}%;background:#22c55e;"></span><span class="bar-count">${buy}</span></div>` : ''}
      ${neutral ? `<div class="signal-bar"><span class="badge bg-gray-600">Neutral</span><span class="bar-fill" style="width:${(neutral / aggregatedSignals.length * 100).toFixed(1)}%;background:#64748b;"></span><span class="bar-count">${neutral}</span></div>` : ''}
      ${sell ? `<div class="signal-bar"><span class="badge bg-red-600">Sell</span><span class="bar-fill" style="width:${(sell / aggregatedSignals.length * 100).toFixed(1)}%;background:#ef4444;"></span><span class="bar-count">${sell}</span></div>` : ''}
      ${strongSell ? `<div class="signal-bar"><span class="badge bg-red-700">Strong Sell</span><span class="bar-fill" style="width:${(strongSell / aggregatedSignals.length * 100).toFixed(1)}%;background:#dc2626;"></span><span class="bar-count">${strongSell}</span></div>` : ''}
    </div>
  </div>` : ''}

  <!-- Token Table -->
  <div class="card">
    <h2>📋 Token Prices</h2>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Chain</th>
            <th>Price</th>
            <th>24h Change</th>
            <th>Volume</th>
            <th>Spread</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          ${tickers.map(t => {
            const signal = aggregatedSignals.find(s => s.symbol === t.symbol);
            const chgClass = t.priceChangePercent > 0 ? 'buy' : t.priceChangePercent < 0 ? 'sell' : 'neutral';
            const chgSign = t.priceChangePercent >= 0 ? '+' : '';
            return `<tr>
              <td><strong>${escapeHtml(t.symbol)}</strong></td>
              <td>${escapeHtml(t.chain)}</td>
              <td>${formatPrice(t.lastPrice)}</td>
              <td class="${chgClass}">${chgSign}${t.priceChangePercent.toFixed(2)}%</td>
              <td>${formatVolume(t.quoteVolume)}</td>
              <td>${t.spreadPct.toFixed(3)}%</td>
              <td>${signal ? signalBadge(signal.direction) : '<span class="badge bg-gray-600">—</span>'}</td>
            </tr>`;
          }).join('\n            ')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Top Signals Detail -->
  ${aggregatedSignals.length > 0 ? `
  <div class="card">
    <h2>🚀 Top Signals Detail</h2>
    ${aggregatedSignals
      .sort((a, b) => b.compositeConfidence - a.compositeConfidence)
      .slice(0, 5)
      .map(s => `
    <div class="signal-detail">
      <div class="signal-detail-header">
        <strong>${escapeHtml(s.symbol)}</strong> (${escapeHtml(s.chain)})
        ${signalBadge(s.direction)}
        <span class="confidence">${(s.compositeConfidence * 100).toFixed(0)}% confidence</span>
      </div>
      <div class="signal-detail-body">
        <div class="signal-meta">
          Price: ${formatPrice(s.lastPrice)} |
          24h: ${s.priceChangePercent >= 0 ? '+' : ''}${s.priceChangePercent.toFixed(2)}%
        </div>
        ${s.compositeReason ? `<div class="signal-reason">${escapeHtml(s.compositeReason)}</div>` : ''}
        ${s.signals.length > 0 ? `
        <div class="signal-sub-signals">
          ${s.signals.slice(0, 4).map((sub: import('./analysis/strategies.js').StrategySignal) => `
            <div class="sub-signal">
              <span class="badge ${sub.direction === 'buy' || sub.direction === 'strong_buy' ? 'bg-green-600' : sub.direction === 'sell' || sub.direction === 'strong_sell' ? 'bg-red-600' : 'bg-gray-600'}">${sub.strategy}</span>
              <span>${escapeHtml(sub.reason)}</span>
            </div>
          `).join('\n            ')}
        </div>` : ''}
      </div>
    </div>`).join('\n    ')}
  </div>` : ''}

  <!-- SVG Charts -->
  ${includeCharts && tickers.length > 0 ? `
  <div class="card">
    <h2>📈 Top Movers — Bar Chart</h2>
    ${generateBarChart(tickers.slice(0, 10), 700, 300)}
  </div>` : ''}

  ${includeCharts && aggregatedSignals.length > 4 ? `
  <div class="card">
    <h2>🎯 Signal Confidence — Top Signals</h2>
    ${generateConfidenceChart(aggregatedSignals.slice(0, 10), 700, 300)}
  </div>` : ''}

  <!-- On-Chain Metrics -->
  ${onchain ? `
  <div class="card">
    <h2>⛓️ On-Chain Metrics</h2>
    <table>
      <thead>
        <tr>
          <th>Protocol</th>
          <th>TVL</th>
          <th>Fees (1d)</th>
          <th>Fees (7d)</th>
        </tr>
      </thead>
      <tbody>
        ${onchain.protocols.slice(0, 10).map((p: import('./onchain.js').ProtocolMetrics) => `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>$${formatLargeNumber(p.tvl)}</td>
          <td>${p.fees1d != null ? '$' + formatLargeNumber(p.fees1d) : '—'}</td>
          <td>${p.fees7d != null ? '$' + formatLargeNumber(p.fees7d) : '—'}</td>
        </tr>`).join('\n        ')}
      </tbody>
    </table>
    ${onchain.protocols.length > 10 ? `<div class="note">Showing 10 of ${onchain.protocols.length} protocols</div>` : ''}
  </div>` : ''}

  <!-- Footer -->
  <div class="footer">
    <p>Generated by Hermes Crypto Radar • ${escapeHtml(date)}</p>
    <p class="footer-note">Print to PDF: File → Print → Save as PDF (enable background graphics)</p>
  </div>

</div>

</body>
</html>`;

  return html;
}

/**
 * Generate a signal snapshot report — compact, one-page.
 */
export function generateSignalSnapshot(
  signals: AggregatedSignal[],
): string {
  const sorted = [...signals].sort((a, b) => b.compositeConfidence - a.compositeConfidence);
  const date = new Date().toISOString().slice(0, 10);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Crypto Radar — Signal Snapshot</title>
<style>${SNAPSHOT_CSS_TEMPLATE}</style>
</head>
<body>

<div class="container">

  <div class="header">
    <h1>🚀 Signal Snapshot</h1>
    <div class="subtitle">${date} • ${signals.length} active signals</div>
  </div>

  <div class="summary-strip">
    <span class="summary-chip">🟢 Strong Buy: ${sorted.filter(s => s.direction === 'strong_buy').length}</span>
    <span class="summary-chip">🟢 Buy: ${sorted.filter(s => s.direction === 'buy').length}</span>
    <span class="summary-chip">⚪ Neutral: ${sorted.filter(s => s.direction === 'neutral').length}</span>
    <span class="summary-chip">🔴 Sell: ${sorted.filter(s => s.direction === 'sell').length}</span>
    <span class="summary-chip">🔴 Strong Sell: ${sorted.filter(s => s.direction === 'strong_sell').length}</span>
  </div>

  ${sorted.map(s => `
  <div class="signal-row">
    <div class="signal-left">
      <strong>${escapeHtml(s.symbol)}</strong>
      <span class="signal-chain">${escapeHtml(s.chain)}</span>
      ${signalBadge(s.direction)}
    </div>
    <div class="signal-right">
      <span class="signal-confidence">${(s.compositeConfidence * 100).toFixed(0)}%</span>
      <span class="signal-price">${formatPrice(s.lastPrice)}</span>
    </div>
    ${s.compositeReason ? `<div class="signal-reason-full">${escapeHtml(s.compositeReason)}</div>` : ''}
  </div>`).join('\n  ')}

  ${signals.length === 0 ? '<div class="empty-state">No signals generated for this period.</div>' : ''}

  <div class="footer">
    <p>Generated by Hermes Crypto Radar</p>
  </div>

</div>

</body>
</html>`;

  return html;
}

// ── SVG Chart Helpers ──────────────────────────────────────────────────

/**
 * Generate an inline SVG bar chart for the top N tokens by volume.
 */
function generateBarChart(tickers: EnrichedTicker[], width: number, height: number): string {
  if (tickers.length === 0) return '<p>No data available</p>';

  const sorted = [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume);
  const maxVol = sorted[0]!.quoteVolume || 1;
  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 60;
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;
  const barCount = sorted.length;
  const barWidth = Math.max(8, Math.min(40, chartW / barCount - 4));
  const gap = Math.max(2, (chartW - barWidth * barCount) / (barCount + 1));

  const bars = sorted.map((t, i) => {
    const barH = (t.quoteVolume / maxVol) * chartH;
    const x = paddingLeft + gap + i * (barWidth + gap);
    const y = paddingTop + chartH - barH;
    const color = t.priceChangePercent >= 0 ? '#22c55e' : '#ef4444';
    const label = t.symbol.replace('USDT', '');
    return `
    <rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${barWidth.toFixed(0)}" height="${barH.toFixed(0)}" fill="${color}" opacity="0.85" rx="2">
      <title>${escapeHtml(t.symbol)}: ${formatVolume(t.quoteVolume)} (${t.priceChangePercent >= 0 ? '+' : ''}${t.priceChangePercent.toFixed(2)}%)</title>
    </rect>
    <text x="${(x + barWidth / 2).toFixed(0)}" y="${(height - 15).toFixed(0)}" text-anchor="middle" font-size="10" fill="#94a3b8">${escapeHtml(label)}</text>`;
  }).join('\n    ');

  // Y-axis gridlines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(pct => {
    const y = paddingTop + chartH - chartH * pct;
    const val = maxVol * pct;
    return `
    <line x1="${paddingLeft}" y1="${y.toFixed(0)}" x2="${(width - paddingRight)}" y2="${y.toFixed(0)}" stroke="#1e293b" stroke-width="1" />
    <text x="${(paddingLeft - 8).toFixed(0)}" y="${(y + 4).toFixed(0)}" text-anchor="end" font-size="10" fill="#64748b">${formatVolumeShort(val)}</text>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="none" />
    ${gridLines}
    ${bars}
  </svg>`;
}

/**
 * Generate an inline SVG horizontal bar chart for signal confidence.
 */
function generateConfidenceChart(signals: AggregatedSignal[], width: number, height: number): string {
  if (signals.length === 0) return '<p>No signal data</p>';

  const barH = 22;
  const gap = 6;
  const labelW = 100;
  const barAreaW = width - labelW - 60;
  const padding = 10;
  const chartH = signals.length * (barH + gap) + padding * 2;
  const actualH = Math.max(height, chartH);

  const bars = signals.map((s, i) => {
    const y = padding + i * (barH + gap);
    const barW = s.compositeConfidence * barAreaW;
    const color = s.direction === 'strong_buy' ? '#16a34a'
      : s.direction === 'buy' ? '#22c55e'
      : s.direction === 'sell' ? '#ef4444'
      : s.direction === 'strong_sell' ? '#dc2626'
      : '#64748b';
    return `
    <text x="${(labelW - 8).toFixed(0)}" y="${(y + barH / 2 + 1).toFixed(0)}" text-anchor="end" font-size="11" fill="#f1f5f9">${escapeHtml(s.symbol.replace('USDT', ''))}</text>
    <rect x="${labelW}" y="${y.toFixed(0)}" width="${barW.toFixed(0)}" height="${barH.toFixed(0)}" fill="${color}" opacity="0.85" rx="3">
      <title>${escapeHtml(s.symbol)}: ${(s.compositeConfidence * 100).toFixed(0)}% — ${s.direction}</title>
    </rect>
    <text x="${(labelW + barW + 6).toFixed(0)}" y="${(y + barH / 2 + 1).toFixed(0)}" font-size="10" fill="#94a3b8">${(s.compositeConfidence * 100).toFixed(0)}%</text>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${actualH}" viewBox="0 0 ${width} ${actualH}">
    <rect width="${width}" height="${actualH}" fill="none" />
    ${bars}
  </svg>`;
}

// ── Signal direction badge ──

function signalBadge(direction: SignalDirection | string): string {
  const colors: Record<string, string> = {
    strong_buy: 'bg-green-700',
    buy: 'bg-green-600',
    neutral: 'bg-gray-600',
    sell: 'bg-red-600',
    strong_sell: 'bg-red-700',
  };
  return `<span class="badge ${colors[direction] ?? 'bg-gray-600'}">${escapeHtml(direction)}</span>`;
}

// ── CSS Template ──

const CSS_TEMPLATE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f1f5f9; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .container { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
  .header { text-align: center; padding: 32px 0 24px; border-bottom: 1px solid #1e293b; margin-bottom: 24px; }
  h1 { font-size: 28px; color: #22d3ee; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 14px; color: #64748b; }
  h2 { font-size: 18px; color: #f1f5f9; margin-bottom: 16px; font-weight: 600; }

  /* Summary grid */
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-card { background: #1e293b; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: 700; color: #f1f5f9; }
  .stat-label { font-size: 12px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Cards */
  .card { background: #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  .card h2:first-child { margin-top: 0; }

  /* Tables */
  .table-wrapper { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #334155; text-align: left; padding: 10px 8px; font-weight: 600; color: #94a3b8; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
  td { padding: 10px 8px; border-bottom: 1px solid #1e293b; }
  tr:hover { background: #0f172a; }

  /* Signal colors */
  .buy { color: #22c55e; }
  .sell { color: #ef4444; }
  .neutral { color: #94a3b8; }
  .strong_buy { color: #16a34a; font-weight: bold; }
  .strong_sell { color: #dc2626; font-weight: bold; }

  /* Badge */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; text-transform: capitalize; color: #fff; }
  .bg-green-700 { background: #15803d; }
  .bg-green-600 { background: #16a34a; }
  .bg-gray-600 { background: #475569; }
  .bg-red-600 { background: #dc2626; }
  .bg-red-700 { background: #b91c1c; }

  /* Signal distribution */
  .signal-distribution { display: flex; flex-direction: column; gap: 8px; }
  .signal-bar { display: flex; align-items: center; gap: 8px; }
  .signal-bar .badge { min-width: 100px; }
  .bar-fill { height: 20px; border-radius: 4px; transition: width 0.3s; }
  .bar-count { font-size: 13px; color: #94a3b8; min-width: 24px; }

  /* Signal detail */
  .signal-detail { border: 1px solid #334155; border-radius: 6px; margin-bottom: 12px; overflow: hidden; }
  .signal-detail-header { background: #0f172a; padding: 10px 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .signal-detail-header strong { font-size: 15px; }
  .confidence { font-size: 12px; color: #94a3b8; margin-left: auto; }
  .signal-detail-body { padding: 10px 12px; }
  .signal-meta { font-size: 12px; color: #64748b; margin-bottom: 4px; }
  .signal-reason { font-size: 13px; color: #cbd5e1; margin: 6px 0; }
  .signal-sub-signals { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .sub-signal { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #94a3b8; }
  .sub-signal .badge { min-width: 80px; }

  /* Signal snapshot row */
  .signal-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; background: #1e293b; border-radius: 6px; padding: 12px; margin-bottom: 8px; }
  .signal-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 180px; }
  .signal-left strong { font-size: 15px; }
  .signal-chain { font-size: 11px; color: #64748b; }
  .signal-right { display: flex; align-items: center; gap: 12px; }
  .signal-confidence { font-size: 16px; font-weight: 700; color: #22d3ee; }
  .signal-price { font-size: 13px; color: #94a3b8; }
  .signal-reason-full { width: 100%; font-size: 12px; color: #64748b; margin-top: 4px; padding-top: 6px; border-top: 1px solid #334155; }

  /* Summary strip */
  .summary-strip { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .summary-chip { background: #1e293b; border-radius: 20px; padding: 4px 12px; font-size: 12px; color: #94a3b8; }

  .empty-state { text-align: center; padding: 40px; color: #64748b; font-size: 14px; }

  /* Footer */
  .footer { text-align: center; padding: 24px 0; border-top: 1px solid #1e293b; margin-top: 24px; }
  .footer p { font-size: 12px; color: #475569; }
  .footer-note { font-size: 11px; color: #334155; margin-top: 2px; }

  .note { font-size: 12px; color: #64748b; text-align: center; padding: 8px; }

  /* SVG inline fix */
  svg { display: block; margin: 0 auto; max-width: 100%; height: auto; }

  @media print {
    body { background: #0f172a !important; }
    .card { break-inside: avoid; }
    .header { break-after: avoid; }
  }
`;

const SNAPSHOT_CSS_TEMPLATE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f1f5f9; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .container { max-width: 720px; margin: 0 auto; padding: 16px; }
  .header { text-align: center; padding: 20px 0 16px; border-bottom: 1px solid #1e293b; margin-bottom: 16px; }
  h1 { font-size: 22px; color: #22d3ee; }
  .subtitle { font-size: 13px; color: #64748b; }
  .summary-strip { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .summary-chip { background: #1e293b; border-radius: 16px; padding: 3px 10px; font-size: 11px; color: #94a3b8; }
  .signal-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; background: #1e293b; border-radius: 6px; padding: 10px; margin-bottom: 6px; }
  .signal-left { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 160px; }
  .signal-left strong { font-size: 14px; }
  .signal-chain { font-size: 10px; color: #64748b; }
  .signal-right { display: flex; align-items: center; gap: 8px; }
  .signal-confidence { font-size: 15px; font-weight: 700; color: #22d3ee; }
  .signal-price { font-size: 12px; color: #94a3b8; }
  .signal-reason-full { width: 100%; font-size: 11px; color: #64748b; margin-top: 3px; padding-top: 5px; border-top: 1px solid #334155; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 500; text-transform: capitalize; color: #fff; }
  .bg-green-700 { background: #15803d; }
  .bg-green-600 { background: #16a34a; }
  .bg-gray-600 { background: #475569; }
  .bg-red-600 { background: #dc2626; }
  .bg-red-700 { background: #b91c1c; }
  .empty-state { text-align: center; padding: 30px; color: #64748b; }
  .footer { text-align: center; padding: 16px 0; border-top: 1px solid #1e293b; margin-top: 16px; }
  .footer p { font-size: 11px; color: #475569; }
  @media print { body { background: #0f172a !important; } }
`;

// ── Utility Helpers ────────────────────────────────────────────────────

function formatPrice(v: number): string {
  return v < 1 ? '$' + v.toFixed(6) : '$' + v.toFixed(2);
}

function formatVolume(v: number): string {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}

function formatVolumeShort(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v.toFixed(0);
}

function formatLargeNumber(v: number): string {
  if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
