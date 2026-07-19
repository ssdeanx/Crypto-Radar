// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — SVG Signal Dashboard Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { signalDashboard } from './signal-dashboard.js';
import type { DashboardOptions } from './signal-dashboard.js';
import type { EnrichedTicker } from '../types.js';
import type { AggregatedSignal, SignalDirection } from '../analysis/strategies.js';

// ── Test Data Factories ──

function makeTicker(overrides: Partial<EnrichedTicker> = {}): EnrichedTicker {
  return {
    runId: 'TEST-1', tsUtc: '2026-07-06T12:00:00Z', dateEt: '07/06 08:00',
    symbol: 'SOL', chain: 'solana', tokenId: 'solana', tokenName: 'Solana',
    lastPrice: 80.50, bidPrice: 80.48, bidQty: 500, askPrice: 80.52, askQty: 500,
    spreadPct: 0.0497, openPrice: 78.00, highPrice: 82.00, lowPrice: 77.00,
    prevClosePrice: 78.50, priceChange: 2.0, priceChangePercent: 2.55,
    weightedAvgPrice: 80.00, volume: 5000000, quoteVolume: 400_000_000,
    count: 25000, lastQty: 50, vwapDistPct: 0.63, rangePosPct: 0.70,
    bookImbalance: 0.0, volVsAvg: 0, obv: 0, momentum: 3.06,
    alerts: '', source: 'binance',
    ...overrides,
  };
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
    lastPrice: 80.50,
    priceChangePercent: 2.55,
    direction,
    compositeConfidence: confidence,
    signals: [
      { strategy: 'momentum', direction, confidence, reason: 'Strong momentum', indicators: {}, timeframe: '1h' },
    ],
    alerts: [],
    timestamp: '2026-07-06T12:00:00Z',
    ...overrides,
  };
}

// ── Tests ──

describe('signalDashboard', () => {
  it('returns a complete SVG document', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker()],
      aggregatedSignals: [],
      onchain: null,
    };
    const svg = signalDashboard(options, 800, 900);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox="0 0 800 900"');
  });

  it('includes header with title', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker()],
      aggregatedSignals: [],
      onchain: null,
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('Crypto Radar');
    expect(svg).toContain('Market Intelligence');
  });

  it('shows token count in status bar', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker(), makeTicker({ symbol: 'BTC', chain: 'multi' })],
      aggregatedSignals: [],
      onchain: null,
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('Tokens:');
    expect(svg).toContain('2');
  });

  it('includes signal count in status bar', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker()],
      aggregatedSignals: [
        makeSignal('SOL', 'buy', 0.8),
        makeSignal('BTC', 'sell', 0.7),
      ],
      onchain: null,
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('Signals:');
    expect(svg).toContain('2');
  });

  it('shows panel titles for all 4 panels', () => {
    const options: DashboardOptions = {
      tickers: [
        makeTicker({ symbol: 'SOL', priceChangePercent: 5 }),
        makeTicker({ symbol: 'BTC', priceChangePercent: -3 }),
      ],
      aggregatedSignals: [makeSignal('SOL', 'strong_buy', 0.95)],
      onchain: {
        protocols: [
          { name: 'Solana', tvl: 5_000_000_000, fees1d: 1_000_000, fees7d: 7_000_000, fees30d: 30_000_000, tvlTrend: 'up' },
        ],
        chains: [{ chain: 'solana', tvl: 5_000_000_000, protocols: 1 }],
        fetchedAt: '2026-07-06T12:00:00Z',
      },
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('Top Signals');
    expect(svg).toContain('Market Breadth');
    expect(svg).toContain('Correlation Matrix');
    expect(svg).toContain('On-Chain Metrics');
  });

  it('shows top signals when provided', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker()],
      aggregatedSignals: [makeSignal('SOL', 'strong_buy', 0.95)],
      onchain: null,
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('STRONG BUY');
    expect(svg).toContain('SOL');
    expect(svg).toContain('95%');
  });

  it('shows empty state when no signals', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker()],
      aggregatedSignals: [],
      onchain: null,
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('No signals generated');
  });

  it('includes market breadth section with gainers/losers', () => {
    const options: DashboardOptions = {
      tickers: [
        makeTicker({ symbol: 'GAINER', priceChangePercent: 10 }),
        makeTicker({ symbol: 'LOSER', priceChangePercent: -5 }),
      ],
      aggregatedSignals: [],
      onchain: null,
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('Top Gainers');
    expect(svg).toContain('Top Losers');
    expect(svg).toContain('GAINER');
    expect(svg).toContain('LOSER');
  });

  it('shows correlation unavailable message when not enough data', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker()],
      aggregatedSignals: [], // fewer than 2 tokens for correlation
      onchain: null,
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('Not enough data for correlation');
  });

  it('shows on-chain panel with protocol data when provided', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker()],
      aggregatedSignals: [makeSignal('SOL', 'buy', 0.7)],
      onchain: {
        protocols: [
          { name: 'Solana', tvl: 10_000_000_000, fees1d: 2_000_000, fees7d: 14_000_000, fees30d: 60_000_000, tvlTrend: 'up' },
          { name: 'Ethereum', tvl: 50_000_000_000, fees1d: 10_000_000, fees7d: 70_000_000, fees30d: 300_000_000, tvlTrend: 'flat' },
        ],
        chains: [],
        fetchedAt: '2026-07-06T12:00:00Z',
      },
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('Solana');
    expect(svg).toContain('Ethereum');
    expect(svg).toContain('$10000.00M'); // formatted TVL for 10B
  });

  it('shows on-chain empty state when no onchain data', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker()],
      aggregatedSignals: [],
      onchain: null,
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('No on-chain data available');
  });

  it('includes footer with generator name', () => {
    const options: DashboardOptions = {
      tickers: [makeTicker()],
      aggregatedSignals: [],
      onchain: null,
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('Hermes Crypto Radar');
  });

  it('handles marketBreadth option', () => {
    const options: DashboardOptions = {
      tickers: [
        makeTicker({ symbol: 'SOL', priceChangePercent: 5 }),
        makeTicker({ symbol: 'BTC', priceChangePercent: -3 }),
      ],
      aggregatedSignals: [],
      onchain: null,
      marketBreadth: { up: 1, down: 1, total: 2 },
    };
    const svg = signalDashboard(options);
    expect(svg).toContain('Breadth:');
    expect(svg).toContain('1/1/2');
  });

  it('handles correlation matrix when provided and enough signals', () => {
    const options: DashboardOptions = {
      tickers: [
        makeTicker({ symbol: 'SOL' }),
        makeTicker({ symbol: 'BTC' }),
        makeTicker({ symbol: 'ETH' }),
      ],
      aggregatedSignals: [
        makeSignal('SOL', 'buy', 0.8),
        makeSignal('BTC', 'sell', 0.7),
        makeSignal('ETH', 'neutral', 0.5),
      ],
      onchain: null,
      correlationMatrix: [
        [1, 0.5, -0.3],
        [0.5, 1, 0.1],
        [-0.3, 0.1, 1],
      ],
    };
    const svg = signalDashboard(options);
    // Should render the heatmap cells (lower triangle)
    expect(svg).toContain('Correlation Matrix');
  });
});
