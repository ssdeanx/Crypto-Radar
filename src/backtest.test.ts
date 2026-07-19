// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Backtest Engine Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { runBacktest, formatBacktest, winRate, overallWinRate, formatSingleBacktest, optimizeWeights, formatOptimization } from './backtest.js';
import type { Kline } from './types.js';
import type { AggregatedSignal, SignalDirection } from './analysis/strategies.js';

// ── Helpers ──

function makeKline(close: number, openTime = 0, open = close, high = close + 2, low = close - 2): Kline {
  return {
    openTime,
    open,
    high,
    low,
    close,
    volume: 1000,
    closeTime: openTime + 3600000,
    quoteVolume: close * 1000,
    count: 100,
    takerBuyVol: 500,
    takerBuyQuoteVol: 500 * close,
    ignore: 0,
  };
}

function makeKlines(closePrices: number[], startTime = 0): Kline[] {
  return closePrices.map((p, i) => makeKline(p, startTime + i * 3600000));
}

function makeSignal(
  symbol: string,
  direction: SignalDirection,
  confidence: number,
  overrides: Partial<AggregatedSignal> = {},
): AggregatedSignal {
  return {
    symbol,
    tokenName: symbol,
    chain: 'solana',
    lastPrice: 100,
    priceChangePercent: 0,
    direction,
    compositeConfidence: confidence,
    signals: [
      {
        strategy: 'momentum',
        direction,
        confidence,
        reason: `${direction} signal`,
        indicators: {},
        timeframe: '1h',
      },
    ],
    alerts: [],
    timestamp: new Date(startTime).toISOString(),
    ...overrides,
  };
}

const startTime = 1000000;

// ── Tests ──

describe('runBacktest', () => {
  it('returns empty result when no signals provided', () => {
    const result = runBacktest([], new Map());
    expect(result.bySymbol.size).toBe(0);
    expect(result.totals.totalSignals).toBe(0);
    expect(result.totals.winRate).toBe(0);
  });

  it('filters out neutral signals', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'neutral', 0.5),
    ];
    const klines = makeKlines([100, 102], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol);
    expect(result.bySymbol.size).toBe(0);
    expect(result.totals.totalSignals).toBe(0);
  });

  it('filters out low-confidence signals', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.2, { lastPrice: 100 }),
    ];
    const klines = makeKlines([100, 102], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol, { horizon: 1, minConfidence: 0.5, mode: 'forward' });
    expect(result.bySymbol.size).toBe(0);
    expect(result.totals.totalSignals).toBe(0);
  });

  it('counts a buy signal as a win when price goes up (forward mode)', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { lastPrice: 100 }),
    ];
    // Price went up: 100 -> 102
    const klines = makeKlines([98, 100, 102], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol);
    const sol = result.bySymbol.get('SOL');
    expect(sol).toBeDefined();
    expect(sol!.wins).toBe(1);
    expect(sol!.losses).toBe(0);
    expect(sol!.winRate).toBe(1);
    expect(sol!.byDirection.buy.wins).toBe(1);
  });

  it('counts a buy signal as a loss when price goes down (forward mode)', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { lastPrice: 100 }),
    ];
    // Price went down: 100 -> 98
    const klines = makeKlines([102, 100, 98], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol);
    const sol = result.bySymbol.get('SOL');
    expect(sol).toBeDefined();
    expect(sol!.wins).toBe(0);
    expect(sol!.losses).toBe(1);
    expect(sol!.winRate).toBe(0);
  });

  it('counts a sell signal as a win when price goes down', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'sell', 0.8, { lastPrice: 100 }),
    ];
    // Price went down: 100 -> 98
    const klines = makeKlines([102, 100, 98], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol);
    const sol = result.bySymbol.get('SOL');
    expect(sol).toBeDefined();
    expect(sol!.wins).toBe(1);
    expect(sol!.losses).toBe(0);
  });

  it('handles strong_buy and strong_sell directions correctly', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'strong_buy', 0.9, { lastPrice: 100 }),
      makeSignal('BTC', 'strong_sell', 0.9, { lastPrice: 50000 }),
    ];
    // SOL goes up (win), BTC goes up too (sell = loss)
    const solKlines = makeKlines([98, 100, 105], startTime);
    const btcKlines = makeKlines([49000, 50000, 51000], startTime + 100000);
    const klinesBySymbol = new Map<string, Kline[]>([
      ['SOL', solKlines],
      ['BTC', btcKlines],
    ]);
    const result = runBacktest(signals, klinesBySymbol);
    expect(result.bySymbol.get('SOL')!.wins).toBe(1);
    expect(result.bySymbol.get('BTC')!.wins).toBe(0);
    expect(result.totals.totalSignals).toBe(2);
    expect(result.totals.wins).toBe(1);
  });

  it('skips symbols with insufficient kline data', () => {
    // Only 1 kline, but horizon is 1, so need at least 2
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { lastPrice: 100 }),
    ];
    const klines = makeKlines([100], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol);
    expect(result.bySymbol.size).toBe(0);
  });

  it('returns aggregated totals combining multiple symbols', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { lastPrice: 100 }),
      makeSignal('BTC', 'sell', 0.8, { lastPrice: 50000 }),
    ];
    const solKlines = makeKlines([98, 100, 102], startTime);           // buy win
    const btcKlines = makeKlines([49000, 50000, 48000], startTime + 100000); // sell win
    const klinesBySymbol = new Map<string, Kline[]>([
      ['SOL', solKlines],
      ['BTC', btcKlines],
    ]);
    const result = runBacktest(signals, klinesBySymbol);
    expect(result.totals.totalSignals).toBe(2);
    expect(result.totals.wins).toBe(2);
    expect(result.totals.winRate).toBe(1);
  });

  it('computes per-direction breakdowns correctly', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'strong_buy', 0.9, { lastPrice: 100 }),
      makeSignal('SOL', 'buy', 0.7, { lastPrice: 100 }),
      makeSignal('SOL', 'sell', 0.7, { lastPrice: 100 }),
    ];
    // All go up: strong_buy win, buy win, sell loss
    const klines = makeKlines([98, 100, 102, 104], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol);
    const sol = result.bySymbol.get('SOL')!;
    // strong_buy: effectiveDirection='buy', priceChange=+2 => win
    expect(sol.byDirection.strong_buy.total).toBe(1);
    expect(sol.byDirection.strong_buy.wins).toBe(1);
    // buy: effectiveDirection='buy', priceChange=+2 => win
    expect(sol.byDirection.buy.total).toBe(1);
    expect(sol.byDirection.buy.wins).toBe(1);
    // sell: effectiveDirection='sell', priceChange=+2 => loss
    expect(sol.byDirection.sell.total).toBe(1);
    expect(sol.byDirection.sell.wins).toBe(0);
    expect(sol.totalSignals).toBe(3);
  });
});

