import type { SignalStrategy, StrategyContext, AggregatedSignal, StrategyWeight, StrategySignal } from './strategies.js';
import type { TechnicalIndicators } from '../types.js';
import type { RadarConfig } from '../core/config.js';
import { getRegimeWeights } from './regime.js';
import type { MarketRegime } from './regime.js';
import { MomentumStrategy } from './momentum.js';
import { MeanReversionStrategy } from './mean-reversion.js';
import { TrendFollowingStrategy } from './trend-following.js';
import { DivergenceStrategy } from './divergence.js';
import { scanPatterns } from './patterns.js';
import { findSupportResistance } from './support-resistance.js';
import { computeVolumeProfile } from './volume-profile.js';
import type { Kline } from '../types.js';
import { logger } from '../core/logger.js';

const DEFAULT_STRATEGIES: SignalStrategy[] = [
  new MomentumStrategy(),
  new MeanReversionStrategy(),
  new TrendFollowingStrategy(),
  new DivergenceStrategy(),
];

const DEFAULT_WEIGHTS: StrategyWeight[] = [
  { name: 'momentum', weight: 0.35 },
  { name: 'mean-reversion', weight: 0.20 },
  { name: 'trend-following', weight: 0.30 },
  { name: 'divergence', weight: 0.15 },
];

/** Default timeframe weights — exported so consumers can inspect/merge */
export const TF_WEIGHTS: Record<string, number> = {
  '15m': 0.10,
  '1h':  0.25,
  '4h':  0.30,
  '1d':  0.35,
};

/**
 * Strategy engine that aggregates signals from multiple strategies
 * into a single composite signal per token.
 *
 * Supports single-timeframe and multi-timeframe evaluation.
 */
export class StrategyEngine {
  private strategies: SignalStrategy[];
  private weights: Map<string, number>;
  private tfWeights: Record<string, number>;

  constructor(
    strategies: SignalStrategy[] = DEFAULT_STRATEGIES,
    weights: StrategyWeight[] = DEFAULT_WEIGHTS,
    tfWeights?: Record<string, number>,
  ) {
    this.strategies = strategies;
    this.weights = new Map(weights.map(w => [w.name, w.weight]));
    this.tfWeights = tfWeights ?? TF_WEIGHTS;
  }

  /**
   * Create a StrategyEngine from a RadarConfig, merging config
   * overrides with default strategy weights and timeframe weights.
   * Config values take precedence over defaults.
   */
  static fromConfig(config: RadarConfig): StrategyEngine {
    let weights: StrategyWeight[] = DEFAULT_WEIGHTS;
    if (config.strategyWeights) {
      // Merge: defaults first, config overrides on top
      const merged = new Map(DEFAULT_WEIGHTS.map(w => [w.name, w.weight]));
      for (const [name, weight] of Object.entries(config.strategyWeights)) {
        merged.set(name, weight);
      }
      weights = Array.from(merged.entries()).map(([name, weight]) => ({ name, weight }));
    }
    const tfWeights = config.timeframeWeights
      ? { ...TF_WEIGHTS, ...config.timeframeWeights }
      : TF_WEIGHTS;
    return new StrategyEngine(DEFAULT_STRATEGIES, weights, tfWeights);
  }

  /**
   * Evaluate all strategies for the given context.
   * Returns an aggregated signal across all strategies.
   *
   * @param ctx Strategy context with ticker, technicals, news, and kline data
   * @returns AggregatedSignal with direction, confidence, and alerts
   */
  async evaluate(ctx: StrategyContext): Promise<AggregatedSignal> {
    // Edge case: no kline data → neutral
    if (!ctx.klineCloses || ctx.klineCloses.length === 0) {
      return {
        symbol: ctx.ticker.symbol, tokenName: ctx.ticker.tokenName, chain: ctx.ticker.chain,
        lastPrice: ctx.ticker.lastPrice, priceChangePercent: ctx.ticker.priceChangePercent,
        direction: 'neutral', compositeConfidence: 0,
        signals: [], alerts: [], timestamp: ctx.ticker.tsUtc,
        compositeReason: 'No kline data available',
      };
    }
    // Evaluate all strategies in parallel — each is independent
    const signalPromises = this.strategies.map(s =>
      Promise.resolve().then(() => {
        try { return s.evaluate(ctx); }
        catch (err) {
          logger.error(`Strategy "${s.name}" failed`, {
            symbol: ctx.ticker.symbol,
            error: err instanceof Error ? err.message : String(err),
          });
          return { strategy: s.name, direction: 'neutral' as const, confidence: 0, reason: `Error: ${err}`, indicators: {}, timeframe: s.timeframe };
        }
      }),
    );
    const signals = await Promise.all(signalPromises);
    if (ctx.technicalsByInterval && ctx.technicalsByInterval.size > 1) {
      return this.aggregateMultiTF(signals, ctx, ctx.technicalsByInterval);
    }
    return this.aggregate(signals, ctx);
  }

