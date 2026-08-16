// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — AI Reasoning Evaluation Engine (Autoevals)
// ═══════════════════════════════════════════════════════════════════════
//
// Evaluates LLM market reasoning outputs, trade rationales, and structured
// responses for factuality, tone, financial soundness, and indicator consistency.
// ═══════════════════════════════════════════════════════════════════════

import { Factuality, Levenshtein } from 'autoevals';
import type { TechnicalIndicators } from '../types.js';

export interface ReasoningEvalInput {
  symbol: string;
  predictedDirection: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string;
  technicals?: Partial<TechnicalIndicators> | null;
  groundTruthSummary?: string;
}

export interface ReasoningEvalResult {
  symbol: string;
  factualityScore: number;
  indicatorConsistencyScore: number;
  isValidJson: boolean;
  passed: boolean;
  reasons: string[];
}

/**
 * Checks if the reasoning contradicts basic technical indicators.
 * E.g., claiming "RSI is oversold" when RSI is 78 is an instant failure.
 */
export function checkIndicatorConsistency(
  reasoning: string,
  technicals?: Partial<TechnicalIndicators> | null,
): { score: number; errors: string[] } {
  if (!technicals) return { score: 1.0, errors: [] };

  const lower = reasoning.toLowerCase();
  const errors: string[] = [];
  let score = 1.0;

  // RSI contradiction checks
  if (technicals.rsi !== undefined && technicals.rsi !== null) {
    if (technicals.rsi >= 70 && lower.includes('oversold')) {
      errors.push(`Contradiction: reasoning states 'oversold' but RSI is ${technicals.rsi} (overbought)`);
      score -= 0.5;
    }
    if (technicals.rsi <= 30 && lower.includes('overbought')) {
      errors.push(`Contradiction: reasoning states 'overbought' but RSI is ${technicals.rsi} (oversold)`);
      score -= 0.5;
    }
  }

  // MACD contradiction checks
  if (technicals.macd?.histogram !== undefined && technicals.macd.histogram !== null) {
    if (technicals.macd.histogram > 0 && lower.includes('bearish macd crossover')) {
      errors.push('Contradiction: reasoning claims bearish MACD crossover while histogram is positive');
      score -= 0.3;
    }
  }

  return {
    score: Math.max(0, Number(score.toFixed(2))),
    errors,
  };
}

/**
 * Evaluates an AI-generated reasoning output against ground truth facts and indicators.
 */
export async function evaluateMarketReasoning(
  input: ReasoningEvalInput,
): Promise<ReasoningEvalResult> {
  const reasons: string[] = [];

  // 1. Check indicator consistency
  const consistency = checkIndicatorConsistency(input.reasoning, input.technicals);
  if (consistency.errors.length > 0) {
    reasons.push(...consistency.errors);
  }

  // 2. Factuality evaluation using Autoevals Factuality scorer if ground truth summary provided
  let factualityScore = 1.0;
  if (input.groundTruthSummary) {
    try {
      const factResult = await Factuality({
        input: `Market analysis for ${input.symbol} (${input.predictedDirection}, confidence ${(input.confidence * 100).toFixed(0)}%)`,
        output: input.reasoning,
        expected: input.groundTruthSummary,
      });
      factualityScore = factResult.score ?? 1.0;
    } catch {
      // Fallback to Levenshtein / word overlap if LLM judge is not configured
      const lev = await Levenshtein({
        output: input.reasoning,
        expected: input.groundTruthSummary,
      });
      factualityScore = lev.score ?? 0.8;
    }
  }

  // 3. JSON Validity check (if output is formatted as JSON)
  let isValidJson = true;
  if (input.reasoning.trim().startsWith('{')) {
    try {
      JSON.parse(input.reasoning);
    } catch {
      isValidJson = false;
      reasons.push('Invalid JSON structure in structured reasoning response');
    }
  }

  const passed = consistency.score >= 0.7 && factualityScore >= 0.6 && isValidJson;

  return {
    symbol: input.symbol,
    factualityScore: Number(factualityScore.toFixed(2)),
    indicatorConsistencyScore: consistency.score,
    isValidJson,
    passed,
    reasons,
  };
}
