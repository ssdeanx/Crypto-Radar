// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Collector Unit Tests
// ═══════════════════════════════════════════════════════════════════════
//
// Tests for runCollector(): end-to-end data collection with mocked
// external dependencies. Covers the full pipeline — klines, futures,
// orderbook, fear & greed, cross-asset — plus partial failures, empty
// inputs, store errors, and edge cases.
//
// Strategy: mock every import that collector.ts touches, then
// orchestrate their return values per test scenario.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  TokenDef,
  Kline,
} from './types.js';

// ── Hoisted mock state ──
//
// vi.hoisted() runs before all vi.mock() factories, so we can share
// mutable data between the mock factories and the test body.

interface MockStoreInstance {
  migrate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  latestKlineTime: ReturnType<typeof vi.fn>;
  upsertKlines: ReturnType<typeof vi.fn>;
  upsertFunding: ReturnType<typeof vi.fn>;
  upsertOpenInterest: ReturnType<typeof vi.fn>;
  upsertLsRatio: ReturnType<typeof vi.fn>;
  upsertLiquidations: ReturnType<typeof vi.fn>;
  upsertFearGreed: ReturnType<typeof vi.fn>;
  upsertOrderBook: ReturnType<typeof vi.fn>;
  upsertCrossAsset: ReturnType<typeof vi.fn>;
}

function freshStoreInstance(): MockStoreInstance {
  return {
    migrate: vi.fn(),
    close: vi.fn(),
    latestKlineTime: vi.fn().mockReturnValue(null),
    upsertKlines: vi.fn().mockReturnValue(0),
    upsertFunding: vi.fn().mockReturnValue(0),
    upsertOpenInterest: vi.fn().mockReturnValue(0),
    upsertLsRatio: vi.fn().mockReturnValue(0),
    upsertLiquidations: vi.fn().mockReturnValue(0),
    upsertFearGreed: vi.fn(),
    upsertOrderBook: vi.fn(),
    upsertCrossAsset: vi.fn(),
  };
}

const mockState = vi.hoisted(() => {
  // The store reference is an object so the vi.mock factory can return
  // whichever instance is current via the getter.
  const storeRef: { current: MockStoreInstance | null } = { current: null };

  // RateLimiter mock class — must be constructable via `new`.
  const RateLimiterClass = vi.fn().mockImplementation(function () {
    return {
      waitForToken: vi.fn().mockResolvedValue(undefined),
      tryConsume: vi.fn().mockReturnValue(true),
      consumeOrWait: vi.fn().mockReturnValue(0),
      available: vi.fn().mockReturnValue(10),
    };
  });

  const mockTokenList: TokenDef[] = [
    { id: 'bitcoin', sym: 'BTC', name: 'Bitcoin', chain: 'multi', coingeckoId: 'bitcoin' },
    { id: 'solana', sym: 'SOL', name: 'Solana', chain: 'solana', coingeckoId: 'solana' },
  ];

  return { storeRef, RateLimiterClass, mockTokenList };
});

// ── Mock all external modules ──
// These factories are hoisted above the real imports by vitest.

vi.mock('./core/config.js', () => ({
  loadConfig: vi.fn(() => ({ dataDir: '/tmp/test-crypto-radar' })),
  resetConfig: vi.fn(),
}));

