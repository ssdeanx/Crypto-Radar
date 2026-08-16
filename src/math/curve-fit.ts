// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Polynomial Curve Fitting & Dynamic S/R Curvature Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Institutional least-squares polynomial regression and inflection analysis:
// - Vandermonde Matrix design & (X^T X)^-1 X^T y Normal Equation solver
// - R^2 coefficient of determination goodness of fit
// - 2nd derivative inflection detection for dynamic Support/Resistance curves
// ═══════════════════════════════════════════════════════════════════════

import * as math from 'mathjs';

export interface PolynomialFitResult {
  coefficients: number[]; // [w0, w1, w2, ...] where y = w0 + w1*x + w2*x^2 + ...
  rSquared: number;
  evaluate: (x: number) => number;
  evaluateDerivative: (x: number) => number;
  evaluateSecondDerivative: (x: number) => number;
}

/**
 * Fits a polynomial of degree `degree` to (x, y) coordinates using MathJS matrix normal equations.
 *
 * @param x - Input x coordinates (e.g. bar indices 0, 1, 2, ...)
 * @param y - Target y values (e.g. price series)
 * @param degree - Polynomial degree (1 = linear, 2 = quadratic, 3 = cubic)
 */
export function fitPolynomial(x: number[], y: number[], degree = 2): PolynomialFitResult {
  const n = x.length;
  if (n === 0 || y.length !== n || degree < 0) {
    return {
      coefficients: [0],
      rSquared: 0,
      evaluate: () => 0,
      evaluateDerivative: () => 0,
      evaluateSecondDerivative: () => 0,
    };
  }

  const d = Math.min(degree, n - 1);

  // Construct Vandermonde matrix X where X[i][j] = x[i]^j
  const X: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: d + 1 }, (_, j) => Math.pow(x[i]!, j)),
  );

  try {
    const matrixX = math.matrix(X);
    const matrixY = math.matrix(y.map(val => [val]));

    // (X^T * X)
    const xTranspose = math.transpose(matrixX);
    const xtx = math.multiply(xTranspose, matrixX);

    // Regularize slightly to guarantee invertibility
    const regularizedXtx = math.add(xtx, math.multiply(math.identity(d + 1), 1e-7)) as math.Matrix;
    const invXtx = math.inv(regularizedXtx);

    // w = (X^T * X)^-1 * X^T * y
    const weightsMatrix = math.multiply(math.multiply(invXtx, xTranspose), matrixY);
    const coefficients: number[] = (weightsMatrix.toArray() as number[][]).map(row => Number(row[0]!.toFixed(6)));

    const evaluate = (val: number): number =>
      coefficients.reduce((sum, c, p) => sum + c * Math.pow(val, p), 0);

    const evaluateDerivative = (val: number): number =>
      coefficients.reduce((sum, c, p) => (p > 0 ? sum + p * c * Math.pow(val, p - 1) : sum), 0);

    const evaluateSecondDerivative = (val: number): number =>
      coefficients.reduce(
        (sum, c, p) => (p > 1 ? sum + p * (p - 1) * c * Math.pow(val, p - 2) : sum),
        0,
      );

    // Compute R^2
    const yMean = y.reduce((a, b) => a + b, 0) / n;
    const ssTotal = y.reduce((sum, actual) => sum + Math.pow(actual - yMean, 2), 0);
    const ssRes = y.reduce((sum, actual, i) => sum + Math.pow(actual - evaluate(x[i]!), 2), 0);
    const rSquared = ssTotal > 0 ? Math.max(0, Math.min(1.0, 1 - ssRes / ssTotal)) : 1.0;

    return {
      coefficients,
      rSquared: Number(rSquared.toFixed(4)),
      evaluate,
      evaluateDerivative,
      evaluateSecondDerivative,
    };
  } catch {
    const avg = y.reduce((a, b) => a + b, 0) / n;
    return {
      coefficients: [avg],
      rSquared: 0,
      evaluate: () => avg,
      evaluateDerivative: () => 0,
      evaluateSecondDerivative: () => 0,
    };
  }
}
