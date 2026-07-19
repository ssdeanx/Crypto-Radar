// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Output Formatters
// ═══════════════════════════════════════════════════════════════════════

import type { EnrichedTicker, OutputFormat, TokenSignal, NewsMatch, TechnicalIndicators } from './types.js';
import type { AggregatedSignal } from './analysis/strategies.js';

// ── Column Definitions ──

/** Convert camelCase to snake_case for CSV column headers */
function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Display-name overrides for CSV headers.
 * Most headers are derived via camelToSnake(), but a few established
 * abbreviations (e.g. priceChangePercent → price_change_pct) are overridden
 * to stay consistent with the XLSX / SQLite export schema.
 */
const CSV_HEADER_OVERRIDES: Partial<Record<keyof EnrichedTicker, string>> = {
  priceChangePercent: 'price_change_pct',
};

/** Typed column list — defines both header order and validation schema */
export const CSV_COLUMNS: (keyof EnrichedTicker)[] = [
  // Run metadata & identity
  'runId', 'tsUtc', 'dateEt', 'symbol', 'chain',
  // Price data
  'lastPrice', 'bidPrice', 'bidQty', 'askPrice', 'askQty',
  'spreadPct', 'openPrice', 'highPrice', 'lowPrice', 'prevClosePrice',
  'priceChangePercent', 'weightedAvgPrice', 'priceChange',
  'volume', 'quoteVolume', 'count', 'lastQty',
  'vwapDistPct', 'rangePosPct', 'bookImbalance', 'volVsAvg', 'obv', 'momentum',
  'alerts', 'source',
  // Technical indicators
  'rsi', 'macdMacd', 'macdSignal', 'macdHistogram',
  'bbUpper', 'bbMiddle', 'bbLower', 'bbWidth', 'atrPct',
  'mfi', 'stochK', 'stochD', 'williamsR', 'cmf', 'tsi', 'ema50DistPct', 'volTrend',
  // Strategy signals
  'momentumScore', 'momentumDirection',
  'meanReversionScore', 'meanReversionDirection',
  'trendFollowingScore', 'trendFollowingDirection',
  'compositeScore', 'compositeDirection',
  'signalCount', 'positionSize',
  // On-chain metrics
  'onchainTvl', 'onchainFees1d', 'onchainChainTvl', 'onchainConfidence',
  // Market regime
  'regime', 'regimeConfidence',
];

/** Typed news column list */
export const NEWS_CSV_COLUMNS: (keyof NewsMatch)[] = [
  'runId', 'tsUtc', 'symbol', 'headline', 'description',
  'source', 'domain', 'relevance',
];

/** Derived CSV header from typed column list — auto-syncs with EnrichedTicker */
export const CSV_HEADER = CSV_COLUMNS
  .map(k => CSV_HEADER_OVERRIDES[k] ?? camelToSnake(k))
  .join(',');

/** Derived news CSV header from typed column list */
export const NEWS_CSV_HEADER = NEWS_CSV_COLUMNS.map(k => camelToSnake(k)).join(',');

// ── CSV formatters ──

/**
 * Smart price formatter: preserves precision for small prices.
 * - $1+    → 2 decimal places
 * - $0.0001+ → 4 decimal places
 * - below  → 6 decimal places
 */
function fPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.0001) return v.toFixed(4);
  return v.toFixed(6);
}

/** Percentage formatter: 4 decimal places */
function fPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toFixed(4);
}

/** Generic numeric formatter with fixed decimal places */
function f(v: number | null | undefined, d: number = 2): string {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toFixed(d);
}

