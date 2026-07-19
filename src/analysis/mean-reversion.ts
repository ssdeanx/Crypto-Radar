// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Mean Reversion Strategy
// ═══════════════════════════════════════════════════════════════════════
//
// Identifies overextended prices likely to revert:
//   - RSI extremes (>70 overbought, <30 oversold)
//   - RSI divergence (price vs RSI swing disagreement)
//   - Distance from moving averages (VWAP, EMA50)
//   - Bollinger Band squeeze + position
//   - Stochastic confirmation for overbought/oversold validation
//   - Volume exhaustion on extreme moves
//   - Low momentum + extreme positioning

import type { SignalStrategy, StrategyContext, StrategySignal } from './strategies.js';
import { rsiSeries } from '../indicators.js';
import { mean } from '../math/index.js';

/**
 * Mean Reversion strategy.
 *
 * Identifies overextended prices likely to revert to the mean
 * using RSI, Bollinger Bands, MA distance, stochastic confirmation,
 * RSI divergence, and volume exhaustion.
 */
export class MeanReversionStrategy implements SignalStrategy {
  readonly name = 'mean-reversion';
  readonly description = 'Identifies overextended prices likely to revert using RSI, BB, stochastic, divergence, and volume exhaustion';
  readonly timeframe = '1h';

  evaluate(ctx: StrategyContext): StrategySignal {
    const { ticker, technical, klineCloses, klineHighs, klineLows, klineVolumes } = ctx;
    let confidence = 0.3; // base — mean reversion is riskier
    const indicators: Record<string, number | null> = {};
    const reasons: string[] = [];

    // Count of confirmations for confidence weighting
    let confirmations = 0;
    const maxConfirmations = 5; // RSI + BB + Stochastic + Volume exhaustion + VWAP/MA

    // ── 1. RSI extremes ──
    if (technical?.rsi != null) {
      indicators.rsi = technical.rsi;
      if (technical.rsi > 75) {
        confidence += 0.25;
        confirmations++;
        reasons.push(`overbought (RSI ${technical.rsi.toFixed(1)}), expecting pullback`);
      } else if (technical.rsi > 70) {
        confidence += 0.15;
        confirmations++;
        reasons.push(`moderately overbought (RSI ${technical.rsi.toFixed(1)})`);
      } else if (technical.rsi < 25) {
        confidence += 0.25;
        confirmations++;
        reasons.push(`oversold (RSI ${technical.rsi.toFixed(1)}), expecting bounce`);
      } else if (technical.rsi < 30) {
        confidence += 0.15;
        confirmations++;
        reasons.push(`moderately oversold (RSI ${technical.rsi.toFixed(1)})`);
      }
    }

    // ── 2. RSI Divergence Detection ──
    // Bears divergence: price makes higher high, RSI makes lower high
    // Bullish divergence: price makes lower low, RSI makes higher low
    if (technical?.rsi != null && klineCloses.length >= 40) {
      const divResult = this.detectRSIDivergence(
        klineHighs, klineLows, klineCloses, 30,
      );
      indicators.rsiDivergence = divResult.divergence;

      if (divResult.type === 'bearish') {
        confidence += 0.20;
        confirmations++;
        reasons.push('🔻 bearish RSI divergence — price higher high, RSI lower high');
      } else if (divResult.type === 'bullish') {
        confidence += 0.20;
        confirmations++;
        reasons.push('🟢 bullish RSI divergence — price lower low, RSI higher low');
      }
      if (divResult.reason) reasons.push(divResult.reason);
    }

    // ── 3. Bollinger Band position — price near bands suggests reversion ──
    if (technical?.bb != null) {
      indicators.bbPosition = technical.bb.position;
      if (technical.bb.position > 0.95) {
        confidence += 0.15;
        confirmations++;
        reasons.push(`price at upper BB (position ${technical.bb.position.toFixed(2)})`);
      } else if (technical.bb.position < 0.05) {
        confidence += 0.15;
        confirmations++;
        reasons.push(`price at lower BB (position ${technical.bb.position.toFixed(2)})`);
      }

      // BB squeeze — narrow bands often precede explosive moves
      if (technical.bb.width < 0.05) {
        confidence += 0.10;
        reasons.push(`BB squeeze (width ${technical.bb.width.toFixed(4)})`);
      }
      indicators.bbWidth = technical.bb.width;
    }

    // ── 4. Stochastic confirmation ──
    if (technical?.stochastic != null) {
      const stoch = technical.stochastic;
      indicators.stochasticK = stoch.k;
      indicators.stochasticD = stoch.d;

      if (stoch.k != null && stoch.d != null) {
        const isOverbought = (technical?.rsi != null && technical.rsi > 70) ||
          (technical?.bb != null && technical.bb.position > 0.9);
        const isOversold = (technical?.rsi != null && technical.rsi < 30) ||
          (technical?.bb != null && technical.bb.position < 0.1);

        // Stochastic overbought (>80) strengthens sell signal
        if (isOverbought && stoch.k > 80 && stoch.d > 80) {
          confidence += 0.10;
          confirmations++;
          reasons.push(`stochastic overbought (K=${stoch.k.toFixed(0)}, D=${stoch.d.toFixed(0)})`);
        }
        // Stochastic oversold (<20) strengthens buy signal
        if (isOversold && stoch.k < 20 && stoch.d < 20) {
          confidence += 0.10;
          confirmations++;
          reasons.push(`stochastic oversold (K=${stoch.k.toFixed(0)}, D=${stoch.d.toFixed(0)})`);
        }
        // %K cross above %D in oversold = bullish reversal signal
        if (isOversold && stoch.k != null && stoch.d != null && stoch.k > stoch.d) {
          confidence += 0.05;
          reasons.push(`stochastic bullish cross (K=${stoch.k.toFixed(0)} > D=${stoch.d.toFixed(0)})`);
        }
        // %K cross below %D in overbought = bearish reversal signal
        if (isOverbought && stoch.k != null && stoch.d != null && stoch.k < stoch.d) {
          confidence += 0.05;
          reasons.push(`stochastic bearish cross (K=${stoch.k.toFixed(0)} < D=${stoch.d.toFixed(0)})`);
        }
      }
    }

    // ── 5. Volume exhaustion on extreme moves ──
    const currentVolume = klineVolumes.length > 0 ? klineVolumes[klineVolumes.length - 1]! : 0;
    const avgVolume20 = klineVolumes.length >= 20
      ? mean(klineVolumes.slice(-20))
      : null;

    const isAtBBExtreme = technical?.bb != null && (
      technical.bb.position > 0.95 || technical.bb.position < 0.05
    );

    if (avgVolume20 != null && currentVolume < avgVolume20 && isAtBBExtreme) {
      // Decreasing volume on extreme BB move = exhaustion
      const volRatio = currentVolume / avgVolume20;
      indicators.volumeExhaustion = volRatio;
      if (volRatio < 0.7) {
        confidence += 0.15;
        confirmations++;
        reasons.push(`volume exhaustion at BB extreme (${(volRatio * 100).toFixed(0)}% of avg)`);
      } else if (volRatio < 0.9) {
        confidence += 0.08;
        confirmations++;
        reasons.push(`volume declining at BB extreme (${(volRatio * 100).toFixed(0)}% of avg)`);
      }
    }

    // ── 6. Distance from VWAP ──
    if (Math.abs(ticker.vwapDistPct) > 3) {
      confidence += 0.10;
      confirmations++;
      reasons.push(`${ticker.vwapDistPct > 0 ? 'above' : 'below'} VWAP by ${Math.abs(ticker.vwapDistPct).toFixed(1)}%`);
    }
    indicators.vwapDistance = ticker.vwapDistPct;

    // ── 7. Price vs EMA50 ──
    if (technical?.priceVsEma50 != null) {
      indicators.priceVsEma50 = technical.priceVsEma50;
      if (Math.abs(technical.priceVsEma50) > 5) {
        confidence += 0.10;
        confirmations++;
        reasons.push(`price ${technical.priceVsEma50 > 0 ? 'above' : 'below'} EMA50 by ${Math.abs(technical.priceVsEma50).toFixed(1)}%`);
      }
    }

    // ── 8. Low momentum + extreme position = strong reversion signal ──
    if (Math.abs(ticker.momentum) < 2 && confidence > 0.5) {
      confidence += 0.10;
      reasons.push('low momentum amplifies reversion probability');
    }

    // ── Additional confidence scaling based on confirmation count ──
    // When 4+ of 5 confirmations fire, add bonus
    if (confirmations >= 4) {
      confidence += 0.08;
      reasons.push(`${confirmations}/${maxConfirmations} confirmations active`);
    } else if (confirmations >= 3) {
      confidence += 0.04;
      reasons.push(`${confirmations}/${maxConfirmations} confirmations active`);
    }

    // ── Direction: mean reversion bets AGAINST the current move ──
    let direction: 'buy' | 'sell' | 'neutral' | 'strong_buy' | 'strong_sell';
    const isOverbought =
      (technical?.rsi != null && technical.rsi > 70) ||
      (technical?.bb != null && technical.bb.position > 0.9);

    const isOversold =
      (technical?.rsi != null && technical.rsi < 30) ||
      (technical?.bb != null && technical.bb.position < 0.1);

    if (isOverbought && confidence >= 0.7) {
      direction = 'sell'; // price high, expect reversion down
    } else if (isOversold && confidence >= 0.7) {
      direction = 'buy';  // price low, expect reversion up
    } else if (isOverbought) {
      direction = 'neutral';
    } else if (isOversold) {
      direction = 'neutral';
    } else {
      direction = 'neutral';
    }

    confidence = Math.max(0, Math.min(1, confidence));

    return {
      strategy: this.name,
      direction,
      confidence: Math.round(confidence * 100) / 100,
      reason: reasons.join('; ') || 'no clear reversion signal',
      indicators,
      timeframe: this.timeframe,
    };
  }

