// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Market Regime Detection Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  detectRegime,
  getRegimeWeights,
  formatRegime,
} from './regime.js';
import type { RegimeResult } from './regime.js';

// ── detectRegime ──

describe('detectRegime', () => {
  it('returns quiet with zero confidence for empty indicators', () => {
    const result = detectRegime({});
    expect(result.regime).toBe('quiet');
    expect(result.confidence).toBe(0);
    expect(result.recommendation).toBeDefined();
  });

  it('detects trending market with ADX > 25', () => {
    const result = detectRegime({ adx: 30 });
    expect(result.regime).toBe('trending');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.adx).toBe(30);
  });

  it('detects strong trending with high ADX', () => {
    const result = detectRegime({ adx: 50 });
    expect(result.regime).toBe('trending');
    // ADX > 40 should add "use wider stops" to recommendation
    expect(result.recommendation).toContain('wider stops');
  });

  it('detects ranging market with ADX < 20', () => {
    const result = detectRegime({ adx: 15 });
    expect(result.regime).toBe('ranging');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('detects volatile market with high BB width', () => {
    const result = detectRegime({ bbWidth: 0.20 });
    expect(result.regime).toBe('volatile');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('detects quiet market with low BB width', () => {
    const result = detectRegime({ bbWidth: 0.01 });
    expect(result.regime).toBe('quiet');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('detects volatile market with high ATR%', () => {
    const result = detectRegime({ atrPct: 8 });
    expect(result.regime).toBe('volatile');
    expect(result.confidence).toBeGreaterThan(0);
    // ATR% > 6 should add extreme volatility warning
    expect(result.recommendation).toContain('capital preservation');
  });

  it('detects quiet market with low ATR%', () => {
    const result = detectRegime({ atrPct: 0.5 });
    expect(result.regime).toBe('quiet');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('handles transition zone ADX (20-25) by splitting votes', () => {
    // ADX=22.5 is right in the transition zone
    const result = detectRegime({ adx: 22.5 });
    // Should still pick a regime
    expect(['trending', 'ranging']).toContain(result.regime);
  });

  it('volume ratio confirms trending when high', () => {
    const result = detectRegime({ adx: 30, volRatio: 2.5 });
    expect(result.regime).toBe('trending');
  });

  it('volume ratio confirms ranging when low', () => {
    const result = detectRegime({ adx: 15, volRatio: 0.3 });
    expect(result.regime).toBe('ranging');
  });

  it('combines ADX trending + low BB width → trending wins', () => {
    const result = detectRegime({ adx: 35, bbWidth: 0.02 });
    expect(result.regime).toBe('trending');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('combines high BB + high ATR → volatile wins', () => {
    const result = detectRegime({ bbWidth: 0.20, atrPct: 6 });
    expect(result.regime).toBe('volatile');
  });

  it('overflow ADX values are handled gracefully', () => {
    const result = detectRegime({ adx: 100 });
    expect(result.regime).toBe('trending');
    expect(result.recommendation).toContain('Strong trend');
  });

  it('zero values do not crash', () => {
    const result = detectRegime({ adx: 0, bbWidth: 0, atrPct: 0, volRatio: 0 });
    expect(result.regime).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('passes through all input values to result', () => {
    const result = detectRegime({ adx: 30, bbWidth: 0.05, atrPct: 2.5, volRatio: 1.2 });
    expect(result.adx).toBe(30);
    expect(result.bbWidth).toBe(0.05);
    expect(result.atrPct).toBe(2.5);
    expect(result.volRatio).toBe(1.2);
  });
});

// ── getRegimeWeights ──

describe('getRegimeWeights', () => {
  it('returns moderate momentum/trend weights for trending', () => {
    const w = getRegimeWeights('trending');
    expect(w.momentum).toBe(0.45);
    expect(w.meanReversion).toBe(0.10);
    expect(w.trendFollowing).toBe(0.45);
    expect(w.positionSize).toBe(1.0);
  });

  it('returns high mean-reversion weight for ranging', () => {
    const w = getRegimeWeights('ranging');
    expect(w.momentum).toBe(0.15);
    expect(w.meanReversion).toBe(0.60);
    expect(w.trendFollowing).toBe(0.25);
    expect(w.positionSize).toBe(0.8);
  });

  it('returns reduced position size for volatile', () => {
    const w = getRegimeWeights('volatile');
    expect(w.positionSize).toBe(0.5);
    expect(w.momentum).toBe(0.30);
    expect(w.meanReversion).toBe(0.35);
    expect(w.trendFollowing).toBe(0.35);
  });

  it('returns balanced weights for quiet', () => {
    const w = getRegimeWeights('quiet');
    expect(w.momentum).toBe(0.35);
    expect(w.meanReversion).toBe(0.30);
    expect(w.trendFollowing).toBe(0.35);
    expect(w.positionSize).toBe(0.9);
  });

  it('all weights sum to 1.0 for trending', () => {
    const w = getRegimeWeights('trending');
    const sum = w.momentum + w.meanReversion + w.trendFollowing;
    expect(sum).toBeCloseTo(1.0);
  });

  it('all weights sum to 1.0 for ranging', () => {
    const w = getRegimeWeights('ranging');
    const sum = w.momentum + w.meanReversion + w.trendFollowing;
    expect(sum).toBeCloseTo(1.0);
  });

  it('all weights sum to 1.0 for volatile', () => {
    const w = getRegimeWeights('volatile');
    const sum = w.momentum + w.meanReversion + w.trendFollowing;
    expect(sum).toBeCloseTo(1.0);
  });

  it('all weights sum to 1.0 for quiet', () => {
    const w = getRegimeWeights('quiet');
    const sum = w.momentum + w.meanReversion + w.trendFollowing;
    expect(sum).toBeCloseTo(1.0);
  });
});

// ── formatRegime ──

describe('formatRegime', () => {
  const makeResult = (overrides: Partial<RegimeResult> = {}): RegimeResult => ({
    regime: 'trending',
    confidence: 0.75,
    adx: 30,
    bbWidth: 0.05,
    atrPct: 2.0,
    volRatio: 1.5,
    recommendation: 'Test recommendation.',
    ...overrides,
  });

  it('returns formatted string with regime name', () => {
    const result = makeResult();
    const output = formatRegime(result);
    expect(output).toContain('Market Regime');
    expect(output).toContain('Trending');
    expect(output).toContain('75%');
  });

  it('includes ADX line when adx is present', () => {
    const output = formatRegime(makeResult({ adx: 30 }));
    expect(output).toContain('ADX:');
    expect(output).toContain('30.0');
  });

  it('omits ADX line when adx is null', () => {
    const output = formatRegime(makeResult({ adx: null }));
    expect(output).not.toContain('ADX:');
  });

  it('includes BB width line when bbWidth is present', () => {
    const output = formatRegime(makeResult({ bbWidth: 0.10 }));
    expect(output).toContain('BB Width:');
  });

  it('omits BB width line when bbWidth is null', () => {
    const output = formatRegime(makeResult({ bbWidth: null }));
    expect(output).not.toContain('BB Width:');
  });

  it('includes ATR line when atrPct is present', () => {
    const output = formatRegime(makeResult({ atrPct: 2.5 }));
    expect(output).toContain('ATR:');
  });

  it('omits ATR line when atrPct is null', () => {
    const output = formatRegime(makeResult({ atrPct: null }));
    expect(output).not.toContain('ATR:');
  });

  it('includes volume line when volRatio is present', () => {
    const output = formatRegime(makeResult({ volRatio: 1.5 }));
    expect(output).toContain('Volume vs Avg:');
  });

  it('omits volume line when volRatio is null', () => {
    const output = formatRegime(makeResult({ volRatio: null }));
    expect(output).not.toContain('Volume vs Avg:');
  });

  it('includes recommendation', () => {
    const output = formatRegime(makeResult());
    expect(output).toContain('Test recommendation.');
  });

  it('formats all four regime types correctly', () => {
    for (const regime of ['trending', 'ranging', 'volatile', 'quiet'] as const) {
      const result = makeResult({ regime, confidence: 0.6 });
      const output = formatRegime(result);
      expect(output).toContain(regime.charAt(0).toUpperCase() + regime.slice(1));
    }
  });
});
