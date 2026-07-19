// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Trend Following Strategy
// ═══════════════════════════════════════════════════════════════════════
//
// Identifies established trends using:
//   - EMA alignment (short > mid > long = uptrend)
//   - EMA slope (direction and steepness of EMA20)
//   - Price above/below key MAs
//   - Ichimoku Cloud confirmation (price vs cloud, cloud twist)
//   - Chandelier Exit (ATR-based trailing stop)
//   - ADX-style trend strength (via ATR comparison)
//   - Higher highs / lower lows pattern detection
//   - Volume supporting the trend

import type { SignalStrategy, StrategyContext, StrategySignal } from './strategies.js';
import { mean } from '../math/index.js';
import { ema, emaSeries } from '../indicators.js';
import { computeTrendRegression } from './trend-regression.js';

/**
 * Trend Following strategy.
 *
 * Identifies established trends using EMA alignment, price vs MA,
 * volume confirmation, EMA slope, Ichimoku cloud confirmation,
 * and Chandelier Exit trailing stops.
 */
export class TrendFollowingStrategy implements SignalStrategy {
  readonly name = 'trend-following';
  readonly description = 'Identifies established trends using EMA alignment, Ichimoku, Chandelier Exit, and volume confirmation';
  readonly timeframe = '1h';

  evaluate(ctx: StrategyContext): StrategySignal {
    const { ticker, technical, klineCloses, klineHighs, klineLows, klineVolumes } = ctx;
    let confidence = 0.3;
    const indicators: Record<string, number | null> = {};
    const reasons: string[] = [];

    const currentPrice = klineCloses.length > 0
      ? klineCloses[klineCloses.length - 1]!
      : ticker.lastPrice;
    indicators.currentPrice = currentPrice;

    // ── 1. EMA alignment (trend direction) ──
    const ema20 = ema(klineCloses, 20);
    const ema50 = ema(klineCloses, 50);
    const ema200 = ema(klineCloses, 200);
    indicators.ema20 = ema20;
    indicators.ema50 = ema50;
    indicators.ema200 = ema200;

    let trendDirection: 'up' | 'down' | 'sideways' = 'sideways';
    let trendStrength = 0;

    if (ema20 != null && ema50 != null) {
      // Uptrend: short > mid, price above both
      if (ema20 > ema50 && currentPrice > ema20) {
        trendDirection = 'up';
        trendStrength += 1;
        confidence += 0.10;
        reasons.push('EMA20 above EMA50 — bullish alignment');
      }
      // Downtrend: short < mid, price below both
      else if (ema20 < ema50 && currentPrice < ema20) {
        trendDirection = 'down';
        trendStrength += 1;
        confidence += 0.10;
        reasons.push('EMA20 below EMA50 — bearish alignment');
      } else {
        reasons.push('EMAs mixed — no clear trend');
      }
    }

    // 3-way alignment with EMA200
    if (ema200 != null && ema20 != null && ema50 != null) {
      if (ema20 > ema50 && ema50 > ema200) {
        trendStrength += 2;
        confidence += 0.15;
        reasons.push('full bullish alignment: EMA20 > EMA50 > EMA200');
      } else if (ema20 < ema50 && ema50 < ema200) {
        trendStrength += 2;
        confidence += 0.15;
        reasons.push('full bearish alignment: EMA20 < EMA50 < EMA200');
      }
    }

    // ── 2. EMA Slope — direction and steepness of EMA20 over last 3 periods ──
    if (klineCloses.length >= 23) {
      const ema20Series = emaSeries(klineCloses, 20);
      const lastIdx = ema20Series.length - 1;
      const ema3ago = ema20Series[lastIdx - 2];
      const ema2ago = ema20Series[lastIdx - 1];
      const emaNow = ema20Series[lastIdx];

      if (ema3ago != null && emaNow != null) {
        // Slope over 3 periods (points per period)
        const emaSlope = (emaNow - ema3ago) / 3;
        const emaSlopePct = ema3ago > 0 ? (emaNow - ema3ago) / ema3ago * 100 : 0;
        indicators.emaSlope = emaSlope;
        indicators.emaSlopePct = emaSlopePct;

        // Normalize slope relative to price for a comparable measure
        const normSlope = currentPrice > 0 ? emaSlope / currentPrice * 100 : 0;
        indicators.emaSlopeNorm = normSlope;

        if (trendDirection === 'up' && normSlope > 0.05) {
          trendStrength += 1;
          confidence += 0.08;
          reasons.push(`EMA20 slope positive (${normSlope.toFixed(4)}%/bar), uptrend accelerating`);
        } else if (trendDirection === 'up' && normSlope > 0) {
          confidence += 0.04;
          reasons.push('EMA20 slope slightly positive');
        } else if (trendDirection === 'down' && normSlope < -0.05) {
          trendStrength += 1;
          confidence += 0.08;
          reasons.push(`EMA20 slope negative (${Math.abs(normSlope).toFixed(4)}%/bar), downtrend accelerating`);
        } else if (trendDirection === 'down' && normSlope < 0) {
          confidence += 0.04;
          reasons.push('EMA20 slope slightly negative');
        }

        // Flat EMA slope when trend is sideways
        if (trendDirection !== 'sideways' && Math.abs(normSlope) < 0.01 && ema20 != null && ema50 != null) {
          reasons.push('EMA20 nearly flat — trend may be stalling');
        }
      }

      // Also include the last 3 EMA values for reference
      indicators.ema20_t1 = ema3ago ?? null;
      indicators.ema20_t2 = ema2ago ?? null;
    }

    // ── 3. Price position relative to EMAs ──
    if (ema50 != null) {
      const distFromEma50 = ((currentPrice - ema50) / ema50) * 100;
      indicators.priceVsEma50 = distFromEma50;

      if (distFromEma50 > 2 && trendDirection === 'up') {
        confidence += 0.08;
        reasons.push(`price ${distFromEma50.toFixed(1)}% above EMA50, trend strong`);
      } else if (distFromEma50 < -2 && trendDirection === 'down') {
        confidence += 0.08;
        reasons.push(`price ${Math.abs(distFromEma50).toFixed(1)}% below EMA50, trend strong`);
      } else if (Math.abs(distFromEma50) < 1) {
        reasons.push('price near EMA50 — potential trend consolidation');
      }
    }

    // ── 4. Ichimoku Cloud Confirmation ──
    if (technical?.ichimoku != null) {
      const ichi = technical.ichimoku;
      indicators.ichimokuSpanA = ichi.spanA;
      indicators.ichimokuSpanB = ichi.spanB;
      indicators.ichimokuConversion = ichi.conversionLine;
      indicators.ichimokuBase = ichi.baseLine;

      if (ichi.spanA != null && ichi.spanB != null) {
        const cloudTop = Math.max(ichi.spanA, ichi.spanB);
        const cloudBottom = Math.min(ichi.spanA, ichi.spanB);

        // Price above cloud = bullish
        if (currentPrice > cloudTop) {
          trendStrength += 1;
          confidence += 0.12;
          reasons.push(`Ichimoku: price above cloud (top=$${cloudTop.toFixed(4)}), bullish`);
        }
        // Price below cloud = bearish
        else if (currentPrice < cloudBottom) {
          trendStrength += 1;
          confidence += 0.12;
          reasons.push(`Ichimoku: price below cloud (bottom=$${cloudBottom.toFixed(4)}), bearish`);
        }
        // Price inside cloud = indecision
        else {
          reasons.push('Ichimoku: price inside cloud — trend not confirmed');
          // Slight confidence reduction for being in the cloud
          confidence -= 0.03;
        }

        // Cloud twist (SpanA crosses SpanB) = trend change signal
        // We approximate by checking if A and B are close (crossing/thin cloud)
        const cloudThickness = cloudTop - cloudBottom;
        const cloudTwistThreshold = cloudTop * 0.005; // 0.5% of price
        if (cloudThickness < cloudTwistThreshold) {
          confidence += 0.05;
          reasons.push('Ichimoku cloud twist (thin cloud) — potential trend change');
        }

        // TK cross (price crosses conversion line)
        if (ichi.conversionLine != null) {
          if (currentPrice > ichi.conversionLine && ema20 != null && currentPrice > ema20) {
            confidence += 0.03;
            reasons.push('Ichimoku: price above Tenkan-sen');
          } else if (currentPrice < ichi.conversionLine && ema20 != null && currentPrice < ema20) {
            confidence += 0.03;
            reasons.push('Ichimoku: price below Tenkan-sen');
          }
        }
      }
    }

    // ── 5. Chandelier Exit — ATR-based trailing stop ──
    if (klineHighs.length >= 23 && klineLows.length >= 23 && klineCloses.length >= 23) {
      const chandelierPeriod = 22;
      const chandelierMultiplier = 3;

      const periodHigh = Math.max(...klineHighs.slice(-chandelierPeriod));
      const periodLow = Math.min(...klineLows.slice(-chandelierPeriod));

      // Compute absolute ATR(22) — not percentage
      const atrAbs = this.computeATRAbsolute(klineHighs, klineLows, klineCloses, chandelierPeriod);

      indicators.chandelierPeriodHigh = periodHigh;
      indicators.chandelierPeriodLow = periodLow;
      indicators.chandelierATR = atrAbs;

      if (atrAbs != null) {
        // Long exit = 22-period high - 3 × ATR
        const longStop = periodHigh - chandelierMultiplier * atrAbs;
        // Short exit = 22-period low + 3 × ATR
        const shortStop = periodLow + chandelierMultiplier * atrAbs;

        indicators.chandelierLongStop = longStop;
        indicators.chandelierShortStop = shortStop;

        if (currentPrice > longStop && trendDirection === 'up') {
          trendStrength += 1;
          confidence += 0.08;
          reasons.push(`Chandelier: price above long exit ($${longStop.toFixed(4)}), uptrend intact`);
        } else if (currentPrice < shortStop && trendDirection === 'down') {
          trendStrength += 1;
          confidence += 0.08;
          reasons.push(`Chandelier: price below short exit ($${shortStop.toFixed(4)}), downtrend intact`);
        } else if (currentPrice < longStop && trendDirection === 'up') {
          reasons.push(`Chandelier: price below long stop ($${longStop.toFixed(4)}) — trend weakening`);
          confidence -= 0.04;
        } else if (currentPrice > shortStop && trendDirection === 'down') {
          reasons.push(`Chandelier: price above short stop ($${shortStop.toFixed(4)}) — trend weakening`);
          confidence -= 0.04;
        }

        // Chandelier position (0 = at short stop, 1 = at long stop)
        const chandelierRange = longStop - shortStop;
        if (chandelierRange > 0) {
          const chandelierPosition = (currentPrice - shortStop) / chandelierRange;
          indicators.chandelierPosition = chandelierPosition;
        }
      }
    }

    // ── 6. Volume confirmation ──
    if (technical?.volTrend != null) {
      indicators.volumeTrend = technical.volTrend;
      // Volume rising with price = trend confirmation
      if (technical.volTrend > 0.2 && Math.abs(ticker.priceChangePercent) > 2) {
        confidence += 0.08;
        reasons.push('volume confirms trend direction');
      }
    }

    // Additional volume strength check using klineVolumes
    const currentVolume = klineVolumes.length > 0 ? klineVolumes[klineVolumes.length - 1]! : 0;
    const avgVolume20 = klineVolumes.length >= 20
      ? mean(klineVolumes.slice(-20))
      : null;
    if (avgVolume20 != null && currentVolume > avgVolume20 * 1.3 && trendStrength >= 2) {
      confidence += 0.05;
      reasons.push('elevated volume supports trend');
    }

    // ── 7. ATR-based trend strength (higher vol = stronger trend) ──
    if (technical?.atrPct != null) {
      indicators.atrPercent = technical.atrPct;
      if (technical.atrPct > 3) {
        confidence += 0.05;
        reasons.push(`high volatility (ATR ${technical.atrPct.toFixed(1)}%)`);
      }
    }

    // ── 8. Trend regression — statistical trend consistency ──
    const trendReg = computeTrendRegression(klineCloses, 50);
    if (trendReg != null) {
      indicators.trendRegSlope = trendReg.slope;
      indicators.trendRegRSquared = trendReg.rSquared;
      indicators.trendRegProjection = trendReg.projection;

      // Use slope sign to confirm trend direction
      if (trendReg.slope > 0 && trendDirection === 'up') {
        reasons.push(`trend regression slope positive (${trendReg.slope.toFixed(6)}) — confirms uptrend`);
      } else if (trendReg.slope < 0 && trendDirection === 'down') {
        reasons.push(`trend regression slope negative (${trendReg.slope.toFixed(6)}) — confirms downtrend`);
      }

      if (trendReg.rSquared > 0.7) {
        confidence += 0.05;
        reasons.push(`strong trend consistency (R²=${trendReg.rSquared.toFixed(2)})`);
      } else if (trendReg.rSquared < 0.3) {
        confidence -= 0.05;
        reasons.push(`weak trend consistency (R²=${trendReg.rSquared.toFixed(2)})`);
      }

      const slopeStrengthPct = currentPrice > 0
        ? Math.abs(trendReg.slope) / currentPrice * 100
        : 0;
      indicators.trendRegSlopeStrengthPct = slopeStrengthPct;

      if (slopeStrengthPct > 0.5) {
        confidence += 0.03;
        reasons.push(`steep trend slope (${slopeStrengthPct.toFixed(2)}% per period)`);
      }
    }

    // ── 9. 24h price change in trend direction ──
    if (trendDirection === 'up' && ticker.priceChangePercent > 0) {
      confidence += 0.05;
    } else if (trendDirection === 'down' && ticker.priceChangePercent < 0) {
      confidence += 0.05;
    }

    // ── Determine signal ──
    const isStrongTrend = trendStrength >= 4;
    let direction: 'buy' | 'sell' | 'neutral' | 'strong_buy' | 'strong_sell';

    if (trendDirection === 'up' && isStrongTrend && confidence >= 0.7) {
      direction = 'strong_buy';
    } else if (trendDirection === 'up' && confidence >= 0.5) {
      direction = 'buy';
    } else if (trendDirection === 'down' && isStrongTrend && confidence >= 0.7) {
      direction = 'strong_sell';
    } else if (trendDirection === 'down' && confidence >= 0.5) {
      direction = 'sell';
    } else {
      direction = 'neutral';
    }

    confidence = Math.max(0, Math.min(1, confidence));

    return {
      strategy: this.name,
      direction,
      confidence: Math.round(confidence * 100) / 100,
      reason: reasons.join('; ') || 'no clear trend detected',
      indicators,
      timeframe: this.timeframe,
    };
  }

  /**
   * Compute absolute ATR (not percentage) for Chandelier Exit calculation.
   */
  private computeATRAbsolute(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number,
  ): number | null {
    if (!closes || closes.length < period + 1) return null;

    const trueRanges: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      trueRanges.push(Math.max(
        highs[i]! - lows[i]!,
        Math.abs(highs[i]! - closes[i - 1]!),
        Math.abs(lows[i]! - closes[i - 1]!),
      ));
    }

    if (trueRanges.length < period) return null;

    // SMA for first period
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    // Wilder smooth for the rest
    for (let i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]!) / period;
    }
    return atr;
  }
}
