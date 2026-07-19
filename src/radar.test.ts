// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Radar Engine Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetConfig } from './core/config.js';
import { _resetTestCache } from './radar.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { runRadar } from './radar.js';

type RadarResult = Awaited<ReturnType<typeof runRadar>>;

function mockRadarResult(overrides?: Partial<RadarResult>): RadarResult {
  return {
    tickers: [],
    technicals: new Map(),
    newsMatches: [],
    signals: [],
    aggregatedSignals: [],
    onchain: null,
    run: { runId: 'TEST', tsUtc: '', numTokens: 0, numSignals: 0, durationMs: 0 },
    ...overrides,
  };
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Build a proper Binance ticker mock
function makeBinanceTicker(symbol: string, price: number, changePercent: number, volume: number) {
  return {
    symbol, lastPrice: String(price), bidPrice: String(price - 0.1), bidQty: '100',
    askPrice: String(price + 0.1), askQty: '100', priceChange: String(price * changePercent / 100),
    priceChangePercent: String(changePercent), weightedAvgPrice: String(price),
    prevClosePrice: String(price - 1), openPrice: String(price - 1),
    highPrice: String(price + 10), lowPrice: String(price - 10),
    volume: String(volume), quoteVolume: String(volume * price),
    openTime: 0, closeTime: 3600000, firstId: 1, lastId: 100, count: 100, lastQty: '1',
  };
}

describe('Radar Engine', () => {
  let tmpDir: string;

  beforeEach(() => {
    resetConfig();
    _resetTestCache();
    mockFetch.mockReset();
    tmpDir = mkdtempSync(path.join(tmpdir(), 'radar-test-'));
    process.env['RADAR__DATA_DIR'] = tmpDir;
  });

  afterEach(() => {
    delete process.env['RADAR__DATA_DIR'];
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    resetConfig();
  });

  it('runs scan successfully with mocked Binance data', async () => {
    // Dynamic import each test to get fresh module state
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v3/ticker/24hr')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            makeBinanceTicker('SOLUSDT', 150, 2.5, 5000000),
            makeBinanceTicker('BTCUSDT', 50000, 1.2, 10000000),
          ],
        });
      }
      if (url.includes('/api/v3/klines')) {
        return Promise.resolve({
          ok: true,
          json: async () => {
            const length = 60;
            return Array.from({ length }, (_, i) => [
              i * 3600000,
              String(100 + i),
              String(105 + i),
              String(95 + i),
              String(100 + Math.sin(i * 0.3) * 5),
              String(1000 + i * 10),
              (i + 1) * 3600000,
              String((100 + i) * 1000),
              100, 500, '50000', '0',
            ]);
          },
        });
      }
      if (url.includes('rss') || url.includes('feed')) {
        return Promise.resolve({
          ok: true,
          text: async () => '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>',
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const { runRadar } = await import('./radar.js');
    const result = await runRadar({
      filter: ['SOL', 'BTC'],
      chain: undefined,
      sortBy: 'change',
      includeTech: true,
      includeNews: false,
    });

    expect(result.tickers).toHaveLength(2);
    expect(result.run.numTokens).toBe(2);
    expect(result.run.runId).toMatch(/^RADAR-/);
    expect(result.signals).toHaveLength(2);
    expect(result.tickers[0]!.priceChangePercent).toBeGreaterThanOrEqual(result.tickers[1]!.priceChangePercent);
  }, 15_000);

  it('handles scan without technical indicators', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v3/ticker/24hr')) {
        return Promise.resolve({
          ok: true,
          json: async () => [makeBinanceTicker('SOLUSDT', 150, 2.5, 5000000)],
        });
      }
      if (url.includes('rss') || url.includes('feed')) {
        return Promise.resolve({
          ok: true,
          text: async () => '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>',
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const { runRadar } = await import('./radar.js');
    const result = await runRadar({ includeTech: false });
    expect(result.tickers).toHaveLength(1);
    expect(result.technicals.size).toBe(0);
  }, 15_000);

  it('handles empty filter gracefully', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v3/ticker/24hr')) {
        return Promise.resolve({
          ok: true,
          json: async () => [makeBinanceTicker('SOLUSDT', 150, 2.5, 5000000)],
        });
      }
      if (url.includes('rss') || url.includes('feed')) {
        return Promise.resolve({
          ok: true,
          text: async () => '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>',
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const { runRadar } = await import('./radar.js');
    const result = await runRadar({ filter: ['NONEXISTENT'] });
    expect(result.tickers).toHaveLength(0);
  }, 15_000);

  it('handles Binance API failure gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const { runRadar, _resetTestCache } = await import('./radar.js');
    _resetTestCache();
    const result = await runRadar({ includeTech: false, includeNews: false, noLog: true });
    expect(result.tickers).toHaveLength(0);
    expect(result.run.numTokens).toBe(0);
  }, 10_000);
});

describe('displayRadar', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  it('returns table format by default', async () => {
    const { displayRadar } = await import('./radar.js');
    const output = await displayRadar(mockRadarResult({
      run: { runId: 'TEST-1', tsUtc: '2026-01-01T00:00:00Z', numTokens: 0, numSignals: 0, durationMs: 0 },
    }), {});
    expect(output).toContain('Crypto Radar');
  });

  it('returns JSON format', async () => {
    const { displayRadar } = await import('./radar.js');
    const output = await displayRadar(mockRadarResult({
      run: { runId: 'TEST-1', tsUtc: '2026-01-01T00:00:00Z', numTokens: 0, numSignals: 0, durationMs: 0 },
    }), { format: 'json' });
    expect(output).toContain('runId');
    expect(output).toContain('TEST-1');
  });

  it('returns CSV format', async () => {
    const { displayRadar } = await import('./radar.js');
    const output = await displayRadar(mockRadarResult({
      run: { runId: 'TEST-1', tsUtc: '2026-01-01T00:00:00Z', numTokens: 0, numSignals: 0, durationMs: 0 },
    }), { format: 'csv' });
    expect(output).toContain('run_id');
  });

  it('returns empty string when quiet', async () => {
    const { displayRadar } = await import('./radar.js');
    const output = await displayRadar(mockRadarResult({
      run: { runId: 'TEST-1', tsUtc: '2026-01-01T00:00:00Z', numTokens: 0, numSignals: 0, durationMs: 0 },
    }), { quiet: true });
    expect(output).toBe('');
  });

  it('includes top signals when signals present', async () => {
    const { displayRadar } = await import('./radar.js');
    const output = await displayRadar(mockRadarResult({
      signals: [
        { symbol: 'SOL', tokenId: 'solana', tokenName: 'Solana', chain: 'solana', lastPrice: 150, priceChangePercent: 2.5, momentumScore: 60, technicalScore: 55, newsScore: 0, compositeScore: 58, alerts: ['PUMP'], timestamp: '' },
      ],
      run: { runId: 'TEST-1', tsUtc: '2026-01-01T00:00:00Z', numTokens: 0, numSignals: 1, durationMs: 0 },
    }), {});
    expect(output).toContain('Top Signals');
    expect(output).toContain('SOL');
  });
});
