// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Core Types
// ═══════════════════════════════════════════════════════════════════════

/** Blockchain chain identifier */
export type Chain = 'solana' | 'polygon' | 'bnb' | 'xrp' | 'ethereum' | 'bitcoin' | 'dogecoin' | 'cardano' | 'sui' | 'aptos' | 'sei' | 'celestia' | 'injective' | 'thorchain' | 'cosmos' | 'near' | 'tron' | 'stellar' | 'avalanche' | 'litecoin' | 'bitcoin-cash' | 'hedera' | 'bittensor' | 'polkadot' | 'filecoin' | 'zcash' | 'monero' | 'algorand' | 'tezos' | 'theta' | 'multi';

/** Supported output formats */
export type OutputFormat = 'csv' | 'json' | 'md' | 'table' | 'xlsx';

/** Sort mode for radar display */
export type SortMode = 'alpha' | 'change' | 'volume' | 'signal' | 'momentum';

/** Kline interval for multi-timeframe analysis */
export type KlineInterval = '15m' | '1h' | '4h' | '1d';

/** Token definition */
export interface TokenDef {
  id: string;
  sym: string;
  name: string;
  chain: Chain;
  /** When chain='multi', the actual chains this token trades under */
  chains?: Chain[];
  /** Binance trading pair, e.g. 'SOLUSDT' */
  pair?: string;
  /** CoinGecko ID for alternative data source */
  coingeckoId?: string;
}

/** Raw Binance ticker data (24hr ticker endpoint) */
export interface BinanceTicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

/** Full enriched ticker with computed indicators */
export interface EnrichedTicker {
  runId: string;
  tsUtc: string;
  dateEt: string;
  symbol: string;
  chain: Chain;
  tokenId: string;
  tokenName: string;
  lastPrice: number;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  spreadPct: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  prevClosePrice: number;
  priceChange: number;
  priceChangePercent: number;
  weightedAvgPrice: number;
  volume: number;
  quoteVolume: number;
  count: number;
  lastQty: number;
  vwapDistPct: number;
  rangePosPct: number;
  bookImbalance: number;
  volVsAvg: number;
  obv: number;
  momentum: number;
  alerts: string;
  source: string;

  // ── Technical Indicators ──
  rsi?: number;
  macdMacd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  bbWidth?: number;
  atrPct?: number;
  mfi?: number;
  stochK?: number;
  stochD?: number;
  williamsR?: number;
  cmf?: number;
  tsi?: number;
  ema50DistPct?: number;
  volTrend?: number;

  // ── New Technical Indicators ──
  adx?: number;
  psar?: number;
  cci?: number;
  keltnerWidth?: number;
  keltnerPos?: number;
  roc?: number;
  forceIndex?: number;
  adl?: number;
  chaikinOsc?: number;
  stochRsi?: number;
  stochRsiK?: number;
  stochRsiD?: number;
  trix?: number;
  kst?: number;
  elderBullPower?: number;
  elderBearPower?: number;
  fisher?: number;
  massIndex?: number;

  // ── Strategy Signals ──
  momentumScore?: number;
  momentumDirection?: string;
  meanReversionScore?: number;
  meanReversionDirection?: string;
  trendFollowingScore?: number;
  trendFollowingDirection?: string;
  compositeScore?: number;
  compositeDirection?: string;
  signalCount?: number;
  positionSize?: number;

  // ── On-Chain Metrics ──
  onchainTvl?: number;
  onchainFees1d?: number;
  onchainChainTvl?: number;
  onchainConfidence?: number;

  // ── Market Regime ──
  regime?: string;
  regimeConfidence?: number;
}

export interface StochasticResult {
  k: number | null;
  d: number | null;
}

export interface IchimokuResult {
  conversionLine: number | null;
  baseLine: number | null;
  spanA: number | null;
  spanB: number | null;
  laggingSpan: number | null;
}

/** Parabolic SAR (Stop and Reverse) result */
export interface ParabolicSarResult {
  sar: number;
  acceleration: number;
  isReversal: boolean;
}

/** Keltner Channels (volatility bands using ATR) */
export interface KeltnerChannelsResult {
  upper: number;
  middle: number;
  lower: number;
  width: number;
  position: number;
}

