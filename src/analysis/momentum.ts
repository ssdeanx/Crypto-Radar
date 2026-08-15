// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Momentum Strategy
// ═══════════════════════════════════════════════════════════════════════
//
// Detects strong trending moves by combining:
//   - Price change velocity (rate of change)
//   - Volume confirmation (volume rising with price)
//   - Volume profile (multi-period volume comparison)
//   - ADX filter (only signal in trending markets)
//   - Breakout detection (price breaking recent range with volume)
//   - RSI momentum (not overbought, but strong)
//   - MACD alignment (histogram direction)
//   - Breakout from Bollinger Bands

import type { SignalStrategy, StrategyContext, StrategySignal } from './strategies.js';
import { mean } from '../math/index.js';
import { computeADX } from '../indicators.js';
import { computeTrendRegression } from './trend-regression.js';

/**
 * Momentum strategy.
 *
 * Detects strong trending moves with volume confirmation,
 * MACD alignment, ADX trending filter, breakout detection,
 * and multi-period volume profile analysis.
 */
export class MomentumStrategy implements SignalStrategy {
  readonly name = 'momentum';
  readonly description = 'Detects strong trending moves with volume confirmation, MACD alignment, ADX filter, and volume profile';
  readonly timeframe = '1h';

  evaluate(ctx: StrategyContext): StrategySignal {
    const { ticker, technical, klineCloses, klineHighs, klineLows, klineVolumes } = ctx;
    let confidence = 0.5;
    const indicators: Record<string, number | null> = {};
    const reasons: string[] = [];

    // ── 0. ADX Filter — only signal in trending markets ──
    const adx = computeADX(klineHighs, klineLows, klineCloses, 14);
    indicators.adx = adx;

    if (adx != null) {
      if (adx > 25) {
        // Trending market — scale confidence proportionally to ADX strength
        // ADX 25→0.5 boost, 50→0.8, 75+→1.0
        const adxScale = Math.min((adx - 25) / 50, 1.0);
        const adxBonus = adxScale * 0.15;
        confidence += adxBonus;
        reasons.push(`ADX ${adx.toFixed(1)} — trending market (confidence × ${(1 + adxScale * 0.3).toFixed(2)})`);
      } else if (adx < 20) {
        // Choppy market — reduce confidence
        confidence -= 0.10;
        reasons.push(`ADX ${adx.toFixed(1)} — choppy market, reducing signal confidence`);
      } else {
        reasons.push(`ADX ${adx.toFixed(1)} — transitioning`);
      }
    }

    // ── 1. Price change velocity (rate of change over 24h) ──
    const roc = ticker.priceChangePercent;
    indicators.roc = roc;

    if (roc > 5) {
      confidence += 0.20;
      reasons.push(`strong upward momentum: ${roc.toFixed(2)}%`);
    } else if (roc > 2) {
      confidence += 0.10;
      reasons.push(`moderate momentum: ${roc.toFixed(2)}%`);
    } else if (roc < -5) {
      confidence += 0.20;
      reasons.push(`strong downward momentum: ${roc.toFixed(2)}%`);
    } else if (roc < -2) {
      confidence += 0.10;
      reasons.push(`moderate downside momentum: ${roc.toFixed(2)}%`);
    }

    // ── 2. Volume profile — multi-period volume comparison ──
    const currentVolume = klineVolumes[klineVolumes.length - 1] ?? 0;
    const avgVolume20 = klineVolumes.length >= 20
      ? mean(klineVolumes.slice(-20))
      : null;
    const avgVolume50 = klineVolumes.length >= 50
      ? mean(klineVolumes.slice(-50))
      : null;

    indicators.currentVolume = currentVolume;
    indicators.avgVolume20 = avgVolume20;
    indicators.avgVolume50 = avgVolume50;

    let volumeProfileConfirmed = false;

    if (avgVolume20 != null && avgVolume20 > 0 && currentVolume > avgVolume20) {
      const volRatio20 = currentVolume / avgVolume20;
      indicators.volumeRatio20 = volRatio20;
      if (volRatio20 > 1.5) {
        confidence += 0.08;
        reasons.push(`volume ${(volRatio20 * 100).toFixed(0)}% of 20-avg`);
      } else if (volRatio20 > 1.0) {
        confidence += 0.04;
      }
    }

    if (avgVolume50 != null && avgVolume50 > 0 && currentVolume > avgVolume50) {
      const volRatio50 = currentVolume / avgVolume50;
      indicators.volumeRatio50 = volRatio50;
      if (volRatio50 > 1.3) {
        confidence += 0.07;
        reasons.push(`volume ${(volRatio50 * 100).toFixed(0)}% of 50-avg`);
      } else if (volRatio50 > 1.0) {
        confidence += 0.03;
      }
    }

    // Strong confirmation when volume is above both averages simultaneously
    if (avgVolume20 != null && avgVolume50 != null && avgVolume20 > 0 && avgVolume50 > 0 && currentVolume > avgVolume20 && currentVolume > avgVolume50) {
      confidence += 0.05;
      volumeProfileConfirmed = true;
      reasons.push('volume above both 20 and 50 period averages');
    }

    // Volume trend (existing)
    if (technical?.volTrend != null && technical.volTrend > 0.3) {
      confidence += 0.08;
      reasons.push(`volume surging: ${(technical.volTrend * 100).toFixed(0)}% vs avg`);
    }
    indicators.volumeTrend = technical?.volTrend ?? null;

    // ── 3. Breakout detection — price breaking 20-period range ──
    if (klineHighs.length >= 20 && klineLows.length >= 20) {
      const periodHigh20 = Math.max(...klineHighs.slice(-20));
      const periodLow20 = Math.min(...klineLows.slice(-20));
      const currentPrice = klineCloses.length > 0
        ? klineCloses[klineCloses.length - 1]!
        : ticker.lastPrice;

      indicators.periodHigh20 = periodHigh20;
      indicators.periodLow20 = periodLow20;

      const isBreakoutUp = currentPrice > periodHigh20;
      const isBreakoutDown = currentPrice < periodLow20;
      const hasVolumeConfirmation = avgVolume20 != null && avgVolume20 > 0 && currentVolume > avgVolume20 * 1.2;

      if (isBreakoutUp && hasVolumeConfirmation) {
        confidence += 0.12;
        reasons.push(`bullish breakout above 20-period high (${currentPrice.toFixed(4)} > ${periodHigh20.toFixed(4)}, vol confirmed)`);
      } else if (isBreakoutDown && hasVolumeConfirmation) {
        confidence += 0.12;
        reasons.push(`bearish breakout below 20-period low (${currentPrice.toFixed(4)} < ${periodLow20.toFixed(4)}, vol confirmed)`);
      } else if (isBreakoutUp) {
        reasons.push('price broke above 20-period range but volume light');
      } else if (isBreakoutDown) {
        reasons.push('price broke below 20-period range but volume light');
      }
    }

    // ── 3b. Quote volume check (existing) ──
    if (ticker.quoteVolume > 50e6) {
      confidence += 0.10;
      reasons.push('very high quote volume');
    } else if (ticker.quoteVolume > 10e6) {
      confidence += 0.05;
    }

    // ── 4. RSI — strong but not exhausted ──
    if (technical?.rsi != null) {
      indicators.rsi = technical.rsi;
      if (roc > 0) {
        if (technical.rsi > 60 && technical.rsi < 75) {
          confidence += 0.08;
          reasons.push(`bullish RSI: ${technical.rsi.toFixed(1)}`);
        } else if (technical.rsi >= 75) {
          confidence -= 0.05;
          reasons.push('RSI overbought, potential exhaustion');
        }
      } else {
        if (technical.rsi < 40 && technical.rsi > 25) {
          confidence += 0.08;
          reasons.push(`bearish RSI: ${technical.rsi.toFixed(1)}`);
        } else if (technical.rsi <= 25) {
          confidence -= 0.05;
          reasons.push('RSI oversold, potential bounce');
        }
      }
    }

    // ── 5. MACD alignment ──
    if (technical?.macd != null && technical.macd.histogram != null) {
      const macdHist = technical.macd.histogram;
      indicators.macdHistogram = macdHist;
      if (macdHist > 0 && roc > 0) {
        confidence += 0.08;
        reasons.push('MACD positive and expanding');
      } else if (macdHist < 0 && roc < 0) {
        confidence += 0.08;
        reasons.push('MACD negative and declining');
      } else if (macdHist > 0 && roc < 0) {
        reasons.push('⚠️ bullish MACD divergence (price down, MACD up)');
        confidence += 0.05;
      } else if (macdHist < 0 && roc > 0) {
        reasons.push('⚠️ bearish MACD divergence (price up, MACD down)');
        confidence -= 0.05;
      }
    }

    // ── 6. BB breakout ──
    if (technical?.bb != null) {
      indicators.bbPosition = technical.bb.position;
      if (technical.bb.position > 0.95 && roc > 0) {
        confidence += 0.05;
        reasons.push('price at upper BB band');
      } else if (technical.bb.position < 0.05 && roc < 0) {
        confidence += 0.05;
        reasons.push('price at lower BB band');
      }
    }

    // ── 7. Trend regression — statistical trend consistency ──
    const trendReg = computeTrendRegression(klineCloses, 20);
    if (trendReg != null) {
      indicators.trendRegSlope = trendReg.slope;
      indicators.trendRegRSquared = trendReg.rSquared;
      indicators.trendRegProjection = trendReg.projection;

      const slopeDirection = trendReg.slope > 0 ? 'up' : trendReg.slope < 0 ? 'down' : 'flat';
      const momentumDirection = roc > 0 ? 'up' : roc < 0 ? 'down' : 'flat';

      if (trendReg.rSquared > 0.7 && slopeDirection === momentumDirection) {
        confidence += 0.05;
        reasons.push(`trend regression R²=${trendReg.rSquared.toFixed(2)} — consistent trend confirming momentum`);
      }

      if (trendReg.rSquared > 0.9) {
        confidence += 0.03;
        reasons.push(`trend regression R²=${trendReg.rSquared.toFixed(2)} — very consistent trend`);
      }

      if (trendReg.rSquared < 0.2) {
        confidence -= 0.03;
        reasons.push(`trend regression R²=${trendReg.rSquared.toFixed(2)} — trend too noisy to trust`);
      }
    }

    // ── Determine direction ──
    let direction: 'buy' | 'sell' | 'neutral' | 'strong_buy' | 'strong_sell';
    if (confidence >= 0.8) {
      direction = roc > 0 ? 'strong_buy' : 'strong_sell';
    } else if (confidence >= 0.6) {
      direction = roc > 0 ? 'buy' : 'sell';
    } else {
      direction = 'neutral';
    }

    confidence = Math.max(0, Math.min(1, confidence));

    indicators.volumeProfileConfirmed = volumeProfileConfirmed ? 1 : 0;

    return {
      strategy: this.name,
      direction,
      confidence: Math.round(confidence * 100) / 100,
      reason: reasons.join('; ') || 'no clear momentum signal',
      indicators,
      timeframe: this.timeframe,
    };
  }
}
