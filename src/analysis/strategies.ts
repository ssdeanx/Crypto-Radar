import type { EnrichedTicker, TechnicalIndicators, NewsMatch } from '../types.js';

export type SignalDirection = 'buy' | 'sell' | 'neutral' | 'strong_buy' | 'strong_sell';

/** Individual strategy evaluation result. */
export interface StrategySignal {
  strategy: string;
  direction: SignalDirection;
  confidence: number;
  reason: string;
  indicators: Record<string, number | null>;
  timeframe: string;
}

/** Aggregated signal combining multiple strategy evaluations. */
export interface AggregatedSignal {
  symbol: string;
  tokenName: string;
  chain: string;
  lastPrice: number;
  priceChangePercent: number;
  direction: SignalDirection;
  compositeConfidence: number;
  signals: StrategySignal[];
  alerts: string[];
  timestamp: string;
  /** Suggested position size based on confidence and volatility (0-1) */
  positionSize?: number;
  /** 95% confidence interval range */
  confidenceRange?: { low: number; high: number };
  compositeReason?: string;
}

/** Context passed to each strategy's evaluate method. */
export interface StrategyContext {
  ticker: EnrichedTicker;
  technical: TechnicalIndicators | null;
  technicalsByInterval: Map<string, TechnicalIndicators>;
  news: NewsMatch[];
  klineCloses: number[];
  klineHighs: number[];
  klineLows: number[];
  klineVolumes: number[];
}

/** Interface all signal strategies must implement. */
export interface SignalStrategy {
  readonly name: string;
  readonly description: string;
  readonly timeframe: string;
  evaluate(ctx: StrategyContext): StrategySignal;
}

/** Weighted strategy configuration. */
export interface StrategyWeight {
  name: string;
  weight: number;
}
