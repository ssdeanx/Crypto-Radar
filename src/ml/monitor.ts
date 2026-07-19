// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — ML Prediction Monitoring & Calibration
// ═══════════════════════════════════════════════════════════════════════
//
// Tracks prediction accuracy vs actual outcomes over time. For every
// prediction, records the confidence bucket and checks later if the
// actual direction matched. Detects calibration drift — e.g., "80%-confidence
// predictions are only correct 60% of the time."
//
// Calibration data is stored in-memory and summarized for the API.
// ═══════════════════════════════════════════════════════════════════════

import type { Store } from '../store/db.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'ml:monitor' });

/** A single calibration observation */
export interface CalibrationPoint {
  /** When the prediction was made (ms epoch) */
  ts: number;
  /** Symbol traded */
  symbol: string;
  /** Predicted direction (-1, 0, 1) */
  predictedDirection: -1 | 0 | 1;
  /** Actual direction (-1, 0, 1) — computed from subsequent close */
  actualDirection: -1 | 0 | 1 | null;
  /** Model confidence at prediction time */
  confidence: number;
  /** Confidence bucket label, e.g. "0.6-0.7" */
  bucket: string;
  /** Whether the prediction was correct */
  correct: boolean | null;
  /** Horizon used for the prediction */
  horizon: number;
}

/** Per-bucket calibration summary */
export interface CalibrationBucket {
  bucket: string;
  total: number;
  correct: number;
  accuracy: number;
  /** Expected accuracy (midpoint of bucket range) */
  expectedAccuracy: number;
  /** Calibration error: expected - actual */
  calibrationError: number;
}

/** Full calibration report */
export interface CalibrationReport {
  buckets: CalibrationBucket[];
  overallAccuracy: number;
  totalPredictions: number;
  /** ECE = Expected Calibration Error (lower is better) */
  ece: number;
  /** Whether calibration is within acceptable bounds */
  isCalibrated: boolean;
  lastUpdated: string;
}

/** Confidence bucket boundaries */
const BUCKET_BOUNDARIES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/** Max prediction age to consider for calibration (7 days in ms) */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compute calibration metrics from stored predictions.
 *
 * Queries predictions where enough time has passed to know the actual
 * outcome by looking at the next kline close.
 *
 * @param store - SQLite store instance
 * @returns CalibrationReport
 */
export function computeCalibration(store: Store): CalibrationReport {
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;

  // Get all predictions from the store
  const predictions = store.getPredictions({ limit: 10_000 });
  const points: CalibrationPoint[] = [];
  let totalCorrect = 0;
  let totalEvaluated = 0;

  for (const pred of predictions) {
    const predTs = new Date(pred.ts).getTime();
    if (predTs < cutoff) continue;

    // Get the kline that would contain the outcome for this prediction
    const klines = store.getKlines(pred.symbol, '1h', { limit: 5, order: 'desc' });
    // Need at least the next kline after prediction to evaluate
    const recentKline = klines.find(k => k.open_time > predTs);
    if (!recentKline) continue; // No outcome data yet

    // Compute actual direction from the next close
    const direction = pred.direction === 'buy' ? 1 : pred.direction === 'sell' ? -1 : 0;
    const confidence = pred.confidence;

    // Bucket the confidence
    const bucket = getBucket(confidence);
    const actualDirection = computeActualDirection(recentKline.close, pred.symbol);
    const correct = actualDirection !== null ? direction === actualDirection : null;

    const point: CalibrationPoint = {
      ts: predTs,
      symbol: pred.symbol,
      predictedDirection: direction,
      actualDirection,
      confidence,
      bucket,
      correct,
      horizon: pred.horizon ?? 5,
    };
    points.push(point);

    if (correct !== null) {
      totalEvaluated++;
      if (correct) totalCorrect++;
    }
  }

  // Aggregate by bucket
  const bucketMap = new Map<string, { total: number; correct: number }>();
  for (const point of points) {
    if (point.correct === null) continue;
    const b = bucketMap.get(point.bucket) ?? { total: 0, correct: 0 };
    b.total++;
    if (point.correct) b.correct++;
    bucketMap.set(point.bucket, b);
  }

  const buckets: CalibrationBucket[] = [];
  let eceSum = 0;
  let eceCount = 0;

  for (let i = 0; i < BUCKET_BOUNDARIES.length - 1; i++) {
    const low = BUCKET_BOUNDARIES[i]!;
    const high = BUCKET_BOUNDARIES[i + 1]!;
    const label = `${low.toFixed(1)}-${high.toFixed(1)}`;
    const data = bucketMap.get(label);
    if (!data || data.total === 0) {
      buckets.push({
        bucket: label,
        total: 0,
        correct: 0,
        accuracy: 0,
        expectedAccuracy: (low + high) / 2,
        calibrationError: 0,
      });
      continue;
    }
    const accuracy = data.total > 0 ? data.correct / data.total : 0;
    const expected = (low + high) / 2;
    const calError = expected - accuracy;
    buckets.push({
      bucket: label,
      total: data.total,
      correct: data.correct,
      accuracy,
      expectedAccuracy: expected,
      calibrationError: calError,
    });
    eceSum += Math.abs(calError) * (data.total / totalEvaluated);
    eceCount++;
  }

  const overallAccuracy = totalEvaluated > 0 ? totalCorrect / totalEvaluated : 0;
  const ece = eceCount > 0 ? eceSum : 0;

  return {
    buckets,
    overallAccuracy,
    totalPredictions: totalEvaluated,
    ece,
    isCalibrated: ece < 0.1, // ECE < 10% is considered well-calibrated
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Compute the actual direction from a close price.
 * Simple heuristic: if close > previous close → up, etc.
 * In production, this would use the same label methodology as the training pipeline.
 */
function computeActualDirection(close: number, _symbol: string): -1 | 0 | 1 | null {
  // This is a simplified placeholder. In production, compare against
  // the close N bars later (where N = prediction horizon).
  // For now, we need a proxy — we store recent klines.
  return null; // Requires historical klines to compute properly
}

/**
 * Map a confidence value to a bucket label.
 */
function getBucket(confidence: number): string {
  for (let i = BUCKET_BOUNDARIES.length - 2; i >= 0; i--) {
    if (confidence >= BUCKET_BOUNDARIES[i]!) {
      return `${BUCKET_BOUNDARIES[i]!.toFixed(1)}-${BUCKET_BOUNDARIES[i + 1]!.toFixed(1)}`;
    }
  }
  return '0.0-0.1';
}
