import { describe, it, expect } from 'vitest';
import { computeLabels, computeAtr14, computeClassDistribution, getDefaultClassWeights } from './labels.js';
import type { KlineRow } from '../types.js';

describe('Option A Institutional Dataset Labeling', () => {
  it('computes forward returns across horizons', () => {
    const closes = [100, 102, 104, 106, 108, 110, 112];
    const labels = computeLabels(closes, '1h', { classHorizon: 1, noiseThreshold: 0.01 });

    expect(labels).toHaveLength(7);
    expect(labels[0]!.label_return_1).toBeCloseTo(0.02);
    expect(labels[0]!.label_direction_1).toBe(1);
    expect(labels[0]!.label_class).toBe(1);
  });

  it('computes ATR(14) accurately from klines', () => {
    const klines: KlineRow[] = Array.from({ length: 30 }, (_, i) => ({
      symbol: 'SOL',
      interval: '1h',
      open_time: i * 3600000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000,
      quote_volume: 100000,
      taker_buy_vol: 500,
      taker_buy_quote_vol: 50000,
    }));

    const atrs = computeAtr14(klines);
    expect(atrs).toHaveLength(30);
    expect(atrs[14]).toBeGreaterThan(0);
  });

  it('computes Triple-Barrier labels (TP hit vs SL hit)', () => {
    const klines: KlineRow[] = Array.from({ length: 40 }, (_, i) => ({
      symbol: 'SOL',
      interval: '1h',
      open_time: i * 3600000,
      open: 100 + i * 2,
      high: 110 + i * 2,
      low: 103 + i * 2,
      close: 104 + i * 2,
      volume: 1000,
      quote_volume: 100000,
      taker_buy_vol: 500,
      taker_buy_quote_vol: 50000,
    }));

    const closes = klines.map(k => k.close);
    const labels = computeLabels(closes, '1h', { maxHoldingCandles: 10 }, klines);

    expect(labels[0]!.label_barrier_hit).toBe(1); // Strong uptrend hits upper TP barrier
    expect(labels[0]!.label_r_multiple).toBeGreaterThan(0);
  });

  it('computes Alpha vs BTC excess return', () => {
    const tokenCloses = [100, 102, 104, 106, 108, 110]; // +10% over 5 periods
    const btcCloses = [50000, 50500, 51000, 51500, 52000, 52000]; // +4% over 5 periods
    const labels = computeLabels(tokenCloses, '1h', {}, undefined, btcCloses);

    expect(labels[0]!.alpha_vs_btc).toBeCloseTo(0.06); // 10% - 4% = +6% alpha
  });

  it('computes default class weights and class distribution', () => {
    const weights = getDefaultClassWeights();
    expect(weights['-1']).toBe(1.5);
    expect(weights['0']).toBe(0.6);
    expect(weights['1']).toBe(1.0);

    const dummyLabels = [
      { label_class: 1 },
      { label_class: -1 },
      { label_class: 0 },
      { label_class: 1 },
    ] as any;

    const dist = computeClassDistribution(dummyLabels);
    expect(dist['1']).toBe(0.5);
    expect(dist['-1']).toBe(0.25);
    expect(dist['0']).toBe(0.25);
  });
});
