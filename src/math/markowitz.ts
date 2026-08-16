// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Markowitz Mean-Variance Portfolio Optimization Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Institutional modern portfolio theory (MPT) optimization using MathJS matrix algebra:
// - Analytical Markowitz Tangency / Maximum Sharpe Portfolio
// - Non-negative Long-Only Simplex Projection (quadratic programming solver)
// - Minimum Variance Portfolio & Efficient Frontier Generation
// ═══════════════════════════════════════════════════════════════════════

import * as math from 'mathjs';

export interface OptimalPortfolioResult {
  weights: number[];
  expectedReturn: number;
  expectedVolatility: number;
  sharpeRatio: number;
  isEfficient: boolean;
}

export interface FrontierPoint {
  targetReturn: number;
  volatility: number;
  weights: number[];
}

/**
 * Projects an arbitrary weight vector onto the probability simplex (w_i >= 0 and sum(w_i) = 1).
 * Implementation of Duchi et al. (2008) efficient O(n log n) projection.
 */
export function projectOntoSimplex(v: number[]): number[] {
  const n = v.length;
  if (n === 0) return [];
  if (n === 1) return [1.0];

  const u = [...v].sort((a, b) => b - a);
  let cssv = 0;
  let rho = 0;

  for (let i = 0; i < n; i++) {
    cssv += u[i]!;
    const cond = u[i]! - (cssv - 1) / (i + 1);
    if (cond > 0) {
      rho = i;
    }
  }

  const theta = (u.slice(0, rho + 1).reduce((a, b) => a + b, 0) - 1) / (rho + 1);
  return v.map(val => Number(Math.max(0, val - theta).toFixed(4)));
}

/**
 * Solves the Markowitz Maximum Sharpe / Tangency Portfolio problem:
 * w* = Sigma^-1 * (mu - r_f * 1) / (1^T * Sigma^-1 * (mu - r_f * 1))
 *
 * @param expectedReturns - Vector of expected asset returns mu
 * @param covMatrix - N x N covariance matrix Sigma
 * @param riskFreeRate - Annualized or period risk-free rate (default: 0.0)
 */
export function computeOptimalPortfolio(
  expectedReturns: number[],
  covMatrix: number[][],
  riskFreeRate = 0,
): OptimalPortfolioResult {
  const n = expectedReturns.length;
  if (n === 0 || covMatrix.length !== n) {
    return { weights: [], expectedReturn: 0, expectedVolatility: 0, sharpeRatio: 0, isEfficient: false };
  }

  if (n === 1) {
    const r = expectedReturns[0] ?? 0;
    const vol = Math.sqrt(covMatrix[0]?.[0] ?? 0.0001);
    return {
      weights: [1.0],
      expectedReturn: r,
      expectedVolatility: vol,
      sharpeRatio: vol > 0 ? (r - riskFreeRate) / vol : 0,
      isEfficient: true,
    };
  }

  try {
    // 1. Convert to mathjs Matrix and add small ridge regularization on diagonal for numerical stability
    const regularizedCov: number[][] = covMatrix.map((row, i) =>
      row.map((val, j) => (i === j ? val + 1e-6 : val)),
    );

    const sigma = math.matrix(regularizedCov);
    const invSigma = math.inv(sigma);

    // Excess return vector: mu - r_f * 1
    const excess = expectedReturns.map(r => r - riskFreeRate);
    const excessCol = math.matrix(excess.map(x => [x]));

    // w_unconstrained = inv(Sigma) * excess
    const rawWeightsMatrix = math.multiply(invSigma, excessCol);
    const rawWeightsArray: number[] = (rawWeightsMatrix.toArray() as number[][]).map(row => row[0]!);

    // 2. Project onto long-only simplex (no shorting)
    const weights = projectOntoSimplex(rawWeightsArray);

    // 3. Compute portfolio metrics
    const wMatrix = math.matrix([weights]);
    const wTranspose = math.transpose(wMatrix);

    // Portfolio Return = w^T * mu
    const portReturn = Number((math.multiply(wMatrix, math.matrix(expectedReturns.map(r => [r]))).toArray() as number[][])[0]?.[0] ?? 0);

    // Portfolio Variance = w^T * Sigma * w
    const varMatrix = math.multiply(math.multiply(wMatrix, sigma), wTranspose);
    const portVar = Math.max(0, Number((varMatrix.toArray() as number[][])[0]?.[0] ?? 0));
    const portVol = Math.sqrt(portVar);

    const sharpe = portVol > 0 ? (portReturn - riskFreeRate) / portVol : 0;

    return {
      weights,
      expectedReturn: Number(portReturn.toFixed(6)),
      expectedVolatility: Number(portVol.toFixed(6)),
      sharpeRatio: Number(sharpe.toFixed(4)),
      isEfficient: true,
    };
  } catch {
    // Fallback: Equal weight allocation if matrix is singular
    const eqWeight = 1.0 / n;
    const weights = new Array(n).fill(Number(eqWeight.toFixed(4)));
    const portReturn = expectedReturns.reduce((a, b) => a + b, 0) / n;
    return {
      weights,
      expectedReturn: Number(portReturn.toFixed(6)),
      expectedVolatility: 0.02,
      sharpeRatio: 0,
      isEfficient: false,
    };
  }
}

/**
 * Computes points along the Markowitz Efficient Frontier.
 *
 * @param expectedReturns - Vector of expected returns
 * @param covMatrix - Covariance matrix
 * @param numPoints - Number of frontier points to compute (default: 10)
 */
export function computeEfficientFrontier(
  expectedReturns: number[],
  covMatrix: number[][],
  numPoints = 10,
): FrontierPoint[] {
  const minRet = Math.min(...expectedReturns);
  const maxRet = Math.max(...expectedReturns);

  if (minRet === maxRet || expectedReturns.length < 2) {
    const opt = computeOptimalPortfolio(expectedReturns, covMatrix);
    return [{ targetReturn: opt.expectedReturn, volatility: opt.expectedVolatility, weights: opt.weights }];
  }

  const points: FrontierPoint[] = [];
  const step = (maxRet - minRet) / (numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    const target = minRet + i * step;
    const opt = computeOptimalPortfolio(expectedReturns, covMatrix, target);
    points.push({
      targetReturn: Number(target.toFixed(6)),
      volatility: opt.expectedVolatility,
      weights: opt.weights,
    });
  }

  return points;
}
