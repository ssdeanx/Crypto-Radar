// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Volume Profile Analysis Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  computeVolumeProfile,
  formatVolumeProfile,
  volumeProfileSvg,
} from './volume-profile.js';
import type { Kline } from '../types.js';

// ── Helpers ──

function makeKline(overrides: Partial<Kline>): Kline {
  return {
    openTime: 0,
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    volume: 1000,
    closeTime: 0,
    quoteVolume: 0,
    count: 0,
    takerBuyVol: 0,
    takerBuyQuoteVol: 0,
    ignore: 0,
    ...overrides,
  };
}

// ── computeVolumeProfile ──

describe('computeVolumeProfile', () => {
  it('returns empty result for empty klines', () => {
    const result = computeVolumeProfile('BTCUSDT', []);
    expect(result.symbol).toBe('BTCUSDT');
    expect(result.poc).toBe(0);
    expect(result.vah).toBe(0);
    expect(result.val).toBe(0);
    expect(result.nodes).toEqual([]);
    expect(result.totalVolume).toBe(0);
    expect(result.timestamp).toBeDefined();
  });

  it('handles flat price (single price level)', () => {
    const klines: Kline[] = [
      makeKline({ low: 100, high: 100, volume: 500 }),
      makeKline({ low: 100, high: 100, volume: 300 }),
    ];
    const result = computeVolumeProfile('TEST', klines);
    expect(result.poc).toBeGreaterThan(0);
    expect(result.totalVolume).toBe(800);
    expect(result.nodes).toHaveLength(1);
  });

  it('computes basic volume profile with multiple candles', () => {
    const klines: Kline[] = [
      makeKline({ low: 90, high: 110, volume: 1000 }),
      makeKline({ low: 95, high: 115, volume: 2000 }),
      makeKline({ low: 100, high: 120, volume: 1500 }),
    ];
    const result = computeVolumeProfile('TEST', klines);
    expect(result.symbol).toBe('TEST');
    expect(result.totalVolume).toBeGreaterThan(0);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.bucketCount).toBe(24); // default

    // POC should be one of the buckets
    expect(result.poc).toBeGreaterThan(0);

    // VA should be within price range
    expect(result.vah).toBeGreaterThan(result.val);
    expect(result.vah).toBeLessThanOrEqual(120);
    expect(result.val).toBeGreaterThanOrEqual(90);
  });

  it('accepts custom bucket count', () => {
    const klines: Kline[] = [
      makeKline({ low: 90, high: 110, volume: 1000 }),
      makeKline({ low: 95, high: 115, volume: 2000 }),
    ];
    const result = computeVolumeProfile('TEST', klines, { buckets: 10 });
    expect(result.bucketCount).toBe(10);
    expect(result.nodes).toHaveLength(10);
  });

  it('accepts custom value area percentage', () => {
    const klines: Kline[] = [
      makeKline({ low: 90, high: 110, volume: 1000 }),
      makeKline({ low: 95, high: 115, volume: 2000 }),
      makeKline({ low: 100, high: 120, volume: 1500 }),
      makeKline({ low: 85, high: 105, volume: 500 }),
      makeKline({ low: 105, high: 125, volume: 3000 }),
    ];
    const result50 = computeVolumeProfile('TEST', klines, { valueAreaPct: 0.5 });
    const result80 = computeVolumeProfile('TEST', klines, { valueAreaPct: 0.8 });
    // Higher value area pct should include more volume → wider VA range
    const vaRange50 = result50.vah - result50.val;
    const vaRange80 = result80.vah - result80.val;
    // 80% should cover at least as much range as 50%
    expect(vaRange80).toBeGreaterThanOrEqual(vaRange50 - 0.001);
  });

  it('classifies HVN and LVN correctly', () => {
    // Create klines with one very high volume cluster and one very low volume area
    const klines: Kline[] = [
      makeKline({ low: 90, high: 92, volume: 10000 }),  // High volume in low range
      makeKline({ low: 92, high: 94, volume: 5 }),      // Very low volume
      makeKline({ low: 94, high: 96, volume: 8000 }),   // High volume
      makeKline({ low: 96, high: 98, volume: 3 }),      // Very low volume
      makeKline({ low: 98, high: 100, volume: 5 }),     // Very low volume
    ];
    const result = computeVolumeProfile('TEST', klines, { buckets: 5 });
    const hvnCount = result.nodes.filter(n => n.type === 'hvn').length;
    const lvnCount = result.nodes.filter(n => n.type === 'lvn').length;
    expect(hvnCount).toBeGreaterThan(0);
    expect(lvnCount).toBeGreaterThan(0);
  });

  it('volume percentages sum to approximately 100', () => {
    const klines: Kline[] = [
      makeKline({ low: 90, high: 110, volume: 1000 }),
      makeKline({ low: 95, high: 115, volume: 2000 }),
      makeKline({ low: 100, high: 120, volume: 1500 }),
    ];
    const result = computeVolumeProfile('TEST', klines);
    const totalPct = result.nodes.reduce((s, n) => s + n.volumePercent, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it('handles single kline', () => {
    const result = computeVolumeProfile('TEST', [makeKline({ low: 100, high: 110, volume: 500 })]);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.totalVolume).toBe(500);
  });
});

// ── formatVolumeProfile ──

describe('formatVolumeProfile', () => {
  it('returns message for empty nodes', () => {
    const empty = {
      symbol: 'TEST',
      poc: 0,
      vah: 0,
      val: 0,
      nodes: [] as any[],
      bucketCount: 24,
      totalVolume: 0,
      timestamp: new Date().toISOString(),
    };
    expect(formatVolumeProfile(empty)).toBe('No volume profile data.');
  });

  it('returns message for all-zero volume nodes', () => {
    const result = {
      symbol: 'TEST',
      poc: 100,
      vah: 105,
      val: 95,
      nodes: [
        { priceLow: 95, priceHigh: 97, volume: 0, volumePercent: 0, type: 'lvn' as const },
        { priceLow: 97, priceHigh: 99, volume: 0, volumePercent: 0, type: 'lvn' as const },
      ],
      bucketCount: 24,
      totalVolume: 0,
      timestamp: new Date().toISOString(),
    };
    expect(formatVolumeProfile(result)).toBe('All buckets have zero volume.');
  });

  it('formats a non-empty profile with histogram bars', () => {
    const result = computeVolumeProfile('TEST', [
      makeKline({ low: 90, high: 110, volume: 1000 }),
      makeKline({ low: 95, high: 115, volume: 2000 }),
    ]);
    const output = formatVolumeProfile(result);
    expect(output).toContain('Volume Profile');
    expect(output).toContain('TEST');
    expect(output).toContain('POC:');
    expect(output).toContain('VA:');
    expect(output).toContain('Total Vol:');
    expect(output).toContain('HVN');
    expect(output).toContain('LVN');
  });

  it('uses custom width', () => {
    const result = computeVolumeProfile('TEST', [
      makeKline({ low: 90, high: 110, volume: 1000 }),
    ]);
    const narrow = formatVolumeProfile(result, 20);
    const wide = formatVolumeProfile(result, 60);
    // Both should work without error
    expect(narrow).toBeDefined();
    expect(wide).toBeDefined();
  });
});

// ── volumeProfileSvg ──

describe('volumeProfileSvg', () => {
  it('returns SVG for empty profile', () => {
    const empty = {
      symbol: 'TEST',
      poc: 0,
      vah: 0,
      val: 0,
      nodes: [] as any[],
      bucketCount: 24,
      totalVolume: 0,
      timestamp: new Date().toISOString(),
    };
    const svg = volumeProfileSvg(empty);
    expect(svg).toContain('<svg');
    expect(svg).toContain('No volume profile data');
    expect(svg).toContain('</svg>');
  });

  it('returns SVG for zero-volume nodes', () => {
    const result = {
      symbol: 'TEST',
      poc: 100,
      vah: 105,
      val: 95,
      nodes: [
        { priceLow: 95, priceHigh: 97, volume: 0, volumePercent: 0, type: 'lvn' as const },
      ],
      bucketCount: 24,
      totalVolume: 0,
      timestamp: new Date().toISOString(),
    };
    const svg = volumeProfileSvg(result);
    expect(svg).toContain('<svg');
    expect(svg).toContain('All buckets zero volume');
    expect(svg).toContain('</svg>');
  });

  it('generates valid SVG for non-empty profile', () => {
    const result = computeVolumeProfile('TEST', [
      makeKline({ low: 90, high: 110, volume: 1000 }),
      makeKline({ low: 95, high: 115, volume: 2000 }),
      makeKline({ low: 100, high: 120, volume: 1500 }),
    ]);
    const svg = volumeProfileSvg(result);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Volume Profile');
    expect(svg).toContain('TEST');
    expect(svg).toContain('POC');
    expect(svg).toContain('HVN');
    expect(svg).toContain('LVN');
    expect(svg).toContain('VA');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox');
    expect(svg).toContain('0f172a'); // dark background
  });

  it('accepts custom dimensions', () => {
    const result = computeVolumeProfile('TEST', [
      makeKline({ low: 90, high: 110, volume: 1000 }),
    ]);
    const svg = volumeProfileSvg(result, 640, 800);
    expect(svg).toContain('viewBox="0 0 640 800"');
  });
});
