// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Signal Generation Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { computeSignals, computeOnchainBoost, clearAlertCache } from './signals.js';
import type { EnrichedTicker, TechnicalIndicators, NewsMatch } from './types.js';
import type { OnChainMetrics } from './onchain.js';

function makeTicker(overrides: Partial<EnrichedTicker> = {}): EnrichedTicker {
  return {
    runId: 'TEST-1',
    tsUtc: '2026-07-02T12:00:00Z',
    dateEt: '07/02 08:00',
    symbol: 'TEST',
    chain: 'solana',
    tokenId: 'test-token',
    tokenName: 'Test Token',
    lastPrice: 100,
    bidPrice: 99.95,
    bidQty: 100,
    askPrice: 100.05,
    askQty: 100,
    spreadPct: 0.1,
    openPrice: 99,
    highPrice: 105,
    lowPrice: 95,
    prevClosePrice: 99,
    priceChange: 1,
    priceChangePercent: 1.0,
    weightedAvgPrice: 100,
    volume: 10000,
    quoteVolume: 1_000_000,
    count: 500,
    lastQty: 10,
    vwapDistPct: 0,
    rangePosPct: 0.5,
    bookImbalance: 0,
    volVsAvg: 0,
    obv: 0,
    momentum: 1.0,
    alerts: '',
    source: 'binance',
    ...overrides,
  };
}

function makeTech(overrides: Partial<TechnicalIndicators> = {}): TechnicalIndicators {
  return {
    rsi: 50,
    mfi: 50,
    bb: { upper: 110, middle: 100, lower: 90, width: 0.2, position: 0.5 },
    macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
    atrPct: 1.5,
    volTrend: 0,
    priceVsEma50: 0,
    obv: 0,
    volVsAvg: 0,
    ...overrides,
  };
}

function makeNews(symbol: string, relevance = 0.7): NewsMatch {
  return {
    runId: 'TEST-1',
    tsUtc: '2026-07-02T12:00:00Z',
    symbol,
    headline: `Test news for ${symbol}`,
    description: 'Test description',
    source: 'CoinTelegraph',
    domain: 'cointelegraph.com',
    relevance,
    url: 'https://example.com/test',
  };
}

describe('computeSignals', () => {
  it('computes composite signals from tickers', () => {
    const tickers = [makeTicker({ symbol: 'TEST', priceChangePercent: 3.5, quoteVolume: 20_000_000 })];
    const technicals = new Map([['TEST', makeTech({ rsi: 62, macd: { macd: 0.8, signal: 0.4, histogram: 0.4 } })]]);
    const news = [makeNews('TEST', 0.8)];

    const signals = computeSignals(tickers, technicals, news);
    expect(signals).toHaveLength(1);

    const s = signals[0]!;
    expect(s.symbol).toBe('TEST');
    expect(s.momentumScore).toBeGreaterThan(50); // Positive price change boosts
    expect(s.technicalScore).toBeGreaterThan(50); // Bullish RSI + MACD
    expect(s.newsScore).toBeGreaterThan(0);       // Has news
    expect(s.compositeScore).toBeGreaterThan(0);
  });

  it('generates DIP alert for large drops', () => {
    const tickers = [makeTicker({ priceChangePercent: -8 })];
    const signals = computeSignals(tickers, new Map(), []);
    expect(signals[0]!.alerts[0]).toContain('DIP (>5% drop)');
    expect(signals[0]!.alerts[0]).toContain('CRITICAL');
  });

  it('generates PUMP alert for large gains', () => {
    const tickers = [makeTicker({ priceChangePercent: 12 })];
    const signals = computeSignals(tickers, new Map(), []);
    expect(signals[0]!.alerts[0]).toContain('PUMP (>5% gain)');
    expect(signals[0]!.alerts[0]).toContain('CRITICAL');
  });

  it('generates overbought alert for high RSI', () => {
    const tickers = [makeTicker()];
    const technicals = new Map([['TEST', makeTech({ rsi: 78 })]]);
    const signals = computeSignals(tickers, technicals, []);
    expect(signals[0]!.alerts.find(a => a.includes('Overbought'))).toBeTruthy();
  });

  it('generates oversold alert for low RSI', () => {
    const tickers = [makeTicker()];
    const technicals = new Map([['TEST', makeTech({ rsi: 25 })]]);
    const signals = computeSignals(tickers, technicals, []);
    expect(signals[0]!.alerts.find(a => a.includes('Oversold'))).toBeTruthy();
  });

  it('news score contribution increases with more articles', () => {
    const tickers = [makeTicker()];

    const signalsNoNews = computeSignals(tickers, new Map(), []);
    const signalsWithNews = computeSignals(tickers, new Map(), [
      makeNews('TEST', 1.0),
      makeNews('TEST', 0.7),
    ]);

    expect(signalsWithNews[0]!.newsScore).toBeGreaterThan(signalsNoNews[0]!.newsScore);
    expect(signalsNoNews[0]!.newsScore).toBe(0);
  });

  it('handles missing technical data gracefully', () => {
    const tickers = [makeTicker()];
    const signals = computeSignals(tickers, new Map(), []);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.technicalScore).toBe(0);
  });

  it('sorts correctly by momentum', () => {
    const tickers = [
      makeTicker({ symbol: 'HIGH', priceChangePercent: 8, quoteVolume: 50_000_000 }),
      makeTicker({ symbol: 'LOW', priceChangePercent: -3, quoteVolume: 100_000 }),
    ];
    const signals = computeSignals(tickers, new Map(), []);
    expect(signals[0]!.symbol).toBe('HIGH');
    expect(signals[0]!.momentumScore).toBeGreaterThan(signals[1]!.momentumScore);
  });
});

