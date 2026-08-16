import { describe, it, expect } from 'vitest';
import {
  computeBrierScore,
  computeExpectedCalibrationError,
  computeSharpeRatio,
  computeSortinoRatio,
  computeMaxDrawdown,
  computeMfeMaeExcursions,
  computeAlphaVsBenchmark,
} from './eval.js';

describe('MathJS Quantitative Financial Analytics Engine', () => {
  describe('computeBrierScore', () => {
    it('returns 0 for perfect probabilities', () => {
      expect(computeBrierScore([1.0, 0.0, 1.0], [1, 0, 1])).toBe(0);
    });

    it('returns 0.25 for random 50/50 guesses', () => {
      expect(computeBrierScore([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])).toBe(0.25);
    });

    it('returns 1.0 for completely inverted predictions', () => {
      expect(computeBrierScore([1.0, 1.0], [0, 0])).toBe(1.0);
    });

    it('throws when lengths mismatch', () => {
      expect(() => computeBrierScore([0.5], [1, 0])).toThrow();
    });
  });

  describe('computeExpectedCalibrationError', () => {
    it('returns 0 for perfectly calibrated confidence', () => {
      // 100% confidence with 100% accuracy, and 0% confidence with 0% accuracy
      const ece = computeExpectedCalibrationError([0.95, 0.95, 0.05, 0.05], [1, 1, 0, 0]);
      expect(ece).toBeLessThan(0.1);
    });

    it('penalizes overconfidence', () => {
      // 90% confidence but only 50% accuracy
      const ece = computeExpectedCalibrationError([0.9, 0.9, 0.9, 0.9], [1, 0, 1, 0]);
      expect(ece).toBeGreaterThan(0.3);
    });
  });

  describe('computeSharpeRatio & computeSortinoRatio', () => {
    it('computes positive Sharpe for consistent upward returns', () => {
      const returns = [0.02, 0.015, 0.03, 0.01, 0.025];
      const sharpe = computeSharpeRatio(returns);
      expect(sharpe).toBeGreaterThan(5);
    });

    it('Sortino is higher than Sharpe when downside volatility is minimal', () => {
      const returns = [0.05, 0.08, -0.001, 0.04, 0.06];
      const sharpe = computeSharpeRatio(returns);
      const sortino = computeSortinoRatio(returns);
      expect(sortino).toBeGreaterThan(sharpe);
    });

    it('returns 0 for arrays with length < 2', () => {
      expect(computeSharpeRatio([0.05])).toBe(0);
      expect(computeSortinoRatio([0.05])).toBe(0);
    });
  });

  describe('computeMaxDrawdown', () => {
    it('computes exact peak to trough percentage', () => {
      const curve = [100, 120, 150, 105, 90, 130];
      const dd = computeMaxDrawdown(curve);
      // Peak is 150, lowest trough after peak is 90 -> (150-90)/150 = 40%
      expect(dd.maxDrawdownPct).toBe(40);
      expect(dd.peakIndex).toBe(2);
      expect(dd.troughIndex).toBe(4);
    });

    it('returns 0 for monotonic upward curve', () => {
      const curve = [100, 110, 120, 130];
      expect(computeMaxDrawdown(curve).maxDrawdownPct).toBe(0);
    });
  });

  describe('computeMfeMaeExcursions', () => {
    it('calculates long trade excursions accurately', () => {
      const entryPrice = 100;
      const klines = [
        { high: 104, low: 98 },
        { high: 110, low: 99 },
        { high: 108, low: 95 },
      ];
      const res = computeMfeMaeExcursions(entryPrice, true, klines);
      // Max high = 110 (MFE = +10%), Max low = 95 (MAE = 5%)
      expect(res.mfePercent).toBe(10);
      expect(res.maePercent).toBe(5);
      expect(res.mfeToMaeRatio).toBe(2.0);
    });
  });

  describe('computeAlphaVsBenchmark', () => {
    it('computes excess return over BTC benchmark', () => {
      const solReturns = [0.05, -0.02, 0.08];
      const btcReturns = [0.02, -0.01, 0.03];
      const alpha = computeAlphaVsBenchmark(solReturns, btcReturns);
      expect(alpha).toEqual([0.03, -0.01, 0.05]);
    });
  });
});
