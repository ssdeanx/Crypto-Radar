// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — ML Prediction Monitoring & Calibration Tests
// ═══════════════════════════════════════════════════════════════════════
//
// Pure unit tests that mock the Store interface — no real database or
// subprocess needed.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Import the module under test ─────────────────────────────────────

import type { Store } from '../store/db.js';
import type { KlineRow } from '../types.js';
import { computeCalibration } from './monitor.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const NOW = 1_000_000_000_000;
const HOUR_MS = 3_600_000;
const FIFTEEN_MIN_MS = 900_000;
const TWO_HOURS_MS = 7_200_000;

/** Build a minimal KlineRow. */
function bar(open_time: number, overrides?: Partial<KlineRow>): KlineRow {
  return {
    symbol: 'SOLUSDT',
    interval: '1h',
    open_time,
    open: overrides?.open ?? 100,
    high: overrides?.high ?? 105,
    low: overrides?.low ?? 99,
    close: overrides?.close ?? 100,
    volume: 5000,
    quote_volume: 520_000,
    taker_buy_vol: 2500,
    taker_buy_quote_vol: 260_000,
  };
}

interface PredInput {
  id?: string;
  symbol?: string;
  ts?: string;
  direction?: string;
  confidence?: number;
  model_id?: string;
  horizon?: number;
  ml_score?: number;
  features_hash?: string;
  interval?: string;
}

function pred(pt: number, overrides: PredInput = {}): Record<string, unknown> {
  return {
    id: 'p1',
    symbol: 'SOLUSDT',
    ts: new Date(pt).toISOString(),
    direction: 'buy',
    confidence: 0.75,
    model_id: 'catboost_v1',
    horizon: 5,
    ml_score: 0.8,
    features_hash: 'abc123',
    ...overrides,
  };
}

/**
 * Build a store with a smart getKlines mock that returns different results
 * based on the query:
 *  - order='desc', limit=1  → returns [currentBar] (the bar <= predTs)
 *  - order='desc', limit>1  → returns all bars (incl. post-prediction bars)
 *  - order='asc',  limit=1  → returns [futureBar] (the bar >= targetTime)
 */
function smartStore(
  predictions: Record<string, unknown>[],
  currentBar: KlineRow,
  futureBar: KlineRow,
  postPredBar?: KlineRow,
): Store {
  const allBars = [futureBar, ...(postPredBar ? [postPredBar] : []), currentBar];

  return {
    getPredictions: vi.fn().mockResolvedValue(predictions as never[]),
    getKlines: vi.fn(
      async (
        _symbol: string,
        _interval: string,
        opts?: { limit?: number; order?: 'asc' | 'desc' },
      ) => {
        if (opts?.order === 'asc') {
          // computeActualDirectionForPrediction: need the future bar
          return [futureBar];
        }
        if (opts?.limit === 1) {
          // computeActualDirectionForPrediction: need the CURRENT bar (<= predTs)
          return [currentBar];
        }
        // computeCalibration filter: return all bars (need open_time > predTs)
        return [...allBars].sort((a, b) => b.open_time - a.open_time);
      },
    ),
  } as unknown as Store;
}

vi.useFakeTimers();
vi.setSystemTime(NOW);

// ═══════════════════════════════════════════════════════════════════════
// computeCalibration
// ═══════════════════════════════════════════════════════════════════════

