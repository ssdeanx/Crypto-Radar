// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Radar Engine
// ═══════════════════════════════════════════════════════════════════════

import type {
  BinanceTicker, EnrichedTicker, TechnicalIndicators,
  NewsMatch, TokenSignal, RadarOptions, RadarRun, KlineInterval,
  Kline,
} from './types.js';
import type { Store } from './store/db.js';
import { getTokensByChain, getBinancePair } from './tokens.js';
import type { TokenDef } from './tokens.js';
import { fetchAllTickers, fetchKlines, fetchTickers7d } from './binance.js';
import { fetchSimplePrices } from './coingecko.js';
import type { CoinGeckoPrice } from './coingecko.js';
import { fetchOnChainMetrics } from './onchain.js';
import type { OnChainMetrics } from './onchain.js';
import { batchComputeAllIndicators } from './indicators.js';
import { fetchAndMatchNews, appendNewsToJsonl } from './news.js';
import { computeSignals } from './signals.js';
import { logger } from './core/logger.js';
import { getGlobalCache, resetGlobalCache } from './core/cache.js';
import { loadConfig, isCloudMode } from './core/config.js';
import type { RadarConfig } from './core/config.js';
import { StrategyEngine } from './analysis/engine.js';
import type { AggregatedSignal } from './analysis/strategies.js';
import { toTable, toMarkdownReport, toSignalReport, toCSV, csvHeader, NEWS_CSV_HEADER } from './output.js';
import { exportToXlsx } from './xlsx-export.js';
import { checkLogRotation, pruneOldLogs, writeLogWithChecksum, verifyLogChecksum } from './core/log-rotation.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_INTERVALS: KlineInterval[] = ['15m', '1h', '4h', '1d'];

let _runCounter = 0;

/** @internal Reset the radar module-level cache (for testing) */
export function _resetTestCache(): void {
  resetGlobalCache();
}

/** Acquire a process lock to prevent concurrent radar runs (daemon safety). */
export function acquireLock(dataDir?: string): boolean {
  if (isCloudMode()) return true;
  const dir = dataDir ?? loadConfig().dataDir;
  const lockFile = path.join(dir, 'radar.lock');
  if (fs.existsSync(lockFile)) return false;
  fs.writeFileSync(lockFile, String(process.pid), 'utf-8');
  return true;
}

/** Release the process lock acquired by acquireLock(). */
export function releaseLock(dataDir?: string): void {
  if (isCloudMode()) return;
  const dir = dataDir ?? loadConfig().dataDir;
  const lockFile = path.join(dir, 'radar.lock');
  if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
}