// ── computeOnchainBoost ──

describe('computeOnchainBoost', () => {
  function makeOnchain(tvl: number, slug: string, trend: 'up' | 'flat' | 'down' = 'flat'): OnChainMetrics {
    return {
      protocols: [{ name: slug, tvl, fees1d: 0, fees7d: 0, fees30d: 0, tvlTrend: trend }],
      chains: [],
      fetchedAt: '2026-07-03T00:00:00Z',
    };
  }

  it('returns 0 when onchain is null', () => {
    expect(computeOnchainBoost('SOLUSDT', 'solana', null)).toBe(0);
  });

  it('returns 0 when token has no protocol mapping', () => {
    const onchain = makeOnchain(5_000_000_000, 'some-protocol');
    expect(computeOnchainBoost('SOLUSDT', 'unknown-token', onchain)).toBe(0);
  });

  it('returns 0 when protocol not in fetched metrics', () => {
    const onchain = makeOnchain(5_000_000_000, 'irrelevant-protocol');
    // uniswap is mapped, but not in the fetched protocols
    expect(computeOnchainBoost('UNIUSDT', 'uniswap', onchain)).toBe(0);
  });

  it('returns 10-15 for high TVL (>$1B)', () => {
    const onchain = makeOnchain(5_000_000_000, 'jupiter-lend');
    const boost = computeOnchainBoost('JUPUSDT', 'jupiter', onchain);
    expect(boost).toBeGreaterThanOrEqual(10);
    expect(boost).toBeLessThanOrEqual(15);
  });

  it('returns 5-10 for medium TVL ($100M-$1B)', () => {
    const onchain = makeOnchain(500_000_000, 'raydium-amm');
    const boost = computeOnchainBoost('RAYUSDT', 'raydium', onchain);
    expect(boost).toBeGreaterThanOrEqual(5);
    expect(boost).toBeLessThanOrEqual(10);
  });

  it('returns 0-5 for low TVL (<$100M)', () => {
    const onchain = makeOnchain(50_000_000, 'raydium-amm');
    const boost = computeOnchainBoost('RAYUSDT', 'raydium', onchain);
    expect(boost).toBeGreaterThanOrEqual(0);
    expect(boost).toBeLessThanOrEqual(5);
  });

  it('returns 10 for high TVL with flat trend (instead of old formula max)', () => {
    const onchain = makeOnchain(2_000_000_000_000, 'jupiter-lend', 'flat');
    const boost = computeOnchainBoost('JUPUSDT', 'jupiter', onchain);
    expect(boost).toBe(10);
  });

  it('returns 15 for high TVL with uptrend', () => {
    const onchain = makeOnchain(2_000_000_000_000, 'jupiter-lend', 'up');
    const boost = computeOnchainBoost('JUPUSDT', 'jupiter', onchain);
    expect(boost).toBe(15);
  });

  it('returns 0 for high TVL with downtrend', () => {
    const onchain = makeOnchain(2_000_000_000_000, 'jupiter-lend', 'down');
    const boost = computeOnchainBoost('JUPUSDT', 'jupiter', onchain);
    expect(boost).toBe(0);
  });
});