describe('computeCalibration', () => {
  beforeEach(() => {
    vi.setSystemTime(NOW);
  });

  it('returns empty calibration report when there are no predictions', async () => {
    const store = smartStore([], bar(0), bar(0));
    const report = await computeCalibration(store);

    expect(report.overallAccuracy).toBe(0);
    expect(report.totalPredictions).toBe(0);
    expect(report.ece).toBe(0);
    expect(report.isCalibrated).toBe(true);
    expect(report.buckets).toHaveLength(10);
  });

  it('filters out predictions beyond MAX_AGE_MS', async () => {
    const oldTs = NOW - 8 * 24 * HOUR_MS; // 8 days ago → filtered out
    const recentTs = NOW - HOUR_MS;       // 1 hour ago → kept

    const currentBar = bar(recentTs - TWO_HOURS_MS, { close: 100 });
    const futureBar = bar(recentTs + 6 * HOUR_MS, { close: 106 });

    const store = smartStore(
      [pred(oldTs), pred(recentTs, { id: 'recent' })],
      currentBar,
      futureBar,
    );

    const report = await computeCalibration(store);
    expect(report.totalPredictions).toBe(1);
  });

  it('computes calibration for a single correct buy prediction', async () => {
    const predTs = NOW - HOUR_MS;

    const currentBar = bar(predTs - TWO_HOURS_MS, { close: 100 });
    const futureBar = bar(predTs + 6 * HOUR_MS, { close: 106 });
    const postPredBar = bar(predTs + FIFTEEN_MIN_MS, { close: 101 });

    const store = smartStore([pred(predTs)], currentBar, futureBar, postPredBar);

    const report = await computeCalibration(store);

    expect(report.totalPredictions).toBe(1);
    expect(report.overallAccuracy).toBe(1);

    const bucket = report.buckets.find(b => b.bucket === '0.7-0.8');
    expect(bucket).toBeDefined();
    expect(bucket!.total).toBe(1);
    expect(bucket!.correct).toBe(1);
    expect(bucket!.accuracy).toBe(1);
    expect(bucket!.expectedAccuracy).toBe(0.75);
    expect(bucket!.calibrationError).toBeCloseTo(-0.25);
    expect(report.ece).toBeCloseTo(0.25);
    expect(report.isCalibrated).toBe(false);
  });

  it('computes ECE correctly for mixed correctness in same bucket', async () => {
    const predTs = NOW - HOUR_MS;

    const currentBar = bar(predTs - TWO_HOURS_MS, { close: 100 });
    const futureBar = bar(predTs + 6 * HOUR_MS, { close: 105 });
    const postPredBar = bar(predTs + FIFTEEN_MIN_MS, { close: 101 });

    const store = smartStore(
      [
        pred(predTs, { id: 'p1', direction: 'buy' }),
        pred(predTs, { id: 'p2', direction: 'sell' }),
      ],
      currentBar,
      futureBar,
      postPredBar,
    );

    const report = await computeCalibration(store);

    expect(report.totalPredictions).toBe(2);
    expect(report.overallAccuracy).toBe(0.5);

    const bucket = report.buckets.find(b => b.bucket === '0.7-0.8');
    expect(bucket).toBeDefined();
    expect(bucket!.total).toBe(2);
    expect(bucket!.correct).toBe(1);
    expect(bucket!.accuracy).toBe(0.5);
    expect(bucket!.expectedAccuracy).toBe(0.75);
    expect(bucket!.calibrationError).toBeCloseTo(0.25);
    expect(report.ece).toBeCloseTo(0.25);
    expect(report.isCalibrated).toBe(false);
  });

  it('sets isCalibrated when ECE < 0.1', async () => {
    const predTs = NOW - HOUR_MS;

    const currentBar = bar(predTs - TWO_HOURS_MS, { close: 100 });
    const futureBar = bar(predTs + 6 * HOUR_MS, { close: 106 });
    const postPredBar = bar(predTs + FIFTEEN_MIN_MS, { close: 101 });

    const predictions = Array.from({ length: 10 }, (_, i) =>
      pred(predTs, { id: `p${i}`, direction: i < 7 ? 'buy' : 'sell' }),
    );

    const store = smartStore(predictions, currentBar, futureBar, postPredBar);

    const report = await computeCalibration(store);

    expect(report.totalPredictions).toBe(10);
    expect(report.overallAccuracy).toBeCloseTo(0.7);
    expect(report.ece).toBeCloseTo(0.05, 1);
    expect(report.isCalibrated).toBe(true);
  });

  it('skips predictions with no future kline (outcome pending)', async () => {
    const predTs = NOW - HOUR_MS;

    const currentBar = bar(predTs - TWO_HOURS_MS, { close: 100 });
    // Provide a postPred bar (for filter) but NO future bar far enough
    // We make the futureBar be the same as currentBar (before predTs)
    // so the actual direction computation will fail
    const postPredBar = bar(predTs + FIFTEEN_MIN_MS, { close: 101 });

    const store = {
      getPredictions: vi.fn().mockResolvedValue([pred(predTs)] as never[]),
      getKlines: vi.fn(async (_sym: string, _int: string, opts?: { limit?: number; order?: 'asc' | 'desc' }) => {
        // For asc queries: return nothing (no future kline)
        if (opts?.order === 'asc') return [];
        // For desc limit=1: return currentBar (for computeActualDirection)
        if (opts?.limit === 1) return [currentBar];
        // For desc limit>1: return postPredBar (so computeCalibration filter passes)
        return [postPredBar];
      }),
    } as unknown as Store;

    const report = await computeCalibration(store);
    expect(report.totalPredictions).toBe(0);
    expect(report.overallAccuracy).toBe(0);
  });

  it('handles neutral direction prediction when price stays flat', async () => {
    const predTs = NOW - HOUR_MS;

    const currentBar = bar(predTs - TWO_HOURS_MS, { close: 100 });
    // Price barely moves → within 0.2% noise threshold → direction = 0
    const futureBar = bar(predTs + 6 * HOUR_MS, { close: 100.1 });
    const postPredBar = bar(predTs + FIFTEEN_MIN_MS, { close: 101 });

    const store = smartStore(
      [pred(predTs, { direction: 'hold', confidence: 0.55 })],
      currentBar,
      futureBar,
      postPredBar,
    );

    const report = await computeCalibration(store);

    expect(report.totalPredictions).toBe(1);
    expect(report.overallAccuracy).toBe(1);

    const bucket = report.buckets.find(b => b.bucket === '0.5-0.6');
    expect(bucket).toBeDefined();
    expect(bucket!.correct).toBe(1);
  });

  it('populates all bucket slots even when empty', async () => {
    const store = smartStore([], bar(0), bar(0));
    const report = await computeCalibration(store);

    expect(report.buckets).toHaveLength(10);
    const expectedBuckets = [
      '0.0-0.1', '0.1-0.2', '0.2-0.3', '0.3-0.4', '0.4-0.5',
      '0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9', '0.9-1.0',
    ];
    for (const label of expectedBuckets) {
      const b = report.buckets.find(b => b.bucket === label);
      expect(b).toBeDefined();
      expect(b!.total).toBe(0);
      expect(b!.accuracy).toBe(0);
      expect(b!.calibrationError).toBe(0);
    }
  });
});
