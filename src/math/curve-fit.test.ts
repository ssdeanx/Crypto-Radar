import { describe, it, expect } from 'vitest';
import { fitPolynomial } from './curve-fit.js';

describe('Polynomial Curve Fitting & S/R Curvature Engine (MathJS)', () => {
  it('fits linear trend line y = 2x + 5 with R^2 = 1.0', () => {
    const x = [0, 1, 2, 3, 4];
    const y = [5, 7, 9, 11, 13];

    const fit = fitPolynomial(x, y, 1);
    expect(fit.rSquared).toBeCloseTo(1.0, 2);
    expect(fit.coefficients[0]).toBeCloseTo(5.0, 1);
    expect(fit.coefficients[1]).toBeCloseTo(2.0, 1);
    expect(fit.evaluate(5)).toBeCloseTo(15.0, 1);
    expect(fit.evaluateDerivative(2)).toBeCloseTo(2.0, 1);
  });

  it('fits quadratic curve y = x^2 - 4x + 10 with inflection awareness', () => {
    const x = [0, 1, 2, 3, 4];
    const y = [10, 7, 6, 7, 10]; // Vertex at x=2, y=6

    const fit = fitPolynomial(x, y, 2);
    expect(fit.rSquared).toBeCloseTo(1.0, 2);
    expect(fit.evaluate(2)).toBeCloseTo(6.0, 1);
    expect(fit.evaluateDerivative(2)).toBeCloseTo(0.0, 1); // Tangent slope at vertex is 0
    expect(fit.evaluateSecondDerivative(2)).toBeGreaterThan(0); // Upward curvature
  });

  it('handles empty data gracefully', () => {
    const fit = fitPolynomial([], []);
    expect(fit.rSquared).toBe(0);
    expect(fit.evaluate(1)).toBe(0);
  });
});
