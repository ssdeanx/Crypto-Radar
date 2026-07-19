// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Integration Smoke Tests
// ═══════════════════════════════════════════════════════════════════════
//
// These tests validate that core infrastructure pieces work together:
//   - Module exports and public API surface
//   - CSV header consistency (CSV_COLUMNS ↔ derived CSV_HEADER)
//   - Global cache singleton
//
// They do NOT hit live APIs — they test the code plumbing.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { CSV_COLUMNS, CSV_HEADER, csvHeader, toCSV } from './output.js';
import type { EnrichedTicker } from './types.js';
import { getGlobalCache, resetGlobalCache } from './core/cache.js';

// ── Public API surface ──

describe('Module exports', () => {
  it('CSV_COLUMNS is an array typed to keyof EnrichedTicker', () => {
    expect(Array.isArray(CSV_COLUMNS)).toBe(true);
    expect(CSV_COLUMNS.length).toBe(63);
    // Spot-check key columns (camelCase keyof EnrichedTicker)
    expect(CSV_COLUMNS[0]).toBe('runId');
    expect(CSV_COLUMNS[4]).toBe('chain');
    expect(CSV_COLUMNS[62]).toBe('regimeConfidence');
  });

  it('CSV_HEADER is derived from CSV_COLUMNS', () => {
    // Header is derived (snake_case) from the typed CSV_COLUMNS list — same arity.
    const headerCols = CSV_HEADER.split(',');
    expect(headerCols.length).toBe(CSV_COLUMNS.length);
    expect(csvHeader()).toBe(CSV_HEADER);
  });

  it('csvHeader() returns CSV_HEADER', () => {
    expect(csvHeader()).toBe(CSV_HEADER);
  });
});

// ── CSV output pipeline ──

describe('CSV output pipeline', () => {
  it('toCSV produces a row with the same column count as the header', () => {
    const ticker: EnrichedTicker = {
      runId: 'SMOKE-1',
      tsUtc: '2026-07-06T12:00:00Z',
      dateEt: '07/06 08:00',
      symbol: 'BTC',
      chain: 'multi',
      tokenId: 'bitcoin',
      tokenName: 'Bitcoin',
      lastPrice: 60000,
      bidPrice: 59999,
      bidQty: 0.5,
      askPrice: 60001,
      askQty: 0.5,
      spreadPct: 0.0033,
      openPrice: 59500,
      highPrice: 60500,
      lowPrice: 59000,
      prevClosePrice: 59800,
      priceChange: 200,
      priceChangePercent: 0.33,
      weightedAvgPrice: 60000,
      volume: 5000,
      quoteVolume: 300_000_000,
      count: 10000,
      lastQty: 0.1,
      vwapDistPct: 0,
      rangePosPct: 0.67,
      bookImbalance: 0,
      volVsAvg: 0,
      obv: 0,
      momentum: 0.4,
      alerts: '',
      source: 'binance',
    };

    const headerCols = CSV_HEADER.split(',');
    const csv = toCSV(ticker);
    const csvCols = csv.split(',');
    expect(csvCols.length).toBe(headerCols.length);
    expect(csv).toContain('BTC');
    expect(csv).toContain('60000');
  });
});

// ── Global cache singleton ──

describe('Global cache singleton', () => {
  beforeEach(() => {
    resetGlobalCache();
  });

  it('getGlobalCache() returns the same instance on repeated calls', () => {
    const a = getGlobalCache();
    const b = getGlobalCache();
    expect(a).toBe(b); // same reference
  });

  it('cache stores and retrieves values', () => {
    const cache = getGlobalCache();
    cache.set('smoke-key', { hello: 'world' });
    expect(cache.get('smoke-key')).toEqual({ hello: 'world' });
  });

  it('cache health stats work', () => {
    const cache = getGlobalCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // hit
    cache.get('missing'); // miss
    const stats = cache.healthStats();
    expect(stats.entries).toBeGreaterThanOrEqual(2);
    expect(stats.hitRate).toBeGreaterThan(0);
    expect(stats.ttlConfig.defaultTtlMs).toBe(300_000);
  });

  it('Cache.getAllHealthStats aggregates across instances', async () => {
    resetGlobalCache();
    const { Cache } = await import('./core/cache.js');
    const extra = new Cache(5000);
    extra.set('x', true);

    const all = Cache.getAllHealthStats();
    expect(all.length).toBeGreaterThanOrEqual(1);
    const extraStats = all.find(s => s.ttlConfig.defaultTtlMs === 5000);
    expect(extraStats).toBeDefined();
    expect(extraStats!.entries).toBe(1);
  });
});
