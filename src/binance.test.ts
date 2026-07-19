// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Binance API Client Unit Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoisted mocks ──

const mockTokenList = vi.hoisted(() => [
  { id: 'bitcoin', sym: 'BTC', name: 'Bitcoin', chain: 'multi', pair: 'BTCUSDT', coingeckoId: 'bitcoin' },
  { id: 'solana', sym: 'SOL', name: 'Solana', chain: 'solana', pair: 'SOLUSDT', coingeckoId: 'solana' },
]);

vi.mock('./tokens.js', () => ({
  getTokenList: vi.fn(() => mockTokenList),
  getBinancePair: vi.fn((t: typeof mockTokenList[0]) => t.pair ?? `${t.sym}USDT`),
}));

// ── Module under test ──

import {
  fetchTicker,
  fetchAllTickers,
  fetchAllUsdtTickers,
  fetchKlines,
  fetchExchangeInfo,
  fetchDepth,
} from './binance.js';

import { getTokenList } from './tokens.js';

// Helpers

interface FetchCall { url: string }
const fetchCalls: FetchCall[] = [];
const ORIGINAL_FETCH = globalThis.fetch;

function setupMockFetch(result: unknown, status = 200): void {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    fetchCalls.push({ url });
    if (status === 429) {
      return Promise.resolve({
        ok: false, status: 429, statusText: 'Too Many',
        headers: new Map([['retry-after', '1']]),
        json: () => Promise.resolve({}),
      } as unknown as Response);
    }
    if (!(status >= 200 && status < 300)) {
      return Promise.resolve({
        ok: false, status, statusText: 'Error',
        json: () => Promise.resolve({}),
      } as unknown as Response);
    }
    return Promise.resolve({
      ok: true, status, statusText: 'OK',
      json: () => Promise.resolve(result),
    } as unknown as Response);
  });
}

function setupFetchError(msg = 'Network failure'): void {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(msg));
}

// ═══════════════════════════════════════════════════════════════════════
// fetchTicker
// ═══════════════════════════════════════════════════════════════════════

