// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Strategy Engine Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { StrategyEngine } from './engine.js';
import type { StrategyContext, StrategySignal, AggregatedSignal } from './strategies.js';
import type { EnrichedTicker, TechnicalIndicators, NewsMatch } from '../types.js';

function makeTicker(overrides: Partial<EnrichedTicker> = {}): EnrichedTicker {
  return {
    runId: 'T', tsUtc: '2026-07-02T12:00:00Z', dateEt: '07/02 08:00',
    symbol: 'TEST', chain: 'solana', tokenId: 'test', tokenName: 'Test',
    lastPrice: 100, bidPrice: 99.9, bidQty: 100, askPrice: 100.1, askQty: 100,
    spreadPct: 0.2, openPrice: 99, highPrice: 105, lowPrice: 95,
    prevClosePrice: 99, priceChange: 1, priceChangePercent: 1.0,
    weightedAvgPrice: 100, volume: 10000, quoteVolume: 1_000_000,
    count: 500, lastQty: 10, vwapDistPct: 0, rangePosPct: 0.5,
    bookImbalance: 0, volVsAvg: 0, obv: 0, momentum: 1.0,
    alerts: '', source: 'binance',
    ...overrides,
  };
}

function makeTech(overrides: Partial<TechnicalIndicators> = {}): TechnicalIndicators {
  return {
    rsi: 50, mfi: 50,
    bb: { upper: 110, middle: 100, lower: 90, width: 0.2, position: 0.5 },
    macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
    atrPct: 1.5, volTrend: 0, priceVsEma50: 0,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    ticker: makeTicker(),
    technical: makeTech(),
    news: [],
    klineCloses: Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i * 0.1) * 10),
    klineHighs: Array.from({ length: 200 }, (_, i) => 105 + Math.sin(i * 0.1) * 10),
    klineLows: Array.from({ length: 200 }, (_, i) => 95 + Math.sin(i * 0.1) * 10),
    klineVolumes: Array.from({ length: 200 }, () => 1000),
    ...overrides,
  };
}

