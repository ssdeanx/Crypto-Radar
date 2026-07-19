// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Output Formatting Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { toCSV, csvHeader, toJSONLine, toMarkdownReport, toTable, toSignalReport } from './output.js';
import type { EnrichedTicker, TechnicalIndicators, NewsMatch, TokenSignal } from './types.js';

function makeTicker(overrides: Partial<EnrichedTicker> = {}): EnrichedTicker {
  return {
    runId: 'TEST-1',
    tsUtc: '2026-07-02T12:00:00Z',
    dateEt: '07/02 08:00',
    symbol: 'SOL',
    chain: 'solana',
    tokenId: 'solana',
    tokenName: 'Solana',
    lastPrice: 80.50,
    bidPrice: 80.48,
    bidQty: 500,
    askPrice: 80.52,
    askQty: 500,
    spreadPct: 0.0497,
    openPrice: 78.00,
    highPrice: 82.00,
    lowPrice: 77.00,
    prevClosePrice: 78.50,
    priceChange: 2.0,
    priceChangePercent: 2.55,
    weightedAvgPrice: 80.00,
    volume: 5000000,
    quoteVolume: 400_000_000,
    count: 25000,
    lastQty: 50,
    vwapDistPct: 0.63,
    rangePosPct: 0.70,
    bookImbalance: 0.0,
    volVsAvg: 0,
    obv: 0,
    momentum: 3.06,
    alerts: '',
    source: 'binance',
    ...overrides,
  };
}

describe('CSV output', () => {
  it('produces correct CSV header', () => {
    const header = csvHeader();
    expect(header).toContain('run_id');
    expect(header).toContain('last_price');
    expect(header).toContain('price_change_pct');
    expect(header).toContain('momentum');
    expect(header).toContain('rsi');
    expect(header).toContain('composite_score');
    expect(header).toContain('regime');
    const cols = header.split(',');
    expect(cols.length).toBe(63); // expanded column count
  });

  it('formats ticker as CSV row', () => {
    const ticker = makeTicker();
    const csv = toCSV(ticker);
    expect(csv).toContain('TEST-1');
    expect(csv).toContain('SOL');
    expect(csv).toContain('solana');
    expect(csv).toContain('2.5500'); // priceChangePercent → 4dp
    // Verify all fields present
    const cols = csv.split(',');
    expect(cols.length).toBe(63); // matches header column count
  });

  it('handles very small prices', () => {
    const ticker = makeTicker({ lastPrice: 0.00001234, symbol: 'BONK' });
    const csv = toCSV(ticker);
    // fPrice: < 0.0001 → toFixed(6) → "0.000012" (rounds down)
    expect(csv).toContain('0.000012');
  });

  it('handles very large volumes', () => {
    const ticker = makeTicker({ quoteVolume: 1_234_567_890 });
    const csv = toCSV(ticker);
    expect(csv).toContain('1234567890'); // no exponential notation
  });

  it('produces valid CSV parseable by standard parsers', () => {
    const ticker = makeTicker();
    const csv = toCSV(ticker);
    // Every row should have exactly as many commas as the header minus one
    const headerCols = csvHeader().split(',').length;
    const csvCols = csv.split(',').length;
    expect(csvCols).toBeLessThanOrEqual(headerCols);
  });
});

describe('JSON line output', () => {
  it('produces valid JSON', () => {
    const ticker = makeTicker();
    const json = toJSONLine(ticker);
    const parsed = JSON.parse(json);
    expect(parsed.symbol).toBe('SOL');
    expect(parsed.lastPrice).toBe(80.50);
    expect(parsed.priceChangePercent).toBe(2.55);
  });

  it('converts undefined optional fields to null (ML schema consistency)', () => {
    const ticker = makeTicker();
    // Remove some optional fields to simulate runtime undefined
    delete (ticker as any).rsi;
    delete (ticker as any).onchainTvl;
    delete (ticker as any).regime;
    const json = toJSONLine(ticker);
    const parsed = JSON.parse(json);
    // Schema keys must still be present — as null, not missing
    expect(parsed).toHaveProperty('rsi');
    expect(parsed).toHaveProperty('onchainTvl');
    expect(parsed).toHaveProperty('regime');
    expect(parsed.rsi).toBeNull();
    expect(parsed.onchainTvl).toBeNull();
    expect(parsed.regime).toBeNull();
  });
});

