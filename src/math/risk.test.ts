import { describe, it, expect } from 'vitest';
import {
  computeKellyFraction,
  computeVolatilityTargetedSize,
  computeValueAtRisk,
} from './risk.js';

describe('Quantitative Risk & Sizing Engine (MathJS)', () => {
  describe('computeKellyFraction', () => {
    it('computes Half-Kelly allocation for positive edge', () => {
      // 60% win rate with 1.5 payoff: Full Kelly = (1.5*0.6 - 0.4)/1.5 = 0.5/1.5 = 0.3333. Half Kelly = 0.1667
      const k = computeKellyFraction(0.6, 1.5, { fraction: 0.5 });
      expect(k).toBeCloseTo(0.1667, 3);
    });

    it('returns 0 when expectancy is negative or zero', () => {
      // 40% win rate with 1.0 payoff: negative expectancy
      expect(computeKellyFraction(0.4, 1.0)).toBe(0);
    });

    it('respects maximum allocation cap', () => {
      // 90% win rate with 5.0 payoff
      const k = computeKellyFraction(0.9, 5.0, { fraction: 1.0, maxAllocation: 0.20 });
      expect(k).toBe(0.20);
    });
  });

  describe('computeVolatilityTargetedSize', () => {
    it('computes exact position size given stop distance', () => {
      // $10,000 balance, 1% risk ($100), SOL price $150, stop distance $5 (ATR based)
      const res = computeVolatilityTargetedSize(10000, 0.01, 150, 5);
      // Units = 100 / 5 = 20 SOL -> $3000 position -> weight = 0.30
      expect(res.targetUnits).toBe(20);
      expect(res.targetUsdValue).toBe(3000);
      expect(res.portfolioWeight).toBe(0.3);
    });

    it('handles zero or negative inputs safely', () => {
      expect(computeVolatilityTargetedSize(0, 0.01, 150, 5).targetUnits).toBe(0);
      expect(computeVolatilityTargetedSize(10000, 0, 150, 5).targetUnits).toBe(0);
    });
  });

  describe('computeValueAtRisk', () => {
    it('computes 95% historical VaR and CVaR', () => {
      const returns = [
        -0.08, -0.05, -0.03, -0.02, -0.01,
        0.00, 0.01, 0.02, 0.03, 0.04,
        0.05, 0.06, 0.07, 0.08, 0.09,
        0.10, 0.11, 0.12, 0.13, 0.14,
      ];
      const res = computeValueAtRisk(returns, 0.95);
      expect(res.varPercent).toBeGreaterThan(0);
      expect(res.cvarPercent).toBeGreaterThanOrEqual(res.varPercent);
    });
  });
});
