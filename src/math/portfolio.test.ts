import { describe, it, expect } from 'vitest';
import {
  computeCovarianceMatrix,
  computeCorrelationMatrix,
  computeRiskParityWeights,
} from './portfolio.js';

describe('Portfolio & Covariance Matrix Engine (MathJS)', () => {
  const assetA = [0.01, 0.02, -0.01, 0.03, -0.02];
  const assetB = [0.015, 0.025, -0.005, 0.035, -0.015]; // Strongly correlated with A
  const assetC = [-0.02, -0.03, 0.04, -0.01, 0.05]; // Inversely correlated

  it('computes symmetric covariance matrix', () => {
    const cov = computeCovarianceMatrix([assetA, assetB, assetC]);
    expect(cov).toHaveLength(3);
    expect(cov[0]![1]).toBeCloseTo(cov[1]![0]!, 6);
    expect(cov[0]![2]).toBeCloseTo(cov[2]![0]!, 6);
    expect(cov[0]![0]).toBeGreaterThan(0); // Variance > 0
  });

  it('computes correlation matrix with 1.0 on diagonal', () => {
    const corr = computeCorrelationMatrix([assetA, assetB, assetC]);
    expect(corr[0]![0]).toBe(1.0);
    expect(corr[1]![1]).toBe(1.0);
    expect(corr[2]![2]).toBe(1.0);
    expect(corr[0]![1]).toBeGreaterThan(0.8); // A and B are positively correlated
    expect(corr[0]![2]).toBeLessThan(0); // A and C are negatively correlated
  });

  it('computes Risk Parity weights summing to 1.0', () => {
    const lowVol = [0.001, -0.001, 0.002, -0.001, 0.001]; // Low vol asset gets higher weight
    const highVol = [0.05, -0.06, 0.08, -0.04, 0.07]; // High vol asset gets lower weight

    const weights = computeRiskParityWeights([lowVol, highVol]);
    expect(weights).toHaveLength(2);
    expect(weights[0]!).toBeGreaterThan(weights[1]!); // Lower vol receives higher weight
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });
});