/** StochRSI — stochastic applied to RSI values */
export interface StochRSIResult {
  stochRsi: number | null;
  k: number | null;
  d: number | null;
}

/** Elder Ray Index — bull and bear power */
export interface ElderRayResult {
  bullPower: number;
  bearPower: number;
}

/** Know Sure Thing (KST) result with signal line */
export interface KSTResult {
  kst: number;
  signal: number | null;
}

/** Technical indicators computed from kline/candlestick data */
export interface TechnicalIndicators {
  rsi: number | null;
  mfi: number | null;
  bb: BBandsResult | null;
  macd: MACDResult | null;
  atrPct: number | null;
  volTrend: number | null;
  priceVsEma50: number | null;
  obv: number | null;
  volVsAvg: number | null;
  /** Stochastic Oscillator (%K, %D) */
  stochastic?: StochasticResult | null;
  /** Ichimoku Cloud lines */
  ichimoku?: IchimokuResult | null;
  /** Williams %R (-100 to 0) */
  williamsR?: number | null;
  /** Chaikin Money Flow */
  cmf?: number | null;
  /** True Strength Index */
  tsi?: number | null;
  /** Average Directional Index (trend strength, 0-100) */
  adx?: number | null;
  /** Parabolic SAR — trend reversal detection */
  psar?: ParabolicSarResult | null;
  /** CCI (Commodity Channel Index) — cyclical detection */
  cci?: number | null;
  /** Keltner Channels — ATR-based volatility bands */
  keltner?: KeltnerChannelsResult | null;
  /** ROC (Rate of Change) — simple momentum */
  roc?: number | null;
  /** VWAP (Volume Weighted Average Price) — intraday valuation */
  vwap?: number | null;
  /** Force Index — price * volume momentum */
  forceIndex?: number | null;
  /** ADL (Accumulation/Distribution Line) */
  adl?: number | null;
  /** Chaikin Oscillator — MACD of ADL */
  chaikinOsc?: number | null;
  /** StochRSI — stochastic on RSI values */
  stochRsi?: StochRSIResult | null;
  /** TRIX — triple exponential average oscillator */
  trix?: number | null;
  /** KST (Know Sure Thing) — summed ROC oscillator */
  kst?: KSTResult | null;
  /** Elder Ray Index — bull/bear power */
  elderRay?: ElderRayResult | null;
  /** Fisher Transform — Gaussian normalization */
  fisher?: number | null;
  /** Mass Index — volatility reversal detection */
  massIndex?: number | null;
  /** Range position (0=window low, 1=window high) over the SAME kline window
   *  as the other indicators. Used for same-window divergence detection. */
  rangePosWindow?: number | null;
}

export interface BBandsResult {
  upper: number;
  middle: number;
  lower: number;
  width: number;
  position: number;
}

export interface MACDResult {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

/** News article from RSS feed */
export interface NewsArticle {
  headline: string;
  description: string;
  source: string;
  domain: string;
  pubDate: string;
  url: string;
}

/** Matched news item for a token */
export interface NewsMatch {
  runId: string;
  tsUtc: string;
  symbol: string;
  headline: string;
  description: string;
  source: string;
  domain: string;
  relevance: number;
  url: string;
}

/** Breakdown of individual signal strategy contributions */
export interface SignalBreakdown {
  momentum: { direction: string; confidence: number };
  meanReversion: { direction: string; confidence: number };
  trendFollowing: { direction: string; confidence: number };
}

/** Composite signal for a token */
export interface TokenSignal {
  symbol: string;
  tokenId: string;
  tokenName: string;
  chain: Chain;
  lastPrice: number;
  priceChangePercent: number;
  momentumScore: number;
  technicalScore: number;
  newsScore: number;
  compositeScore: number;
  alerts: string[];
  timestamp: string;
  /** Breakdown of per-strategy signal directions and confidence */
  signalBreakdown?: SignalBreakdown;
  /** Current market regime if determined */
  regime?: string;
  /** ADX trend strength (0–100) from technical indicators */
  adx?: number | null;
  /** ADX trend strength category label */
  adxStrength?: string;
  /** Detected price/RSI divergence if any */
  divergence?: { type: string; strength: number; description: string };
  /** ATR-based volatility factor (0–1) for position sizing guidance */
  volatilityFactor?: number;
}

/** Radar run options */
export interface RadarOptions {
  filter?: string[];
  chain?: Chain;
  sortBy?: SortMode;
  noLog?: boolean;
  quiet?: boolean;
  format?: OutputFormat;
  includeTech?: boolean;
  includeNews?: boolean;
  /** Limit scan to a specific kline interval (e.g. '1h' or '4h') */
  period?: KlineInterval;
  /** Enable DeFiLlama on-chain metrics during scan */
  includeOnchain?: boolean;
  /** Store to persist run results (optional) */
  store?: { persistRun(result: { tickers: EnrichedTicker[]; signals: TokenSignal[]; newsMatches: NewsMatch[] }): void };
}

/** Run metadata for a radar sweep */
export interface RadarRun {
  runId: string;
  tsUtc: string;
  numTokens: number;
  numSignals: number;
  durationMs: number;
}

/** Kline data point */
export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  count: number;
  takerBuyVol: number;
  takerBuyQuoteVol: number;
  ignore: number;
}

