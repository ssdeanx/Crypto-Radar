// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Support & Resistance Detection Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import type { Kline } from '../types.js';
import {
  findSupportResistance,
  formatSR,
} from './support-resistance.js';

// ── Helpers ──

function makeKline(close: number, i: number, high = close * 1.01, low = close * 0.99, volume = 1000): Kline {
  return {
    openTime: i * 3600000,
    open: close,
    high,
    low,
    close,
    volume,
    closeTime: i * 3600000 + 3599999,
    quoteVolume: close * volume,
    count: 100,
    takerBuyVol: 500,
    takerBuyQuoteVol: 500 * close,
    ignore: 0,
  };
}

// Build a wavy series so pivots appear (oscillating highs/lows)
function buildWave(count: number, base = 100): Kline[] {
  const klines: Kline[] = [];
  for (let i = 0; i < count; i++) {
    // triangle wave between base*0.95 and base*1.05
    const phase = (i % 20) / 20;
    const swing = Math.sin(i * Math.PI / 5);
    const close = base + swing * base * 0.04;
    const high = close + Math.abs(swing) * base * 0.01 + 0.5;
    const low = close - Math.abs(swing) * base * 0.01 - 0.5;
    klines.push(makeKline(close, i, high, low, 1000 + (i % 3) * 100));
  }
  return klines;
}

describe('findSupportResistance — validation', () => {
  it('returns empty result for null/undefined klines', () => {
    const r = findSupportResistance('SOL', null as unknown as Kline[]);
    expect(r.support).toEqual([]);
    expect(r.resistance).toEqual([]);
    expect(r.nearestSupport).toBeNull();
    expect(r.nearestResistance).toBeNull();
    expect(r.upsideTarget).toBeNull();
    expect(r.downsideRisk).toBeNull();
  });

  it('returns empty result when too few klines', () => {
    const klines = [makeKline(100, 0), makeKline(101, 1)];
    const r = findSupportResistance('SOL', klines);
    expect(r.support).toEqual([]);
    expect(r.resistance).toEqual([]);
  });

  it('returns empty result when klines lack valid high/low/volume', () => {
    const bad: Kline[] = [];
    for (let i = 0; i < 30; i++) bad.push(makeKline(0, i, 0, 0, 0));
    const r = findSupportResistance('SOL', bad);
    expect(r.support).toEqual([]);
    expect(r.resistance).toEqual([]);
  });
});

describe('findSupportResistance — detection', () => {
  it('detects support/resistance levels on a wave series', () => {
    const klines = buildWave(60);
    const r = findSupportResistance('SOL', klines);
    expect(r.symbol).toBe('SOL');
    expect(r.timestamp).toBeTruthy();
    expect(Array.isArray(r.support)).toBe(true);
    expect(Array.isArray(r.resistance)).toBe(true);
  });

  it('respects maxLevels option', () => {
    const klines = buildWave(120);
    const r = findSupportResistance('SOL', klines, { maxLevels: 2, pivotWindow: 3 });
    expect(r.support.length).toBeLessThanOrEqual(2);
    expect(r.resistance.length).toBeLessThanOrEqual(2);
  });

  it('applies minTouches filter', () => {
    const klines = buildWave(80);
    const r = findSupportResistance('SOL', klines, { minTouches: 3, pivotWindow: 3 });
    for (const l of r.support) expect(l.touchCount).toBeGreaterThanOrEqual(3);
    for (const l of r.resistance) expect(l.touchCount).toBeGreaterThanOrEqual(3);
  });

  it('omits psychological levels when disabled', () => {
    const klines = buildWave(80);
    const r = findSupportResistance('SOL', klines, { includePsychological: false });
    expect(r.psychological).toEqual([]);
  });

  it('includes psychological levels by default', () => {
    const klines = buildWave(80);
    const r = findSupportResistance('SOL', klines);
    expect(r.psychological.length).toBeGreaterThan(0);
    for (const p of r.psychological) expect(p.type).toBe('psychological');
  });

  it('labels levels with R/S prefixes', () => {
    const klines = buildWave(120);
    const r = findSupportResistance('SOL', klines, { pivotWindow: 3 });
    const labels = [...r.support.map(l => l.label), ...r.resistance.map(l => l.label)];
    expect(labels.some(l => l.startsWith('S'))).toBe(true);
    expect(labels.some(l => l.startsWith('R'))).toBe(true);
    // psychological labels start with PSY
    expect(r.psychological.every(p => p.label.startsWith('PSY'))).toBe(true);
  });

  it('computes strength in [0,1] and rounding to 2 decimals', () => {
    const klines = buildWave(120);
    const r = findSupportResistance('SOL', klines, { pivotWindow: 3 });
    for (const l of [...r.support, ...r.resistance]) {
      expect(l.strength).toBeGreaterThanOrEqual(0);
      expect(l.strength).toBeLessThanOrEqual(1);
      // at most 2 decimal places
      expect(l.strength).toBe(Math.round(l.strength * 100) / 100);
    }
  });

  it('computes upsideTarget / downsideRisk when nearest levels exist', () => {
    const klines = buildWave(120);
    const r = findSupportResistance('SOL', klines, { pivotWindow: 3 });
    if (r.nearestResistance) expect(r.upsideTarget).not.toBeNull();
    if (r.nearestSupport) expect(r.downsideRisk).not.toBeNull();
  });

  it('uses custom pivotWindow option', () => {
    const klines = buildWave(100);
    const r = findSupportResistance('SOL', klines, { pivotWindow: 5 });
    expect(Array.isArray(r.support)).toBe(true);
  });

  it('handles very low-price assets (psychological step < 1)', () => {
    const klines = buildWave(80, 0.05);
    const r = findSupportResistance('SHIB', klines, { pivotWindow: 3 });
    // should not throw and produce a result
    expect(r.symbol).toBe('SHIB');
    expect(Array.isArray(r.psychological)).toBe(true);
  });
});

describe('calculateStrength behavior (via public API branches)', () => {
  it('levels with no touches get filtered out', () => {
    const klines = buildWave(80);
    const r = findSupportResistance('SOL', klines, { minTouches: 2, pivotWindow: 3 });
    // every returned level must have touchCount >= minTouches
    for (const l of [...r.support, ...r.resistance]) {
      expect(l.touchCount).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('formatSR', () => {
  it('renders a result without throwing', () => {
    const klines = buildWave(120);
    const r = findSupportResistance('SOL', klines, { pivotWindow: 3 });
    const out = formatSR(r);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('SOL');
  });

  it('renders empty result gracefully', () => {
    const r = findSupportResistance('SOL', [makeKline(100, 0), makeKline(101, 1)]);
    const out = formatSR(r);
    expect(typeof out).toBe('string');
    expect(out).toContain('SOL');
  });

  it('output includes Upside/Downside summary', () => {
    const klines = buildWave(120);
    const r = findSupportResistance('SOL', klines, { pivotWindow: 3 });
    const out = formatSR(r);
    expect(out).toContain('Upside');
    expect(out).toContain('Downside');
  });
});
