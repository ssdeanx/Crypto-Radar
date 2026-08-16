import { describe, it, expect } from 'vitest';
import { checkIndicatorConsistency, evaluateMarketReasoning } from './ai-eval.js';

describe('AI Reasoning Evaluation Engine (Autoevals)', () => {
  it('passes reasoning that aligns with indicators', async () => {
    const res = await evaluateMarketReasoning({
      symbol: 'SOL',
      predictedDirection: 'bullish',
      confidence: 0.85,
      reasoning: 'SOL displays strong upward momentum with expanding Bollinger Bands and bullish MACD histogram.',
      technicals: {
        rsi: 62,
        macd: { macd: 1.5, signal: 0.8, histogram: 0.7 },
      },
    });

    expect(res.passed).toBe(true);
    expect(res.indicatorConsistencyScore).toBe(1.0);
    expect(res.reasons).toHaveLength(0);
  });

  it('catches and penalizes reasoning that contradicts RSI indicator', async () => {
    const consistency = checkIndicatorConsistency(
      'Token is deeply oversold and ready for a bounce.',
      { rsi: 82 }, // RSI 82 is heavily overbought!
    );

    expect(consistency.score).toBeLessThan(1.0);
    expect(consistency.errors[0]).toContain("states 'oversold' but RSI is 82");
  });

  it('evaluates with ground truth summary', async () => {
    const res = await evaluateMarketReasoning({
      symbol: 'ETH',
      predictedDirection: 'bearish',
      confidence: 0.75,
      reasoning: 'ETH is breaking below key support at $2,800 with sustained sell volume.',
      groundTruthSummary: 'ETH breaks under 2800 support on heavy selling pressure.',
    });

    expect(res.factualityScore).toBeGreaterThan(0.35);
    expect(res.indicatorConsistencyScore).toBe(1.0);
  });
});
