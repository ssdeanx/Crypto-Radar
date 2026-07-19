// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Correlation Engine Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  computeCorrelationMatrix,
  computeCorrelationMatrixBulk,
  computeCovMatrix,
  computePCA,
  findTopCorrelations,
  priceReturns,
  formatCorrelationTable,
} from './correlation.js';

// ── priceReturns ──

describe('priceReturns', () => {
  it('computes period-over-period returns', () => {
    const prices = [100, 110, 121]; // 10% then 10%
    const result = priceReturns(prices);
    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(0.1);
    expect(result[1]).toBeCloseTo(0.1);
  });

  it('returns empty array for < 2 prices', () => {
    expect(priceReturns([])).toEqual([]);
    expect(priceReturns([100])).toEqual([]);
  });

  it('handles zero previous price', () => {
    const prices = [0, 100, 200];
    const result = priceReturns(prices);
    expect(result[0]).toBe(0); // prev=0, division by zero protected
    expect(result[1]).toBe(1); // (200-100)/100
  });

  it('handles negative returns', () => {
    const prices = [100, 90, 81];
    const result = priceReturns(prices);
    expect(result[0]).toBeCloseTo(-0.1);
    expect(result[1]).toBeCloseTo(-0.1);
  });
});

// ── computeCorrelationMatrix ──

describe('computeCorrelationMatrix', () => {
  it('returns empty matrix for empty map', () => {
    const result = computeCorrelationMatrix(new Map());
    expect(result.symbols).toEqual([]);
    expect(result.matrix).toEqual([]);
    expect(result.periods).toBe(0);
    expect(result.timestamp).toBeDefined();
  });

  it('computes 1×1 matrix for single symbol', () => {
    const map = new Map([['BTC', [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]]]);
    const result = computeCorrelationMatrix(map);
    expect(result.symbols).toEqual(['BTC']);
    expect(result.matrix).toEqual([[1]]);
    expect(result.periods).toBe(10); // 11 prices => 10 returns
  });

  it('returns perfect positive correlation for identical price series', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
    const map = new Map<string, number[]>([
      ['BTC', prices],
      ['ETH', prices],
    ]);
    const result = computeCorrelationMatrix(map);
    expect(result.symbols).toEqual(['BTC', 'ETH']);
    expect(result.matrix[0][0]).toBe(1);
    expect(result.matrix[1][1]).toBe(1);
    // Off-diagonal should be very close to 1 (identical returns)
    expect(result.matrix[0][1]).toBeCloseTo(1, 4);
    expect(result.matrix[1][0]).toBeCloseTo(1, 4);
  });

  it('returns perfect negative correlation for inversely related returns', () => {
    // Construct price series where returns are exact opposites
    const returnsA = [0.01, -0.005, 0.02, -0.01, 0.015, -0.008, 0.012, -0.006, 0.018, -0.004, 0.009, -0.007, 0.016, -0.003, 0.011];
    const returnsB = returnsA.map(r => -r);

    const pricesA: number[] = [100];
    const pricesB: number[] = [100];
    for (const r of returnsA) pricesA.push(pricesA[pricesA.length - 1]! * (1 + r));
    for (const r of returnsB) pricesB.push(pricesB[pricesB.length - 1]! * (1 + r));

    const map = new Map<string, number[]>([
      ['BTC', pricesA],
      ['ETH', pricesB],
    ]);
    const result = computeCorrelationMatrix(map);
    expect(result.matrix[0][1]).toBeCloseTo(-1, 4);
    expect(result.matrix[1][0]).toBeCloseTo(-1, 4);
  });

  it('returns near-zero correlation for unrelated random-like series', () => {
    // BTC: steady +1 each step, ETH: oscillates
    const btc = Array.from({ length: 20 }, (_, i) => 100 + i);
    const eth = Array.from({ length: 20 }, (_, i) => 100 + (i % 4 === 0 ? 5 : i % 4 === 2 ? -5 : 0));
    const map = new Map<string, number[]>([
      ['BTC', btc],
      ['ETH', eth],
    ]);
    const result = computeCorrelationMatrix(map);
    // Should be small magnitude (not perfectly correlated)
    expect(Math.abs(result.matrix[0][1])).toBeLessThan(0.5);
  });

  it('returns 0 correlation for fewer than 10 data points', () => {
    const short = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]; // 9 prices => 8 returns
    const map = new Map<string, number[]>([
      ['BTC', short],
      ['ETH', [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]],
    ]);
    const result = computeCorrelationMatrix(map);
    expect(result.matrix[0][1]).toBe(0);
  });

  it('handles symbols of different lengths by aligning to shortest', () => {
    const long = Array.from({ length: 30 }, (_, i) => 100 + i);
    const short = Array.from({ length: 20 }, (_, i) => 100 + i);
    const map = new Map<string, number[]>([
      ['LONG', long],
      ['SHORT', short],
    ]);
    const result = computeCorrelationMatrix(map);
    expect(result.matrix[0][1]).not.toBeNaN();
    expect(isFinite(result.matrix[0][1])).toBe(true);
    expect(result.matrix[0][0]).toBe(1);
    expect(result.matrix[1][1]).toBe(1);
  });

  it('handles constant price (zero variance) gracefully', () => {
    const constant = Array.from({ length: 20 }, () => 100);
    const varying = Array.from({ length: 20 }, (_, i) => 100 + i);
    const map = new Map<string, number[]>([
      ['CONST', constant],
      ['VAR', varying],
    ]);
    const result = computeCorrelationMatrix(map);
    // Constant series has zero variance → correlation = 0
    expect(result.matrix[0][1]).toBe(0);
  });

  it('produces symmetrical matrix', () => {
    const a = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    const b = Array.from({ length: 20 }, (_, i) => 200 - i);
    const c = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i * 0.5) * 10);
    const map = new Map<string, number[]>([
      ['A', a],
      ['B', b],
      ['C', c],
    ]);
    const result = computeCorrelationMatrix(map);
    const n = result.symbols.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        expect(result.matrix[i][j]).toBeCloseTo(result.matrix[j][i], 10);
      }
    }
  });
});