describe('formatBacktest', () => {
  it('returns formatted string with overall section', () => {
    const result = runBacktest([], new Map());
    const formatted = formatBacktest(result);
    expect(formatted).toContain('Backtest Results');
    expect(formatted).toContain('Overall');
    expect(formatted).toContain('Win Rate');
  });

  it('includes per-direction breakdown when signals exist', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { lastPrice: 100 }),
    ];
    const klines = makeKlines([98, 100, 102], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol);
    const formatted = formatBacktest(result);
    expect(formatted).toContain('By Direction');
    expect(formatted).toContain('Buy');
  });

  it('includes per-symbol breakdown when multiple symbols', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { lastPrice: 100 }),
      makeSignal('BTC', 'buy', 0.8, { lastPrice: 50000 }),
    ];
    const solKlines = makeKlines([98, 100, 102], startTime);
    const btcKlines = makeKlines([49000, 50000, 51000], startTime + 100000);
    const klinesBySymbol = new Map<string, Kline[]>([
      ['SOL', solKlines],
      ['BTC', btcKlines],
    ]);
    const result = runBacktest(signals, klinesBySymbol);
    const formatted = formatBacktest(result);
    expect(formatted).toContain('By Symbol');
    expect(formatted).toContain('SOL');
    expect(formatted).toContain('BTC');
  });
});

describe('winRate / overallWinRate', () => {
  it('returns formatted win rate percentage string', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { lastPrice: 100 }),
    ];
    const klines = makeKlines([98, 100, 102], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol);
    const sol = result.bySymbol.get('SOL')!;
    expect(winRate(sol)).toBe('100.0%');
    expect(overallWinRate(result)).toBe('100.0%');
  });
});

