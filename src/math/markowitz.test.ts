import { describe, it, expect } from 'vitest';
import {
  projectOntoSimplex,
  computeOptimalPortfolio,
  computeEfficientFrontier,
} from './markowitz.js';

describe('Markowitz Mean-Variance Optimization Engine (MathJS)', () => {
  describe('projectOntoSimplex', () => {
    it('projects unconstrained weights to non-negative simplex summing to 1', () => {
      const raw = [1.2, -0.4, 0.8];
      const projected = projectOntoSimplex(raw);
      expect(projected.every(w => w >= 0)).toBe(true);
      const sum = projected.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
      expect(projected[1]).toBe(0); // Negative weight set to 0
    });
  });

  describe('computeOptimalPortfolio', () => {
    it('allocates higher weight to asset with higher return and lower variance', () => {
      const expectedReturns = [0.12, 0.04]; // Asset 1 has 12% return, Asset 2 has 4%
      const covMatrix = [
        [0.04, 0.005],
        [0.005, 0.02],
      ];

      const res = computeOptimalPortfolio(expectedReturns, covMatrix);
      expect(res.isEfficient).toBe(true);
      expect(res.weights).toHaveLength(2);
      expect(res.weights[0]!).toBeGreaterThan(res.weights[1]!); // Asset 1 gets dominant weight
      const sum = res.weights.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
      expect(res.sharpeRatio).toBeGreaterThan(0);
    });

    it('handles single-asset case gracefully', () => {
      const res = computeOptimalPortfolio([0.08], [[0.01]]);
      expect(res.weights).toEqual([1.0]);
      expect(res.expectedReturn).toBe(0.08);
      expect(res.isEfficient).toBe(true);
    });
  });

  describe('computeEfficientFrontier', () => {
    it('generates frontier points across target returns', () => {
      const expectedReturns = [0.05, 0.15];
      const covMatrix = [
        [0.01, 0.002],
        [0.002, 0.04],
      ];

      const frontier = computeEfficientFrontier(expectedReturns, covMatrix, 5);
      expect(frontier).toHaveLength(5);
      expect(frontier[0]!.targetReturn).toBeLessThan(frontier[4]!.targetReturn);
    });
  });
});