/** CSV-safe string: wrap in double quotes, escape internal quotes */
function q(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Format an enriched ticker as a CSV line.
 * @param ticker The enriched ticker to format
 * @returns CSV string
 */
export function toCSV(ticker: EnrichedTicker): string {
  const parts = [
    // ── Run metadata & identity ──
    q(ticker.runId),
    q(ticker.tsUtc),
    q(ticker.dateEt),
    q(ticker.symbol),
    q(ticker.chain),

    // ── Price data ──
    fPrice(ticker.lastPrice),
    fPrice(ticker.bidPrice),
    f(ticker.bidQty),
    fPrice(ticker.askPrice),
    f(ticker.askQty),
    fPct(ticker.spreadPct),
    fPrice(ticker.openPrice),
    fPrice(ticker.highPrice),
    fPrice(ticker.lowPrice),
    fPrice(ticker.prevClosePrice),
    fPct(ticker.priceChangePercent),
    fPrice(ticker.weightedAvgPrice),
    fPrice(ticker.priceChange),
    f(ticker.volume, 0),
    f(ticker.quoteVolume, 2),
    ticker.count.toString(),
    f(ticker.lastQty),
    fPct(ticker.vwapDistPct),
    fPct(ticker.rangePosPct),
    fPct(ticker.bookImbalance),
    fPct(ticker.volVsAvg),
    fPct(ticker.obv),
    fPct(ticker.momentum),
    q(ticker.alerts),
    q(ticker.source),

    // ── Technical indicators ──
    f(ticker.rsi, 2),
    f(ticker.macdMacd, 4),
    f(ticker.macdSignal, 4),
    f(ticker.macdHistogram, 4),
    fPrice(ticker.bbUpper),
    fPrice(ticker.bbMiddle),
    fPrice(ticker.bbLower),
    fPct(ticker.bbWidth),
    fPct(ticker.atrPct),
    f(ticker.mfi, 2),
    f(ticker.stochK, 2),
    f(ticker.stochD, 2),
    f(ticker.williamsR, 2),
    f(ticker.cmf, 4),
    f(ticker.tsi, 4),
    fPct(ticker.ema50DistPct),
    f(ticker.volTrend, 4),

    // ── Strategy signals ──
    f(ticker.momentumScore, 2),
    q(ticker.momentumDirection ?? ''),
    f(ticker.meanReversionScore, 2),
    q(ticker.meanReversionDirection ?? ''),
    f(ticker.trendFollowingScore, 2),
    q(ticker.trendFollowingDirection ?? ''),
    f(ticker.compositeScore, 2),
    q(ticker.compositeDirection ?? ''),
    ticker.signalCount != null ? ticker.signalCount.toString() : '',
    f(ticker.positionSize, 4),

    // ── On-chain metrics ──
    f(ticker.onchainTvl, 2),
    f(ticker.onchainFees1d, 2),
    f(ticker.onchainChainTvl, 2),
    f(ticker.onchainConfidence, 4),

    // ── Market regime ──
    q(ticker.regime ?? ''),
    f(ticker.regimeConfidence, 4),
  ];
  return parts.join(',');
}

/**
 * Get the CSV header line.
 * @returns Header string
 */
export function csvHeader(): string {
  return CSV_HEADER;
}

// ── JSON Lines ──

/**
 * Canonical schema key list for EnrichedTicker.
 * Every optional field is included so the JSONL dataset always has a
 * consistent schema — missing/unset fields serialize as `null` instead of
 * being omitted. This is critical for ML fine-tuning where variable schemas
 * break training pipelines.
 *
 * Includes ALL fields from the EnrichedTicker interface including the newer
 * technical indicators that are in the type but not yet in CSV_COLUMNS.
 */
export const TICKER_KEYS: (keyof EnrichedTicker)[] = [
  // Run metadata & identity
  'runId', 'tsUtc', 'dateEt', 'symbol', 'chain', 'tokenId', 'tokenName',
   // Price data
   'lastPrice', 'bidPrice', 'bidQty', 'askPrice', 'askQty',
   'spreadPct', 'openPrice', 'highPrice', 'lowPrice', 'prevClosePrice',
   'priceChangePercent', 'weightedAvgPrice', 'priceChange',
   'volume', 'quoteVolume', 'count', 'lastQty',
   'vwapDistPct', 'rangePosPct', 'bookImbalance', 'volVsAvg', 'obv', 'momentum',
   'alerts', 'source',
   // Technical indicators
   'rsi', 'macdMacd', 'macdSignal', 'macdHistogram',
   'bbUpper', 'bbMiddle', 'bbLower', 'bbWidth', 'atrPct',
   'mfi', 'stochK', 'stochD', 'williamsR', 'cmf', 'tsi', 'ema50DistPct', 'volTrend',
   // New technical indicators
   'adx', 'psar', 'cci', 'keltnerWidth', 'keltnerPos', 'roc', 'forceIndex',
   'adl', 'chaikinOsc', 'stochRsi', 'stochRsiK', 'stochRsiD', 'trix', 'kst',
   'elderBullPower', 'elderBearPower', 'fisher', 'massIndex',
   // Strategy signals
   'momentumScore', 'momentumDirection',
   'meanReversionScore', 'meanReversionDirection',
   'trendFollowingScore', 'trendFollowingDirection',
   'compositeScore', 'compositeDirection',
   'signalCount', 'positionSize',
   // On-chain metrics
   'onchainTvl', 'onchainFees1d', 'onchainChainTvl', 'onchainConfidence',
   // Market regime
   'regime', 'regimeConfidence',
 ];

 /**
  * Format an enriched ticker as a JSON line for ML-ready JSONL datasets.
  *
  * Uses the canonical TICKER_KEYS schema to ensure every line has the same
  * keys — all unset optional fields become `null` instead of being omitted.
  * This gives model training a consistent input shape across every record.
  *
  * @param ticker The enriched ticker to format
  * @returns Minified JSON string with consistent schema (nulls, not missing keys)
  */
export function toJSONLine(ticker: EnrichedTicker): string {
  const obj: Record<string, unknown> = {};
  for (const key of TICKER_KEYS) {
    obj[key as string] = ticker[key] ?? null;
  }
  return JSON.stringify(obj);
}

// ── Markdown report ──

/**
 * Generate a full markdown radar report.
 * @param tickers Array of enriched tickers
 * @param technicals Optional map of technical indicators by symbol
 * @param newsMatches Optional array of news matches
 * @returns Markdown report string
 */
export function toMarkdownReport(
  tickers: EnrichedTicker[],
  technicals?: Map<string, TechnicalIndicators>,
  newsMatches?: NewsMatch[],
): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  lines.push(`# 🛰️ Crypto Radar — ${now.slice(0, 19)}Z\n`);

  // Summary
  const total = tickers.length;
  const gainers = tickers.filter(t => t.priceChangePercent > 0).length;
  const losers = tickers.filter(t => t.priceChangePercent < 0).length;
  lines.push(`**${total} tokens tracked** — 📈 ${gainers} up · 📉 ${losers} down\n`);

  // Table
  lines.push('| Symbol | Chain | Price | 24h Chg | Vol (24h) | Spread | Momentum |');
  lines.push('|--------|-------|-------|---------|-----------|--------|----------|');

  for (const t of tickers) {
    const chgStr = t.priceChangePercent >= 0
      ? `+${t.priceChangePercent.toFixed(2)}%`
      : `${t.priceChangePercent.toFixed(2)}%`;
    const momentumTag = t.momentum >= 5 ? '🚀' : t.momentum <= -5 ? '⚠️' : '';
    lines.push(
      `| ${t.symbol} | ${t.chain} | $${fmtPrice(t.lastPrice)} | ${chgStr} | ${fmtQuoteVol(t.quoteVolume)} | ${t.spreadPct.toFixed(3)}% | ${momentumTag}`,
    );
  }

  // Technical indicators section
  if (technicals && technicals.size > 0) {
    lines.push('\n## 📊 Technical Indicators\n');
    lines.push('| Symbol | RSI | MFI | BB Width | MACD Hist | ATR% | Vol Trend | Price vs EMA50 |');
    lines.push('|--------|-----|-----|----------|-----------|------|-----------|----------------|');

    for (const [sym, ti] of Array.from(technicals)) {
      lines.push(
        `| ${sym} | ${ti.rsi?.toFixed(1) ?? '—'} | ${ti.mfi?.toFixed(1) ?? '—'} | ${ti.bb?.width.toFixed(3) ?? '—'} | ${ti.macd?.histogram != null ? ti.macd.histogram.toExponential(2) : '—'} | ${ti.atrPct?.toFixed(2) ?? '—'}% | ${ti.volTrend?.toFixed(2) ?? '—'} | ${ti.priceVsEma50?.toFixed(2) ?? '—'}%`,
      );
    }
  }

  // News section
  if (newsMatches && newsMatches.length > 0) {
    lines.push('\n## 📰 News Signals\n');

    // Group by symbol
    const bySymbol = new Map<string, NewsMatch[]>();
    for (const m of newsMatches) {
      const arr = bySymbol.get(m.symbol) ?? [];
      arr.push(m);
      bySymbol.set(m.symbol, arr);
    }

    for (const [sym, items] of Array.from(bySymbol)) {
      lines.push(`### ${sym}\n`);
      for (const item of items.slice(0, 3)) {
        lines.push(`- **${item.headline}** (${item.source}, rel: ${item.relevance})`);
        if (item.description) {
          lines.push(`  ${item.description.slice(0, 200)}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// ── Terminal table ──

/**
 * Format tickers as a terminal-friendly table.
 * @param tickers Array of enriched tickers
 * @param aggregatedSignals Optional aggregated signals
 * @returns Terminal table string
 */
export function toTable(tickers: EnrichedTicker[], aggregatedSignals?: AggregatedSignal[]): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  lines.push(`🛰️  Crypto Radar — ${now}  |  ${tickers.length} tokens` +
    (aggregatedSignals && aggregatedSignals.length > 0 ? `  |  ${aggregatedSignals.length} signals` : '') + '\n');

  // Header
  lines.push('Sym     Chain    Price        24h Chg    Vol(24h)    Spread   Momentum  Tags');

  // Build a lookup of signal tags per symbol
  const signalTags = new Map<string, string>();
  if (aggregatedSignals) {
    for (const sig of aggregatedSignals) {
      const dir = sig.direction === 'buy' ? '🟢' : sig.direction === 'sell' ? '🔴' : '⚪';
      signalTags.set(sig.symbol, `${dir}${(sig.compositeConfidence * 100).toFixed(0)}%`);
    }
  }

  for (const t of tickers) {
    const sym = t.symbol.padEnd(7);
    const chain = t.chain.padEnd(8);
    const price = fmtPrice(t.lastPrice).padEnd(12);
    const chg = (t.priceChangePercent >= 0 ? '+' : '') + t.priceChangePercent.toFixed(2) + '%';
    const chgStr = chg.padEnd(10);
    const vol = fmtQuoteVol(t.quoteVolume).padEnd(10);
    const spread = fmtSpread(t.spreadPct).padEnd(8);
    const momentum = t.momentum.toFixed(1).padEnd(8);

    // Tags
    const tags: string[] = [];
    if (t.priceChangePercent <= -5) tags.push('🔴DIP');
    else if (t.priceChangePercent >= 5) tags.push('🟢PUMP');
    if (t.quoteVolume >= 10e6) tags.push('💧HI-LIQ');
    if (t.spreadPct >= 1) tags.push('⚠️WIDE');
    const sigTag = signalTags.get(t.symbol);
    if (sigTag) tags.push(sigTag);
    const tagStr = tags.join(' ');

    lines.push(`${sym} ${chain} ${price} ${chgStr} ${vol} ${spread} ${momentum} ${tagStr}`);
  }

  return lines.join('\n');
}

// ── Signal report ──

/**
 * Generate a signal report string sorted by composite score.
 * @param signals Array of token signals
 * @returns Formatted signal report
 */
export function toSignalReport(signals: TokenSignal[]): string {
  const sorted = [...signals]
    .sort((a, b) => (Number.isFinite(b.compositeScore) ? b.compositeScore : -Infinity)
      - (Number.isFinite(a.compositeScore) ? a.compositeScore : -Infinity));
  const lines: string[] = [];

  lines.push('# 🚀 Crypto Radar — Signals\n');

  for (const s of sorted.slice(0, 10)) {
    const scoreBar = scoreToBar(s.compositeScore, 20);
    lines.push(`## ${s.symbol} (${s.chain}) — Score: ${s.compositeScore.toFixed(1)}/100`);
    lines.push(`Price: $${s.lastPrice} | 24h: ${s.priceChangePercent >= 0 ? '+' : ''}${s.priceChangePercent.toFixed(2)}%`);
    lines.push(`Momentum: ${s.momentumScore.toFixed(1)} | Technical: ${s.technicalScore.toFixed(1)} | News: ${s.newsScore.toFixed(1)}`);
    lines.push(`\`${scoreBar}\``);
    if (s.alerts.length > 0) {
      lines.push(`Alerts: ${s.alerts.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Helpers ──

function fmtPrice(v: number): string {
  return v < 1 ? '$' + v.toFixed(6) : '$' + v.toFixed(2);
}

function fmtQuoteVol(v: number): string {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}

function fmtSpread(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) + '%' : '—';
}

function scoreToBar(score: number, maxLen: number): string {
  const filled = Math.round((score / 100) * maxLen);
  const empty = maxLen - filled;
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, empty));
}

// ── JSON Schema Validation ──

export interface ValidationError {
  field: string;
  message: string;
  value: unknown;
}

/**
 * Validate radar output data against expected schema.
 * Returns list of validation errors (empty = valid).
 */
export function validateOutput(
  tickers: EnrichedTicker[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i]!;

    // Schema drift check: verify every CSV_COLUMNS field exists on row
    for (const key of CSV_COLUMNS) {
      if (t[key] === undefined) {
        errors.push({ field: `tickers[${i}].${key}`, message: 'Field missing (undefined) — CSV_COLUMNS field not populated', value: undefined });
      }
    }

    if (typeof t.lastPrice !== 'number' || isNaN(t.lastPrice)) {
      errors.push({ field: `tickers[${i}].lastPrice`, message: 'Must be a valid number', value: t.lastPrice });
    }
    if (!t.symbol || typeof t.symbol !== 'string') {
      errors.push({ field: `tickers[${i}].symbol`, message: 'Must be a non-empty string', value: t.symbol });
    }
    if (typeof t.priceChangePercent !== 'number' || isNaN(t.priceChangePercent)) {
      errors.push({ field: `tickers[${i}].priceChangePercent`, message: 'Must be a valid number', value: t.priceChangePercent });
    }
    if (typeof t.runId !== 'string' || t.runId.length === 0) {
      errors.push({ field: `tickers[${i}].runId`, message: 'Must be a non-empty string', value: t.runId });
    }
    if (typeof t.tsUtc !== 'string' || t.tsUtc.length === 0) {
      errors.push({ field: `tickers[${i}].tsUtc`, message: 'Must be a non-empty string', value: t.tsUtc });
    }
    if (typeof t.chain !== 'string' || t.chain.length === 0) {
      errors.push({ field: `tickers[${i}].chain`, message: 'Must be a non-empty string', value: t.chain });
    }
    if (typeof t.volume !== 'number' || isNaN(t.volume) || t.volume < 0) {
      errors.push({ field: `tickers[${i}].volume`, message: 'Must be a non-negative number', value: t.volume });
    }
    if (typeof t.quoteVolume !== 'number' || isNaN(t.quoteVolume) || t.quoteVolume < 0) {
      errors.push({ field: `tickers[${i}].quoteVolume`, message: 'Must be a non-negative number', value: t.quoteVolume });
    }
    if (typeof t.spreadPct !== 'number' || isNaN(t.spreadPct)) {
      errors.push({ field: `tickers[${i}].spreadPct`, message: 'Must be a valid number', value: t.spreadPct });
    }
    if (typeof t.momentum !== 'number' || isNaN(t.momentum)) {
      errors.push({ field: `tickers[${i}].momentum`, message: 'Must be a valid number', value: t.momentum });
    }
  }
  return errors;
}

/**
 * Format enriched tickers for display according to the requested output format.
 * @param tickers Array of enriched tickers
 * @param format Output format ('table' | 'csv' | 'json' | 'md' | 'xlsx')
 * @param aggregatedSignals Optional aggregated signals to include in table output
 * @returns Formatted string (empty for xlsx — handled by caller)
 */
export function formatOutput(
  tickers: EnrichedTicker[],
  format: OutputFormat,
  aggregatedSignals?: AggregatedSignal[],
): string {
  switch (format) {
    case 'table':
      return toTable(tickers, aggregatedSignals);
    case 'csv':
      return [csvHeader(), ...tickers.map(t => toCSV(t))].join('\n');
    case 'json':
      return JSON.stringify(tickers, null, 2);
    case 'md':
      return toMarkdownReport(tickers);
    case 'xlsx':
      return ''; // xlsx handled by export pipeline
    default:
      return toTable(tickers, aggregatedSignals);
  }
}
