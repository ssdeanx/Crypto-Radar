// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Shared Test Helpers
// ═══════════════════════════════════════════════════════════════════════
//
// Reusable factories for test data, shared across test files.
// Keeps test data construction consistent and reduces duplication.

import type { EnrichedTicker, TechnicalIndicators, NewsMatch, TokenSignal } from './types.js';

/** Create a mock EnrichedTicker with sensible defaults */
export function makeTicker(overrides: Partial<EnrichedTicker> = {}): EnrichedTicker {
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

/** Create mock TechnicalIndicators with sensible defaults */
export function makeTech(overrides: Partial<TechnicalIndicators> = {}): TechnicalIndicators {
  return {
    rsi: 50,
    mfi: 50,
    bb: { upper: 110, middle: 100, lower: 90, width: 0.2, position: 0.5 },
    macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
    atrPct: 1.5,
    volTrend: 0,
    priceVsEma50: 0,
    obv: null,
    volVsAvg: null,
    ...overrides,
  } as TechnicalIndicators;
}

/** Create a mock NewsMatch */
export function makeNews(symbol: string, relevance = 0.7): NewsMatch {
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

/** Create a mock TokenSignal with sensible defaults */
export function makeSignal(overrides: Partial<TokenSignal> = {}): TokenSignal {
  return {
    symbol: 'TEST',
    chain: 'solana',
    tokenId: 'test-token',
    tokenName: 'Test Token',
    compositeScore: 50,
    momentumScore: 50,
    technicalScore: 50,
    newsScore: 50,
    lastPrice: 100,
    priceChangePercent: 0,
    alerts: [],
    timestamp: '2026-07-03T00:00:00Z',
    ...overrides,
  };
}
