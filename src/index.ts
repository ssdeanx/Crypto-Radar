// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Public API
// ═══════════════════════════════════════════════════════════════════════

export { runRadar, displayRadar } from './radar.js';
export { fetchAllTickers, fetchTicker, fetchKlines, fetchDepth } from './binance.js';
export { fetchAndMatchNews } from './news.js';
export { computeSignals } from './signals.js';
export { computeAllIndicators, computeRSI, computeMACD, computeBB, computeATR } from './indicators.js';
export { getTokenList, getAllTokens, getTokenById, getTokenBySymbol, getTokensByChain, getBinancePair, getActiveTokenCount, resetTokenConfig, reloadTokenConfig } from './tokens.js';
export { toTable, toCSV, toMarkdownReport, toSignalReport, validateOutput } from './output.js';
export type { ValidationError } from './output.js';

// PDF/HTML report export
export { generateHtmlReport, generateSignalSnapshot } from './pdf-export.js';
export type { ReportConfig } from './pdf-export.js';

// Enterprise core
export { loadConfig, resetConfig, writeDefaultConfig } from './core/config.js';
export type { RadarConfig } from './core/config.js';
export { CryptoRadarError, NetworkError, RateLimitError, DataError, ConfigError, CacheError, SignalError } from './core/errors.js';
export { logger } from './core/logger.js';
export { Cache } from './core/cache.js';
export { RateLimiter } from './core/rate-limiter.js';

// Alerts
export { checkAlerts, formatAlerts, resetAlertState } from './core/alerts.js';
export type { PriceAlert, AlertResult } from './core/alerts.js';

// Webhook notifications
export { sendAlert, formatAlertMessage } from './core/webhook.js';
export type { WebhookType, WebhookConfig } from './core/webhook.js';

// Charts
export { priceSparkline, dualSparkline, multiMaSparkline, priceSvgChart, multiPanelSvgChart, candlestickSvgChart } from './io/charts.js';
export { correlationHeatMap, portfolioDashboard, marketBreadthGauge, strategyPerformance } from './io/advanced-charts.js';
export type { Holding, MarketMetrics } from './io/advanced-charts.js';

// Signal Dashboard
export { signalDashboard } from './io/signal-dashboard.js';
export type { DashboardOptions } from './io/signal-dashboard.js';

// Alternative data sources
export { fetchSimplePrices, fetchMarketData } from './coingecko.js';
export type { CoinGeckoPrice, CoinGeckoMarketData } from './coingecko.js';

// Jupiter DEX price API (Solana)
export {
  fetchJupiterPrices,
  fetchSolanaDexPrices,
  fetchJupiterTokenList,
  toDexPrices,
  getMintAddress,
  getAllMintAddresses,
  getMintCount,
  clearJupiterCache,
} from './jupiter.js';

// On-chain metrics (DeFiLlama)
export { fetchOnChainMetrics, fetchOnChainPrices, fetchProtocolTvl, fetchProtocolFees, fetchChainTvl } from './onchain.js';
export type { OnChainMetrics, ProtocolMetrics, ChainMetrics } from './onchain.js';

// WebSocket
export { BinanceWsClient, tickerStreams, klineStreams } from './ws.js';

// Strategy engine
export { StrategyEngine } from './analysis/engine.js';
export { MomentumStrategy } from './analysis/momentum.js';
export { MeanReversionStrategy } from './analysis/mean-reversion.js';
export { TrendFollowingStrategy } from './analysis/trend-following.js';
export type { SignalStrategy, StrategyContext, StrategySignal, AggregatedSignal, SignalDirection } from './analysis/strategies.js';

// Market regime detection
export { detectRegime, getRegimeWeights, formatRegime } from './analysis/regime.js';
export type { MarketRegime, RegimeResult } from './analysis/regime.js';

// Volume Profile
export { computeVolumeProfile, formatVolumeProfile, volumeProfileSvg } from './analysis/volume-profile.js';
export type { VolumeProfileResult, VolumeNode } from './analysis/volume-profile.js';

// Candlestick pattern recognition
export { scanPatterns } from './analysis/patterns.js';
export type { PatternType, PatternDirection, DetectedPattern, PatternResult } from './analysis/patterns.js';

// Cross-token correlation engine
export { computeCorrelationMatrix, findTopCorrelations, formatCorrelationTable, priceReturns } from './analysis/correlation.js';
export type { CorrelationMatrix, CorrelationPair } from './analysis/correlation.js';

// Support & Resistance detection
export { findSupportResistance, formatSR } from './analysis/support-resistance.js';
export type { PriceLevel, SupportResistanceResult, SROptions } from './analysis/support-resistance.js';

// Health
export { HealthMonitor } from './monitor/health.js';
export type { HealthStatus } from './monitor/health.js';

// Daemon
export { runDaemon, isDaemonRunning, stopDaemon } from './daemon.js';

// Paper Trading
export { PaperTrader, createPaperTrader, listProfiles, getActiveProfileName } from './paper-trade.js';
export type { PaperTraderConfig, PaperTrade, PortfolioHolding, PortfolioState, PerformanceReport, TradeRecommendation, ProfileSummary } from './paper-trade.js';

// Backtest & Benchmark
export { runBacktest, formatBacktest, winRate, overallWinRate, formatSingleBacktest } from './backtest.js';
export type { BacktestResult, BacktestOptions, AggregatedBacktestResult } from './backtest.js';
export { runBenchmark, runBenchmarkMedian, formatBenchmark } from './core/benchmark.js';
export type { BenchmarkResult } from './core/benchmark.js';

// SQLite store
export { Store } from './store/db.js';

// Historical collector
export { runCollector } from './collector.js';
export type { CollectorOptions } from './collector.js';

// New data sources
export { fetchFundingRates, fetchOpenInterest, fetchLongShortRatio, fetchTopLongShortPositionRatio, fetchLiquidations } from './sources/futures.js';
export { fetchFearGreed } from './sources/fear-greed.js';
export { snapshotOrderBook } from './sources/orderbook.js';
export { fetchGlobalData } from './sources/cross-asset.js';

// REST API + WS hub
export { createRestHandler } from './api/rest.js';
export { createWsHub } from './api/ws.js';

// ML Pipeline
export { buildFeatures } from './ml/features.js';
export { computeLabels, getDefaultClassWeights, computeClassDistribution } from './ml/labels.js';
export { assembleDataset, normalizeRow } from './ml/dataset.js';
export { batchPredict, persistPredictions } from './ml/predict.js';
export type { FeatureRow, LabelRow, MLConfig, PredictionResult, NormalizationStats, DatasetResult, DatasetOpts, FeatureOpts } from './ml/types.js';

// SQLite export bridge
export { exportCsvToSql } from './sqlite-export.js';
export type { CsvToSqlOptions, CsvRow, ValidationResult, ExportResult } from './sqlite-export.js';

export type {
  TokenDef, BinanceTicker, EnrichedTicker, TechnicalIndicators,
  NewsMatch, TokenSignal, RadarOptions, RadarRun,
  Kline, Chain, SortMode, OutputFormat,
  DexPrice,
} from './types.js';
