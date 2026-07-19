// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Historical Collector
// ═══════════════════════════════════════════════════════════════════════
//
// Resumable, idempotent, cron-safe collector that backfills klines from
// Binance and fetches futures/fear-greed/orderbook/cross-asset data into
// the persistent Store.
//
// Usage:
//   import { runCollector } from './collector.js';
//   const report = await runCollector({ klines: true, futures: true });
//

import type { CollectorReport, KlineInterval, KlineRow } from './types.js';
import { Store } from './store/db.js';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { RateLimiter } from './core/rate-limiter.js';
import { getTokenList, getBinancePair } from './tokens.js';
import { fetchKlines } from './binance.js';
import {
  fetchFundingRates,
  fetchOpenInterest,
  fetchLongShortRatio,
  fetchTopLongShortPositionRatio,
  fetchLiquidations,
} from './sources/futures.js';
import { fetchFearGreed } from './sources/fear-greed.js';
import { snapshotOrderBook } from './sources/orderbook.js';
import { fetchGlobalData } from './sources/cross-asset.js';

const log = logger.child({ module: 'collector' });

export interface CollectorOptions {
  /** Collect klines (default true) */
  klines?: boolean;
  /** Collect futures data (default true) */
  futures?: boolean;
  /** Override backfill depth in days for all intervals */
  backfillDays?: number;
  /** Subset of symbols to collect (default all tracked tokens) */
  symbols?: string[];
  /** Kline intervals to collect (default all 4) */
  intervals?: KlineInterval[];
  /** Collect order book snapshots (default false) */
  orderbook?: boolean;
  /** Collect Fear & Greed index (default false) */
  fearGreed?: boolean;
  /** Collect cross-asset data (default false) */
  crossAsset?: boolean;
  /** Progress callback */
  onProgress?: (msg: string) => void;
}

const ALL_INTERVALS: KlineInterval[] = ['15m', '1h', '4h', '1d'];

const INTERVAL_MS: Record<KlineInterval, number> = {
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
};

const DEFAULT_BACKFILL_DAYS: Record<KlineInterval, number> = {
  '15m': 3,
  '1h': 7,
  '4h': 14,
  '1d': 30,
};

const FETCH_LIMIT = 1000;
const BINANCE_RATE_LIMIT_MAX = 10;
const BINANCE_RATE_LIMIT_WINDOW = 1000;

const klineRateLimiter = new RateLimiter(BINANCE_RATE_LIMIT_MAX, BINANCE_RATE_LIMIT_WINDOW);

/**
 * Run the collector: backfill klines and collect futures / ancillary data
 * into the persistent store. Returns a report with inserted counts and any
 * errors encountered.
 */
export async function runCollector(opts?: CollectorOptions): Promise<CollectorReport> {
  const start = performance.now();

  const options = {
    klines: opts?.klines ?? true,
    futures: opts?.futures ?? true,
    backfillDays: opts?.backfillDays ?? 0,
    symbols: opts?.symbols ?? [],
    intervals: opts?.intervals ?? ALL_INTERVALS,
    orderbook: opts?.orderbook ?? false,
    fearGreed: opts?.fearGreed ?? false,
    crossAsset: opts?.crossAsset ?? false,
    onProgress: opts?.onProgress ?? (() => {}),
  };

  const report: CollectorReport = {
    klinesInserted: 0,
    fundingInserted: 0,
    oiInserted: 0,
    lsInserted: 0,
    liquidationsInserted: 0,
    fearGreedInserted: 0,
    orderBookInserted: 0,
    crossAssetInserted: 0,
    errors: [],
    durationMs: 0,
  };

  const config = loadConfig();
  const store = Store.open(config.dataDir);
  store.migrate();

  try {
    const tokens = getTokenList();
    const symbols: string[] = options.symbols.length > 0
      ? options.symbols
      : tokens.map(t => getBinancePair(t));

    if (options.klines) {
      await collectKlines(store, symbols, options.intervals, options.backfillDays, options.onProgress, report);
    }

    if (options.futures) {
      await collectFutures(store, symbols, options.onProgress, report);
    }

    if (options.orderbook) {
      await collectOrderBook(store, symbols, options.onProgress, report);
    }

    if (options.fearGreed) {
      await collectFearGreed(store, options.onProgress, report);
    }

    if (options.crossAsset) {
      await collectCrossAsset(store, options.onProgress, report);
    }
  } catch (err) {
    const msg = `Collector fatal error: ${err instanceof Error ? err.message : String(err)}`;
    report.errors.push(msg);
    log.error(msg, { error: err });
  } finally {
    store.close();
    report.durationMs = Math.round(performance.now() - start);
  }

  return report;
}