/** Persist lightweight run state to disk for crash recovery. */
export function saveState(state: Record<string, unknown>, dataDir?: string): void {
  if (isCloudMode()) return;
  const dir = dataDir ?? loadConfig().dataDir;
  const stateFile = path.join(dir, 'crypto-radar-state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state), 'utf-8');
}

/** Load previously persisted run state, or null if none exists. */
export function loadState(dataDir?: string): Record<string, unknown> | null {
  if (isCloudMode()) return null;
  const dir = dataDir ?? loadConfig().dataDir;
  const stateFile = path.join(dir, 'crypto-radar-state.json');
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getRunId(): string {
  _runCounter++;
  const ts = Date.now().toString(36).toUpperCase();
  return `RADAR-${ts}-${_runCounter}`;
}

function toISOUTC(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toET(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).replace(',', '');
}

/**
 * Parse a numeric string from an upstream feed into a finite number.
 *
 * Hardening against finding #3: Binance can serve a malformed/empty field on
 * a transient error. A bare `parseFloat` would yield `NaN`, which later flows
 * unchecked into `priceChangePercent * 3`, survives `Math.round`, and poisons
 * the composite score + the `.sort()` that ranks "Top Signals". Returning 0
 * (neutral) for non-finite input bounds the damage to the single affected
 * ticker instead of corrupting the whole ranking.
 */
function safeParseFloat(raw: string | undefined | null, fallback = 0): number {
  const n = parseFloat(raw ?? '');
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Enrich a raw Binance ticker with computed fields.
 * @param raw Raw Binance ticker data
 * @param token Token definition
 * @param runId Radar run identifier
 * @param tsUtc ISO UTC timestamp
 * @returns Enriched ticker with computed fields (spread, VWAP distance, etc.)
 */
function enrichTicker(
  raw: BinanceTicker,
  token: TokenDef,
  runId: string,
  tsUtc: string,
): EnrichedTicker {
  const lastPrice = safeParseFloat(raw.lastPrice);
  const bidPrice = safeParseFloat(raw.bidPrice);
  const askPrice = safeParseFloat(raw.askPrice);
  const highPrice = safeParseFloat(raw.highPrice);
  const lowPrice = safeParseFloat(raw.lowPrice);
  const openPrice = safeParseFloat(raw.openPrice);
  const prevClosePrice = safeParseFloat(raw.prevClosePrice);
  const weightedAvgPrice = safeParseFloat(raw.weightedAvgPrice);
  const quoteVolume = safeParseFloat(raw.quoteVolume);
  const volume = safeParseFloat(raw.volume);
  const bidQty = safeParseFloat(raw.bidQty);
  const askQty = safeParseFloat(raw.askQty);
  const spreadPct = bidPrice > 0 ? ((askPrice - bidPrice) / bidPrice) * 100 : 0;
  const vwapDistPct = weightedAvgPrice > 0
    ? ((lastPrice - weightedAvgPrice) / weightedAvgPrice) * 100 : 0;
  const range = highPrice - lowPrice;
  const rangePosPct = range > 0 ? (lastPrice - lowPrice) / range : 0.5;
  const bookImbalance = (bidQty + askQty) > 0
    ? (bidQty - askQty) / (bidQty + askQty) : 0;
  const priceChangePercent = safeParseFloat(raw.priceChangePercent);
  const momentum = priceChangePercent * (quoteVolume > 10e6 ? 1.2 : 1.0);
  const alerts: string[] = [];
  if (priceChangePercent <= -5) alerts.push('DIP');
  if (priceChangePercent >= 5) alerts.push('PUMP');
  if (quoteVolume >= 10e6) alerts.push('HI-VOL');
  if (spreadPct >= 1) alerts.push('WIDE');
  return {
    runId, tsUtc, dateEt: toET(new Date()),
    symbol: token.sym, chain: token.chain, tokenId: token.id, tokenName: token.name,
    lastPrice, bidPrice, bidQty, askPrice, askQty, spreadPct,
    openPrice, highPrice, lowPrice, prevClosePrice,
    priceChange: parseFloat(raw.priceChange), priceChangePercent, weightedAvgPrice,
    volume, quoteVolume, count: raw.count, lastQty: parseFloat(raw.lastQty),
    vwapDistPct, rangePosPct, bookImbalance,
    volVsAvg: 0, obv: 0, momentum,
    alerts: alerts.join('|'), source: 'binance',
  };
}

/**
 * Execute a full radar scan: fetch live tickers from Binance, compute
 * technical indicators for configured intervals, match news, generate
 * signals, and evaluate strategy engine.
 *
 * @param options Scan options (filter, chain, sortBy, format, etc.)
 * @returns Radar results including tickers, technicals, news, signals, and aggregated signals
 */
export async function runRadar(options: RadarOptions = {}): Promise<{
  tickers: EnrichedTicker[];
  technicals: Map<string, Map<string, TechnicalIndicators>>;
  newsMatches: NewsMatch[];
  signals: TokenSignal[];
  aggregatedSignals: AggregatedSignal[];
  onchain: OnChainMetrics | null;
  run: RadarRun;
}> {
  const startTime = Date.now();
  const runId = getRunId();
  const tsUtc = toISOUTC(new Date());
  const config: RadarConfig = loadConfig();
  const log = logger.child({ runId });
  const intervals: KlineInterval[] = options.period ? [options.period] : DEFAULT_INTERVALS;

  log.info('Starting radar scan', { filter: options.filter, chain: options.chain, intervals });

  const cacheKey = `tickers:${options.chain ?? 'all'}:${options.filter?.join(',') ?? ''}`;
  let rawTickers = getGlobalCache().get<Map<string, BinanceTicker>>(cacheKey);
  if (!rawTickers) {
    try {
      rawTickers = await fetchAllTickers();
      getGlobalCache().set(cacheKey, rawTickers, 300_000);
    } catch (err) {
      log.warn('Failed to fetch tickers from Binance', { error: err instanceof Error ? err.message : String(err) });
      rawTickers = new Map();
    }
  }

  // Fetch 7d rolling window tickers in parallel (non-fatal if it fails)
  const cacheKey7d = `tickers7d:${options.chain ?? 'all'}`;
  let tickers7d = getGlobalCache().get<Map<string, import('./binance.js').Ticker7d>>(cacheKey7d);
  if (!tickers7d) {
    try {
      const pairs = Array.from(rawTickers.keys());
      tickers7d = await fetchTickers7d(pairs);
      getGlobalCache().set(cacheKey7d, tickers7d, 300_000);
    } catch (err) {
      log.warn('Failed to fetch 7d tickers from Binance', { error: err instanceof Error ? err.message : String(err) });
      tickers7d = new Map();
    }
  }

  const tokens = options.chain ? getTokensByChain(options.chain) : getTokensByChain(undefined);
  const filteredTokens = options.filter && options.filter.length > 0
    ? tokens.filter(t => options.filter!.includes(t.sym)) : tokens;

  // Fetch CoinGecko simple prices as fallback for tokens not on Binance
  let cgPrices: Map<string, CoinGeckoPrice> = new Map();
  try {
    const cgIds = filteredTokens.map(t => t.id).filter(Boolean);
    if (cgIds.length > 0) {
      const prices = await fetchSimplePrices(cgIds);
      cgPrices = prices as Map<string, CoinGeckoPrice>;
    }
  } catch {
    // Non-fatal — Binance is primary source
  }

  const enrichedTickers: EnrichedTicker[] = [];
  for (const token of filteredTokens) {
    const pair = getBinancePair(token);
    const raw = rawTickers.get(pair);
    if (raw) {
      const enriched = enrichTicker(raw, token, runId, tsUtc);
      // Merge 7d fields if available
      const t7d = tickers7d?.get(pair);
      if (t7d) {
        const high7d = parseFloat(t7d.highPrice);
        const low7d  = parseFloat(t7d.lowPrice);
        enriched.priceChangePct7d    = parseFloat(t7d.priceChangePercent);
        enriched.weightedAvgPrice7d  = parseFloat(t7d.weightedAvgPrice);
        enriched.highPrice7d         = high7d;
        enriched.lowPrice7d          = low7d;
        enriched.volume7d            = parseFloat(t7d.volume);
        enriched.quoteVolume7d       = parseFloat(t7d.quoteVolume);
        enriched.rangeWidth7d        = high7d > 0 ? (high7d - low7d) / high7d : 0;
      }
      enrichedTickers.push(enriched);
    } else if (cgPrices.has(token.id)) {
      // Fallback: use CoinGecko price for tokens without a Binance pair
      const cg = cgPrices.get(token.id)!;
      const synthetic: BinanceTicker = {
        symbol: pair,
        priceChange: '0',
        priceChangePercent: String(cg.usd24hChange ?? 0),
        weightedAvgPrice: String(cg.usd),
        prevClosePrice: String(cg.usd),
        lastPrice: String(cg.usd),
        lastQty: '0',
        bidPrice: String(cg.usd),
        bidQty: '0',
        askPrice: String(cg.usd),
        askQty: '0',
        openPrice: String(cg.usd),
        highPrice: String(cg.usd),
        lowPrice: String(cg.usd),
        volume: '0',
        quoteVolume: '0',
        openTime: 0, closeTime: 0,
        firstId: 0, lastId: 0, count: 0,
      };
      enrichedTickers.push(enrichTicker(synthetic, token, runId, tsUtc));
    }
  }

  if (options.sortBy) {
    const sortKey = options.sortBy === 'change' ? 'priceChangePercent' as const
      : options.sortBy === 'volume' ? 'quoteVolume' as const
      : options.sortBy === 'momentum' || options.sortBy === 'signal' ? 'momentum' as const
      : 'symbol' as const;
    if (sortKey === 'symbol') enrichedTickers.sort((a, b) => a.symbol.localeCompare(b.symbol));
    else enrichedTickers.sort((a, b) => b[sortKey] - a[sortKey]);
  }

  const technicals = new Map<string, Map<string, TechnicalIndicators>>();
  const klineCache = new Map<string, Kline[]>();
  const KLINE_LIMIT = 200;

  if (options.includeTech !== false) {
    log.info(`Computing technical indicators for ${enrichedTickers.length} tokens across ${intervals.length} intervals...`);
    
    // Step 1: Pre-fetch all Klines for all pairs and intervals
    const pairs = enrichedTickers.map(t => ({
      ticker: t,
      pair: getBinancePair(
        getTokensByChain(t.chain).find(tk => tk.sym === t.symbol) ?? {
          id: t.tokenId, sym: t.symbol, name: t.tokenName, chain: t.chain,
        }
      )
    }));

    await Promise.all(pairs.map(async ({ pair }) => {
      await Promise.all(intervals.map(async (interval) => {
        const ck = `${pair}:${interval}`;
        if (!klineCache.has(ck)) {
          try {
            klineCache.set(ck, await fetchKlines(pair, interval, KLINE_LIMIT));
          } catch (err) {
            log.warn(`Failed to fetch klines for ${pair} ${interval}`, { error: err instanceof Error ? err.message : String(err) });
          }
        }
      }));
    }));

    // Step 2: Batch compute indicators per interval
    const intervalTechnicals = new Map<string, Record<string, TechnicalIndicators>>();
    for (const interval of intervals) {
      const batches: Record<string, Kline[]> = {};
      for (const { pair, ticker } of pairs) {
        const ck = `${pair}:${interval}`;
        const klines = klineCache.get(ck);
        if (klines && klines.length > 0) {
          batches[ticker.symbol] = klines;
        }
      }
      if (Object.keys(batches).length > 0) {
        try {
          const results = await batchComputeAllIndicators(batches);
          intervalTechnicals.set(interval, results);
        } catch (err) {
          log.warn(`Failed batch compute for interval ${interval}`, { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // Step 3: Apply computed technicals back to tokens
    for (const { ticker } of pairs) {
      const perTokenTechs = new Map<string, TechnicalIndicators>();
      for (const interval of intervals) {
        const results = intervalTechnicals.get(interval);
        if (results && results[ticker.symbol]) {
          const tech = results[ticker.symbol]!;
          perTokenTechs.set(interval, tech);
          if (interval === '1h') {
            if (tech.obv != null) ticker.obv = tech.obv;
            if (tech.volVsAvg != null) ticker.volVsAvg = tech.volVsAvg;
          }
        }
      }
      technicals.set(ticker.symbol, perTokenTechs);
    }
  }

  let newsMatches: NewsMatch[] = [];
  if (options.includeNews !== false) {
    const newsCacheKey = `news:${runId}`;
    const cached = getGlobalCache().get<NewsMatch[]>(newsCacheKey);
    if (!cached) {
      log.info('Fetching news feeds...');
      try {
        newsMatches = await fetchAndMatchNews(runId, tsUtc);
        getGlobalCache().set(newsCacheKey, newsMatches, 300_000);
      } catch (err) {
        log.warn('News fetch failed, continuing without news', { error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      newsMatches = cached;
    }
  }

  // Write news matches to JSONL file (non-fatal)
  try {
    appendNewsToJsonl(newsMatches, config.dataDir);
  } catch (err) {
    log.warn('Failed to write news JSONL', { error: err instanceof Error ? err.message : String(err) });
  }

  // 4. On-chain metrics (DeFiLlama) — opt-in via config or flag
  let onchain: OnChainMetrics | null = null;
  if (config.defiLlamaEnabled || options.includeOnchain) {
    log.info('Fetching on-chain metrics...');
    try {
      onchain = await fetchOnChainMetrics(filteredTokens);
      getGlobalCache().set(`onchain:${runId}`, onchain, 300_000);
    } catch (err) {
      log.warn('On-chain metrics fetch failed, continuing without', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const singleTechs = new Map<string, TechnicalIndicators>();
  for (const [sym, perInterval] of technicals) {
    const oneHr = perInterval.get('1h') ?? perInterval.values().next().value ?? null;
    if (oneHr) singleTechs.set(sym, oneHr);
  }
  const signals = computeSignals(enrichedTickers, singleTechs, newsMatches, onchain);

  const engine = new StrategyEngine();
  const aggregatedSignals: AggregatedSignal[] = [];

  for (const t of enrichedTickers) {
    const tokenNews = newsMatches.filter(n => n.symbol === t.symbol);
    const pair = getBinancePair(
      getTokensByChain(t.chain).find(tk => tk.sym === t.symbol) ?? {
        id: t.tokenId, sym: t.symbol, name: t.tokenName, chain: t.chain,
      },
    );
    let closes: number[] = [];
    let highs: number[] = [];
    let lows: number[] = [];
    let volumes: number[] = [];
    const defaultInterval = intervals[0] ?? '1h';
    const ck = `${pair}:${defaultInterval}`;
    const cachedKlines = klineCache.get(ck);
    if (cachedKlines) {
      closes = cachedKlines.map(k => k.close);
      highs = cachedKlines.map(k => k.high);
      lows = cachedKlines.map(k => k.low);
      volumes = cachedKlines.map(k => k.volume);
    } else {
      try {
        const klines = await fetchKlines(pair, defaultInterval, KLINE_LIMIT);
        klineCache.set(ck, klines);
        closes = klines.map(k => k.close);
        highs = klines.map(k => k.high);
        lows = klines.map(k => k.low);
        volumes = klines.map(k => k.volume);
      } catch (err) {
        logger.warn(`Failed to fetch klines for ${pair}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    const agg = await engine.evaluate({
      ticker: t,
      technical: singleTechs.get(t.symbol) ?? null,
      technicalsByInterval: technicals.get(t.symbol) ?? new Map(),
      news: tokenNews,
      klineCloses: closes,
      klineHighs: highs,
      klineLows: lows,
      klineVolumes: volumes,
    });
    aggregatedSignals.push(agg);
  }

  if (!options.noLog) {
    await appendToLog(enrichedTickers, config.dataDir, 'crypto-radar-log.csv', csvHeader(), toCSV);
    await appendToLog(newsMatches, config.dataDir, 'crypto-radar-news.csv',
      NEWS_CSV_HEADER, toNewsCSV);
  }

  const durationMs = Date.now() - startTime;
  const run: RadarRun = { runId, tsUtc, numTokens: enrichedTickers.length, numSignals: signals.length, durationMs };
  log.info(`Scan complete: ${enrichedTickers.length} tokens, ${durationMs}ms`);

  if (options.store) {
    try {
      const store: Store = options.store as Store;
      await store.persistRun({ tickers: enrichedTickers, signals, newsMatches });
      log.info(`Archived ${enrichedTickers.length} tickers, ${signals.length} signals, ${newsMatches.length} news items`);
    } catch (err) {
      log.warn('Failed to persist radar run', { error: String(err) });
    }
  }

  return { tickers: enrichedTickers, technicals, newsMatches, signals, aggregatedSignals, onchain, run };
}

async function appendToLog<T>(
  items: T[],
  dataDir: string,
  fileName: string,
  header: string,
  formatter: (item: T) => string,
): Promise<void> {
  if (isCloudMode()) return;
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, fileName);

    // Prune old logs per retention policy
    pruneOldLogs(dataDir);
    checkLogRotation(filePath);

    // ── SHA-256 integrity check before reading existing data ──
    if (fs.existsSync(filePath)) {
      const existingChecksumPath = filePath + '.sha256';
      if (fs.existsSync(existingChecksumPath)) {
        const valid = verifyLogChecksum(filePath);
        if (!valid) {
          logger.warn(`Checksum mismatch on ${fileName} — file may have been tampered or corrupted. Starting fresh.`);
          fs.unlinkSync(filePath);
          try { fs.unlinkSync(existingChecksumPath); } catch { /* best-effort */ }
        }
      }
    }

    // ── Truly append: read existing content, append new rows, write all ──
    // This makes crypto-radar-log.csv a real rolling dataset that accumulates
    // all runs, not just the last one. The atomic write via writeLogWithChecksum
    // prevents partial-write corruption.
    const exists = fs.existsSync(filePath);
    const existingContent = exists ? fs.readFileSync(filePath, 'utf-8').replace(/\n$/, '') + '\n' : '';
    const newRows = items.map(item => formatter(item)).join('\n') + '\n';
    const content = exists ? existingContent + newRows : header + '\n' + newRows;

    // Always write with SHA-256 checksum sidecar
    writeLogWithChecksum(filePath, content);
  } catch (err) {
    logger.error('Failed to write log', { file: fileName, error: String(err) });
  }
}

function toNewsCSV(match: NewsMatch): string {
  const cleanHeadline = match.headline.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
  const cleanDescription = match.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
  return [
    match.runId, match.tsUtc, match.symbol,
    `"${cleanHeadline}"`, `"${cleanDescription}"`,
    match.source, match.domain, match.relevance.toFixed(2),
  ].join(',');
}

/**
 * Format and display radar results according to the specified output format.
 *
 * Supports: table (default), json, csv, md, xlsx, and quiet modes.
 *
 * @param result Radar scan result from runRadar()
 * @param options Radar options (format, quiet, etc.)
 * @returns Formatted output string
 */
export async function displayRadar(
  result: Awaited<ReturnType<typeof runRadar>>,
  options: RadarOptions,
): Promise<string> {
  const format = options.format ?? 'table';
  if (format === 'json') {
    return JSON.stringify({
      tickers: result.tickers, signals: result.signals,
      aggregatedSignals: result.aggregatedSignals,
      onchain: result.onchain, run: result.run,
    }, null, 2);
  }
  if (format === 'csv') {
    const lines = [csvHeader()];
    for (const t of result.tickers) lines.push(toCSV(t));
    return lines.join('\n');
  }
  if (format === 'md') {
    const singleTechs = new Map<string, TechnicalIndicators>();
    for (const [sym, perInterval] of result.technicals) {
      const oneHr = perInterval.get('1h') ?? perInterval.values().next().value ?? null;
      if (oneHr) singleTechs.set(sym, oneHr);
    }
    return toMarkdownReport(result.tickers, singleTechs, result.newsMatches);
  }
  if (format === 'xlsx') {
    try {
      const config = loadConfig();
      const dataDir = config.dataDir;
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const fp = path.resolve(dataDir, 'radar-output.xlsx');
      await exportToXlsx(result.tickers, fp);
      return `[XLSX export: ${fp} — ${result.tickers.length} tokens]`;
    } catch (err) {
      logger.error('XLSX export failed', { error: err instanceof Error ? err.message : String(err) });
      return `[XLSX export failed: ${err instanceof Error ? err.message : 'unknown error'}]`;
    }
  }
  if (options.quiet) return '';
  let output = toTable(result.tickers, result.aggregatedSignals);
  if (result.signals.length > 0) {
    output += '\n\n═══ Top Signals ═══\n';
    const topSignals = [...result.signals]
      .sort((a, b) => (Number.isFinite(b.compositeScore) ? b.compositeScore : -Infinity)
        - (Number.isFinite(a.compositeScore) ? a.compositeScore : -Infinity))
      .slice(0, 5);
    for (const s of topSignals) {
      output += `\n${s.symbol} (${s.chain}) ${s.compositeScore}/100  [M:${s.momentumScore} T:${s.technicalScore} N:${s.newsScore}]`;
      if (s.alerts.length > 0) output += `  ${s.alerts.slice(0, 3).join(', ')}`;
    }
    // Append detailed signal report
    output += '\n\n' + toSignalReport(result.signals.slice(0, 10));
  }
  return output;
}
