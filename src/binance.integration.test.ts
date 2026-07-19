// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Binance API Integration Tests
//
// Tests the enrichment pipeline end-to-end by mocking the Binance REST
// API at the fetch level. Covers:
//   - Ticker fetching and enrichment (radar.ts enrichTicker)
//   - Kline fetching and indicator computation
//   - Full runRadar pipeline
//   - Partial / missing data edge cases
//   - Rate-limit retry behavior
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ── Track original fetch so we can restore ──
const originalFetch = globalThis.fetch;

// ── Mock Binance ticker data (SOLUSDT) ──
const MOCK_TICKER_SOL = {
  symbol: 'SOLUSDT',
  priceChange: '2.50',
  priceChangePercent: '3.12',
  weightedAvgPrice: '80.00',
  prevClosePrice: '78.50',
  lastPrice: '82.50',
  lastQty: '15.0',
  bidPrice: '82.48',
  bidQty: '500.0',
  askPrice: '82.52',
  askQty: '300.0',
  openPrice: '80.00',
  highPrice: '84.00',
  lowPrice: '79.00',
  volume: '5000000',
  quoteVolume: '400000000',
  openTime: 1783000000000,
  closeTime: 1783086400000,
  firstId: 1000000,
  lastId: 1005000,
  count: 5000,
};

// ── Mock Binance ticker data (BTCUSDT) ──
const MOCK_TICKER_BTC = {
  symbol: 'BTCUSDT',
  priceChange: '-850.00',
  priceChangePercent: '-1.25',
  weightedAvgPrice: '67800',
  prevClosePrice: '68000',
  lastPrice: '67150',
  lastQty: '0.5',
  bidPrice: '67145',
  bidQty: '2.0',
  askPrice: '67155',
  askQty: '1.5',
  openPrice: '68000',
  highPrice: '68500',
  lowPrice: '66800',
  volume: '12500',
  quoteVolume: '850000000',
  openTime: 1783000000000,
  closeTime: 1783086400000,
  firstId: 500000,
  lastId: 505000,
  count: 10000,
};

// ── Deterministic mock kline data: 200 candles in a gentle uptrend ──
//
// Uses fixed sine-wave variation (no Math.random()) so test results
// are stable across runs. All 200 candles computed at module load time.
const MOCK_KLINES: unknown[][] = (() => {
  const klines: unknown[][] = [];
  for (let i = 0; i < 200; i++) {
    const phase = i * 0.1;
    const base = 80 + i * 0.005;                         // very gentle uptrend
    const open  = base + Math.sin(phase) * 0.5;           // cyclic variation
    const rawDelta = Math.sin(phase * 1.3) * 0.4;          // ~half candles up, ~half down
    const close = open + rawDelta;
    const high  = Math.max(open, close) + 0.4;
    const low   = Math.min(open, close) - 0.4;
    const vol   = 500_000 + (i % 7) * 50_000;

    klines.push([
      1783000000000 + i * 3600000,  // openTime
      open.toFixed(2),               // open
      high.toFixed(2),               // high
      low.toFixed(2),                // low
      close.toFixed(2),              // close
      vol.toFixed(0),                // volume
      (i + 1) * 3600000 + 1783000000000, // closeTime
      (open * vol).toFixed(2),       // quoteVolume
      500 + (i % 13),                // count
      (vol * 0.5).toFixed(0),        // takerBuyVol
      (open * vol * 0.5).toFixed(2), // takerBuyQuoteVol
      '0',                           // ignore
    ]);
  }
  return klines;
})();

// ── Helpers for checking fetch URLs ──
function isTickerUrl(url: string): boolean {
  return url.includes('/api/v3/ticker/24hr');
}

function isKlineUrl(url: string): boolean {
  return url.includes('/api/v3/klines');
}

function isExchangeInfoUrl(url: string): boolean {
  return url.includes('/api/v3/exchangeInfo');
}

function isDepthUrl(url: string): boolean {
  return url.includes('/api/v3/depth');
}