describe('StrategyEngine', () => {
  it('evaluates all registered strategies', async () => {
    const engine = new StrategyEngine();
    const result = await engine.evaluate(makeCtx());

    expect(result.signals).toHaveLength(3); // momentum, mean-reversion, trend-following
    expect(result.direction).toBeDefined();
    expect(result.compositeConfidence).toBeGreaterThanOrEqual(0);
    expect(result.compositeConfidence).toBeLessThanOrEqual(1);
  });

  it('produces buy direction for strong uptrend', async () => {
    const engine = new StrategyEngine();
    const ctx = makeCtx({
      ticker: makeTicker({ priceChangePercent: 8.5, quoteVolume: 50_000_000 }),
      technical: makeTech({ rsi: 65, macd: { macd: 1.5, signal: 0.8, histogram: 0.7 }, volTrend: 0.5, priceVsEma50: 5 }),
      klineCloses: Array.from({ length: 200 }, (_, i) => 100 + i * 0.5), // sustained uptrend
      klineHighs: Array.from({ length: 200 }, (_, i) => 102 + i * 0.5),
      klineLows: Array.from({ length: 200 }, (_, i) => 98 + i * 0.5),
    });

    const result = await engine.evaluate(ctx);
    expect(['buy', 'strong_buy']).toContain(result.direction);
    expect(result.compositeConfidence).toBeGreaterThan(0.5);
  });

  it('produces sell direction for strong downtrend', async () => {
    const engine = new StrategyEngine();
    const ctx = makeCtx({
      ticker: makeTicker({ priceChangePercent: -7.2 }),
      technical: makeTech({ rsi: 35, macd: { macd: -1.0, signal: -0.5, histogram: -0.5 }, volTrend: -0.3, priceVsEma50: -4 }),
      klineCloses: Array.from({ length: 200 }, (_, i) => 200 - i * 0.5), // sustained downtrend
      klineHighs: Array.from({ length: 200 }, (_, i) => 202 - i * 0.5),
      klineLows: Array.from({ length: 200 }, (_, i) => 198 - i * 0.5),
    });

    const result = await engine.evaluate(ctx);
    expect(['sell', 'strong_sell']).toContain(result.direction);
    expect(result.compositeConfidence).toBeGreaterThan(0.5);
  });

  it('returns neutral for conflicting signals', async () => {
    const engine = new StrategyEngine();
    const ctx = makeCtx({
      ticker: makeTicker({ priceChangePercent: 0.5, quoteVolume: 100_000 }),
      technical: makeTech({ rsi: 50, macd: { macd: 0, signal: 0, histogram: 0 }, volTrend: 0, priceVsEma50: 0 }),
      klineCloses: Array.from({ length: 200 }, () => 100), // flat
    });

    const result = await engine.evaluate(ctx);
    expect(result.direction).toBe('neutral');
  });

  it('produces strong_buy when momentum and trend align', async () => {
    const engine = new StrategyEngine();
    const ctx = makeCtx({
      ticker: makeTicker({ priceChangePercent: 12, quoteVolume: 100_000_000, spreadPct: 0.05 }),
      technical: makeTech({ rsi: 68, macd: { macd: 2.0, signal: 1.0, histogram: 1.0 }, volTrend: 0.8, priceVsEma50: 8 }),
      klineCloses: Array.from({ length: 200 }, (_, i) => 80 + i * 0.8),
      klineHighs: Array.from({ length: 200 }, (_, i) => 82 + i * 0.8),
      klineLows: Array.from({ length: 200 }, (_, i) => 78 + i * 0.8),
    });

    const result = await engine.evaluate(ctx);
    expect(result.direction).toBe('strong_buy');
    expect(result.compositeConfidence).toBeGreaterThan(0.7);
  });

  it('handles strategy failure gracefully', async () => {
    // Create engine with a broken strategy
    const brokenStrategy = {
      name: 'broken',
      description: 'Always throws',
      timeframe: '1h',
      evaluate: () => { throw new Error('Intentional failure'); },
    };
    const engine = new StrategyEngine([brokenStrategy]);
    const result = await engine.evaluate(makeCtx());

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]!.strategy).toBe('broken');
    expect(result.signals[0]!.direction).toBe('neutral');
  });

  it('generates alerts for extreme conditions', async () => {
    const engine = new StrategyEngine();
    const ctx = makeCtx({
      ticker: makeTicker({ priceChangePercent: -6.5 }),
      technical: makeTech({ rsi: 28 }),
      news: [
        { runId: 'T', tsUtc: '', symbol: 'TEST', headline: 'Bad news', description: '', source: 'CT', domain: 'ct.com', relevance: 0.9, url: '' },
        { runId: 'T', tsUtc: '', symbol: 'TEST', headline: 'Worse news', description: '', source: 'CT', domain: 'ct.com', relevance: 0.8, url: '' },
      ],
    });

    const result = await engine.evaluate(ctx);
    expect(result.alerts.some(a => a.includes('DIP'))).toBe(true);
    expect(result.alerts.some(a => a.includes('oversold'))).toBe(true);
    expect(result.alerts.some(a => a.includes('News'))).toBe(true);
  });

  it('exposes strategy info with weights', () => {
    const engine = new StrategyEngine();
    const info = engine.getStrategyInfo();

    expect(info.strategies).toHaveLength(3);
    expect(info.tfWeights).toBeDefined();
    expect(info.tfWeights['1h']).toBe(0.25);
    const momentum = info.strategies.find(s => s.name === 'momentum');
    expect(momentum).toBeDefined();
    expect(momentum!.weight).toBe(0.4);
    expect(momentum!.timeframe).toBe('1h');
  });

  it('getStrategyWeights returns current weights as record', () => {
    const engine = new StrategyEngine();
    const weights = engine.getStrategyWeights();
    expect(weights['momentum']).toBe(0.4);
    expect(weights['mean-reversion']).toBe(0.2);
    expect(weights['trend-following']).toBe(0.4);
  });

  it('setStrategyWeight updates weight at runtime', () => {
    const engine = new StrategyEngine();
    engine.setStrategyWeight('momentum', 0.5);
    expect(engine.getStrategyWeights()['momentum']).toBe(0.5);
  });

  it('setStrategyWeight throws for unknown strategy', () => {
    const engine = new StrategyEngine();
    expect(() => engine.setStrategyWeight('unknown', 0.5)).toThrow('Unknown strategy');
  });
});
