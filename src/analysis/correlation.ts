// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Cross-Token Correlation Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Computes Pearson correlation coefficients between token price movements.
// Uses daily returns from kline close prices.
//
// This helps users:
//   - Diversify portfolios (avoid correlated assets)
//   - Identify sector rotations (SOL up, BTC down = capital rotation)
//   - Find hedge pairs (BTC vs ETH correlation spikes)

export interface CorrelationMatrix {
  symbols: string[];
  /** N×N matrix of Pearson R values (-1 to 1) */
  matrix: number[][];
  /** Number of periods used for computation */
  periods: number;
  timestamp: string;
}

export interface CorrelationPair {
  symbolA: string;
  symbolB: string;
  correlation: number; // -1 to 1
}

import { Matrix, EigenvalueDecomposition } from '../math/index.js';

/**
 * Convert price levels to period-over-period returns.
 *
 * Returns are computed as: r_i = (price_i - price_{i-1}) / price_{i-1}
 * This makes series comparable regardless of absolute price levels.
 *
 * @param prices  Array of close prices
 * @returns Array of returns (one less than input length)
 */
function toReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    if (prev === 0) {
      returns.push(0);
    } else {
      returns.push((prices[i]! - prev) / prev);
    }
  }
  return returns;
}

/**
 * Compute Pearson correlation matrix from multiple price series using
 * centered matrix operations (ml-matrix).
 *
 * Delegates to {@link computeCorrelationMatrixBulk}. All return series are
 * truncated to the global minimum length before computing correlations,
 * ensuring all entries in the matrix reflect the same time period.
 *
 * Returns a symmetrical N×N matrix where matrix[i][j] = correlation
 * between symbol[i] and symbol[j]. The diagonal (self-correlation) is
 * always 1.0.
 *
 * @param priceMap  Map of symbol → array of close prices
 * @returns CorrelationMatrix with symbols and N×N matrix
 */
export function computeCorrelationMatrix(
  priceMap: Map<string, number[]>,
): CorrelationMatrix {
  return computeCorrelationMatrixBulk(priceMap);
}

/**
 * Find top N strongest correlations for a given symbol.
 *
 * Returns pairs sorted by absolute correlation strength (descending),
 * excluding the symbol's self-correlation. Both positive and negative
 * correlations are ranked by their absolute value.
 *
 * @param symbol  The symbol to find correlations for
 * @param matrix  Correlation matrix from computeCorrelationMatrix()
 * @param n       Number of results (default: 5)
 * @returns Array of correlation pairs, sorted by absolute strength
 */
export function findTopCorrelations(
  symbol: string,
  matrix: CorrelationMatrix,
  n: number = 5,
): CorrelationPair[] {
  const idx = matrix.symbols.indexOf(symbol);
  if (idx === -1) return [];

  const pairs: CorrelationPair[] = [];

  for (let j = 0; j < matrix.symbols.length; j++) {
    if (j === idx) continue;
    pairs.push({
      symbolA: symbol,
      symbolB: matrix.symbols[j]!,
      correlation: matrix.matrix[idx]![j]!,
    });
  }

  // Sort by absolute correlation strength descending
  pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return pairs.slice(0, n);
}

/**
 * Helper: compute daily returns from close prices (convenience wrapper
 * around toReturns).
 *
 * @param prices  Array of close prices
 * @returns Array of daily returns
 */
export function priceReturns(prices: number[]): number[] {
  return toReturns(prices);
}

/**
 * Compute correlation matrix using centered matrix operations (bulk path).
 *
 * This is the underlying implementation for {@link computeCorrelationMatrix}.
 * All return series are truncated to the global minimum length before
 * computing correlations.
 *
 * @deprecated Use {@link computeCorrelationMatrix} instead.
 * @param priceMap  Map of symbol → array of close prices
 * @returns CorrelationMatrix with symbols and N×N matrix
 */
