import { describe, it, expect } from 'vitest';
import { computeTrendRegression } from './trend-regression.js';

describe('computeTrendRegression', () => {
  it('returns null for insufficient data', () => {
    expect(computeTrendRegression([100, 101], 5)).toBeNull();
    expect(computeTrendRegression([100], 3)).toBeNull();
    expect(computeTrendRegression([], 3)).toBeNull();
  });

  it('returns positive slope for upward trend', () => {
    const prices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
    const result = computeTrendRegression(prices, 10);
    expect(result).not.toBeNull();
    expect(result!.slope).toBeGreaterThan(0);
    expect(result!.rSquared).toBeGreaterThan(0.9);
    expect(result!.projection).toBeGreaterThan(prices[prices.length - 1]!);
  });

  it('returns negative slope for downward trend', () => {
    const prices = [109, 108, 107, 106, 105, 104, 103, 102, 101, 100];
    const result = computeTrendRegression(prices, 10);
    expect(result).not.toBeNull();
    expect(result!.slope).toBeLessThan(0);
    expect(result!.projection).toBeLessThan(prices[prices.length - 1]!);
  });

  it('returns near-zero slope for flat price', () => {
    const prices = Array.from({ length: 10 }, () => 100);
    const result = computeTrendRegression(prices, 10);
    expect(result).not.toBeNull();
    expect(Math.abs(result!.slope)).toBeLessThan(1e-10);
  });

  it('R² is between 0 and 1', () => {
    const prices = Array.from({ length: 15 }, (_, i) => 100 + Math.sin(i * 0.5) * 5);
    const result = computeTrendRegression(prices, 10);
    expect(result).not.toBeNull();
    expect(result!.rSquared).toBeGreaterThanOrEqual(0);
    expect(result!.rSquared).toBeLessThanOrEqual(1);
  });
});
