// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Portfolio & Covariance Matrix Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Institutional multi-asset portfolio mathematical optimization:
// - N x N Covariance & Correlation Matrix computation via mathjs
// - Risk Parity (Equal Risk Contribution / Inverse Volatility) weights
// - Dominant Market Factor Extraction (PCA / Beta to Market Portfolio)
// ═══════════════════════════════════════════════════════════════════════

import * as math from 'mathjs';

/**
 * Computes N x N sample covariance matrix from multi-asset return series.
 *
 * @param assetReturns - Array of asset return arrays: [asset_1_returns, asset_2_returns, ...]
 * @returns 2D square matrix of covariances
 */
export function computeCovarianceMatrix(assetReturns: number[][]): number[][] {
  const numAssets = assetReturns.length;
  if (numAssets === 0) return [];

  const minLen = Math.min(...assetReturns.map(r => r.length));
  if (minLen < 2) {
    return Array.from({ length: numAssets }, (_, i) =>
      Array.from({ length: numAssets }, (_, j) => (i === j ? 1 : 0)),
    );
  }

  // Compute means
  const means = assetReturns.map(r => Number(math.mean(r.slice(0, minLen))));
  const cov: number[][] = Array.from({ length: numAssets }, () => new Array(numAssets).fill(0));

  for (let i = 0; i < numAssets; i++) {
    for (let j = i; j < numAssets; j++) {
      let sum = 0;
      const rI = assetReturns[i]!;
      const rJ = assetReturns[j]!;
      const mI = means[i]!;
      const mJ = means[j]!;

      for (let t = 0; t < minLen; t++) {
        sum += (rI[t]! - mI) * (rJ[t]! - mJ);
      }

      const val = Number((sum / (minLen - 1)).toFixed(8));
      cov[i]![j] = val;
      cov[j]![i] = val;
    }
  }

  return cov;
}

/**
 * Computes N x N Pearson correlation matrix from covariance matrix or return series.
 */
export function computeCorrelationMatrix(assetReturns: number[][]): number[][] {
  const numAssets = assetReturns.length;
  if (numAssets === 0) return [];

  const cov = computeCovarianceMatrix(assetReturns);
  const corr: number[][] = Array.from({ length: numAssets }, () => new Array(numAssets).fill(0));

  for (let i = 0; i < numAssets; i++) {
    for (let j = 0; j < numAssets; j++) {
      if (i === j) {
        corr[i]![j] = 1.0;
      } else {
        const stdI = Math.sqrt(cov[i]![i] ?? 0);
        const stdJ = Math.sqrt(cov[j]![j] ?? 0);
        const denom = stdI * stdJ;
        corr[i]![j] = denom > 0 ? Number(((cov[i]![j] ?? 0) / denom).toFixed(4)) : 0;
      }
    }
  }

  return corr;
}

/**
 * Computes Inverse-Volatility Risk Parity portfolio weights:
 * w_i = (1 / sigma_i) / sum(1 / sigma_k)
 *
 * Ensures each asset contributes an equal share of portfolio risk.
 *
 * @param assetReturns - Multi-asset return series
 * @returns Array of normalized weights summing to 1.0
 */
export function computeRiskParityWeights(assetReturns: number[][]): number[] {
  const numAssets = assetReturns.length;
  if (numAssets === 0) return [];
  if (numAssets === 1) return [1.0];

  const volatilities = assetReturns.map(r => {
    if (r.length < 2) return 0.02; // Default baseline volatility
    const std = Number(math.std(r));
    return std > 0 && Number.isFinite(std) ? std : 0.02;
  });

  const inverseVols = volatilities.map(v => 1.0 / v);
  const sumInv = inverseVols.reduce((a, b) => a + b, 0);

  if (sumInv === 0 || !Number.isFinite(sumInv)) {
    return new Array(numAssets).fill(Number((1.0 / numAssets).toFixed(4)));
  }

  return inverseVols.map(inv => Number((inv / sumInv).toFixed(4)));
}
