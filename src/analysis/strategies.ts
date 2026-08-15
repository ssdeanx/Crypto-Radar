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

  // ── Advanced Pattern & Breakout Signal Integrations ──
  /** Detected candlestick chart patterns */
  patterns?: Array<{ type: string; direction: string; confidence: number; description: string }>;
  /** Nearest support and resistance price levels */
  supportResistance?: {
    nearestSupport: number | null;
    nearestResistance: number | null;
    upsideTargetPct: number | null;
    downsideRiskPct: number | null;
  };
  /** Volume Profile Point of Control (POC), VAH, VAL */
  volumeProfile?: {
    poc: number;
    vah: number;
    val: number;
  };
  /** Risk management calculations: ATR stop-loss, take-profit, and risk-to-reward ratio */
  riskManagement?: {
    stopLossPrice: number;
    takeProfitPrice: number;
    riskRewardRatio: number;
    kellyPositionSize: number;
  };
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