describe('fetchTicker', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; fetchCalls.length = 0; });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns ticker data for a valid pair', async () => {
    const mockData = { symbol: 'SOLUSDT', lastPrice: '150.00', volume: '5000000' };
    setupMockFetch(mockData);
    const result = await fetchTicker('SOLUSDT');
    expect(result.symbol).toBe('SOLUSDT');
    expect(result.lastPrice).toBe('150.00');
  });

  it('throws on HTTP error response', async () => {
    setupMockFetch({}, 404);
    await expect(fetchTicker('INVALIDUSDT')).rejects.toThrow('HTTP 404');
  });

  it('retries on 429 rate limit', async () => {
    const mockData = { symbol: 'SOLUSDT', lastPrice: '150' };
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 429, statusText: 'Too Many',
        headers: new Map([['retry-after', '1']]),
        json: () => Promise.resolve({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200, statusText: 'OK',
        json: () => Promise.resolve(mockData),
      } as unknown as Response);
    const result = await fetchTicker('SOLUSDT');
    expect(result.symbol).toBe('SOLUSDT');
  });

  it('throws on network failure', async () => {
    setupFetchError('network unreachable');
    await expect(fetchTicker('SOLUSDT')).rejects.toThrow('network unreachable');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchAllTickers
// ═══════════════════════════════════════════════════════════════════════

describe('fetchAllTickers', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; fetchCalls.length = 0; });

  it('returns a map of symbol → ticker for tracked tokens', async () => {
    const mockData = [
      { symbol: 'BTCUSDT', lastPrice: '67000', volume: '10000' },
      { symbol: 'SOLUSDT', lastPrice: '150', volume: '5000000' },
    ];
    setupMockFetch(mockData);
    const map = await fetchAllTickers();
    expect(map.size).toBe(2);
    expect(map.get('BTCUSDT')!.lastPrice).toBe('67000');
    expect(map.get('SOLUSDT')!.lastPrice).toBe('150');
  });

  it('returns empty map when no tokens are tracked', async () => {
    (getTokenList as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);
    setupMockFetch([]);
    const map = await fetchAllTickers();
    expect(map.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchAllUsdtTickers
// ═══════════════════════════════════════════════════════════════════════

describe('fetchAllUsdtTickers', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; fetchCalls.length = 0; });

  it('filters only USDT pairs from the full ticker list', async () => {
    const mockAll = [
      { symbol: 'BTCUSDT', lastPrice: '67000' },
      { symbol: 'BTCETH', lastPrice: '0.05' },
      { symbol: 'SOLUSDT', lastPrice: '150' },
    ];
    setupMockFetch(mockAll);
    const map = await fetchAllUsdtTickers();
    expect(map.size).toBe(2);
    expect(map.has('BTCUSDT')).toBe(true);
    expect(map.has('SOLUSDT')).toBe(true);
    expect(map.has('BTCETH')).toBe(false);
  });

  it('returns empty map when API returns empty array', async () => {
    setupMockFetch([]);
    const map = await fetchAllUsdtTickers();
    expect(map.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchKlines
// ═══════════════════════════════════════════════════════════════════════

describe('fetchKlines', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; fetchCalls.length = 0; });

  it('returns parsed kline objects', async () => {
    const rawKlines = [
      [1700000000000, '100.0', '110.0', '90.0', '105.0', '5000', 1700003600000, '500000', 100, '2500', '250000', '0'],
    ];
    setupMockFetch(rawKlines);
    const klines = await fetchKlines('SOLUSDT', '1h', 1);
    expect(klines).toHaveLength(1);
    expect(klines[0]!.open).toBe(100);
    expect(klines[0]!.high).toBe(110);
    expect(klines[0]!.low).toBe(90);
    expect(klines[0]!.close).toBe(105);
    expect(klines[0]!.volume).toBe(5000);
  });

  it('uses custom interval and limit parameters', async () => {
    setupMockFetch([]);
    await fetchKlines('BTCUSDT', '15m', 50);
    const calledUrl = fetchCalls[0]!.url;
    expect(calledUrl).toContain('interval=15m');
    expect(calledUrl).toContain('limit=50');
  });

  it('handles single kline with limit=1', async () => {
    const rawKlines = [[1700000000000, '100.0', '110.0', '90.0', '105.0', '5000', 1700003600000, '500000', 100, '2500', '250000', '0']];
    setupMockFetch(rawKlines);
    const klines = await fetchKlines('SOLUSDT', '1h', 1);
    expect(klines).toHaveLength(1);
    expect(klines[0]!.open).toBe(100);
    expect(klines[0]!.high).toBe(110);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchExchangeInfo
// ═══════════════════════════════════════════════════════════════════════

describe('fetchExchangeInfo', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns exchange info with symbols', async () => {
    const mockInfo = {
      timezone: 'UTC',
      serverTime: 1700000000000,
      symbols: [{ symbol: 'BTCUSDT', status: 'TRADING' }],
    };
    setupMockFetch(mockInfo);
    const info = await fetchExchangeInfo();
    expect(info.timezone).toBe('UTC');
    expect(info.symbols).toHaveLength(1);
  });

  it('throws on HTTP error', async () => {
    setupMockFetch({}, 500);
    await expect(fetchExchangeInfo()).rejects.toThrow('HTTP 500');
  });

  it('throws on network failure', async () => {
    setupFetchError('exchange info api down');
    await expect(fetchExchangeInfo()).rejects.toThrow('exchange info api down');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchDepth
// ═══════════════════════════════════════════════════════════════════════

describe('fetchDepth', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; fetchCalls.length = 0; });

  it('returns order book data', async () => {
    const mockDepth = {
      lastUpdateId: 12345,
      bids: [['100.0', '10.0']],
      asks: [['101.0', '5.0']],
    };
    setupMockFetch(mockDepth);
    const depth = await fetchDepth('SOLUSDT', 10);
    expect(depth.lastUpdateId).toBe(12345);
    expect(depth.bids).toHaveLength(1);
    expect(depth.asks).toHaveLength(1);
  });

  it('uses custom limit parameter in URL', async () => {
    setupMockFetch({ lastUpdateId: 1, bids: [], asks: [] });
    await fetchDepth('SOLUSDT', 5);
    expect(fetchCalls[0]!.url).toContain('limit=5');
  });

  it('throws on HTTP error', async () => {
    setupMockFetch({}, 403);
    await expect(fetchDepth('SOLUSDT')).rejects.toThrow('HTTP 403');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Error propagation (circuit breaker re-throws unless tripped)
// ═══════════════════════════════════════════════════════════════════════

describe('Error propagation', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('fetchAllTickers propagates errors', async () => {
    setupFetchError('network error');
    await expect(fetchAllTickers()).rejects.toThrow('network error');
  });

  it('fetchKlines propagates errors', async () => {
    setupFetchError('kline error');
    await expect(fetchKlines('SOLUSDT')).rejects.toThrow('kline error');
  });

  it('fetchAllUsdtTickers propagates errors', async () => {
    setupFetchError('ticker error');
    await expect(fetchAllUsdtTickers()).rejects.toThrow('ticker error');
  });
});
