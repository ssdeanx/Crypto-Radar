import { describe, it, expect } from 'vitest';
import { estimateMarkovTransitionMatrix, type MarketRegimeType } from './markov.js';

describe('Markov Regime Transition & Stationary State Engine (MathJS)', () => {
  it('estimates transition matrix and expected durations from persistent regime sequence', () => {
    // Bull regime persists for 4 bars, transitions to chop, persists for 3 bars, then transitions to bear
    const sequence: MarketRegimeType[] = [
      'bull', 'bull', 'bull', 'bull',
      'chop', 'chop', 'chop',
      'bear', 'bear', 'bear', 'bear', 'bear',
    ];

    const res = estimateMarkovTransitionMatrix(sequence);
    expect(res.states).toEqual(['bull', 'bear', 'chop']);

    // Check transition matrix is row-stochastic (each row sums to ~1.0)
    for (const row of res.transitionMatrix) {
      const sum = row.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    }

    // Expected duration of bear should be highest since it had longest streak
    expect(res.expectedDuration.bear).toBeGreaterThan(1.0);
    expect(res.expectedDuration.bull).toBeGreaterThan(1.0);

    // Stationary distribution sums to ~1.0
    const statSum = res.stationaryDistribution.bull + res.stationaryDistribution.bear + res.stationaryDistribution.chop;
    expect(statSum).toBeCloseTo(1.0, 2);

    // Predict next state
    const nextFromBull = res.predictNext('bull');
    expect(nextFromBull.bull).toBeGreaterThan(nextFromBull.bear);
  });

  it('handles empty sequence gracefully with equal probabilities', () => {
    const res = estimateMarkovTransitionMatrix([]);
    expect(res.transitionMatrix).toHaveLength(3);
    expect(res.stationaryDistribution.bull).toBeCloseTo(0.3333, 2);
  });
});
