// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Spectral Eigenportfolio & Factor Decomposition Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Institutional spectral analysis and PCA factor modeling using MathJS eigendecomposition:
// - Eigenvalue and Eigenvector decomposition of asset covariance
// - Market Factor extraction & Variance Explained ratio
// - Normalized Eigenportfolio weights & Network Centrality
// ═══════════════════════════════════════════════════════════════════════

import * as math from 'mathjs';

export interface EigenportfolioFactor {
  factorIndex: number;
  eigenvalue: number;
  varianceExplainedRatio: number;
  cumulativeVarianceRatio: number;
  weights: number[];
}

export interface SpectralDecompositionResult {
  factors: EigenportfolioFactor[];
  totalVariance: number;
  marketFactorWeights: number[];
}

/**
 * Performs spectral factor decomposition on an N x N asset covariance matrix using math.eigs().
 *
 * @param covMatrix - N x N symmetric covariance matrix
 */
export function computeEigenportfolios(covMatrix: number[][]): SpectralDecompositionResult {
  const n = covMatrix.length;
  if (n === 0 || covMatrix.some(row => row.length !== n)) {
    return { factors: [], totalVariance: 0, marketFactorWeights: [] };
  }

  if (n === 1) {
    const variance = covMatrix[0]?.[0] ?? 0;
    return {
      factors: [
        {
          factorIndex: 0,
          eigenvalue: variance,
          varianceExplainedRatio: 1.0,
          cumulativeVarianceRatio: 1.0,
          weights: [1.0],
        },
      ],
      totalVariance: variance,
      marketFactorWeights: [1.0],
    };
  }

  try {
    const sigma = math.matrix(covMatrix);
    const eig = math.eigs(sigma);

    // Parse eigenvalues and eigenvectors
    // math.eigs returns values (array or matrix) and eigenvectors (array of {value, vector})
    let pairs: { val: number; vec: number[] }[] = [];

    if (Array.isArray(eig.eigenvectors)) {
      pairs = eig.eigenvectors.map((item: any) => {
        const val = typeof item.value === 'number' ? item.value : (item.value?.re ?? 0);
        const rawVec: number[] = Array.isArray(item.vector)
          ? item.vector
          : ((item.vector?.toArray?.() ?? []) as number[]);
        return { val, vec: rawVec };
      });
    } else {
      // Fallback: extract from eig.values
      const rawVals: number[] = Array.isArray(eig.values)
        ? eig.values
        : ((eig.values as any)?.toArray?.() ?? []);
      pairs = rawVals.map((v, idx) => ({
        val: typeof v === 'number' ? v : (v as any)?.re ?? 0,
        vec: new Array(n).fill(0).map((_, i) => (i === idx ? 1 : 0)),
      }));
    }

    // Sort descending by eigenvalue
    pairs.sort((a, b) => b.val - a.val);

    const totalVariance = pairs.reduce((sum, p) => sum + Math.max(0, p.val), 0);
    let cumulative = 0;

    const factors: EigenportfolioFactor[] = pairs.map((p, idx) => {
      const posVal = Math.max(0, p.val);
      const ratio = totalVariance > 0 ? posVal / totalVariance : 0;
      cumulative += ratio;

      // Normalize eigenvector so sum of absolute weights = 1.0
      const l1Norm = p.vec.reduce((sum, w) => sum + Math.abs(w), 0);
      const normalizedWeights = l1Norm > 0
        ? p.vec.map(w => Number((w / l1Norm).toFixed(4)))
        : new Array(n).fill(Number((1 / n).toFixed(4)));

      return {
        factorIndex: idx,
        eigenvalue: Number(posVal.toFixed(6)),
        varianceExplainedRatio: Number(ratio.toFixed(4)),
        cumulativeVarianceRatio: Number(Math.min(1.0, cumulative).toFixed(4)),
        weights: normalizedWeights,
      };
    });

    const marketFactorWeights = factors[0]?.weights ?? new Array(n).fill(1 / n);

    return {
      factors,
      totalVariance: Number(totalVariance.toFixed(6)),
      marketFactorWeights,
    };
  } catch {
    // Fallback: Identity factors
    const eqWeight = 1 / n;
    return {
      factors: [
        {
          factorIndex: 0,
          eigenvalue: 1.0,
          varianceExplainedRatio: 1.0,
          cumulativeVarianceRatio: 1.0,
          weights: new Array(n).fill(Number(eqWeight.toFixed(4))),
        },
      ],
      totalVariance: 1.0,
      marketFactorWeights: new Array(n).fill(Number(eqWeight.toFixed(4))),
    };
  }
}