describe('Binance API integration', () => {
  beforeAll(() => {
    // Mock the global fetch before importing modules that use it
    vi.stubGlobal('fetch', vi.fn());
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mocks fetchAllTickers and verifies enrichment fields', async () => {
    // Arrange: mock Binance 24hr ticker endpoint
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [MOCK_TICKER_SOL, MOCK_TICKER_BTC],
    } as Response);

    // Act: import and call fetchAllTickers
    const { fetchAllTickers } = await import('./binance.js');
    const tickers = await fetchAllTickers();

    // Assert: returns a Map with both tickers
    expect(tickers).toBeInstanceOf(Map);
    expect(tickers.size).toBeGreaterThanOrEqual(2);
    expect(tickers.has('SOLUSDT')).toBe(true);
    expect(tickers.has('BTCUSDT')).toBe(true);

    // Verify the ticker data was parsed correctly
    const sol = tickers.get('SOLUSDT')!;
    expect(sol.symbol).toBe('SOLUSDT');
    expect(sol.lastPrice).toBe('82.50');
    expect(sol.priceChangePercent).toBe('3.12');
    expect(sol.volume).toBe('5000000');
    expect(sol.quoteVolume).toBe('400000000');

    const btc = tickers.get('BTCUSDT')!;
    expect(btc.symbol).toBe('BTCUSDT');
    expect(btc.lastPrice).toBe('67150');
    expect(btc.priceChangePercent).toBe('-1.25');

    // Verify the URL was constructed correctly (contains symbols from token registry)
    const callUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain('/api/v3/ticker/24hr');
    expect(callUrl).toContain('SOLUSDT');
    expect(callUrl).toContain('BTCUSDT');
  });

  it('mocks fetchKlines and verifies indicator computation', async () => {
    // Arrange: mock Binance klines endpoint
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_KLINES,
    } as Response);

    // Act: fetch klines then compute indicators
    const { fetchKlines } = await import('./binance.js');
    const { computeAllIndicators } = await import('./indicators.js');

    const klines = await fetchKlines('SOLUSDT', '1h', 200);

    // Assert: kline shape is correct
    expect(klines).toHaveLength(200);
    expect(klines[0]).toHaveProperty('openTime');
    expect(klines[0]).toHaveProperty('open');
    expect(klines[0]).toHaveProperty('high');
    expect(klines[0]).toHaveProperty('low');
    expect(klines[0]).toHaveProperty('close');
    expect(klines[0]).toHaveProperty('volume');
    expect(typeof klines[0]!.openTime).toBe('number');
    expect(typeof klines[0]!.open).toBe('number');
    expect(klines[0]!.open).toBeGreaterThan(0);

    // Act: compute all indicators from real klines
    const indicators = computeAllIndicators(klines);

    // Assert: all indicator fields are populated
    expect(indicators.rsi).not.toBeNull();
    expect(indicators.mfi).not.toBeNull();
    expect(indicators.bb).not.toBeNull();
    expect(indicators.macd).not.toBeNull();
    expect(indicators.macd?.macd).not.toBeNull();
    expect(indicators.macd?.signal).not.toBeNull();
    expect(indicators.atrPct).not.toBeNull();
    expect(indicators.volTrend).not.toBeNull();
    expect(indicators.priceVsEma50).not.toBeNull();

    // In a gentle uptrend, RSI should be > 50
    expect(indicators.rsi!).toBeGreaterThan(50);
    expect(indicators.rsi!).toBeLessThan(90);

    // Bollinger bands should be well-formed
    expect(indicators.bb!.upper).toBeGreaterThan(indicators.bb!.middle);
    expect(indicators.bb!.middle).toBeGreaterThan(indicators.bb!.lower);
    expect(indicators.bb!.width).toBeGreaterThan(0);

    // MACD histogram should be positive in uptrend
    expect(indicators.macd!.histogram).toBeGreaterThan(0);

    // ATR should be a reasonable percentage
    expect(indicators.atrPct!).toBeGreaterThan(0);
    expect(indicators.atrPct!).toBeLessThan(10);

    // Volume trend might fluctuate due to random data — just verify it's computed
    expect(typeof indicators.volTrend).toBe('number');
  });

  it('runs full enrichment pipeline with mocked Binance API', async () => {
    // Arrange: mock both ticker and klines endpoints
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch
      // First call: fetchAllTickers
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => [MOCK_TICKER_SOL],
      } as Response)
      // Subsequent calls: fetchKlines (called once per token, may have multiple)
      .mockResolvedValue({
        ok: true, status: 200,
        json: async () => MOCK_KLINES,
      } as Response);

    // Act: run the full radar pipeline
    const { runRadar } = await import('./radar.js');
    const result = await runRadar({
      chain: 'solana',
      sortBy: 'alpha',
      noLog: true,
      includeNews: false,
    });

    // Assert: run metadata
    expect(result.run).toBeDefined();
    expect(result.run.runId).toMatch(/^RADAR-/);
    expect(result.run.numTokens).toBeGreaterThanOrEqual(1);
    expect(result.run.tsUtc).toBeDefined();
    expect(result.run.durationMs).toBeGreaterThan(0);

    // Assert: enriched tickers
    expect(result.tickers.length).toBeGreaterThanOrEqual(1);
    const ticker = result.tickers[0]!;
    expect(ticker.symbol).toBe('SOL');
    expect(ticker.chain).toBe('solana');
    expect(ticker.lastPrice).toBe(82.50);
    expect(ticker.priceChangePercent).toBe(3.12);

    // Verify enrichment fields are computed
    expect(ticker.spreadPct).toBeGreaterThan(0);            // (ask - bid) / bid * 100
    expect(ticker.rangePosPct).toBeGreaterThanOrEqual(0);   // position in 24h range
    expect(ticker.rangePosPct).toBeLessThanOrEqual(1);
    expect(ticker.momentum).toBeGreaterThan(0);             // priceChangePercent * vol multiplier
    expect(ticker.source).toBe('binance');

    // Assert: technical indicators
    expect(result.technicals.size).toBeGreaterThanOrEqual(1);
    const tech = result.technicals.get('SOL');
    expect(tech).toBeDefined();
    expect(tech!.rsi).not.toBeNull();

    // Assert: signals
    expect(result.signals.length).toBeGreaterThanOrEqual(1);
    const signal = result.signals[0]!;
    expect(signal.symbol).toBe('SOL');
    expect(signal.compositeScore).toBeGreaterThan(0);

    // Assert: aggregated signals
    expect(result.aggregatedSignals.length).toBeGreaterThanOrEqual(1);
    const agg = result.aggregatedSignals[0]!;
    expect(agg.direction).toBeDefined();
    expect(agg.compositeConfidence).toBeGreaterThanOrEqual(0);
    expect(agg.compositeConfidence).toBeLessThanOrEqual(1);
  });

  it('gracefully handles missing tokens in Binance response', async () => {
    // Arrange: Binance only returns data for SOL, not for some tokens
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [MOCK_TICKER_SOL],  // Only SOL, no BTC
    } as Response);

    // Act: run radar with noLog to avoid file writes
    const { runRadar } = await import('./radar.js');
    const result = await runRadar({
      noLog: true,
      includeNews: false,
      includeTech: false,
      sortBy: 'alpha',
    });

    // Assert: SOL is present and other missing tokens are silently skipped
    expect(result.tickers.length).toBeGreaterThanOrEqual(1);
    const symbols = result.tickers.map(t => t.symbol);
    expect(symbols).toContain('SOL');

    // runRadar should NOT crash — null entries are filtered naturally
    // because enrichTicker is only called when raw ticker data exists
    expect(result.run.numTokens).toBe(result.tickers.length);
    expect(result.run.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('recovers from Binance rate-limit (429) via retry', async () => {
    // Arrange: first fetch returns 429, second succeeds
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([['retry-after', '1']]) as unknown as Headers,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [MOCK_TICKER_SOL, MOCK_TICKER_BTC],
      } as Response);

    // Act: fetchAllTickers should retry internally
    const { fetchAllTickers } = await import('./binance.js');
    const tickers = await fetchAllTickers();

    // Assert: succeeded after retry
    expect(tickers.size).toBeGreaterThanOrEqual(2);
    expect(tickers.has('SOLUSDT')).toBe(true);
    expect(tickers.has('BTCUSDT')).toBe(true);

    // Should have attempted the call twice (first 429, second success)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
