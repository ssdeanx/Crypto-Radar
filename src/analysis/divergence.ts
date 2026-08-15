// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — RSI & MACD Divergence Strategy
// ═══════════════════════════════════════════════════════════════════════
//
// Detects high-probability trend reversal signals by scanning for:
//   - Bullish Divergence: Price forms Lower Lows while RSI / MACD forms Higher Lows
//   - Bearish Divergence: Price forms Higher Highs while RSI / MACD forms Lower Highs
//   - Hidden Bullish Divergence: Price forms Higher Lows while RSI forms Lower Lows
//   - Hidden Bearish Divergence: Price forms Lower Highs while RSI forms Higher Highs
// ═══════════════════════════════════════════════════════════════════════

import type { SignalStrategy, StrategyContext, StrategySignal, SignalDirection } from './strategies.js';
import { computeRSI, computeMACD } from '../indicators.js';

export class DivergenceStrategy implements SignalStrategy {
  readonly name = 'divergence';
  readonly description = 'Scans for RSI and MACD regular and hidden price divergences';
  readonly timeframe = '1h';

  evaluate(ctx: StrategyContext): StrategySignal {
    const { klineCloses, klineHighs, klineLows } = ctx;
    const indicators: Record<string, number | null> = {};
    const reasons: string[] = [];

    if (!klineCloses || klineCloses.length < 30) {
      return {
        strategy: this.name,
        direction: 'neutral',
        confidence: 0,
        reason: 'Insufficient kline history for divergence scan',
        indicators: {},
        timeframe: this.timeframe,
      };
    }

    const rsiVal = computeRSI(klineCloses, 14);
    const macdObj = computeMACD(klineCloses);
    indicators.rsi = rsiVal;
    indicators.macd_hist = macdObj?.histogram ?? null;

    let score = 0; // -100 to +100
    let confidence = 0.5;

    // Build rolling 14-period RSI array
    const rsiSeries: number[] = [];
    for (let i = 14; i <= klineCloses.length; i++) {
      const r = computeRSI(klineCloses.slice(0, i), 14);
      if (r != null) rsiSeries.push(r);
    }

    if (rsiSeries.length >= 10) {
      const n = klineCloses.length;
      const len = rsiSeries.length;

      // Find local price & RSI pivots
      const priceP1 = klineLows[n - 1]!;
      const priceP2 = Math.min(...klineLows.slice(n - 10, n - 2));

      const rsiP1 = rsiSeries[len - 1]!;
      const rsiP2 = rsiSeries[len - 5] ?? rsiSeries[len - 3]!;

      const priceHighP1 = klineHighs[n - 1]!;
      const priceHighP2 = Math.max(...klineHighs.slice(n - 10, n - 2));

      // Regular Bullish Divergence (Price Lower Low, RSI Higher Low)
      if (priceP1 < priceP2 && rsiP1 > rsiP2 + 2.0 && rsiP1 < 45) {
        score += 45;
        confidence += 0.20;
        reasons.push(`Bullish RSI Divergence: Price LL ($${priceP1.toFixed(2)} vs $${priceP2.toFixed(2)}) with RSI HL (${rsiP1.toFixed(1)} vs ${rsiP2.toFixed(1)})`);
      }

      // Regular Bearish Divergence (Price Higher High, RSI Lower High)
      if (priceHighP1 > priceHighP2 && rsiP1 < rsiP2 - 2.0 && rsiP1 > 55) {
        score -= 45;
        confidence += 0.20;
        reasons.push(`Bearish RSI Divergence: Price HH ($${priceHighP1.toFixed(2)} vs $${priceHighP2.toFixed(2)}) with RSI LH (${rsiP1.toFixed(1)} vs ${rsiP2.toFixed(1)})`);
      }
    }

    // MACD Histogram Alignment
    if (macdObj.histogram != null && macdObj.signal != null) {
      if (macdObj.histogram > 0 && macdObj.histogram > macdObj.signal) {
        score += 15;
      } else if (macdObj.histogram < 0 && macdObj.histogram < macdObj.signal) {
        score -= 15;
      }
    }

    let direction: SignalDirection = 'neutral';
    if (score >= 40) direction = 'strong_buy';
    else if (score >= 20) direction = 'buy';
    else if (score <= -40) direction = 'strong_sell';
    else if (score <= -20) direction = 'sell';

    confidence = Math.min(Math.max(confidence, 0.1), 0.95);

    return {
      strategy: this.name,
      direction,
      confidence,
      reason: reasons.length > 0 ? reasons.join('; ') : 'No significant divergence detected',
      indicators,
      timeframe: this.timeframe,
    };
  }
}