// ── Kline backfill ──

async function collectKlines(
  store: Store,
  symbols: string[],
  intervals: KlineInterval[],
  backfillDaysOverride: number,
  onProgress: (msg: string) => void,
  report: CollectorReport,
): Promise<void> {
  for (const symbol of symbols) {
    for (const interval of intervals) {
      const intervalMs = INTERVAL_MS[interval];
      const defaultDays = DEFAULT_BACKFILL_DAYS[interval];
      const backfillDays = backfillDaysOverride > 0 ? backfillDaysOverride : defaultDays;
      const lookbackMs = backfillDays * 86400000;
      const nowMs = Date.now();

      const last = store.latestKlineTime(symbol, interval);

      if (last === null) {
        await seedKlines(store, symbol, interval, intervalMs, lookbackMs, nowMs, onProgress, report);
      } else {
        await incrementalKlines(store, symbol, interval, intervalMs, last, nowMs, onProgress, report);
      }
    }
  }
}

async function seedKlines(
  store: Store,
  symbol: string,
  interval: KlineInterval,
  _intervalMs: number,
  lookbackMs: number,
  nowMs: number,
  onProgress: (msg: string) => void,
  report: CollectorReport,
): Promise<void> {
  onProgress(`Seeding ${symbol} ${interval}`);
  let endTime: number | undefined = nowMs;
  const fromTime = nowMs - lookbackMs;

  while (true) {
    await klineRateLimiter.waitForToken();
    try {
      const klines = await fetchKlines(symbol, interval, FETCH_LIMIT, undefined, endTime);
      if (!klines || klines.length === 0) break;

      const rows: KlineRow[] = klines.map(k => ({
        symbol,
        interval,
        open_time: k.openTime,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        quote_volume: k.quoteVolume,
        taker_buy_vol: k.takerBuyVol,
        taker_buy_quote_vol: k.takerBuyQuoteVol,
      }));

      report.klinesInserted += await store.upsertKlines(rows);

      const earliestOpenTime = klines[0]!.openTime;
      if (earliestOpenTime <= fromTime || klines.length < FETCH_LIMIT) break;

      endTime = earliestOpenTime - 1;
    } catch (err) {
      const msg = `Kline seed error ${symbol} ${interval}: ${err instanceof Error ? err.message : String(err)}`;
      report.errors.push(msg);
      log.error(msg);
      break;
    }
  }
}

async function incrementalKlines(
  store: Store,
  symbol: string,
  interval: KlineInterval,
  intervalMs: number,
  last: number,
  nowMs: number,
  onProgress: (msg: string) => void,
  report: CollectorReport,
): Promise<void> {
  const startTime = last + intervalMs;
  if (startTime >= nowMs) return;

  onProgress(`Incremental ${symbol} ${interval}`);
  await klineRateLimiter.waitForToken();

  try {
    const klines = await fetchKlines(symbol, interval, FETCH_LIMIT, startTime);
    if (!klines || klines.length === 0) return;

    const rows: KlineRow[] = klines.map(k => ({
      symbol,
      interval,
      open_time: k.openTime,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
      quote_volume: k.quoteVolume,
      taker_buy_vol: k.takerBuyVol,
      taker_buy_quote_vol: k.takerBuyQuoteVol,
    }));

    report.klinesInserted += await store.upsertKlines(rows);
  } catch (err) {
    const msg = `Kline incremental error ${symbol} ${interval}: ${err instanceof Error ? err.message : String(err)}`;
    report.errors.push(msg);
    log.error(msg);
  }
}