/** DEX price entry for Solana tokens via Jupiter aggregator */
export interface DexPrice {
  source: 'jupiter' | 'raydium' | 'orca';
  price: number;
  tokenId: string;
  timestamp: number;
}

// ── Database row types ──

export interface KlineRow {
  symbol: string; interval: string; open_time: number;
  open: number; high: number; low: number; close: number;
  volume: number; quote_volume: number;
  taker_buy_vol: number; taker_buy_quote_vol: number;
}

export interface TickerRow {
  symbol: string; ts_utc: string;
  price: number; price_change_pct: number;
  volume: number; quote_volume: number;
  rsi: number | null; macd_hist: number | null; bb_width: number | null; atr_pct: number | null;
  adx: number | null; regime: string | null; composite_score: number | null;
}

export interface SignalRow {
  symbol: string; ts_utc: string;
  composite_score: number; direction: string | null;
  momentum_score: number | null; mean_reversion_score: number | null; trend_following_score: number | null;
  regime: string | null; adx: number | null;
}

export interface NewsRow {
  id: string; symbol: string | null; headline: string | null;
  description: string | null; source: string | null; domain: string | null;
  relevance: number | null; pub_date: string | null;
}

export interface PaperTradeRow {
  id: string; profile: string; symbol: string; side: string;
  entry_price: number | null; entry_time: string | null;
  quantity: number | null; exit_price: number | null; exit_time: string | null;
  pnl: number | null; fees: number | null; status: string | null;
}

export interface FundingRow {
  symbol: string; ts: number; rate: number | null;
}

export interface OIRow {
  symbol: string; ts: number; open_interest: number | null;
}

export interface LsRatioRow {
  symbol: string; ts: number;
  long_account: number | null; short_account: number | null;
  long_position: number | null; short_position: number | null;
}

export interface LiquidationRow {
  id: string; symbol: string | null; ts: number | null;
  side: string | null; price: number | null; qty: number | null; usd: number | null;
}

export interface FearGreedRow {
  ts: number; value: number; classification: string | null;
}

export interface OrderBookRow {
  symbol: string; ts: number;
  spread_pct: number | null; imbalance: number | null;
  bids: string | null; asks: string | null;
}

export interface CrossAssetRow {
  ts: number;
  btc_dominance: number | null; eth_dominance: number | null;
  total_mcap: number | null; total_mcap_change_24h: number | null;
  market_cap_percentage_json: string | null;
}

/** F4: ML prediction row */
export interface PredictionRow {
  id: string;
  symbol: string;
  ts: string;
  direction: string;
  confidence: number;
  model_id: string;
  horizon: number;
  ml_score: number | null;
  features_hash: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export type CollectorReport = {
  klinesInserted: number;
  fundingInserted: number;
  oiInserted: number;
  lsInserted: number;
  liquidationsInserted: number;
  fearGreedInserted: number;
  orderBookInserted: number;
  crossAssetInserted: number;
  errors: string[];
  durationMs: number;
};