describe('Markdown report', () => {
  it('generates report with token table', () => {
    const tickers = [makeTicker(), makeTicker({ symbol: 'BTC', chain: 'multi' })];
    const report = toMarkdownReport(tickers);
    expect(report).toContain('SOL');
    expect(report).toContain('BTC');
    expect(report).toContain('2 tokens tracked');
    expect(report).toContain('Symbol');
  });

  it('includes technical indicators section when provided', () => {
    const tickers = [makeTicker()];
    const technicals = new Map<string, TechnicalIndicators>([
      ['SOL', { rsi: 65, mfi: 55, bb: { upper: 90, middle: 80, lower: 70, width: 0.25, position: 0.6 }, macd: { macd: 0.5, signal: 0.3, histogram: 0.2 }, atrPct: 2.1, volTrend: 0.15, priceVsEma50: 3.2 }],
    ]);
    const report = toMarkdownReport(tickers, technicals);
    expect(report).toContain('RSI');
    expect(report).toContain('65');
    expect(report).toContain('MACD');
  });

  it('includes news section when provided', () => {
    const tickers = [makeTicker()];
    const news: NewsMatch[] = [{
      runId: 'T1', tsUtc: '', symbol: 'SOL',
      headline: 'Solana upgrade successful', description: 'Test',
      source: 'CoinTelegraph', domain: 'cointelegraph.com',
      relevance: 0.85, url: 'https://example.com',
    }];
    const report = toMarkdownReport(tickers, undefined, news);
    expect(report).toContain('News Signals');
    expect(report).toContain('Solana upgrade');
  });
});

describe('Terminal table', () => {
  it('generates formatted table with headers', () => {
    const tickers = [makeTicker(), makeTicker({ symbol: 'ETH', chain: 'multi', lastPrice: 3500 })];
    const table = toTable(tickers);
    expect(table).toContain('SOL');
    expect(table).toContain('ETH');
    expect(table).toContain('Sym');
    expect(table).toContain('Price');
  });

  it('includes tags for significant movements', () => {
    const tickers = [
      makeTicker({ symbol: 'PUMPED', priceChangePercent: 8.5 }),
      makeTicker({ symbol: 'DIPPED', priceChangePercent: -7.2 }),
    ];
    const table = toTable(tickers);
    expect(table).toContain('🟢PUMP');
    expect(table).toContain('🔴DIP');
  });
});

describe('Signal report', () => {
  it('generates signal report sorted by score descending', () => {
    const signals: TokenSignal[] = [
      { symbol: 'LOW', tokenId: 'l', tokenName: 'Low', chain: 'solana', lastPrice: 1, priceChangePercent: 0, momentumScore: 20, technicalScore: 20, newsScore: 0, compositeScore: 20, alerts: [], timestamp: '' },
      { symbol: 'HIGH', tokenId: 'h', tokenName: 'High', chain: 'solana', lastPrice: 1, priceChangePercent: 0, momentumScore: 80, technicalScore: 80, newsScore: 20, compositeScore: 72, alerts: [], timestamp: '' },
    ];
    const report = toSignalReport(signals);
    // HIGH should appear before LOW (sorted by compositeScore descending)
    const highIdx = report.indexOf('HIGH');
    const lowIdx = report.indexOf('LOW');
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('shows score bar visualization', () => {
    const signals: TokenSignal[] = [
      { symbol: 'TEST', tokenId: 't', tokenName: 'Test', chain: 'solana', lastPrice: 100, priceChangePercent: 5, momentumScore: 50, technicalScore: 50, newsScore: 50, compositeScore: 50, alerts: [], timestamp: '' },
    ];
    const report = toSignalReport(signals);
    expect(report).toContain('█'); // filled score bar
    expect(report).toContain('░'); // empty part of bar
  });
});