// ── Futures data ──

async function collectFutures(
  store: Store,
  symbols: string[],
  onProgress: (msg: string) => void,
  report: CollectorReport,
): Promise<void> {
  for (const symbol of symbols) {
    onProgress(`Futures ${symbol}`);

    try {
      const funding = await fetchFundingRates(symbol, 30);
      if (funding.length > 0) {
        report.fundingInserted += await store.upsertFunding(funding);
      }
    } catch (err) {
      const msg = `Funding error ${symbol}: ${err instanceof Error ? err.message : String(err)}`;
      report.errors.push(msg);
      log.error(msg);
    }

    try {
      const oi = await fetchOpenInterest(symbol);
      if (oi.length > 0) {
        report.oiInserted += await store.upsertOpenInterest(oi);
      }
    } catch (err) {
      const msg = `Open interest error ${symbol}: ${err instanceof Error ? err.message : String(err)}`;
      report.errors.push(msg);
      log.error(msg);
    }

    try {
      const ls = await fetchLongShortRatio(symbol);
      if (ls.length > 0) {
        report.lsInserted += await store.upsertLsRatio(ls);
      }
    } catch (err) {
      const msg = `Long/short ratio error ${symbol}: ${err instanceof Error ? err.message : String(err)}`;
      report.errors.push(msg);
      log.error(msg);
    }

    try {
      const pos = await fetchTopLongShortPositionRatio(symbol);
      if (pos.length > 0) {
        report.lsInserted += await store.upsertLsRatio(pos);
      }
    } catch (err) {
      const msg = `Top position ratio error ${symbol}: ${err instanceof Error ? err.message : String(err)}`;
      report.errors.push(msg);
      log.error(msg);
    }

    try {
      const liqs = await fetchLiquidations(symbol);
      if (liqs.length > 0) {
        report.liquidationsInserted += await store.upsertLiquidations(liqs);
      }
    } catch (err) {
      const msg = `Liquidations error ${symbol}: ${err instanceof Error ? err.message : String(err)}`;
      report.errors.push(msg);
      log.error(msg);
    }
  }
}

// ── Order book snapshots ──

async function collectOrderBook(
  store: Store,
  symbols: string[],
  onProgress: (msg: string) => void,
  report: CollectorReport,
): Promise<void> {
  for (const symbol of symbols) {
    onProgress(`Orderbook ${symbol}`);
    try {
      const snap = await snapshotOrderBook(symbol);
      if (snap) {
        await store.upsertOrderBook(snap);
        report.orderBookInserted++;
      }
    } catch (err) {
      const msg = `Orderbook error ${symbol}: ${err instanceof Error ? err.message : String(err)}`;
      report.errors.push(msg);
      log.error(msg);
    }
  }
}

// ── Fear & Greed index ──

async function collectFearGreed(
  store: Store,
  onProgress: (msg: string) => void,
  report: CollectorReport,
): Promise<void> {
  onProgress('Fear & Greed');
  try {
    const rows = await fetchFearGreed(30);
    for (const row of rows) {
      await store.upsertFearGreed(row);
      report.fearGreedInserted++;
    }
  } catch (err) {
    const msg = `Fear & Greed error: ${err instanceof Error ? err.message : String(err)}`;
    report.errors.push(msg);
    log.error(msg);
  }
}

// ── Cross-asset data ──

async function collectCrossAsset(
  store: Store,
  onProgress: (msg: string) => void,
  report: CollectorReport,
): Promise<void> {
  onProgress('Cross-asset');
  try {
    const row = await fetchGlobalData();
    if (row) {
      await store.upsertCrossAsset(row);
      report.crossAssetInserted++;
    }
  } catch (err) {
    const msg = `Cross-asset error: ${err instanceof Error ? err.message : String(err)}`;
    report.errors.push(msg);
    log.error(msg);
  }
}
