// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — XLSX Export Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exportToXlsx } from './xlsx-export.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { EnrichedTicker } from './types.js';

function makeTicker(overrides: Partial<EnrichedTicker> = {}): EnrichedTicker {
  return {
    runId: 'TEST-1', tsUtc: '2026-07-02T12:00:00Z', dateEt: '07/02 08:00',
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

describe('XLSX Export', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'xlsx-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('exports tickers to xlsx file', async () => {
    const tickers = [makeTicker(), makeTicker({ symbol: 'BTC', chain: 'multi' })];
    const fp = path.join(tmpDir, 'test.xlsx');
    const result = await exportToXlsx(tickers, fp);
    expect(result).toBe(fp);
    expect(fs.existsSync(fp)).toBe(true);
    // xlsx files have specific magic bytes
    const buf = fs.readFileSync(fp);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf[0]).toBe(0x50); // PK ZIP header
  });

  it('handles single ticker', async () => {
    const tickers = [makeTicker()];
    const fp = path.join(tmpDir, 'single.xlsx');
    await exportToXlsx(tickers, fp);
    expect(fs.existsSync(fp)).toBe(true);
  });

  it('handles pump and dip ticker formatting', async () => {
    const tickers = [
      makeTicker({ symbol: 'PUMP', priceChangePercent: 8.5 }),
      makeTicker({ symbol: 'DIP', priceChangePercent: -7.2, spreadPct: 1.5, quoteVolume: 50_000_000 }),
    ];
    const fp = path.join(tmpDir, 'styled.xlsx');
    await exportToXlsx(tickers, fp);
    expect(fs.existsSync(fp)).toBe(true);
  });
});