  /**
   * Get regime-adjusted strategy weights.
   * Trending → more momentum + trend-following
   * Ranging → more mean-reversion
   * Volatile → reduce all
   */
  getAdjustedWeights(regime?: MarketRegime): Map<string, number> {
    if (!regime) return this.weights;
    const adj = getRegimeWeights(regime);
    const adjusted = new Map(this.weights);
    adjusted.set('momentum', adj.momentum);
    adjusted.set('mean-reversion', adj.meanReversion);
    adjusted.set('trend-following', adj.trendFollowing);
    return adjusted;
  }

  private async aggregateMultiTF(
    _baseSignals: ReturnType<SignalStrategy['evaluate']>[],
    ctx: StrategyContext,
    techByInterval: Map<string, TechnicalIndicators>,
  ): Promise<AggregatedSignal> {
    // Redistribute TF weights if fewer intervals than expected
    const expectedIntervals = Object.keys(this.tfWeights);
    const effectiveTfWeights: Record<string, number> = { ...this.tfWeights };
    if (techByInterval.size < expectedIntervals.length) {
      const evenWeight = 1 / techByInterval.size;
      for (const interval of techByInterval.keys()) {
        effectiveTfWeights[interval] = evenWeight;
      }
    }

    const tfResults = await Promise.all(
      Array.from(techByInterval.entries()).map(async ([interval, tech]) => {
        const tfCtx: StrategyContext = { ...ctx, technical: tech };
        const tfSignals = this.strategies.map(s => {
          try {
            const sig = s.evaluate(tfCtx);
            return { ...sig, timeframe: interval };
          } catch (err) {
            logger.error(`Strategy "${s.name}" failed on interval ${interval}`, {
              symbol: ctx.ticker.symbol, error: err instanceof Error ? err.message : String(err),
            });
            return { strategy: s.name, direction: 'neutral' as const, confidence: 0, reason: `Error: ${err}`, indicators: {}, timeframe: interval };
          }
        });

        const buySum = tfSignals.reduce((a, s) => a + (s.direction === 'buy' || s.direction === 'strong_buy' ? s.confidence : 0), 0);
        const sellSum = tfSignals.reduce((a, s) => a + (s.direction === 'sell' || s.direction === 'strong_sell' ? s.confidence : 0), 0);
        const reason = buySum > sellSum ? `${interval}: bullish (${(buySum * 100).toFixed(0)}%)`
          : sellSum > buySum ? `${interval}: bearish (${(sellSum * 100).toFixed(0)}%)`
          : `${interval}: neutral`;

        return { signals: tfSignals, reason };
      })
    );

    const allSignals: StrategySignal[] = [];
    const tfReasons: string[] = [];
    for (const res of tfResults) {
      allSignals.push(...res.signals);
      tfReasons.push(res.reason);
    }

    const totalWeight = Array.from(this.weights.values()).reduce((a, b) => a + b, 0) || 1;
    let weightedConfidence = 0;
    const dirVotes: Record<string, number> = { buy: 0, sell: 0, neutral: 0, strong_buy: 0, strong_sell: 0 };
    for (const signal of allSignals) {
      const strategyWeight = this.weights.get(signal.strategy) ?? (1 / this.strategies.length);
      const tfWeight = effectiveTfWeights[signal.timeframe] ?? (1 / expectedIntervals.length);
      const compositeWeight = (strategyWeight / totalWeight) * tfWeight;
      weightedConfidence += signal.confidence * compositeWeight;
      const voteWeight = signal.confidence * compositeWeight;
      dirVotes[signal.direction] = (dirVotes[signal.direction] ?? 0) + voteWeight;
      if (signal.direction === 'strong_buy') dirVotes['buy'] = (dirVotes['buy'] ?? 0) + voteWeight;
      if (signal.direction === 'strong_sell') dirVotes['sell'] = (dirVotes['sell'] ?? 0) + voteWeight;
    }

    // Edge case: all strategies returned neutral across all timeframes
    const allNeutral = allSignals.every(s => s.direction === 'neutral');
    if (allNeutral) {
      weightedConfidence = 0;
    }

    let direction: 'buy' | 'sell' | 'neutral' | 'strong_buy' | 'strong_sell';
    const buyVotes = (dirVotes['buy'] ?? 0) + (dirVotes['strong_buy'] ?? 0);
    const sellVotes = (dirVotes['sell'] ?? 0) + (dirVotes['strong_sell'] ?? 0);
    if (allNeutral) direction = 'neutral';
    else if (buyVotes > sellVotes && buyVotes > 0.3) direction = buyVotes > 0.5 ? 'strong_buy' : 'buy';
    else if (sellVotes > buyVotes && sellVotes > 0.3) direction = sellVotes > 0.5 ? 'strong_sell' : 'sell';
    else direction = 'neutral';

    // Agreement score: how much strategies agree on direction (0-1)
    const totalVotes = buyVotes + sellVotes + (dirVotes['neutral'] ?? 0);
    const agreement_score = totalVotes > 0
      ? Math.max(buyVotes, sellVotes, dirVotes['neutral'] ?? 0) / totalVotes
      : 0;

    // 95% confidence interval
    const confidenceHalfWidth = (1 - agreement_score) * 0.2;
    const confidenceRange = {
      low: Math.round(Math.max(0, weightedConfidence - confidenceHalfWidth) * 100) / 100,
      high: Math.round(Math.min(1, weightedConfidence + confidenceHalfWidth) * 100) / 100,
    };

    // Position size: confidence adjusted by volatility (high volatility = smaller position)
    const atrPct = ctx.technical?.atrPct ?? 0;
    const volatilityFactor = Math.min(atrPct / 100, 0.5);
    const positionSize = Math.round(weightedConfidence * (1 - volatilityFactor) * 100) / 100;

    const alerts: string[] = [];
    if (ctx.ticker.priceChangePercent <= -5) alerts.push('\u{1F534} DIP (>5% drop)');
    if (ctx.ticker.priceChangePercent >= 5) alerts.push('\u{1F7E2} PUMP (>5% gain)');
    if (ctx.technical?.rsi != null && ctx.technical.rsi > 70) alerts.push('RSI overbought');
    if (ctx.technical?.rsi != null && ctx.technical.rsi < 30) alerts.push('RSI oversold');
    if (ctx.ticker.quoteVolume >= 10e6) alerts.push('High volume');
    if (ctx.news.length >= 2) alerts.push(`News: ${ctx.news.length} articles`);

    const compositeReason = `Multi-TF: ${tfReasons.join(' | ')}`;
    const baseSignal: AggregatedSignal = {
      symbol: ctx.ticker.symbol, tokenName: ctx.ticker.tokenName, chain: ctx.ticker.chain,
      lastPrice: ctx.ticker.lastPrice, priceChangePercent: ctx.ticker.priceChangePercent,
      direction, compositeConfidence: Math.round(weightedConfidence * 100) / 100,
      positionSize, confidenceRange,
      signals: allSignals.map(s => ({ strategy: s.strategy, direction: s.direction, confidence: s.confidence, reason: s.reason, indicators: s.indicators, timeframe: s.timeframe })),
      alerts, timestamp: ctx.ticker.tsUtc, compositeReason,
    };

    return this.enrichSignalDetails(baseSignal, ctx, agreement_score);
  }

