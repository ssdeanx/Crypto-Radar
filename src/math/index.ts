import {
  mean,
  median,
  mode,
  sum,
  min,
  max,
  sampleVariance,
  variance,
  sampleStandardDeviation,
  standardDeviation,
  sampleCorrelation,
  sampleCovariance,
  linearRegression,
  linearRegressionLine,
  rSquared,
  quantile,
  zScore,
  medianAbsoluteDeviation,
  weightedQuantile,
} from 'simple-statistics';

export {
  mean,
  median,
  mode,
  sum,
  min,
  max,
  sampleVariance,
  variance,
  sampleStandardDeviation,
  standardDeviation,
  sampleCorrelation,
  sampleCovariance,
  linearRegression,
  linearRegressionLine,
  rSquared,
  quantile,
  zScore,
  medianAbsoluteDeviation,
  weightedQuantile,
};

export { Matrix, EigenvalueDecomposition } from 'ml-matrix';

export * from './eval.js';
export * from './risk.js';
export * from './portfolio.js';
export * from './filtering.js';
export * from './markowitz.js';
export * from './spectral.js';
export * from './markov.js';
export * from './curve-fit.js';
export * from './bignum.js';
export * as math from 'mathjs';