// ── computeSignals with on-chain parameter ──

describe('computeSignals with onchain', () => {
  beforeEach(() => {
    clearAlertCache();
  });

  it('passes onchain parameter without breaking existing behavior', () => {
    const tickers = [makeTicker({ symbol: 'TEST', tokenId: 'test-token', priceChangePercent: 0 })];
    const signals = computeSignals(tickers, new Map(), [], null);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.compositeScore).toBeGreaterThanOrEqual(0);
  });

  it('applies on-chain boost to composite score for mapped token', () => {
    const tickers = [makeTicker({ symbol: 'JUPUSDT', tokenId: 'jupiter', priceChangePercent: 0 })];
    const onchain: OnChainMetrics = {
      protocols: [{ name: 'jupiter-lend', tvl: 5_000_000_000, fees1d: 0, fees7d: 0, fees30d: 0, tvlTrend: 'flat' }],
      chains: [],
      fetchedAt: '2026-07-03T00:00:00Z',
    };
    const signalsWith = computeSignals(tickers, new Map(), [], onchain);
    const signalsWithout = computeSignals(tickers, new Map(), [], null);

    expect(signalsWith[0]!.compositeScore).toBeGreaterThan(signalsWithout[0]!.compositeScore);
  });

  it('adds Strong on-chain TVL alert for high boost', () => {
    const tickers = [makeTicker({ symbol: 'JUPUSDT', tokenId: 'jupiter', priceChangePercent: 0 })];
    const onchain: OnChainMetrics = {
      protocols: [{ name: 'jupiter-lend', tvl: 5_000_000_000, fees1d: 0, fees7d: 0, fees30d: 0, tvlTrend: 'flat' }],
      chains: [],
      fetchedAt: '2026-07-03T00:00:00Z',
    };
    const signals = computeSignals(tickers, new Map(), [], onchain);
    expect(signals[0]!.alerts.find(a => a.includes('Strong on-chain'))).toBeTruthy();
  });
});

// ── Prism-scan remediation regression tests (findings #1–#5) ──