  private enrichSignalDetails(
    signal: AggregatedSignal,
    ctx: StrategyContext,
    agreementScore: number,
  ): AggregatedSignal {
    const klines: Kline[] = ctx.klineCloses && ctx.klineCloses.length > 5
      ? ctx.klineCloses.map((c, i) => ({
          openTime: i * 3600000,
          open: c,
          high: ctx.klineHighs?.[i] ?? c,
          low: ctx.klineLows?.[i] ?? c,
          close: c,
          volume: ctx.klineVolumes?.[i] ?? 0,
          closeTime: (i + 1) * 3600000,
          quoteVolume: 0,
          count: 0,
          takerBuyVol: 0,
          takerBuyQuoteVol: 0,
          ignore: 0,
        }))
      : [];

    if (klines.length > 5) {
      const pRes = scanPatterns(ctx.ticker.symbol, klines);
      if (pRes.patterns.length > 0) {
        signal.patterns = pRes.patterns.map(p => ({
          type: p.type,
          direction: p.direction,
          confidence: p.confidence,
          description: p.description,
        }));
      }
    }

    if (klines.length > 10 && ctx.ticker.lastPrice > 0) {
      const srRes = findSupportResistance(ctx.ticker.symbol, klines);
      signal.supportResistance = {
        nearestSupport: srRes.nearestSupport?.price ?? null,
        nearestResistance: srRes.nearestResistance?.price ?? null,
        upsideTargetPct: srRes.upsideTarget,
        downsideRiskPct: srRes.downsideRisk,
      };

      const vpRes = computeVolumeProfile(ctx.ticker.symbol, klines);
      signal.volumeProfile = {
        poc: vpRes.poc,
        vah: vpRes.vah,
        val: vpRes.val,
      };
    }

    if (ctx.ticker.lastPrice > 0) {
      const atrVal = ((ctx.technical?.atrPct ?? 2) / 100) * ctx.ticker.lastPrice;
      const isBull = signal.direction === 'buy' || signal.direction === 'strong_buy';
      const stopLossPrice = Math.max(0, isBull ? ctx.ticker.lastPrice - 2 * atrVal : ctx.ticker.lastPrice + 2 * atrVal);
      const takeProfitPrice = isBull ? ctx.ticker.lastPrice + 3 * atrVal : Math.max(0, ctx.ticker.lastPrice - 3 * atrVal);
      const riskPerShare = Math.abs(ctx.ticker.lastPrice - stopLossPrice);
      const rewardPerShare = Math.abs(takeProfitPrice - ctx.ticker.lastPrice);
      const riskRewardRatio = riskPerShare > 0 ? Math.round((rewardPerShare / riskPerShare) * 100) / 100 : 1.5;

      const winProb = Math.max(0.1, Math.min(0.9, agreementScore));
      const b = Math.max(0.5, riskRewardRatio);
      const q = 1 - winProb;
      const kellyFraction = (winProb * b - q) / b;
      const kellyPositionSize = Math.round(Math.max(0, Math.min(0.25, kellyFraction)) * 100) / 100;

      signal.riskManagement = {
        stopLossPrice: Math.round(stopLossPrice * 10000) / 10000,
        takeProfitPrice: Math.round(takeProfitPrice * 10000) / 10000,
        riskRewardRatio,
        kellyPositionSize,
      };
    }

    return signal;
  }

