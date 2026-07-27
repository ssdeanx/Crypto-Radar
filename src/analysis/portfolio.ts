// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Markowitz Portfolio Optimization
// ═══════════════════════════════════════════════════════════════════════
//
// Implements a discrete grid-search approach to mean-variance optimization:
//   - Maximize Sharpe ratio   (wᵀμ - rf) / √(wᵀΣw)
//   - Minimize portfolio variance
//   - Build efficient frontier from Pareto-optimal points
//
// All matrix operations delegate to ml-matrix via ../math/index.js.

import { Matrix, EigenvalueDecomposition } from '../math/index.js';

export interface PortfolioResult {
  symbols: string[];
  maxSharpeWeights: number[];
  maxSharpeReturn: number;
  maxSharpeVol: number;
  maxSharpeRatio: number;
  minVarWeights: number[];
  minVarReturn: number;
  minVarVol: number;
  minVarRatio: number;
  frontierPoints: number;
}

/**
 * Generate all valid N‑asset weight combinations on a discrete grid.
 *
 * Every weight is a non-negative multiple of `step` and the vector sums to 1.
 *
 * @param n     Number of assets
 * @param step  Grid resolution (0.05 for N≤5, 0.1 for N>5)
 * @returns     Array of weight vectors (each length n)
 */
function generateWeightGrid(n: number, step: number): number[][] {
  const totalSteps = Math.round(1 / step);
  const results: number[][] = [];

  function recurse(remaining: number, idx: number, current: number[]): void {
    if (idx === n - 1) {
      current.push(remaining * step);
      results.push([...current]);
      current.pop();
      return;
    }
    for (let i = 0; i <= remaining; i++) {
      current.push(i * step);
      recurse(remaining - i, idx + 1, current);
      current.pop();
    }
  }

  recurse(totalSteps, 0, []);
  return results;
}

/**
 * Ensure the covariance matrix is positive semi-definite.
 *
 * Checks for negative eigenvalues. If any are below a small threshold,
 * adds εI (ridge regularization) to the diagonal.
 *
 * @param matrix  Raw N×N covariance matrix
 * @returns       Regularized Matrix (same dimensions)
 */
function regularizeCov(matrix: number[][]): Matrix {
  const n = matrix.length;
  const m = new Matrix(matrix);

  let needsReg = false;
  try {
    const evd = new EigenvalueDecomposition(m);
    const eig = evd.realEigenvalues;
    for (let i = 0; i < n; i++) {
      if (eig[i]! < 1e-10) {
        needsReg = true;
        break;
      }
    }
  } catch {
    needsReg = true;
  }

  if (!needsReg) return m;

  const eps = 1e-6;
  const reg = new Matrix(matrix);
  for (let i = 0; i < n; i++) {
    reg.set(i, i, reg.get(i, i) + eps);
  }
  return reg;
}

/**
 * Run Markowitz mean-variance optimization via discrete grid search.
 *
 * @param covMatrix       N×N covariance matrix
 * @param expectedReturns N-element array of annualized expected returns
 * @param riskFreeRate    Annual risk-free rate (default 5 %)
 * @returns               PortfolioResult or null if N < 2
 */
export function computePortfolio(
  covMatrix: number[][],
  expectedReturns: number[],
  riskFreeRate: number = 0.05,
  symbols: string[] = [],
): PortfolioResult | null {
  const n = expectedReturns.length;
  if (n < 2) return null;

  const cov = regularizeCov(covMatrix);
  const step = n <= 5 ? 0.05 : 0.1;
  const grid = generateWeightGrid(n, step);

  let maxSharpeW: number[] | null = null;
  let maxSharpeVal = -Infinity;
  let maxSharpeRet = 0;
  let maxSharpeVol = 0;

  let minVarW: number[] | null = null;
  let minVarVal = Infinity;
  let minVarRet = 0;
  let minVarRatio = 0;

  const frontier: Array<{ ret: number; vol: number }> = [];

  for (const w of grid) {
    const wVec = new Matrix([w]);
    const wT = wVec.transpose();

    const ret = w.reduce((sum, wi, i) => sum + wi * expectedReturns[i]!, 0);

    const varMat = wVec.mmul(cov).mmul(wT);
    const vol = Math.sqrt(Math.max(0, varMat.get(0, 0)));

    const sharpe = vol > 1e-10 ? (ret - riskFreeRate) / vol : -Infinity;

    frontier.push({ ret, vol });

    if (sharpe > maxSharpeVal) {
      maxSharpeVal = sharpe;
      maxSharpeW = w;
      maxSharpeRet = ret;
      maxSharpeVol = vol;
    }

    if (vol < minVarVal) {
      minVarVal = vol;
      minVarW = w;
      minVarRet = ret;
      minVarRatio = vol > 1e-10 ? (ret - riskFreeRate) / vol : 0;
    }
  }

  if (!maxSharpeW || !minVarW) return null;

  // Build efficient frontier: Pareto-optimal (return, volatility) pairs
  const sortedByVol = [...frontier].sort((a, b) => a.vol - b.vol);
  const pareto: Array<{ ret: number; vol: number }> = [];
  let maxRetSoFar = -Infinity;
  for (const p of sortedByVol) {
    if (p.ret > maxRetSoFar) {
      pareto.push(p);
      maxRetSoFar = p.ret;
    }
  }

  return {
    symbols,
    maxSharpeWeights: maxSharpeW,
    maxSharpeReturn: maxSharpeRet,
    maxSharpeVol: maxSharpeVol,
    maxSharpeRatio: maxSharpeVal,
    minVarWeights: minVarW,
    minVarReturn: minVarRet,
    minVarVol: minVarVal,
    minVarRatio: minVarRatio,
    frontierPoints: pareto.length,
  };
}
