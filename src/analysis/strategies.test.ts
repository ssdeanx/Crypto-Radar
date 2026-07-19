// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Strategy Types Tests
// ═══════════════════════════════════════════════════════════════════════
//
// strategies.ts exports only TypeScript types/interfaces (no runtime
// functions or classes). These tests verify that the types are usable
// at runtime and that type narrowing / construction works as expected.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import type {
  SignalDirection,
  StrategySignal,
  AggregatedSignal,
  StrategyContext,
  SignalStrategy,
  StrategyWeight,
} from './strategies.js';
import type { EnrichedTicker, TechnicalIndicators, NewsMatch } from '../types.js';

// ── Type Verification — compile-time only, but we exercise constructors ──

describe('StrategySignal', () => {
  it('can be constructed with correct shape', () => {
    const signal: StrategySignal = {
      strategy: 'momentum',
      direction: 'buy',
      confidence: 0.75,
      reason: 'Strong uptrend',
      indicators: { rsi: 65, macd: 0.5 },
      timeframe: '1h',
    };
    expect(signal.strategy).toBe('momentum');
    expect(signal.direction).toBe('buy');
    expect(signal.confidence).toBe(0.75);
    expect(signal.reason).toBe('Strong uptrend');
    expect(signal.indicators.rsi).toBe(65);
    expect(signal.timeframe).toBe('1h');
  });

  it('accepts all valid SignalDirection values', () => {
    const directions: SignalDirection[] = ['buy', 'sell', 'neutral', 'strong_buy', 'strong_sell'];
    for (const dir of directions) {
      const signal: StrategySignal = {
        strategy: 'test',
        direction: dir,
        confidence: 0.5,
        reason: 'test',
        indicators: {},
        timeframe: '1h',
      };
      expect(signal.direction).toBe(dir);
    }
  });
});

describe('AggregatedSignal', () => {
  it('can be constructed with required fields', () => {
    const signal: AggregatedSignal = {
      symbol: 'SOLUSDT',
      tokenName: 'Solana',
      chain: 'solana',
      lastPrice: 150.0,
      priceChangePercent: 5.2,
      direction: 'buy',
      compositeConfidence: 0.65,
      signals: [],
      alerts: ['Strong momentum'],
      timestamp: new Date().toISOString(),
    };
    expect(signal.symbol).toBe('SOLUSDT');
    expect(signal.direction).toBe('buy');
    expect(signal.signals).toEqual([]);
    expect(signal.positionSize).toBeUndefined();
  });

  it('accepts optional fields', () => {
    const signal: AggregatedSignal = {
      symbol: 'BTCUSDT',
      tokenName: 'Bitcoin',
      chain: 'bitcoin',
      lastPrice: 60000,
      priceChangePercent: -2.1,
      direction: 'sell',
      compositeConfidence: 0.8,
      signals: [
        {
          strategy: 'momentum',
          direction: 'sell',
          confidence: 0.8,
          reason: 'Downtrend',
          indicators: {},
          timeframe: '1h',
        },
      ],
      alerts: [],
      timestamp: new Date().toISOString(),
      positionSize: 0.5,
      confidenceRange: { low: 0.6, high: 0.9 },
      compositeReason: 'All strategies align bearish',
    };
    expect(signal.positionSize).toBe(0.5);
    expect(signal.confidenceRange!.low).toBe(0.6);
    expect(signal.compositeReason).toBe('All strategies align bearish');
    expect(signal.signals).toHaveLength(1);
  });
});

describe('StrategyContext', () => {
  it('can be constructed with correct shape', () => {
    const ticker: EnrichedTicker = {
      runId: 'T', tsUtc: '2026-07-02T12:00:00Z', dateEt: '07/02 08:00',
      symbol: 'TEST', chain: 'solana', tokenId: 'test', tokenName: 'Test',
      lastPrice: 100, bidPrice: 99.9, bidQty: 100, askPrice: 100.1, askQty: 100,
      spreadPct: 0.2, openPrice: 99, highPrice: 105, lowPrice: 95,
      prevClosePrice: 99, priceChange: 1, priceChangePercent: 1.0,
      weightedAvgPrice: 100, volume: 10000, quoteVolume: 1_000_000,
      count: 500, lastQty: 10, vwapDistPct: 0, rangePosPct: 0.5,
      bookImbalance: 0, volVsAvg: 0, obv: 0, momentum: 1.0,
      alerts: '', source: 'binance',
    };
    const tech: TechnicalIndicators = {
      rsi: 50, mfi: 50,
      bb: { upper: 110, middle: 100, lower: 90, width: 0.2, position: 0.5 },
      macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
      atrPct: 1.5, volTrend: 0, priceVsEma50: 0,
      obv: null, volVsAvg: null,
    };
    const context: StrategyContext = {
      ticker,
      technical: tech,
      technicalsByInterval: new Map(),
      news: [],
      klineCloses: [100, 101, 102],
      klineHighs: [105, 106, 107],
      klineLows: [95, 96, 97],
      klineVolumes: [1000, 1100, 1200],
    };
    expect(context.ticker.symbol).toBe('TEST');
    expect(context.technical!.rsi).toBe(50);
    expect(context.klineCloses).toHaveLength(3);
    expect(context.technicalsByInterval.size).toBe(0);
  });
});

describe('SignalStrategy', () => {
  it('can be implemented by a class', () => {
    class TestStrategy implements SignalStrategy {
      readonly name = 'test';
      readonly description = 'Test strategy';
      readonly timeframe = '1h';
      evaluate(ctx: StrategyContext) {
        return {
          strategy: this.name,
          direction: 'neutral' as const,
          confidence: 0.5,
          reason: 'test',
          indicators: {},
          timeframe: this.timeframe,
        };
      }
    }
    const strategy = new TestStrategy();
    expect(strategy.name).toBe('test');
    const result = strategy.evaluate({
      ticker: {} as EnrichedTicker,
      technical: null,
      technicalsByInterval: new Map(),
      news: [],
      klineCloses: [],
      klineHighs: [],
      klineLows: [],
      klineVolumes: [],
    });
    expect(result.direction).toBe('neutral');
  });
});

describe('StrategyWeight', () => {
  it('can be constructed with correct shape', () => {
    const weight: StrategyWeight = { name: 'momentum', weight: 0.4 };
    expect(weight.name).toBe('momentum');
    expect(weight.weight).toBe(0.4);
  });
});
