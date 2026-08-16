import { describe, it, expect } from 'vitest';
import { computeEigenportfolios } from './spectral.js';

describe('Spectral Eigenportfolio & Factor Decomposition Engine (MathJS)', () => {
  it('computes principal eigenfactors from symmetric covariance matrix', () => {
    const covMatrix = [
      [0.05, 0.03, 0.02],
      [0.03, 0.06, 0.025],
      [0.02, 0.025, 0.04],
    ];

    const res = computeEigenportfolios(covMatrix);
    expect(res.factors).toHaveLength(3);
    expect(res.totalVariance).toBeGreaterThan(0);

    // Factors are sorted descending by eigenvalue
    expect(res.factors[0]!.eigenvalue).toBeGreaterThanOrEqual(res.factors[1]!.eigenvalue);
    expect(res.factors[1]!.eigenvalue).toBeGreaterThanOrEqual(res.factors[2]!.eigenvalue);

    // Cumulative variance ratio reaches ~1.0
    expect(res.factors[2]!.cumulativeVarianceRatio).toBeCloseTo(1.0, 2);

    // Market factor (first eigenvector) is extracted
    expect(res.marketFactorWeights).toHaveLength(3);
  });

  it('handles 1x1 covariance matrix gracefully', () => {
    const res = computeEigenportfolios([[0.04]]);
    expect(res.factors).toHaveLength(1);
    expect(res.factors[0]!.eigenvalue).toBe(0.04);
    expect(res.factors[0]!.varianceExplainedRatio).toBe(1.0);
  });

  it('handles empty matrix without throwing', () => {
    const res = computeEigenportfolios([]);
    expect(res.factors).toHaveLength(0);
    expect(res.totalVariance).toBe(0);
  });
});
