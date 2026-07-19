// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — PDF/HTML Report Export Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { generateHtmlReport, generateSignalSnapshot } from './pdf-export.js';
import type { ReportConfig } from './pdf-export.js';
import type { EnrichedTicker } from './types.js';
import type { AggregatedSignal, SignalDirection } from './analysis/strategies.js';

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
    signals: [{ strategy: 'momentum', direction, confidence, reason: 'Strong momentum', indicators: {}, timeframe: '1h' }],
    alerts: [],
    timestamp: '2026-07-06T12:00:00Z',
    ...overrides,
  };
}

// ── Tests ──

describe('generateHtmlReport', () => {
  it('returns a complete HTML document', () => {
    const config: ReportConfig = {
      title: 'Test Report',
      date: '2026-07-06',
      tickers: [makeTicker()],
      aggregatedSignals: [],
      onchain: null,
    };
    const html = generateHtmlReport(config);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<html');
  });

  it('includes the report title in the HTML', () => {
    const config: ReportConfig = {
      title: 'Crypto Radar Daily',
      date: '2026-07-06',
      tickers: [makeTicker()],
      aggregatedSignals: [],
      onchain: null,
    };
    const html = generateHtmlReport(config);
    expect(html).toContain('Crypto Radar Daily');
    expect(html).toContain('<title>Crypto Radar Daily — Crypto Radar Report</title>');
  });

  it('includes summary statistics for tokens', () => {
    const config: ReportConfig = {
      title: 'Test',
      date: '2026-07-06',
      tickers: [
        makeTicker({ symbol: 'SOL', priceChangePercent: 5.0 }),
        makeTicker({ symbol: 'BTC', priceChangePercent: -3.0 }),
        makeTicker({ symbol: 'ETH', priceChangePercent: 1.0 }),
      ],
      aggregatedSignals: [],
      onchain: null,
    };
    const html = generateHtmlReport(config);
    expect(html).toContain('3'); // tokens tracked
    expect(html).toContain('2'); // gainers (SOL, ETH) = 2
    expect(html).toContain('1'); // losers (BTC) = 1
  });

  it('includes token table with ticker rows', () => {
    const config: ReportConfig = {
      title: 'Test',
      date: '2026-07-06',
      tickers: [
        makeTicker({ symbol: 'SOL', lastPrice: 80.50 }),
        makeTicker({ symbol: 'BTC', lastPrice: 65000 }),
      ],
      aggregatedSignals: [],
      onchain: null,
    };
    const html = generateHtmlReport(config);
    expect(html).toContain('SOL');
    expect(html).toContain('BTC');
    expect(html).toContain('Token Prices');
    expect(html).toContain('<table>');
    expect(html).toContain('</table>');
  });

  it('includes signal distribution section when signals exist', () => {
    const config: ReportConfig = {
      title: 'Test',
      date: '2026-07-06',
      tickers: [makeTicker()],
      aggregatedSignals: [
        makeSignal('SOL', 'buy', 0.8),
        makeSignal('BTC', 'sell', 0.7),
      ],
      onchain: null,
    };
    const html = generateHtmlReport(config);
    expect(html).toContain('Signal Distribution');
    expect(html).toContain('strong_buy');
    expect(html).toContain('buy');
    expect(html).toContain('sell');
  });

  it('includes top signals detail when signals exist', () => {
    const config: ReportConfig = {
      title: 'Test',
      date: '2026-07-06',
      tickers: [makeTicker()],
      aggregatedSignals: [makeSignal('SOL', 'strong_buy', 0.95)],
      onchain: null,
    };
    const html = generateHtmlReport(config);
    expect(html).toContain('Top Signals Detail');
    expect(html).toContain('SOL');
    expect(html).toContain('95%'); // confidence
  });

  it('includes bar chart when includeCharts is true and tickers exist', () => {
    const config: ReportConfig = {
      title: 'Test',
      date: '2026-07-06',
      tickers: [makeTicker(), makeTicker({ symbol: 'BTC', chain: 'multi' })],
      aggregatedSignals: [],
      onchain: null,
      includeCharts: true,
    };
    const html = generateHtmlReport(config);
    expect(html).toContain('<svg');
    expect(html).toContain('Top Movers');
  });

  it('omits charts when includeCharts is false', () => {
    const config: ReportConfig = {
      title: 'Test',
      date: '2026-07-06',
      tickers: [makeTicker()],
      aggregatedSignals: [],
      onchain: null,
      includeCharts: false,
    };
    const html = generateHtmlReport(config);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('Top Movers');
  });

  it('includes on-chain section when onchain data is provided', () => {
    const config: ReportConfig = {
      title: 'Test',
      date: '2026-07-06',
      tickers: [makeTicker()],
      aggregatedSignals: [],
      onchain: {
        protocols: [{ name: 'Solana', tvl: 5_000_000_000, fees1d: 1_000_000, fees7d: 7_000_000, fees30d: null, tvlTrend: 'up' }],
        chains: [],
        fetchedAt: '2026-07-06T12:00:00Z',
      },
    };
    const html = generateHtmlReport(config);
    expect(html).toContain('On-Chain Metrics');
    expect(html).toContain('Solana');
  });

  it('escapes HTML in user-provided content', () => {
    const config: ReportConfig = {
      title: 'Test <script>alert("xss")</script>',
      date: '2026-07-06',
      tickers: [makeTicker({ symbol: '<b>SOL</b>' })],
      aggregatedSignals: [],
      onchain: null,
    };
    const html = generateHtmlReport(config);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;SOL&lt;/b&gt;');
  });
});