describe('prism-scan remediation', () => {
  beforeEach(() => {
    clearAlertCache();
  });

  // Finding #1 — missing news is neutral, not a 0 that under-ranks a token.
  it('treats missing news as neutral (no 20pt structural penalty)', () => {
    const tickers = [makeTicker({ symbol: 'TEST', priceChangePercent: 0 })];
    const tech = new Map([['TEST', makeTech({ rsi: 50, adx: undefined })]]);
    const noNews = computeSignals(tickers, tech, []);
    const weakNews = computeSignals(tickers, tech, [makeNews('TEST', 0.1)]);
    // Neutral baseline (50) contributes 0.2*50=10; a 0.1-relevance article
    // contributes 0.2*2=0.4. Missing news must NOT be penalized below weak news.
    expect(noNews[0]!.compositeScore).toBeGreaterThan(weakNews[0]!.compositeScore);
  });

  // Finding #2 — divergence uses same-window range position, not 24h ticker.
  it('detects regular divergence only from same-window range position', () => {
    // Window-low + RSI not confirming + negative change → bullish-regular.
    const tickersBull = [makeTicker({ symbol: 'TEST', priceChangePercent: -2 })];
    const techBull = new Map([['TEST', makeTech({ rsi: 55, rangePosWindow: 0.05 })]]);
    const bull = computeSignals(tickersBull, techBull, [])[0]!;
    expect(bull.divergence?.type).toBe('bullish-regular');

    // 24h ticker at the low BUT window range mid → must NOT fire (no longer
    // mixes the 24h ticker position with the 1h RSI).
    const tickersMis = [makeTicker({ symbol: 'TEST', priceChangePercent: -2, rangePosPct: 0.1 })];
    const techMis = new Map([['TEST', makeTech({ rsi: 55, rangePosWindow: 0.5 })]]);
    const mis = computeSignals(tickersMis, techMis, [])[0]!;
    expect(mis.divergence?.type).toBeUndefined();
  });

  // Finding #3 — a malformed (NaN) feed field must not poison the composite.
  it('keeps composite finite when a feed field is NaN', () => {
    const tickers = [makeTicker({ symbol: 'TEST', priceChangePercent: NaN })];
    const signals = computeSignals(tickers, new Map(), []);
    const c = signals[0]!.compositeScore;
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(100);
  });

  // Finding #4 — on-chain boost is multiplicative & post-clamp (not eaten).
  it('applies on-chain boost multiplicatively after the clamp', () => {
    const tickers = [makeTicker({ symbol: 'JUPUSDT', tokenId: 'jupiter', priceChangePercent: 0 })];
    const tech = new Map([['JUPUSDT', makeTech({ rsi: 50, adx: undefined })]]);
    const onchain: OnChainMetrics = {
      protocols: [{ name: 'jupiter-lend', tvl: 5_000_000_000, fees1d: 0, fees7d: 0, fees30d: 0, tvlTrend: 'flat' }],
      chains: [], fetchedAt: '2026-07-03T00:00:00Z',
    };
    const without = computeSignals(tickers, tech, [], null)[0]!.compositeScore;
    const withBoost = computeSignals(tickers, tech, [], onchain)[0]!.compositeScore;
    // Boost must be applied as ×(1 + boost/100) = ×1.10 of the clamped base,
    // NOT added as a flat +10pp (which a clamp would also eat for high bases).
    expect(withBoost).toBeCloseTo(without * 1.10, 1);
    expect(withBoost).not.toBeCloseTo(without + 10, 1); // reject old additive form
    expect(withBoost).toBeGreaterThan(without);
  });

  // Finding #5 — ADX multiplier scales the score, NOT the on-chain boost.
  it('applies ADX multiplier to score only, leaving on-chain boost unscaled', () => {
    const mk = (adx: number) => {
      const tickers = [makeTicker({ symbol: 'JUPUSDT', tokenId: 'jupiter', priceChangePercent: 0 })];
      const tech = new Map([['JUPUSDT', makeTech({ rsi: 50, adx })]]);
      const onchain: OnChainMetrics = {
        protocols: [{ name: 'jupiter-lend', tvl: 5_000_000_000, fees1d: 0, fees7d: 0, fees30d: 0, tvlTrend: 'flat' }],
        chains: [], fetchedAt: '2026-07-03T00:00:00Z',
      };
      return computeSignals(tickers, tech, [], onchain)[0]!.compositeScore;
    };
    const baseNoAdx = computeSignals(
      [makeTicker({ symbol: 'JUPUSDT', tokenId: 'jupiter', priceChangePercent: 0 })],
      new Map([['JUPUSDT', makeTech({ rsi: 50, adx: undefined })]]),
      [], null,
    )[0]!.compositeScore;
    // ADX 10 → 0.6× score, then ×1.10 boost; ADX 60 → 1.1× score, then ×1.10 boost.
    // The boost is independent of ADX (old code scaled the boost by ADX too,
    // e.g. (base×0.6)+10, which double-penalized choppy markets).
    expect(mk(10)).toBeCloseTo(baseNoAdx * 0.6 * 1.10, 1);
    expect(mk(60)).toBeCloseTo(baseNoAdx * 1.1 * 1.10, 1);
    expect(mk(60)).toBeGreaterThan(mk(10)); // higher trend strength → higher score
  });
});