// ── findTopCorrelations ──

// ── computeCorrelationMatrixBulk ──

describe('computeCorrelationMatrixBulk', () => {
  it('matches pairwise results for equal-length series', () => {
    const pricesA = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    const pricesB = Array.from({ length: 30 }, (_, i) => 200 - i);
    const pricesC = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i * 0.5) * 10);
    const map = new Map<string, number[]>([
      ['A', pricesA],
      ['B', pricesB],
      ['C', pricesC],
    ]);

    const pairwise = computeCorrelationMatrix(map);
    const bulk = computeCorrelationMatrixBulk(map);

    expect(bulk.symbols).toEqual(pairwise.symbols);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(bulk.matrix[i][j]).toBeCloseTo(pairwise.matrix[i][j], 4);
      }
    }
  });

  it('handles empty map', () => {
    const result = computeCorrelationMatrixBulk(new Map());
    expect(result.symbols).toEqual([]);
    expect(result.matrix).toEqual([]);
  });

  it('produces symmetrical matrix', () => {
    const map = new Map<string, number[]>([
      ['A', Array.from({ length: 30 }, (_, i) => 100 + i * 2)],
      ['B', Array.from({ length: 30 }, (_, i) => 200 - i)],
      ['C', Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i * 0.5) * 10)],
    ]);
    const result = computeCorrelationMatrixBulk(map);
    const n = result.symbols.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        expect(result.matrix[i][j]).toBeCloseTo(result.matrix[j][i], 10);
      }
    }
  });

  it('handles constant series gracefully', () => {
    const constant = Array.from({ length: 20 }, () => 100);
    const varying = Array.from({ length: 20 }, (_, i) => 100 + i);
    const map = new Map<string, number[]>([
      ['CONST', constant],
      ['VAR', varying],
    ]);
    const result = computeCorrelationMatrixBulk(map);
    expect(result.matrix[0][1]).toBe(0);
  });
});

// ── computeCovMatrix ──

describe('computeCovMatrix', () => {
  it('returns covariance matrix for equal-length series', () => {
    const a = Array.from({ length: 20 }, (_, i) => 100 + i);
    const b = Array.from({ length: 20 }, (_, i) => 200 - i);
    const map = new Map<string, number[]>([['A', a], ['B', b]]);
    const result = computeCovMatrix(map);

    expect(result.symbols).toEqual(['A', 'B']);
    expect(result.matrix).toHaveLength(2);
    expect(result.matrix[0]).toHaveLength(2);
    // Diagonal should be non-negative (variance)
    expect(result.matrix[0][0]).toBeGreaterThanOrEqual(0);
    expect(result.matrix[1][1]).toBeGreaterThanOrEqual(0);
  });

  it('handles empty map', () => {
    const result = computeCovMatrix(new Map());
    expect(result.symbols).toEqual([]);
    expect(result.matrix).toEqual([]);
  });
});

// ── computePCA ──

