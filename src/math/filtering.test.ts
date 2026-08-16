import { describe, it, expect } from 'vitest';
import {
  applyKalmanFilter,
  computeRobustZScore,
  computeHurstExponent,
} from './filtering.js';

describe('Signal Filtering & Mathematical Regime Engine (MathJS)', () => {
  describe('applyKalmanFilter', () => {
    it('smooths noisy measurements and tracks true price trend', () => {
      const noisy = [100, 103, 99, 104, 102, 108, 106, 112, 110, 115];
      const res = applyKalmanFilter(noisy);
      expect(res.smoothed).toHaveLength(10);
      expect(res.velocities).toHaveLength(10);
      // Smoothed version should reduce volatility
      expect(res.smoothed[res.smoothed.length - 1]).toBeGreaterThan(100);
    });

    it('returns empty arrays for empty series', () => {
      expect(applyKalmanFilter([]).smoothed).toEqual([]);
    });
  });

  describe('computeRobustZScore', () => {
    it('detects extreme outliers without mean corruption', () => {
      const series = [10, 11, 10, 12, 11, 10, 100]; // 100 is an extreme outlier
      const zScores = computeRobustZScore(series);
      expect(zScores[zScores.length - 1]).toBeGreaterThan(10); // Outlier z-score > 10
      expect(Math.abs(zScores[0]!)).toBeLessThan(1.5); // Normal points near 0
    });
  });

  describe('computeHurstExponent', () => {
    it('detects trending regime for strong monotonic trend', () => {
      const trend = Array.from({ length: 64 }, (_, i) => 100 * Math.exp(0.01 * i));
      const res = computeHurstExponent(trend);
      expect(res.hurst).toBeGreaterThan(0.5);
      expect(res.regime).toBe('trending');
    });

    it('detects mean-reverting regime for oscillating series', () => {
      const oscillating = Array.from({ length: 64 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5));
      const res = computeHurstExponent(oscillating);
      expect(res.hurst).toBeLessThan(0.5);
      expect(res.regime).toBe('mean_reverting');
    });
  });
});
