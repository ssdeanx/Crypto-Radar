// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Market Regime Detection
// ═══════════════════════════════════════════════════════════════════════
//
// Classifies market conditions into regimes using multiple metrics:
//   - ADX (trend strength) → Trending (>25) vs Ranging (<20)
//   - Bollinger Band width → Volatile (wide) vs Quiet (narrow)
//   - ATR percentile → confirms volatility regime
//   - Volume vs average → confirms conviction
//
// This helps the signal engine adjust strategy weights dynamically.

export type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'quiet';

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number;      // 0-1
  adx: number | null;
  bbWidth: number | null;
  atrPct: number | null;
  volRatio: number | null; // current vol / avg vol
  recommendation: string;  // human-readable advice
}

/**
 * Detect current market regime from technical indicators.
 *
 * Uses a weighted voting system across ADX, BB width, ATR, and volume:
 *   - ADX > 25 → trending vote, ADX < 20 → ranging vote
 *   - BB width > 0.12 → volatile vote, < 0.03 → quiet vote
 *   - ATR% > 4% → volatile vote, < 1% → quiet vote
 *   - Volume ratio > 1.5 → confirms trending/volatile
 *
 * The regime with the highest vote weight wins. Confidence reflects
 * the margin of victory over the runner-up.
 *
 * @param indicators  Object with optional ADX, BB width, ATR%, volume ratio
 * @returns RegimeResult with regime, confidence, and human advice
 */
import { medianAbsoluteDeviation } from '../math/index.js';

export function detectRegime(indicators: {
  adx?: number | null;
  bbWidth?: number | null;
  atrPct?: number | null;
  volRatio?: number | null;
  closes?: number[];
}): RegimeResult {
  const { adx, bbWidth, atrPct, volRatio, closes } = indicators;

  // ── Vote tally ──
  const votes: Record<MarketRegime, number> = {
    trending: 0,
    ranging: 0,
    volatile: 0,
    quiet: 0,
  };
  let totalWeight = 0;

  // ADX vote (weight: 3 — strongest single indicator)
  if (adx != null) {
    totalWeight += 3;
    if (adx > 25) {
      // Trending — stronger ADX → stronger vote
      votes.trending += 3 * Math.min((adx - 25) / 25, 1);
    } else if (adx < 20) {
      votes.ranging += 3 * Math.min((20 - adx) / 10, 1);
    } else {
      // 20-25: transition zone, split vote
      const trendingFraction = (adx - 20) / 5;
      votes.trending += 3 * trendingFraction;
      votes.ranging += 3 * (1 - trendingFraction);
    }
  }

  // BB width vote (weight: 2)
  if (bbWidth != null) {
    totalWeight += 2;
    if (bbWidth > 0.12) {
      votes.volatile += 2 * Math.min((bbWidth - 0.12) / 0.08, 1);
    } else if (bbWidth < 0.03) {
      votes.quiet += 2 * Math.min((0.03 - bbWidth) / 0.02, 1);
    } else {
      // 0.03-0.12: neutral zone — BB neither tight nor wide
    }
  }

  // ATR% vote (weight: 2)
  if (atrPct != null) {
    totalWeight += 2;
    if (atrPct > 4) {
      votes.volatile += 2 * Math.min((atrPct - 4) / 6, 1);
    } else if (atrPct < 1) {
      votes.quiet += 2 * Math.min((1 - atrPct) / 0.8, 1);
    }
  }

  // Volume ratio vote (weight: 1 — confirming indicator only)
  if (volRatio != null && volRatio > 0) {
    totalWeight += 1;
    if (volRatio > 2.0) {
      // Very high volume — confirms trending or volatile
      votes.trending += 0.5;
      votes.volatile += 0.5;
    } else if (volRatio > 1.5) {
      votes.trending += 0.7;
      votes.volatile += 0.3;
    } else if (volRatio < 0.5) {
      // Low volume — confirms ranging or quiet
      votes.ranging += 0.5;
      votes.quiet += 0.5;
    }
  }

  // MAD-based volatility vote (weight: 1 — robust to outliers)
  if (closes && closes.length > 10) {
    const mad = medianAbsoluteDeviation(closes);
    const lastPrice = closes[closes.length - 1]!;
    if (lastPrice > 0 && mad > 0) {
      totalWeight += 1;
      const madPct = (mad / lastPrice) * 100;
      if (madPct > 2) {
        votes.volatile += 1 * Math.min((madPct - 2) / 4, 1);
      } else if (madPct < 0.5) {
        votes.quiet += 1 * Math.min((0.5 - madPct) / 0.4, 1);
      } else {
        // 0.5-2: neutral — normal volatility
      }
    }
  }

  // ── Determine winner ──
  const sorted = (Object.entries(votes) as [MarketRegime, number][])
    .sort((a, b) => b[1] - a[1]);

  const winner = sorted[0]![0];
  const winnerVotes = sorted[0]![1];
  const runnerUpVotes = sorted[1]![1];
  const totalVotes = sorted.reduce((s, [, v]) => s + v, 0);

  // Confidence: margin between winner and runner-up over total weight
  // Ranges 0-1, higher means more definitive classification
  const confidence = totalWeight > 0 && totalVotes > 0
    ? Math.round(((winnerVotes - runnerUpVotes) / totalWeight) * 100) / 100
    : 0;

  // Clamp confidence
  const clampedConfidence = Math.max(0, Math.min(1, confidence));

  // ── Build recommendation ──
  let recommendation: string;
  switch (winner) {
    case 'trending':
      recommendation = 'Trending market — favor momentum and trend-following strategies. '
        + 'Consider trend continuation entries with volume confirmation.';
      if (adx != null && adx > 40) {
        recommendation += ' Strong trend — use wider stops.';
      }
      break;
    case 'ranging':
      recommendation = 'Range-bound market — favor mean-reversion strategies. '
        + 'Look for bounces at support/resistance levels. Reduce trend expectations.';
      if (bbWidth != null && bbWidth < 0.04) {
        recommendation += ' Tight ranges — expect breakout soon.';
      }
      break;
    case 'volatile':
      recommendation = 'High volatility — REDUCE position sizes. '
        + 'Wider stops recommended. Consider waiting for volatility contraction.';
      if (atrPct != null && atrPct > 6) {
        recommendation += ' ⚠️ Extreme volatility — capital preservation priority.';
      }
      break;
    case 'quiet':
      recommendation = 'Low volatility — balanced approach. '
        + 'Good environment for accumulating positions with tight stops.';
      break;
    default:
      recommendation = 'Insufficient data to determine regime.';
  }

  return {
    regime: totalWeight > 0 ? winner : 'quiet',
    confidence: clampedConfidence,
    adx: adx ?? null,
    bbWidth: bbWidth ?? null,
    atrPct: atrPct ?? null,
    volRatio: volRatio ?? null,
    recommendation,
  };
}