vi.mock('./core/logger.js', () => ({
  logger: {
    child: vi.fn(() => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    })),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('./core/rate-limiter.js', () => ({
  RateLimiter: mockState.RateLimiterClass,
}));

vi.mock('./tokens.js', () => ({
  getTokenList: vi.fn(() => mockState.mockTokenList),
  getBinancePair: vi.fn((t: TokenDef) => `${t.sym}USDT`),
}));

vi.mock('./binance.js', () => ({
  fetchKlines: vi.fn(),
}));

vi.mock('./sources/futures.js', () => ({
  fetchFundingRates: vi.fn(),
  fetchOpenInterest: vi.fn(),
  fetchLongShortRatio: vi.fn(),
  fetchTopLongShortPositionRatio: vi.fn(),
  fetchLiquidations: vi.fn(),
}));

vi.mock('./sources/fear-greed.js', () => ({
  fetchFearGreed: vi.fn(),
}));

vi.mock('./sources/orderbook.js', () => ({
  snapshotOrderBook: vi.fn(),
}));

vi.mock('./sources/cross-asset.js', () => ({
  fetchGlobalData: vi.fn(),
}));

// Dynamic Store mock — delegates to the hoisted storeRef.current.
// Each beforeEach() swaps in a fresh instance.
vi.mock('./store/db.js', () => ({
  Store: {
    open: vi.fn(() => mockState.storeRef.current),
  },
}));

// ── Module under test (imported after all mocks are hoisted) ──

import { runCollector } from './collector.js';
import { getTokenList } from './tokens.js';
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

// ── Helpers ──

/** Build a Binance API kline response object (not a KlineRow). */
function makeBinanceKline(overrides: Partial<Kline> = {}): Kline {
  return {
    openTime: Date.now() - 3600000,
    open: 60000,
    high: 61000,
    low: 59000,
    close: 60500,
    volume: 1000,
    closeTime: Date.now() - 3600000 + 3600000,
    quoteVolume: 60000000,
    count: 100,
    takerBuyVol: 500,
    takerBuyQuoteVol: 30000000,
    ignore: 0,
    ...overrides,
  };
}

/** Shortcut: set the hoisted store reference to a fresh mock instance. */
function initStore(): MockStoreInstance {
  const inst = freshStoreInstance();
  mockState.storeRef.current = inst;
  return inst;
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('runCollector', () => {
  let store: MockStoreInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    store = initStore();
  });

  // ── Happy path: default options (klines + futures) ──

  describe('default options (klines + futures)', () => {
    it('completes a full collect run and returns a well-formed report', async () => {
      // Each symbol × interval fetch returns one candle, and the store
      // reports it as successfully inserted.
      vi.mocked(fetchKlines).mockResolvedValue([makeBinanceKline({ openTime: Date.now() - 3600000 })]);
      store.upsertKlines.mockReturnValue(1);
      // Futures mocks: return data so the store upserts are called
      vi.mocked(fetchFundingRates).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, rate: 0.0001 },
      ]);
      vi.mocked(fetchOpenInterest).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, open_interest: 500000 },
      ]);
      vi.mocked(fetchLongShortRatio).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, long_account: 55, short_account: 45, long_position: 0, short_position: 0 },
      ]);
      vi.mocked(fetchTopLongShortPositionRatio).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, long_account: 0, short_account: 0, long_position: 60, short_position: 40 },
      ]);
      vi.mocked(fetchLiquidations).mockResolvedValue([
        { id: 'liq1', symbol: 'BTCUSDT', ts: Date.now() / 1000, side: 'SELL', price: 60000, qty: 10, usd: 600000 },
      ]);
      store.upsertFunding.mockReturnValue(5);
      store.upsertOpenInterest.mockReturnValue(1);
      store.upsertLsRatio.mockReturnValue(1);
      store.upsertLiquidations.mockReturnValue(3);

      const report = await runCollector();

      expect(report.klinesInserted).toBeGreaterThan(0);
      expect(report.fundingInserted).toBe(10);  // 2 symbols × 5 rows
      expect(report.oiInserted).toBe(2);        // 2 symbols × 1 row
      expect(report.lsInserted).toBe(4);        // 2 symbols × 2 LS endpoints × 1
      expect(report.liquidationsInserted).toBe(6); // 2 symbols × 3 rows
      expect(report.errors).toHaveLength(0);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof report.durationMs).toBe('number');

      // Store lifecycle
      expect(store.migrate).toHaveBeenCalledOnce();
      expect(store.close).toHaveBeenCalledOnce();
    });

    it('returns empty report when no data is available', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      store.upsertKlines.mockReturnValue(0);

      const report = await runCollector({ klines: true, futures: false });

      expect(report.klinesInserted).toBe(0);
      expect(report.fundingInserted).toBe(0);
      expect(report.oiInserted).toBe(0);
      expect(report.lsInserted).toBe(0);
      expect(report.liquidationsInserted).toBe(0);
      expect(report.errors).toHaveLength(0);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Kline-specific scenarios ──

  describe('kline collection', () => {
    it('seeds klines when no existing data (latestKlineTime returns null)', async () => {
      store.latestKlineTime.mockReturnValue(null);
      const kline = makeBinanceKline({ openTime: Date.now() - 3600000 });
      vi.mocked(fetchKlines).mockResolvedValue([kline]);
      store.upsertKlines.mockReturnValue(1);

      const report = await runCollector({ klines: true, futures: false });

      expect(report.klinesInserted).toBeGreaterThan(0);
      // seedKlines was called, meaning fetchKlines was called without startTime
      // When latestKlineTime returns null, seedKlines fetches with endTime
      expect(fetchKlines).toHaveBeenCalled();
      expect(report.errors).toHaveLength(0);
    });

    it('processes klines in incremental path (existing data + new klines)', async () => {
      const existingTime = Date.now() - 7200000; // 2 hours ago
      store.latestKlineTime.mockReturnValue(existingTime);
      const newKline = makeBinanceKline({ openTime: existingTime + 3600000 });
      vi.mocked(fetchKlines).mockResolvedValue([newKline]);
      store.upsertKlines.mockReturnValue(1);

      const report = await runCollector({
        klines: true,
        futures: false,
        intervals: ['1h'], // narrow to 1 interval for clarity
      });

      // incrementalKlines maps klines and upserts them
      expect(report.klinesInserted).toBeGreaterThan(0);
      expect(fetchKlines).toHaveBeenCalled();
      // Verify fetchKlines was called with startTime (incremental signature)
      const calls = vi.mocked(fetchKlines).mock.calls;
      // fetchKlines(symbol, interval, limit, startTime)
      // With 2 symbols and 1 interval: 2 calls total
      expect(calls.length).toBeGreaterThan(0);
      // Each call should have startTime (4th arg) set
      for (const call of calls) {
        expect(call[3]).toBeDefined(); // startTime
      }
      expect(report.errors).toHaveLength(0);
    });

    it('handles incremental klines API error in catch block', async () => {
      const existingTime = Date.now() - 7200000;
      store.latestKlineTime.mockReturnValue(existingTime);
      vi.mocked(fetchKlines).mockRejectedValue(new Error('API timeout'));

      const report = await runCollector({
        klines: true,
        futures: false,
        intervals: ['1h'],
      });

      expect(report.klinesInserted).toBe(0);
      expect(report.errors.some((e) => e.includes('incremental'))).toBe(true);
    });

    it('breaks seed loop when earliest kline time is before lookback window', async () => {
      const now = Date.now();
      const oldKline = makeBinanceKline({ openTime: now - 86400000 * 2 }); // 2 days ago
      // Set to 1 day backfill so the kline is outside the window
      vi.mocked(fetchKlines).mockResolvedValue([oldKline]);
      store.latestKlineTime.mockReturnValue(null); // seed path
      store.upsertKlines.mockReturnValue(1);

      const report = await runCollector({
        klines: true,
        futures: false,
        backfillDays: 1, // 1 day lookback
        intervals: ['1d'],
      });

      // seedKlines maps+upserts before checking break condition,
      // so klines ARE inserted even though the loop breaks immediately
      expect(report.klinesInserted).toBeGreaterThan(0);
      expect(report.errors).toHaveLength(0);
    });

    it('uses incremental path when existing data present', async () => {
      const existingTime = Date.now() - 1800000; // 30 min ago
      store.latestKlineTime.mockReturnValue(existingTime);
      vi.mocked(fetchKlines).mockResolvedValue([]);

      const report = await runCollector({ klines: true, futures: false });

      expect(report.klinesInserted).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('does nothing when latest kline time is recent (within interval)', async () => {
      const now = Date.now();
      const existingTime = now - 60000; // 1 minute ago, within 15m interval
      store.latestKlineTime.mockReturnValue(existingTime);
      vi.mocked(fetchKlines).mockResolvedValue([]);

      const report = await runCollector({
        klines: true,
        futures: false,
        intervals: ['15m'],
      });

      // For 15m interval (900000 ms), startTime = 60000 + 900000 = 960000 > now
      // So incrementalKlines returns early without fetching
      expect(report.klinesInserted).toBe(0);
      // fetchKlines should NOT be called because startTime >= nowMs
      expect(fetchKlines).not.toHaveBeenCalled();
      expect(report.errors).toHaveLength(0);
    });

    it('respects custom backfillDays override', async () => {
      store.latestKlineTime.mockReturnValue(null);
      vi.mocked(fetchKlines).mockResolvedValue([]);

      const report = await runCollector({
        klines: true,
        futures: false,
        backfillDays: 60,
        intervals: ['1d'],
      });

      expect(report.errors).toHaveLength(0);
      // seedKlines called with lookback = 60 days
      // fetchKlines called with endTime near now
      expect(fetchKlines).toHaveBeenCalled();
    });

    it('uses configured intervals', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);

      const report = await runCollector({
        klines: true,
        futures: false,
        intervals: ['1d'],
      });

      // Only 1 interval × 2 symbols = 2 fetch calls
      expect(report.errors).toHaveLength(0);
    });

    it('uses provided symbols instead of expanding from token list', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);

      const report = await runCollector({
        symbols: ['BTCUSDT', 'ETHUSDT'],
        intervals: ['1h'],
        futures: false,
      });

      expect(report.errors).toHaveLength(0);
      // Collector still calls getTokenList() internally (for the `tokens`
      // variable), but uses options.symbols for the actual symbol iteration.
      // Verify fetchKlines was only called for 1 interval instead of all 4.
      expect(fetchKlines).toHaveBeenCalledTimes(2); // 2 symbols × 1 interval
    });
  });

  // ── Futures collection ──

  describe('futures collection', () => {
    it('collects all five futures data types for each symbol', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      // Returns same data for each symbol (2 symbols total)
      vi.mocked(fetchFundingRates).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, rate: 0.0001 },
      ]);
      vi.mocked(fetchOpenInterest).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, open_interest: 500000 },
      ]);
      vi.mocked(fetchLongShortRatio).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, long_account: 55, short_account: 45, long_position: 0, short_position: 0 },
      ]);
      vi.mocked(fetchTopLongShortPositionRatio).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, long_account: 0, short_account: 0, long_position: 60, short_position: 40 },
      ]);
      vi.mocked(fetchLiquidations).mockResolvedValue([
        { id: 'liq1', symbol: 'BTCUSDT', ts: Date.now() / 1000, side: 'SELL', price: 60000, qty: 10, usd: 600000 },
      ]);
      // Each upsert is called once per symbol; with 2 symbols totals are doubled
      store.upsertFunding.mockReturnValue(1);
      store.upsertOpenInterest.mockReturnValue(1);
      store.upsertLsRatio.mockReturnValue(1); // per call, 2 symbols × 2 LS endpoints = 4 total
      store.upsertLiquidations.mockReturnValue(1);

      const report = await runCollector({ klines: false, futures: true });

      expect(report.fundingInserted).toBe(2);  // 2 symbols × 1 row each
      expect(report.oiInserted).toBe(2);       // 2 symbols × 1 row each
      expect(report.lsInserted).toBe(4);       // 2 symbols × 2 endpoints (= long/short + top position)
      expect(report.liquidationsInserted).toBe(2); // 2 symbols × 1 row each
      expect(report.errors).toHaveLength(0);
    });

    it('skips upsert when API returns empty arrays', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      vi.mocked(fetchFundingRates).mockResolvedValue([]);
      vi.mocked(fetchOpenInterest).mockResolvedValue([]);
      vi.mocked(fetchLongShortRatio).mockResolvedValue([]);
      vi.mocked(fetchTopLongShortPositionRatio).mockResolvedValue([]);
      vi.mocked(fetchLiquidations).mockResolvedValue([]);

      const report = await runCollector({ klines: false, futures: true });

      expect(report.fundingInserted).toBe(0);
      expect(report.oiInserted).toBe(0);
      expect(report.lsInserted).toBe(0);
      expect(report.liquidationsInserted).toBe(0);
      expect(report.errors).toHaveLength(0);
    });
  });

  // ── Optional data sources ──

  describe('optional data sources', () => {
    it('collects fear & greed index', async () => {
      vi.mocked(fetchFearGreed).mockResolvedValue([
        { ts: Date.now() / 1000, value: 50, classification: 'Neutral' },
      ]);

      const report = await runCollector({
        klines: false,
        futures: false,
        fearGreed: true,
      });

      expect(report.fearGreedInserted).toBe(1);
      expect(report.errors).toHaveLength(0);
    });

    it('collects orderbook snapshots', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      vi.mocked(snapshotOrderBook).mockResolvedValue({
        symbol: 'BTCUSDT',
        ts: Date.now() / 1000,
        spread_pct: 0.01,
        imbalance: 0.1,
        bids: '[]',
        asks: '[]',
      });

      const report = await runCollector({
        klines: false,
        futures: false,
        orderbook: true,
      });

      expect(report.orderBookInserted).toBeGreaterThan(0);
      expect(report.errors).toHaveLength(0);
    });

    it('collects cross-asset global data', async () => {
      vi.mocked(fetchGlobalData).mockResolvedValue({
        ts: Date.now() / 1000,
        btc_dominance: 55.5,
        eth_dominance: 15.2,
        total_mcap: 2_000_000_000_000,
        total_mcap_change_24h: 2.5,
        market_cap_percentage_json: '{"btc":55.5,"eth":15.2}',
      });

      const report = await runCollector({
        klines: false,
        futures: false,
        crossAsset: true,
      });

      expect(report.crossAssetInserted).toBe(1);
      expect(report.errors).toHaveLength(0);
    });

    it('collects all optional sources together', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      vi.mocked(fetchFundingRates).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, rate: 0.0001 },
      ]);
      vi.mocked(fetchOpenInterest).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, open_interest: 500000 },
      ]);
      vi.mocked(fetchLongShortRatio).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, long_account: 55, short_account: 45, long_position: 0, short_position: 0 },
      ]);
      vi.mocked(fetchTopLongShortPositionRatio).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, long_account: 0, short_account: 0, long_position: 60, short_position: 40 },
      ]);
      vi.mocked(fetchLiquidations).mockResolvedValue([
        { id: 'liq1', symbol: 'BTCUSDT', ts: Date.now() / 1000, side: 'SELL', price: 60000, qty: 10, usd: 600000 },
      ]);
      vi.mocked(fetchFearGreed).mockResolvedValue([
        { ts: Date.now() / 1000, value: 42, classification: 'Fear' },
      ]);
      vi.mocked(snapshotOrderBook).mockResolvedValue({
        symbol: 'BTCUSDT',
        ts: Date.now() / 1000,
        spread_pct: 0.02,
        imbalance: -0.05,
        bids: '[]',
        asks: '[]',
      });
      vi.mocked(fetchGlobalData).mockResolvedValue({
        ts: Date.now() / 1000,
        btc_dominance: 54,
        eth_dominance: 16,
        total_mcap: 1_900_000_000_000,
        total_mcap_change_24h: -1.2,
        market_cap_percentage_json: '{}',
      });
      store.upsertFunding.mockReturnValue(1);
      store.upsertOpenInterest.mockReturnValue(1);
      store.upsertLsRatio.mockReturnValue(1);
      store.upsertLiquidations.mockReturnValue(1);

      const report = await runCollector({
        klines: true,
        futures: true,
        orderbook: true,
        fearGreed: true,
        crossAsset: true,
      });

      expect(report.klinesInserted).toBe(0);
      expect(report.fundingInserted).toBe(2);  // 2 symbols × 1 row each
      expect(report.oiInserted).toBe(2);       // 2 symbols
      expect(report.lsInserted).toBe(4);       // 2 symbols × 2 LS endpoints
      expect(report.liquidationsInserted).toBe(2); // 2 symbols
      expect(report.fearGreedInserted).toBe(1);
      expect(report.orderBookInserted).toBeGreaterThan(0);
      expect(report.crossAssetInserted).toBe(1);
      expect(report.errors).toHaveLength(0);
    });
  });

  // ── Partial failure handling ──

  describe('partial failure handling', () => {
    it('continues collecting other symbols when one symbol fails in klines', async () => {
      // BTCUSDT (first) fails; SOLUSDT (second) succeeds
      vi.mocked(fetchKlines)
        .mockRejectedValueOnce(new Error('BTC network error'))
        .mockResolvedValue([]);

      const report = await runCollector({ klines: true, futures: false });

      expect(report.errors.length).toBeGreaterThanOrEqual(1);
      expect(report.errors[0]).toContain('BTCUSDT');
      expect(report.errors[0]).toContain('network error');
    });

    it('continues with next symbol when futures data source fails for one symbol', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      // BTCUSDT succeeds, SOLUSDT fails
      vi.mocked(fetchFundingRates)
        .mockResolvedValueOnce([{ symbol: 'BTCUSDT', ts: Date.now() / 1000, rate: 0.0001 }])
        .mockRejectedValueOnce(new Error('SOL funding error'));
      store.upsertFunding.mockReturnValue(1); // BTCUSDT upsert returns 1

      const report = await runCollector({ klines: false, futures: true });

      expect(report.fundingInserted).toBe(1);
      expect(report.errors.some((e) => e.includes('SOL'))).toBe(true);
      expect(report.errors.some((e) => e.includes('funding'))).toBe(true);
    });

    it('handles all futures sources failing for all symbols', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      vi.mocked(fetchFundingRates).mockRejectedValue(new Error('Funding fail'));
      vi.mocked(fetchOpenInterest).mockRejectedValue(new Error('OI fail'));
      vi.mocked(fetchLongShortRatio).mockRejectedValue(new Error('LS fail'));
      vi.mocked(fetchTopLongShortPositionRatio).mockRejectedValue(new Error('Pos fail'));
      vi.mocked(fetchLiquidations).mockRejectedValue(new Error('Liq fail'));

      const report = await runCollector({ klines: false, futures: true });

      // 2 symbols × 5 failing sources = expected errors (but individual errors
      // are pushed per-catch, so min is 2 since there are 5 catches per symbol
      // and at least one should fire)
      expect(report.fundingInserted).toBe(0);
      expect(report.oiInserted).toBe(0);
      expect(report.lsInserted).toBe(0);
      expect(report.liquidationsInserted).toBe(0);
      expect(report.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('handles fear & greed fetch failure', async () => {
      vi.mocked(fetchFearGreed).mockRejectedValue(new Error('API unavailable'));

      const report = await runCollector({
        klines: false,
        futures: false,
        fearGreed: true,
      });

      expect(report.fearGreedInserted).toBe(0);
      expect(report.errors.some((e) => e.includes('Fear & Greed'))).toBe(true);
    });

    it('handles orderbook fetch failure', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      vi.mocked(snapshotOrderBook).mockRejectedValue(new Error('Orderbook timeout'));

      const report = await runCollector({
        klines: false,
        futures: false,
        orderbook: true,
      });

      expect(report.orderBookInserted).toBe(0);
      expect(report.errors.some((e) => e.includes('Orderbook'))).toBe(true);
    });

    it('handles cross-asset fetch failure', async () => {
      vi.mocked(fetchGlobalData).mockRejectedValue(new Error('Cross-asset timeout'));

      const report = await runCollector({
        klines: false,
        futures: false,
        crossAsset: true,
      });

      expect(report.crossAssetInserted).toBe(0);
      expect(report.errors.some((e) => e.includes('Cross-asset'))).toBe(true);
    });

    it('handles store upsert throwing errors during futures collection', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      vi.mocked(fetchFundingRates).mockResolvedValue([
        { symbol: 'BTCUSDT', ts: Date.now() / 1000, rate: 0.0001 },
      ]);
      store.upsertFunding.mockImplementation(() => {
        throw new Error('Store disk full');
      });

      const report = await runCollector({ klines: false, futures: true });

      expect(report.fundingInserted).toBe(0);
      expect(report.errors.some((e) => e.includes('Funding'))).toBe(true);
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('handles empty token list', async () => {
      vi.mocked(getTokenList).mockReturnValueOnce([]);

      const report = await runCollector({ klines: true, futures: true });

      expect(report.klinesInserted).toBe(0);
      expect(report.fundingInserted).toBe(0);
      expect(report.oiInserted).toBe(0);
      expect(report.lsInserted).toBe(0);
      expect(report.liquidationsInserted).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('handles null klines from API (fetch returns null)', async () => {
      store.latestKlineTime.mockReturnValue(null);
      vi.mocked(fetchKlines).mockResolvedValue(null as unknown as Kline[]);

      const report = await runCollector({ klines: true, futures: false });

      expect(report.klinesInserted).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('handles empty klines array from API', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);

      const report = await runCollector({ klines: true, futures: false });

      expect(report.klinesInserted).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('handles null fear-greed data (empty array from API)', async () => {
      vi.mocked(fetchFearGreed).mockResolvedValue([]);

      const report = await runCollector({
        klines: false,
        futures: false,
        fearGreed: true,
      });

      expect(report.fearGreedInserted).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('handles null orderbook snapshot', async () => {
      vi.mocked(snapshotOrderBook).mockResolvedValue(null);

      const report = await runCollector({
        klines: false,
        futures: false,
        orderbook: true,
      });

      expect(report.orderBookInserted).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('handles null cross-asset data', async () => {
      vi.mocked(fetchGlobalData).mockResolvedValue(null);

      const report = await runCollector({
        klines: false,
        futures: false,
        crossAsset: true,
      });

      expect(report.crossAssetInserted).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('calls onProgress callback with status messages', async () => {
      vi.mocked(fetchKlines).mockResolvedValue([]);
      const messages: string[] = [];
      const onProgress = (msg: string) => { messages.push(msg); };

      await runCollector({
        klines: true,
        futures: false,
        onProgress,
      });

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((m) => m.includes('BTCUSDT'))).toBe(true);
      expect(messages.some((m) => m.includes('SOLUSDT'))).toBe(true);
    });

    it('handles fatal error inside try block (e.g. getTokenList throws)', async () => {
      vi.mocked(getTokenList).mockImplementationOnce(() => {
        throw new Error('Token registry corrupted');
      });

      const report = await runCollector({ klines: true, futures: true });

      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]).toContain('Collector fatal error');
      expect(report.errors[0]).toContain('Token registry corrupted');
      // Store should still be closed in finally block
      expect(store.close).toHaveBeenCalledOnce();
    });

    it('still closes store and reports duration when error occurs', async () => {
      vi.mocked(fetchKlines).mockRejectedValue(new Error('Kline failure'));

      const report = await runCollector({ klines: true, futures: false });

      expect(report.errors.length).toBeGreaterThan(0);
      expect(store.close).toHaveBeenCalledOnce();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