export function computeCorrelationMatrixBulk(
  priceMap: Map<string, number[]>,
): CorrelationMatrix {
  const symbols = Array.from(priceMap.keys());
  const N = symbols.length;
  if (N === 0) {
    return { symbols, matrix: [], periods: 0, timestamp: new Date().toISOString() };
  }

  // Pre-compute returns for each symbol
  const returnsMap = new Map<string, number[]>();
  for (const [symbol, prices] of priceMap) {
    returnsMap.set(symbol, toReturns(prices));
  }

  // Find global minimum return-series length
  let minLen = Infinity;
  for (const returns of returnsMap.values()) {
    if (returns.length < minLen) minLen = returns.length;
  }

  if (minLen < 10) {
    // Not enough data — fall back to pairwise zero matrix
    const matrix: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++) matrix[i]![i] = 1;
    return { symbols, matrix, periods: minLen, timestamp: new Date().toISOString() };
  }

  const M = minLen;

  // 1. Build returns matrix: rows = time periods (M), cols = symbols (N)
  const returnsData: number[][] = [];
  for (let t = 0; t < M; t++) {
    const row: number[] = [];
    for (const sym of symbols) {
      const rets = returnsMap.get(sym)!;
      // Align to the end (most recent M periods)
      row.push(rets[rets.length - M + t]!);
    }
    returnsData.push(row);
  }

  const returnsMatrix = new Matrix(returnsData); // M×N

  // 2. Center (subtract column means)
  returnsMatrix.center('column');

  // 3. Covariance = (1/(M-1)) * Xᵀ * X
  const covMatrix = returnsMatrix.transpose().mmul(returnsMatrix).mul(1 / (M - 1));

  // 4. Standard deviations from diagonal of covariance
  const std = new Float64Array(N);
  for (let i = 0; i < N; i++) std[i] = Math.sqrt(Math.max(0, covMatrix.get(i, i)));

  // 5. Build correlation matrix: D * Cov * D where D = diag(1/std)
  const matrix: number[][] = [];
  for (let i = 0; i < N; i++) {
    const row: number[] = [];
    for (let j = 0; j < N; j++) {
      const denom = std[i]! * std[j]!;
      const corr = denom > 1e-10 ? covMatrix.get(i, j) / denom : (i === j ? 1 : 0);
      row.push(corr);
    }
    matrix.push(row);
  }

  const roundedMatrix = matrix.map(r => r.map(v => Math.round(v * 10000) / 10000));

  return {
    symbols,
    matrix: roundedMatrix,
    periods: M,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compute the N×N covariance matrix from price series.
 *
 * Uses the same centered matrix approach as computeCorrelationMatrixBulk().
 * All series are truncated to the global minimum length.
 *
 * @param priceMap  Map of symbol → array of close prices
 * @returns Covariance matrix with symbols
 */
export function computeCovMatrix(
  priceMap: Map<string, number[]>,
): { symbols: string[]; matrix: number[][] } {
  const symbols = Array.from(priceMap.keys());
  const N = symbols.length;
  if (N === 0) return { symbols, matrix: [] };

  const returnsMap = new Map<string, number[]>();
  for (const [symbol, prices] of priceMap) {
    returnsMap.set(symbol, toReturns(prices));
  }

  let minLen = Infinity;
  for (const returns of returnsMap.values()) {
    if (returns.length < minLen) minLen = returns.length;
  }

  if (minLen < 2) {
    const matrix: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    return { symbols, matrix };
  }

  const M = minLen;

  const returnsData: number[][] = [];
  for (let t = 0; t < M; t++) {
    const row: number[] = [];
    for (const sym of symbols) {
      const rets = returnsMap.get(sym)!;
      row.push(rets[rets.length - M + t]!);
    }
    returnsData.push(row);
  }

  const returnsMatrix = new Matrix(returnsData);
  returnsMatrix.center('column');
  const covMatrix = returnsMatrix.transpose().mmul(returnsMatrix).mul(1 / (M - 1));

  const matrix: number[][] = [];
  for (let i = 0; i < N; i++) {
    const row: number[] = [];
    for (let j = 0; j < N; j++) {
      row.push(covMatrix.get(i, j));
    }
    matrix.push(row);
  }

  return { symbols, matrix };
}

/**
 * Compute Principal Component Analysis (PCA) on a correlation matrix.
 *
 * Uses EigenvalueDecomposition from ml-matrix. Returns eigenvalues sorted
 * descending with explained variance ratios.
 *
 * @param corrMatrix  N×N correlation matrix (as number[][])
 * @returns PCA result with eigenvalues, explained/cumulative variance, eigenvectors
 */
export function computePCA(corrMatrix: number[][]): {
  eigenvalues: number[];
  explainedVariance: number[];
  cumulativeVariance: number[];
  eigenvectors: number[][];
} {
  const matrix = new Matrix(corrMatrix);
  const evd = new EigenvalueDecomposition(matrix);
  const eigenvalues = evd.realEigenvalues;
  const eigenvectors = evd.eigenvectorMatrix;

  // Sort descending by eigenvalue, carrying eigenvectors along
  const n = eigenvalues.length;
  const paired: Array<{ value: number; vector: number[] }> = [];
  for (let i = 0; i < n; i++) {
    const vec: number[] = [];
    for (let j = 0; j < n; j++) {
      vec.push(eigenvectors.get(j, i));
    }
    paired.push({ value: Math.max(0, eigenvalues[i]!), vector: vec });
  }
  paired.sort((a, b) => b.value - a.value);

  const sortedEigenvalues = paired.map(p => p.value);
  const sortedEigenvectors = paired.map(p => p.vector);

  // Clamp near-zero negative eigenvalues from floating-point noise
  const total = sortedEigenvalues.reduce((s, v) => s + v, 0) || 1;

  const explained: number[] = [];
  const cumulative: number[] = [];
  let running = 0;
  for (const val of sortedEigenvalues) {
    const ratio = val / total;
    explained.push(ratio);
    running += ratio;
    cumulative.push(running);
  }

  return {
    eigenvalues: sortedEigenvalues,
    explainedVariance: explained,
    cumulativeVariance: cumulative,
    eigenvectors: sortedEigenvectors,
  };
}

/**
 * Format correlation matrix as a terminal table.
 *
 * Shows a grid of symbols vs symbols with correlation values.
 * Strong positive correlations (≥0.7) are marked with a '+'
 * Strong negative correlations (≤-0.7) are marked with a '-'
 *
 * @param matrix  CorrelationMatrix from computeCorrelationMatrix()
 * @returns Formatted table string ready for terminal display
 */
export function formatCorrelationTable(matrix: CorrelationMatrix): string {
  if (matrix.symbols.length === 0) return 'No correlation data.';

  const header = matrix.symbols;
  const colWidth = 8; // Fixed-width columns for readability
  const labelWidth = 6;

  // Build header row
  const lines: string[] = [];

  // Top header line with padded symbols
  const headerParts: string[] = [''.padEnd(labelWidth)];
  for (const sym of header) {
    headerParts.push(sym.padStart(colWidth));
  }
  lines.push(headerParts.join(' '));

  // Separator
  const sepParts: string[] = [''.padEnd(labelWidth, '─')];
  for (let i = 0; i < header.length; i++) {
    sepParts.push(''.padEnd(colWidth, '─'));
  }
  lines.push(sepParts.join('─'));

  // Data rows
  for (let i = 0; i < matrix.symbols.length; i++) {
    const rowParts: string[] = [matrix.symbols[i]!.padEnd(labelWidth)];
    const row = matrix.matrix[i]!;
    for (let j = 0; j < row.length; j++) {
      const val = row[j]!;
      let formatted: string;
      if (i === j) {
        formatted = '  1.00'; // diagonal highlight
      } else if (val >= 0.7) {
        formatted = `+${val.toFixed(2)}`; // strong positive
      } else if (val <= -0.7) {
        formatted = `${val.toFixed(2)}`;  // strong negative (sign already there)
      } else if (val >= 0) {
        formatted = ` ${val.toFixed(2)}`;
      } else {
        formatted = `${val.toFixed(2)}`;
      }
      rowParts.push(formatted.padStart(colWidth));
    }
    lines.push(rowParts.join(' '));
  }

  // Legend
  lines.push('');
  lines.push(`Periods: ${matrix.periods} returns  |  +0.70 = strong positive  |  -0.70 = strong negative`);
  lines.push(`Timestamp: ${matrix.timestamp}`);

  return lines.join('\n');
}