describe('formatSingleBacktest', () => {
  it('formats a single BacktestResult as a readable string', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { lastPrice: 100 }),
    ];
    const klines = makeKlines([98, 100, 102], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = runBacktest(signals, klinesBySymbol);
    const sol = result.bySymbol.get('SOL')!;
    const formatted = formatSingleBacktest(sol);
    expect(formatted).toContain('SOL');
    expect(formatted).toContain('Win Rate');
    expect(formatted).toContain('Total Ret');
    expect(formatted).toContain('Sharpe');
  });
});

// ── Regression: optimizeWeights (F weight optimization) ──

describe('optimizeWeights', () => {
  // Build deterministic signals with individual strategy breakdowns
  function stratSig(symbol: string, direction: 'buy' | 'sell', conf: number, lastPrice: number): AggregatedSignal {
    return {
      symbol,
      tokenName: symbol,
      chain: 'solana',
      lastPrice,
      priceChangePercent: 0,
      direction,
      compositeConfidence: conf,
      signals: [
        { strategy: 'momentum', direction, confidence: conf, reason: 'm', indicators: {}, timeframe: '1h' },
        { strategy: 'mean-reversion', direction, confidence: conf, reason: 'mr', indicators: {}, timeframe: '1h' },
        { strategy: 'trend-following', direction, confidence: conf, reason: 'tf', indicators: {}, timeframe: '1h' },
      ],
      alerts: [],
      timestamp: new Date(startTime).toISOString(),
    };
  }

  function klinesUp(sym: string, base: number, n = 5): Kline[] {
    // ascending closes so 'buy' is a win
    return Array.from({ length: n }, (_, i) => makeKline(base + i * 2, startTime + i * 3600000));
  }

  it('returns defaults when no strategy-breakdown signals', () => {
    const signals = [makeSignal('SOL', 'buy', 0.8, { signals: [] })];
    const klines = makeKlines([100, 102, 104], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    const result = optimizeWeights(signals, klinesBySymbol);
    expect(result.combinationsTested).toBe(0);
    expect(result.bestWeights).toEqual({ momentum: 0.4, meanReversion: 0.2, trendFollowing: 0.4 });
    expect(result.defaultPerformance).toBeNull();
  });

  it('tests weight combinations and returns improvement metrics', () => {
    const signals = [
      stratSig('SOL', 'buy', 0.9, 100),
      stratSig('BTC', 'buy', 0.9, 100),
    ];
    const klinesBySymbol = new Map<string, Kline[]>([
      ['SOL', klinesUp('SOL', 100)],
      ['BTC', klinesUp('BTC', 100)],
    ]);
    const result = optimizeWeights(signals, klinesBySymbol);
    expect(result.combinationsTested).toBeGreaterThan(0);
    expect(result.bestWeights.momentum + result.bestWeights.meanReversion + result.bestWeights.trendFollowing).toBeCloseTo(1, 5);
    expect(result.performance).toBeDefined();
    expect(result.defaultPerformance).toBeDefined();
    expect(result.improvement).toBeDefined();
    expect(result.timestamp).toBeTruthy();
  });

  it('bestWeights respect minWeight floor', () => {
    const signals = [stratSig('SOL', 'buy', 0.9, 100)];
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klinesUp('SOL', 100)]]);
    const result = optimizeWeights(signals, klinesBySymbol, { step: 0.2, minWeight: 0.2 });
    expect(result.bestWeights.momentum).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(result.bestWeights.meanReversion).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(result.bestWeights.trendFollowing).toBeGreaterThanOrEqual(0.2 - 1e-9);
  });

  it('formatOptimization renders without throwing', () => {
    const signals = [stratSig('SOL', 'buy', 0.9, 100)];
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klinesUp('SOL', 100)]]);
    const result = optimizeWeights(signals, klinesBySymbol);
    const out = formatOptimization(result);
    expect(typeof out).toBe('string');
    expect(out).toContain('Weight Optimization');
  });
});

// ── Regression: kline fallback (F6) ──

describe('kline fallback behavior', () => {
  it('handles signal whose lastPrice does not match any kline (uses fallback, no crash)', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { lastPrice: 9999 }), // way off from kline prices
    ];
    const klines = makeKlines([100, 102, 104], startTime);
    const klinesBySymbol = new Map<string, Kline[]>([['SOL', klines]]);
    // Should not throw — fallback to last kline
    const result = runBacktest(signals, klinesBySymbol);
    expect(result.bySymbol.has('SOL')).toBe(true);
    expect(Number.isFinite(result.totals.sharpeRatio)).toBe(true);
  });
});