  /**
   * Detect RSI divergence between price and RSI over a lookback window.
   *
   * Bearish divergence: price makes a higher high while RSI makes a lower high.
   * Bullish divergence: price makes a lower low while RSI makes a higher low.
   *
   * Uses a swing-point detection approach looking at local maxima/minima.
   */
  private detectRSIDivergence(
    highs: number[],
    lows: number[],
    closes: number[],
    lookback = 30,
  ): { divergence: number; type: 'bullish' | 'bearish' | 'none'; reason: string } {
    const startIdx = Math.max(0, closes.length - lookback);
    const windowCloses = closes.slice(startIdx);
    const windowHighs = highs.slice(startIdx);
    const windowLows = lows.slice(startIdx);

    if (windowCloses.length < 20) {
      return { divergence: 0, type: 'none', reason: '' };
    }

    // Compute RSI values for the window
    const rsiVals = rsiSeries(windowCloses, 14);

    // Find swing highs (local maxima in price) — require 2 bars on each side
    const swingHighs: Array<{ priceIdx: number; price: number; rsi: number | null }> = [];
    const swingLows: Array<{ priceIdx: number; price: number; rsi: number | null }> = [];

    for (let i = 2; i < windowHighs.length - 2; i++) {
      const h = windowHighs[i]!;
      // Swing high: higher than 2 neighbors on each side
      if (
        h > (windowHighs[i - 1] ?? 0) && h > (windowHighs[i - 2] ?? 0) &&
        h > (windowHighs[i + 1] ?? 0) && h >= (windowHighs[i + 2] ?? 0)
      ) {
        swingHighs.push({
          priceIdx: i,
          price: h,
          rsi: rsiVals[i] ?? null,
        });
      }

      const l = windowLows[i]!;
      // Swing low: lower than 2 neighbors on each side
      if (
        l < (windowLows[i - 1] ?? Infinity) && l < (windowLows[i - 2] ?? Infinity) &&
        l < (windowLows[i + 1] ?? Infinity) && l <= (windowLows[i + 2] ?? Infinity)
      ) {
        swingLows.push({
          priceIdx: i,
          price: l,
          rsi: rsiVals[i] ?? null,
        });
      }
    }

    // Need at least 2 swing points for divergence detection
    // Bearish divergence: price higher high but RSI lower high
    if (swingHighs.length >= 2) {
      const last = swingHighs[swingHighs.length - 1]!;
      const prev = swingHighs[swingHighs.length - 2]!;
      if (
        last.price > prev.price &&
        last.rsi != null && prev.rsi != null &&
        last.rsi < prev.rsi
      ) {
        // Bearish divergence confirmed
        const rsiDrop = prev.rsi - last.rsi;
        const divStrength = rsiDrop / prev.rsi;
        return {
          divergence: divStrength,
          type: 'bearish',
          reason: `price higher high (${last.price.toFixed(4)} > ${prev.price.toFixed(4)}) but RSI lower (${last.rsi.toFixed(1)} < ${prev.rsi.toFixed(1)})`,
        };
      }
    }

    // Bullish divergence: price lower low but RSI higher low
    if (swingLows.length >= 2) {
      const last = swingLows[swingLows.length - 1]!;
      const prev = swingLows[swingLows.length - 2]!;
      if (
        last.price < prev.price &&
        last.rsi != null && prev.rsi != null &&
        last.rsi > prev.rsi
      ) {
        // Bullish divergence confirmed
        const rsiRise = last.rsi - prev.rsi;
        const divStrength = rsiRise / (100 - prev.rsi);
        return {
          divergence: divStrength,
          type: 'bullish',
          reason: `price lower low (${last.price.toFixed(4)} < ${prev.price.toFixed(4)}) but RSI higher (${last.rsi.toFixed(1)} > ${prev.rsi.toFixed(1)})`,
        };
      }
    }

    return { divergence: 0, type: 'none', reason: '' };
  }
}