describe('generateSignalSnapshot', () => {
  it('returns a complete HTML document', () => {
    const html = generateSignalSnapshot([]);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('Signal Snapshot');
  });

  it('shows empty state when no signals provided', () => {
    const html = generateSignalSnapshot([]);
    expect(html).toContain('No signals generated');
    expect(html).toContain('0 active signals');
  });

  it('shows signal count in subtitle', () => {
    const signals = [
      makeSignal('SOL', 'buy', 0.8),
      makeSignal('BTC', 'sell', 0.7),
    ];
    const html = generateSignalSnapshot(signals);
    expect(html).toContain('2 active signals');
  });

  it('displays signal rows sorted by confidence descending', () => {
    const signals = [
      makeSignal('LOW', 'buy', 0.55),
      makeSignal('HIGH', 'strong_buy', 0.95),
      makeSignal('MID', 'sell', 0.72),
    ];
    const html = generateSignalSnapshot(signals);
    // Get the index of each symbol in the output
    const highIdx = html.indexOf('HIGH');
    const midIdx = html.indexOf('MID');
    const lowIdx = html.indexOf('LOW');
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it('includes summary strip with direction counts', () => {
    const signals = [
      makeSignal('SOL', 'strong_buy', 0.9),
      makeSignal('BTC', 'buy', 0.7),
      makeSignal('ETH', 'neutral', 0.5),
      makeSignal('DOT', 'sell', 0.6),
      makeSignal('ADA', 'strong_sell', 0.85),
    ];
    const html = generateSignalSnapshot(signals);
    expect(html).toContain('Strong Buy: 1');
    expect(html).toContain('Buy: 1');
    expect(html).toContain('Neutral: 1');
    expect(html).toContain('Sell: 1');
    expect(html).toContain('Strong Sell: 1');
  });

  it('includes reason text when present', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { compositeReason: 'Strong uptrend with high volume' }),
    ];
    const html = generateSignalSnapshot(signals);
    expect(html).toContain('Strong uptrend with high volume');
  });

  it('escapes HTML in signal data', () => {
    const signals: AggregatedSignal[] = [
      makeSignal('SOL', 'buy', 0.8, { compositeReason: '<script>alert(1)</script>' }),
    ];
    const html = generateSignalSnapshot(signals);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });
});