  private aggregate(signals: ReturnType<SignalStrategy['evaluate']>[], ctx: StrategyContext): AggregatedSignal {
    const totalWeight = Array.from(this.weights.values()).reduce((a, b) => a + b, 0) || 1;
    let weightedConfidence = 0;
    const dirVotes: Record<string, number> = { buy: 0, sell: 0, neutral: 0, strong_buy: 0, strong_sell: 0 };
    for (const signal of signals) {
      const weight = this.weights.get(signal.strategy) ?? (1 / this.strategies.length);
      const normalizedWeight = weight / totalWeight;
      weightedConfidence += signal.confidence * normalizedWeight;
      const voteWeight = signal.confidence * normalizedWeight;
      dirVotes[signal.direction] = (dirVotes[signal.direction] ?? 0) + voteWeight;
      if (signal.direction === 'strong_buy') dirVotes['buy'] = (dirVotes['buy'] ?? 0) + voteWeight;
      if (signal.direction === 'strong_sell') dirVotes['sell'] = (dirVotes['sell'] ?? 0) + voteWeight;
    }

    // Edge case: all strategies returned neutral
    const allNeutral = signals.every(s => s.direction === 'neutral');
    if (allNeutral) {
      weightedConfidence = 0;
    }

    let direction: 'buy' | 'sell' | 'neutral' | 'strong_buy' | 'strong_sell';
    const buyVotes = (dirVotes['buy'] ?? 0) + (dirVotes['strong_buy'] ?? 0);
    const sellVotes = (dirVotes['sell'] ?? 0) + (dirVotes['strong_sell'] ?? 0);
    if (allNeutral) direction = 'neutral';
    else if (buyVotes > sellVotes && buyVotes > 0.3) direction = buyVotes > 0.5 ? 'strong_buy' : 'buy';
    else if (sellVotes > buyVotes && sellVotes > 0.3) direction = sellVotes > 0.5 ? 'strong_sell' : 'sell';
    else direction = 'neutral';

    // Agreement score: how much strategies agree on direction (0-1)
    const totalVotes = buyVotes + sellVotes + (dirVotes['neutral'] ?? 0);
    const agreement_score = totalVotes > 0
      ? Math.max(buyVotes, sellVotes, dirVotes['neutral'] ?? 0) / totalVotes
      : 0;

    // 95% confidence interval
    const confidenceHalfWidth = (1 - agreement_score) * 0.2;
    const confidenceRange = {
      low: Math.round(Math.max(0, weightedConfidence - confidenceHalfWidth) * 100) / 100,
      high: Math.round(Math.min(1, weightedConfidence + confidenceHalfWidth) * 100) / 100,
    };

    // Position size: confidence adjusted by volatility (high volatility = smaller position)
    const atrPct = ctx.technical?.atrPct ?? 0;
    const volatilityFactor = Math.min(atrPct / 100, 0.5);
    const positionSize = Math.round(weightedConfidence * (1 - volatilityFactor) * 100) / 100;

    const alerts: string[] = [];
    if (ctx.ticker.priceChangePercent <= -5) alerts.push('\u{1F534} DIP (>5% drop)');
    if (ctx.ticker.priceChangePercent >= 5) alerts.push('\u{1F7E2} PUMP (>5% gain)');
    if (ctx.technical?.rsi != null && ctx.technical.rsi > 70) alerts.push('RSI overbought');
    if (ctx.technical?.rsi != null && ctx.technical.rsi < 30) alerts.push('RSI oversold');
    if (ctx.ticker.quoteVolume >= 10e6) alerts.push('High volume');
    if (ctx.news.length >= 2) alerts.push(`News: ${ctx.news.length} articles`);
    const baseSignal: AggregatedSignal = {
      symbol: ctx.ticker.symbol, tokenName: ctx.ticker.tokenName, chain: ctx.ticker.chain,
      lastPrice: ctx.ticker.lastPrice, priceChangePercent: ctx.ticker.priceChangePercent,
      direction, compositeConfidence: Math.round(weightedConfidence * 100) / 100,
      positionSize, confidenceRange,
      signals: signals.map(s => ({ strategy: s.strategy, direction: s.direction, confidence: s.confidence, reason: s.reason, indicators: s.indicators, timeframe: s.timeframe })),
      alerts, timestamp: ctx.ticker.tsUtc,
    };

    return this.enrichSignalDetails(baseSignal, ctx, agreement_score);
  }

  /**
   * Get current strategy weights as a Record.
   * @returns Record of strategy name -> weight
   */
  getStrategyWeights(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [name, weight] of this.weights) {
      result[name] = weight;
    }
    return result;
  }

  /**
   * Set the weight of a strategy at runtime.
   * @param name Strategy name
   * @param weight New weight value
   */
  setStrategyWeight(name: string, weight: number): void {
    const valid = this.strategies.some(s => s.name === name);
    if (!valid) {
      throw new Error(`Unknown strategy: "${name}". Valid strategies: ${this.strategies.map(s => s.name).join(', ')}`);
    }
    this.weights.set(name, weight);
  }

  /**
   * Get info about all registered strategies, their weights, and current tfWeights.
   * @returns Object with strategies array and tfWeights
   */
  getStrategyInfo(): {
    strategies: Array<{ name: string; description: string; timeframe: string; weight: number }>;
    tfWeights: Record<string, number>;
  } {
    return {
      strategies: this.strategies.map(s => ({
        name: s.name, description: s.description, timeframe: s.timeframe,
        weight: this.weights.get(s.name) ?? (1 / this.strategies.length),
      })),
      tfWeights: { ...this.tfWeights },
    };
  }
}