describe('computePCA', () => {
  it('returns eigenvalues that sum to N (trace of correlation matrix)', () => {
    // 3×3 identity-like correlation matrix
    const corrMatrix = [
      [1.0, 0.5, 0.3],
      [0.5, 1.0, 0.4],
      [0.3, 0.4, 1.0],
    ];
    const result = computePCA(corrMatrix);

    expect(result.eigenvalues).toHaveLength(3);
    expect(result.explainedVariance).toHaveLength(3);
    expect(result.cumulativeVariance).toHaveLength(3);
    expect(result.eigenvectors).toHaveLength(3);

    // Eigenvalues of a 3×3 correlation matrix sum to 3
    const sum = result.eigenvalues.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(3, 4);

    // Cumulative variance ends at 1
    expect(result.cumulativeVariance[2]).toBeCloseTo(1, 4);
  });

  it('returns all ones for diagonal-only matrix', () => {
    const corrMatrix = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const result = computePCA(corrMatrix);
    const sum = result.eigenvalues.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(3, 4);
    // Each eigenvalue should be ~1 for identity
    for (const val of result.eigenvalues) {
      expect(val).toBeCloseTo(1, 4);
    }
  });

  it('sorts eigenvalues descending', () => {
    const corrMatrix = [
      [1.0, 0.9, 0.2],
      [0.9, 1.0, 0.1],
      [0.2, 0.1, 1.0],
    ];
    const result = computePCA(corrMatrix);
    for (let i = 1; i < result.eigenvalues.length; i++) {
      expect(result.eigenvalues[i - 1]).toBeGreaterThanOrEqual(result.eigenvalues[i]);
    }
  });
});

describe('findTopCorrelations', () => {
  const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
  const map = new Map<string, number[]>([
    ['BTC', prices],
    ['ETH', prices.map(p => p * 1.1)],
    ['SOL', prices.map(p => p * 0.9)],
    ['ADA', Array.from({ length: 20 }, (_, i) => 200 - i)],
    ['DOT', Array.from({ length: 20 }, () => 100)],
  ]);
  const matrix = computeCorrelationMatrix(map);

  it('returns empty array for unknown symbol', () => {
    expect(findTopCorrelations('UNKNOWN', matrix)).toEqual([]);
  });

  it('returns pairs for a known symbol', () => {
    const pairs = findTopCorrelations('BTC', matrix);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.length).toBeLessThanOrEqual(5);
    for (const p of pairs) {
      expect(p.symbolA).toBe('BTC');
      expect(p.symbolB).not.toBe('BTC');
      expect(p.correlation).toBeGreaterThanOrEqual(-1);
      expect(p.correlation).toBeLessThanOrEqual(1);
    }
  });

  it('returns top N correlations', () => {
    const pairs = findTopCorrelations('BTC', matrix, 2);
    expect(pairs).toHaveLength(2);
  });

  it('sorts by absolute correlation descending', () => {
    const pairs = findTopCorrelations('BTC', matrix);
    for (let i = 1; i < pairs.length; i++) {
      expect(Math.abs(pairs[i - 1]!.correlation))
        .toBeGreaterThanOrEqual(Math.abs(pairs[i]!.correlation));
    }
  });

  it('handles self-correlation exclusion', () => {
    const pairs = findTopCorrelations('ADA', matrix);
    for (const p of pairs) {
      // DOT is constant → correlation 0, but it's still returned
      expect(p.symbolA).toBe('ADA');
    }
  });
});

// ── formatCorrelationTable ──

describe('formatCorrelationTable', () => {
  it('returns message for empty matrix', () => {
    const empty = {
      symbols: [],
      matrix: [],
      periods: 0,
      timestamp: new Date().toISOString(),
    };
    expect(formatCorrelationTable(empty)).toBe('No correlation data.');
  });

  it('formats a basic matrix', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
    const map = new Map<string, number[]>([
      ['BTC', prices],
      ['ETH', prices],
    ]);
    const matrix = computeCorrelationMatrix(map);
    const output = formatCorrelationTable(matrix);

    expect(output).toContain('BTC');
    expect(output).toContain('ETH');
    expect(output).toContain('Periods:');
    expect(output).toContain('Timestamp:');
    // Diagonal should show 1.00
    expect(output).toContain('1.00');
  });

  it('includes legend', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
    const map = new Map<string, number[]>([['BTC', prices]]);
    const matrix = computeCorrelationMatrix(map);
    const output = formatCorrelationTable(matrix);
    expect(output).toContain('strong positive');
    expect(output).toContain('strong negative');
  });
});