/**
 * Get regime-appropriate strategy weight adjustments.
 *
 * Returns dynamic weights per strategy type and a position-size multiplier.
 * These can be fed into the StrategyEngine at runtime to adapt to
 * current market conditions.
 *
 * Trending → boost momentum + trend-following
 * Ranging  → boost mean-reversion
 * Volatile → reduce all position sizes
 * Quiet    → balanced (defaults)
 *
 * @param regime  The detected market regime
 * @returns Strategy weights (momentum, meanReversion, trendFollowing)
 *          plus a positionSize multiplier (0-1)
 */
export function getRegimeWeights(regime: MarketRegime): {
  momentum: number;
  meanReversion: number;
  trendFollowing: number;
  positionSize: number;
} {
  switch (regime) {
    case 'trending':
      return {
        momentum: 0.45,
        meanReversion: 0.10,
        trendFollowing: 0.45,
        positionSize: 1.0,
      };
    case 'ranging':
      return {
        momentum: 0.15,
        meanReversion: 0.60,
        trendFollowing: 0.25,
        positionSize: 0.8,
      };
    case 'volatile':
      return {
        momentum: 0.30,
        meanReversion: 0.35,
        trendFollowing: 0.35,
        positionSize: 0.5,
      };
    case 'quiet':
      return {
        momentum: 0.35,
        meanReversion: 0.30,
        trendFollowing: 0.35,
        positionSize: 0.9,
      };
  }
}

/**
 * Format regime result for display.
 *
 * Returns a color-coded (terminal-safe) string with emoji indicators:
 *   📈 Trending, 📊 Ranging, ⚡ Volatile, 😴 Quiet
 *
 * @param result  RegimeResult from detectRegime()
 * @returns Human-readable formatted string with emoji and key metrics
 */
export function formatRegime(result: RegimeResult): string {
  const emoji: Record<MarketRegime, string> = {
    trending: '📈',
    ranging: '📊',
    volatile: '⚡',
    quiet: '😴',
  };

  const regimeName = result.regime.charAt(0).toUpperCase() + result.regime.slice(1);

  const lines: string[] = [
    `\n${emoji[result.regime]}  Market Regime: ${regimeName}`,
    `    Confidence: ${(result.confidence * 100).toFixed(0)}%`,
  ];

  if (result.adx != null) {
    lines.push(`    ADX: ${result.adx.toFixed(1)} ${result.adx > 25 ? '(trending)' : result.adx < 20 ? '(ranging)' : '(transition)'}`);
  }
  if (result.bbWidth != null) {
    lines.push(`    BB Width: ${(result.bbWidth * 100).toFixed(2)}% ${result.bbWidth > 0.12 ? '(wide)' : result.bbWidth < 0.03 ? '(tight)' : '(normal)'}`);
  }
  if (result.atrPct != null) {
    lines.push(`    ATR: ${result.atrPct.toFixed(2)}% ${result.atrPct > 4 ? '(high vol)' : result.atrPct < 1 ? '(low vol)' : '(normal)'}`);
  }
  if (result.volRatio != null) {
    lines.push(`    Volume vs Avg: ${(result.volRatio * 100).toFixed(0)}%`);
  }

  lines.push(`\n  💡 ${result.recommendation}\n`);
  return lines.join('\n');
}
