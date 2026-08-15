// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Paper Trading Engine
// ═══════════════════════════════════════════════════════════════════════
//
// A fake-money paper trading CLI game that lets agents (or users) practice
// reading crypto signals and investing with fake money.
//
// Features:
//   - Starts with $10,000 fake USD
//   - Buy/sell tokens at live Binance/CoinGecko prices
//   - P&L tracking (per-token and total portfolio)
//   - Signal integration (uses existing signals.ts infrastructure)
//   - Performance reports (win rate, Sharpe-like ratio, best/worst trades)
//   - State persistence via JSON (snapshot/restore)
//   - Profile support: multiple named portfolios with isolated state
//   - Hermes Agent Play (programmatic API for agent-driven trading)
// ═══════════════════════════════════════════════════════════════════════

import type { TokenSignal } from './types.js';
import { getTokenBySymbol, getTokenList } from './tokens.js';
import type { TokenDef } from './tokens.js';
import { fetchTicker } from './binance.js';
import { fetchSimplePrices } from './coingecko.js';
import { runRadar } from './radar.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from './core/config.js';
import { logWarn } from './core/errors.js';
import { mean, sampleStandardDeviation } from './math/index.js';

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

/** Difficulty levels for paper trading */
export const Difficulty = {
  EASY: 'easy',
  HARD: 'hard',
  EXTREME: 'extreme',
} as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

/** Default starting balance per difficulty level */
export const DIFFICULTY_BALANCES: Record<Difficulty, number> = {
  [Difficulty.EASY]: 10_000,
  [Difficulty.HARD]: 1_000,
  [Difficulty.EXTREME]: 100,
};

/** Execution realism settings (slippage, exchange fees) */
export interface ExecutionModelConfig {
  /** Slippage rate in decimal (e.g. 0.0005 for 0.05%, 0 for zero-slippage) */
  slippageRate?: number;
  /** Maker fee rate (e.g. 0.0002 for 0.02%, 0 for zero fees) */
  makerFeeRate?: number;
  /** Taker fee rate (e.g. 0.0005 for 0.05%, 0 for zero fees) */
  takerFeeRate?: number;
}

/** Options for trade execution */
export interface TradeExecutionOptions {
  /** Reason / signal context that triggered this trade */
  reason?: string;
  /** Order execution type */
  orderType?: 'market' | 'limit' | 'stop_loss' | 'take_profit' | 'trailing_stop';
  /** Snapshot of market indicators and regime at time of trade execution for ML telemetry */
  telemetry?: Record<string, unknown>;
  /** Stop loss price level */
  stopLossPrice?: number;
  /** Take profit price level */
  takeProfitPrice?: number;
  /** Trailing stop percentage (e.g. 2 for 2%) */
  trailingStopPct?: number;
  /** Override slippage rate for this trade */
  slippageRate?: number;
  /** Override fee rate for this trade */
  feeRate?: number;
}

/** Configuration for the PaperTrader */
export interface PaperTraderConfig {
  /** Starting fake USD balance (default: 10,000) */
  startingBalance?: number;
  /** Optional whitelist of allowed token symbols */
  allowedTokens?: string[];
  /** Directory for state persistence (default: ~/.hermes/data/crypto-radar/) */
  dataDir?: string;
  /** Profile name for multi-profile support. Default "trader1" */
  profileName?: string;
  /** Difficulty level (determines starting balance if startingBalance not set). Defaults to EASY */
  difficulty?: Difficulty;
  /** Execution realism settings (slippage, fees) */
  executionModel?: ExecutionModelConfig;
}

/** A single trade record */
export interface PaperTrade {
  id: string;
  type: 'buy' | 'sell';
  symbol: string;
  tokenId: string;
  amount: number;
  price: number;
  total: number;       // amount × price in USD
  timestamp: string;   // ISO 8601
  /** Realized P&L for sell trades (negative = loss) */
  pnl?: number;
  /** Reason / signal context that triggered this trade (for agent play) */
  reason?: string;
  /** Fee paid in USD */
  fee?: number;
  /** Slippage percentage experienced */
  slippage?: number;
  /** Order execution type */
  orderType?: 'market' | 'limit' | 'stop_loss' | 'take_profit' | 'trailing_stop';
  /** Max Favorable Excursion % reached during trade lifetime */
  mfe?: number;
  /** Max Adverse Excursion % reached during trade lifetime */
  mae?: number;
  /** Duration held in milliseconds */
  holdingDurationMs?: number;
  /** Snapshot of market indicators and regime at time of trade execution */
  telemetry?: Record<string, unknown>;
}

/** A holding position for a token */
export interface PortfolioHolding {
  symbol: string;
  tokenId: string;
  amount: number;
  avgEntryPrice: number; // weighted average entry price
  entryTimestamp?: string;
  peakPrice?: number;
  troughPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPct?: number;
  entryIndicators?: Record<string, unknown>;
}

/** Full portfolio state (persisted as JSON) */
export interface PortfolioState {
  cash: number;
  holdings: PortfolioHolding[];
  trades: PaperTrade[];
  startBalance: number;
}

/** Per-token breakdown in the performance report */
export interface PerTokenReport {
  symbol: string;
  tokenId: string;
  tokenName: string;
  amount: number;
  avgEntry: number;
  currentPrice: number;
  value: number;            // amount × currentPrice
  unrealizedPnl: number;    // (currentPrice - avgEntry) × amount
  unrealizedPnlPercent: number;
  realizedPnl: number;      // sum of pnl from sell trades for this token
  totalPnl: number;         // realized + unrealized
  trades: number;
}

/** Full performance report */
export interface PerformanceReport {
  startBalance: number;
  currentCash: number;
  holdingsValue: number;
  totalEquity: number;       // cash + holdingsValue
  totalReturn: number;       // totalEquity - startBalance
  totalReturnPercent: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;           // 0–1
  bestTrade: PaperTrade | null;
  worstTrade: PaperTrade | null;
  sharpeRatio: number;
  perToken: PerTokenReport[];
}

/** Result of a multi-profile comparison run */
export interface ProfileResult {
  profileName: string;
  difficulty: Difficulty;
  startBalance: number;
  currentBalance: number;
  totalPnl: number;
  winRate: number;
  tradeCount: number;
  sharpeLike: number;
}

/** Trade recommendation from signal integration */
export interface TradeRecommendation {
  symbol: string;
  tokenId: string;
  tokenName: string;
  action: 'buy' | 'sell' | 'hold';
  /**
   * Composite score — Always 0–100 regardless of source engine.
   * - From AggregatedSignal (strategy engine): mapped from 0–1 to 0–100
   * - From TokenSignal (signals engine): passed through as-is
   */
  compositeScore: number;
  /** Confidence 0–1 for trade sizing */
  confidence: number;
  reason: string;
  currentPrice: number;
  direction: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Profile Types
// ═══════════════════════════════════════════════════════════════════════

/** Wrapper format for profile state files (version 2) */
export interface ProfileStateFile {
  /** Schema version — bump when format changes (currently 2) */
  version: number;
  /** Must match the filename stem */
  profileName: string;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /** ISO 8601 timestamp of last modification */
  updatedAt: string;
  /** The actual portfolio state (v1-compatible shape) */
  state: PortfolioState;
}

/** Summary metadata returned by listProfiles() */
export interface ProfileSummary {
  profileName: string;
  cash: number;
  tradeCount: number;
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const VALID_PROFILE_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

let tradeIdCounter = 0;

function nextTradeId(): string {
  tradeIdCounter++;
  const ts = Date.now().toString(36).toUpperCase();
  return `PT-${ts}-${tradeIdCounter.toString(36).toUpperCase()}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

export function expandHome(filePath: string): string {
  if (filePath.startsWith('~/') || filePath.startsWith('~\\\\')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
    return filePath.replace(/^~/, home);
  }
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════════
// PaperTrader Class
// ═══════════════════════════════════════════════════════════════════════

export class PaperTrader {
  private state: PortfolioState;
  private readonly config: Required<Omit<PaperTraderConfig, 'executionModel'>> & { executionModel: Required<ExecutionModelConfig> };
  private profileName: string;
  private createdAt: string;
  private tokenCache: Map<string, { price: number; timestamp: number }>;

  constructor(config: PaperTraderConfig = {}) {
    this.profileName = config.profileName ?? 'trader1';
    if (!VALID_PROFILE_NAME.test(this.profileName)) {
      throw new Error(
        `Invalid profile name "${this.profileName}". Use letters, numbers, hyphens, and underscores only (1–64 chars).`,
      );
    }
    const difficulty = config.difficulty ?? Difficulty.EASY;
    const startingBalance = config.startingBalance ?? DIFFICULTY_BALANCES[difficulty];
    this.config = {
      startingBalance,
      allowedTokens: config.allowedTokens ?? [],
      dataDir: config.dataDir ?? loadConfig().dataDir,
      profileName: this.profileName,
      difficulty,
      executionModel: {
        slippageRate: config.executionModel?.slippageRate ?? 0,
        makerFeeRate: config.executionModel?.makerFeeRate ?? 0,
        takerFeeRate: config.executionModel?.takerFeeRate ?? 0,
      },
    };
    this.createdAt = new Date().toISOString();
    this.tokenCache = new Map();

    this.state = {
      cash: this.config.startingBalance,
      holdings: [],
      trades: [],
      startBalance: this.config.startingBalance,
    };
  }

  // ── Property accessors ──

  /** Current cash balance */
  get cash(): number {
    return this.state.cash;
  }

  /** Trade history (read-only) */
  get trades(): readonly PaperTrade[] {
    return this.state.trades;
  }

  /** Current holdings */
  get holdings(): readonly PortfolioHolding[] {
    return this.state.holdings;
  }

  /** Starting balance */
  get startBalance(): number {
    return this.state.startBalance;
  }

  // ── Price fetching ──

  /**
   * Fetch the current price for a token symbol.
   * Tries Binance first, falls back to CoinGecko.
   * Results are cached for 60 seconds to avoid excessive API calls.
   */
  async getPrice(symbol: string): Promise<number | null> {
    const upperSym = symbol.toUpperCase();

    // Check cache (60s TTL)
    const cached = this.tokenCache.get(upperSym);
    if (cached && Date.now() - cached.timestamp < 60_000) {
      return cached.price;
    }

    // Try Binance
    try {
      const token = getTokenBySymbol(upperSym);
      if (token) {
        const pair = `${upperSym}USDT`;
        const ticker = await fetchTicker(pair);
        const price = parseFloat(ticker.lastPrice);
        if (price > 0) {
          this.tokenCache.set(upperSym, { price, timestamp: Date.now() });
          return price;
        }
      }
    } catch {
      // Fall through to CoinGecko
    }

    // Fallback to CoinGecko
    try {
      // Get the token from registry to find coingeckoId
      const allTokens = getTokenList();
      const token = allTokens.find(t => t.sym === upperSym);
      if (token?.coingeckoId) {
        const prices = await fetchSimplePrices([token.coingeckoId]);
        const priceData = prices.get(token.coingeckoId);
        if (priceData && priceData.usd > 0) {
          this.tokenCache.set(upperSym, { price: priceData.usd, timestamp: Date.now() });
          return priceData.usd;
        }
      }
    } catch {
      // Give up
    }

    return null;
  }

  /**
   * Clear the internal price cache.
   */
  clearPriceCache(): void {
    this.tokenCache.clear();
  }

  // ── Token validation ──

  private validateToken(symbol: string): TokenDef | null {
    const upperSym = symbol.toUpperCase();
    const token = getTokenBySymbol(upperSym);
    if (!token) return null;

    // Check allowed tokens filter
    if (this.config.allowedTokens.length > 0 && !this.config.allowedTokens.includes(upperSym)) {
      return null;
    }

    return token;
  }

  // ── Trade execution ──

  /**
   * Buy a specified amount of a token.
   * @param symbol Token symbol (e.g., "SOL", "ETH")
   * @param amount Quantity to buy
   * @param optionsOrReason Optional reason string or full TradeExecutionOptions
   * @returns The executed trade, or null if it failed
   */
  async buy(
    symbol: string,
    amount: number,
    optionsOrReason?: string | TradeExecutionOptions,
  ): Promise<PaperTrade | null> {
    const upperSym = symbol.toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const token = this.validateToken(upperSym);
    if (!token) return null;

    const price = await this.getPrice(upperSym);
    if (price === null || price <= 0) return null;

    const options: TradeExecutionOptions =
      typeof optionsOrReason === 'string'
        ? { reason: optionsOrReason }
        : (optionsOrReason ?? {});

    const slippageRate = options.slippageRate ?? this.config.executionModel.slippageRate;
    const feeRate = options.feeRate ?? this.config.executionModel.takerFeeRate;

    const executedPrice = price * (1 + slippageRate);
    const subtotal = amount * executedPrice;
    const fee = subtotal * feeRate;
    const totalCost = subtotal + fee;

    if (!Number.isFinite(totalCost) || totalCost <= 0) return null;

    if (totalCost > this.state.cash) {
      return null; // insufficient funds
    }

    // Deduct cash
    this.state.cash -= totalCost;

    const now = nowISO();

    // Update holdings (weighted average entry price)
    const existing = this.state.holdings.find(h => h.symbol === upperSym);
    if (existing) {
      const totalCostBasis = existing.amount * existing.avgEntryPrice + subtotal;
      existing.amount += amount;
      existing.avgEntryPrice = totalCostBasis / existing.amount;
      existing.peakPrice = Math.max(existing.peakPrice ?? executedPrice, executedPrice);
      existing.troughPrice = Math.min(existing.troughPrice ?? executedPrice, executedPrice);
      if (options.stopLossPrice !== undefined) existing.stopLossPrice = options.stopLossPrice;
      if (options.takeProfitPrice !== undefined) existing.takeProfitPrice = options.takeProfitPrice;
      if (options.trailingStopPct !== undefined) existing.trailingStopPct = options.trailingStopPct;
      if (options.telemetry) existing.entryIndicators = options.telemetry;
    } else {
      this.state.holdings.push({
        symbol: upperSym,
        tokenId: token.id,
        amount,
        avgEntryPrice: executedPrice,
        entryTimestamp: now,
        peakPrice: executedPrice,
        troughPrice: executedPrice,
        stopLossPrice: options.stopLossPrice,
        takeProfitPrice: options.takeProfitPrice,
        trailingStopPct: options.trailingStopPct,
        entryIndicators: options.telemetry,
      });
    }

    // Record trade
    const trade: PaperTrade = {
      id: nextTradeId(),
      type: 'buy',
      symbol: upperSym,
      tokenId: token.id,
      amount,
      price: executedPrice,
      total: totalCost,
      timestamp: now,
      reason: options.reason,
      fee: fee > 0 ? fee : undefined,
      slippage: slippageRate > 0 ? slippageRate * 100 : undefined,
      orderType: options.orderType ?? 'market',
      telemetry: options.telemetry,
    };
    this.state.trades.push(trade);

    return trade;
  }

  /**
   * Sell a specified amount of a token.
   * @param symbol Token symbol (e.g., "SOL", "ETH")
   * @param amount Quantity to sell (or -1 for all)
   * @param optionsOrReason Optional reason string or full TradeExecutionOptions
   * @returns The executed trade, or null if it failed
   */
  async sell(
    symbol: string,
    amount: number,
    optionsOrReason?: string | TradeExecutionOptions,
  ): Promise<PaperTrade | null> {
    const upperSym = symbol.toUpperCase();
    if (amount === 0) return null;

    const token = this.validateToken(upperSym);
    if (!token) return null;

    const holding = this.state.holdings.find(h => h.symbol === upperSym);
    if (!holding || holding.amount <= 0) return null;

    // If amount is -1, sell all
    const sellAmount = amount === -1 ? holding.amount : Math.min(amount, holding.amount);

    if (sellAmount <= 0) return null;

    const price = await this.getPrice(upperSym);
    if (price === null || price <= 0) return null;

    const options: TradeExecutionOptions =
      typeof optionsOrReason === 'string'
        ? { reason: optionsOrReason }
        : (optionsOrReason ?? {});

    const slippageRate = options.slippageRate ?? this.config.executionModel.slippageRate;
    const feeRate = options.feeRate ?? this.config.executionModel.takerFeeRate;

    const executedPrice = price * (1 - slippageRate);
    const subtotal = sellAmount * executedPrice;
    const fee = subtotal * feeRate;
    const netProceeds = subtotal - fee;
    const costBasis = sellAmount * holding.avgEntryPrice;
    const realizedPnl = netProceeds - costBasis;

    // Add cash
    this.state.cash += netProceeds;

    // Holding duration & excursion metrics
    const now = nowISO();
    const entryMs = holding.entryTimestamp ? new Date(holding.entryTimestamp).getTime() : Date.now();
    const durationMs = Math.max(0, Date.now() - entryMs);

    const peak = Math.max(holding.peakPrice ?? holding.avgEntryPrice, executedPrice);
    const trough = Math.min(holding.troughPrice ?? holding.avgEntryPrice, executedPrice);
    const mfe = holding.avgEntryPrice > 0 ? ((peak - holding.avgEntryPrice) / holding.avgEntryPrice) * 100 : 0;
    const mae = holding.avgEntryPrice > 0 ? ((holding.avgEntryPrice - trough) / holding.avgEntryPrice) * 100 : 0;

    // Update holding
    holding.amount -= sellAmount;
    if (holding.amount <= 0.00000001) {
      this.state.holdings = this.state.holdings.filter(h => h.symbol !== upperSym);
    }

    // Record trade
    const trade: PaperTrade = {
      id: nextTradeId(),
      type: 'sell',
      symbol: upperSym,
      tokenId: token.id,
      amount: sellAmount,
      price: executedPrice,
      total: subtotal,
      pnl: realizedPnl,
      timestamp: now,
      reason: options.reason,
      fee: fee > 0 ? fee : undefined,
      slippage: slippageRate > 0 ? slippageRate * 100 : undefined,
      orderType: options.orderType ?? 'market',
      mfe: Math.round(mfe * 100) / 100,
      mae: Math.round(mae * 100) / 100,
      holdingDurationMs: durationMs,
      telemetry: holding.entryIndicators,
    };
    this.state.trades.push(trade);

    return trade;
  }

  // ── Portfolio queries ──

  /**
   * Get the current portfolio state.
   * Returns a snapshot with current market values for all holdings.
   */
  async getPortfolio(): Promise<{
    cash: number;
    holdings: Array<PortfolioHolding & {
      currentPrice: number;
      value: number;
      unrealizedPnl: number;
      unrealizedPnlPercent: number;
    }>;
    totalHoldingsValue: number;
    totalEquity: number;
  }> {
    const holdingsWithPrices: Array<PortfolioHolding & {
      currentPrice: number;
      value: number;
      unrealizedPnl: number;
      unrealizedPnlPercent: number;
    }> = [];

    let totalHoldingsValue = 0;

    for (const h of this.state.holdings) {
      const price = await this.getPrice(h.symbol);
      const currentPrice = price ?? 0;
      const value = h.amount * currentPrice;
      const unrealizedPnl = value - (h.amount * h.avgEntryPrice);
      const unrealizedPnlPercent = h.avgEntryPrice > 0
        ? ((currentPrice - h.avgEntryPrice) / h.avgEntryPrice) * 100
        : 0;

      holdingsWithPrices.push({
        ...h,
        currentPrice,
        value,
        unrealizedPnl,
        unrealizedPnlPercent,
      });

      totalHoldingsValue += value;
    }

    return {
      cash: this.state.cash,
      holdings: holdingsWithPrices,
      totalHoldingsValue,
      totalEquity: this.state.cash + totalHoldingsValue,
    };
  }

  /**
   * Get the raw portfolio state (no price lookups).
   * Useful for quick state inspection without async calls.
   */
  getRawState(): PortfolioState {
    return { ...this.state, holdings: [...this.state.holdings], trades: [...this.state.trades] };
  }

  // ── Performance Report ──

  /**
   * Generate a comprehensive performance report.
   */
  async getReport(): Promise<PerformanceReport> {
    const portfolio = await this.getPortfolio();

    // Count wins / losses from sell trades
    let wins = 0;
    let losses = 0;
    let bestTrade: PaperTrade | null = null;
    let worstTrade: PaperTrade | null = null;

    const sellTrades = this.state.trades.filter(t => t.type === 'sell' && t.pnl != null);
    for (const t of sellTrades) {
      if (t.pnl! > 0) {
        wins++;
        if (!bestTrade || t.pnl! > bestTrade.pnl!) bestTrade = t;
      } else if (t.pnl! < 0) {
        losses++;
        if (!worstTrade || t.pnl! < worstTrade.pnl!) worstTrade = t;
      }
    }

    const totalSells = wins + losses;

    // Per-token breakdown
    const perTokenMap = new Map<string, {
      realizedPnl: number;
      trades: number;
      tokenId: string;
      tokenName: string;
    }>();

    // Initialize from token registry
    for (const h of this.state.holdings) {
      const token = getTokenBySymbol(h.symbol);
      perTokenMap.set(h.symbol, {
        realizedPnl: 0,
        trades: 0,
        tokenId: h.tokenId,
        tokenName: token?.name ?? h.symbol,
      });
    }

    // Accumulate realized P&L per token from sell trades
    for (const t of this.state.trades.filter(t => t.type === 'sell')) {
      const entry = perTokenMap.get(t.symbol);
      if (entry) {
        entry.realizedPnl += t.pnl ?? 0;
        entry.trades += 1;
      } else {
        const token = getTokenBySymbol(t.symbol);
        perTokenMap.set(t.symbol, {
          realizedPnl: t.pnl ?? 0,
          trades: 1,
          tokenId: t.tokenId,
          tokenName: token?.name ?? t.symbol,
        });
      }
    }

    const perToken: PerTokenReport[] = [];

    for (const h of portfolio.holdings) {
      const entry = perTokenMap.get(h.symbol);
      const totalPnl = (entry?.realizedPnl ?? 0) + h.unrealizedPnl;
      perToken.push({
        symbol: h.symbol,
        tokenId: h.tokenId,
        tokenName: entry?.tokenName ?? h.symbol,
        amount: h.amount,
        avgEntry: h.avgEntryPrice,
        currentPrice: h.currentPrice,
        value: h.value,
        unrealizedPnl: h.unrealizedPnl,
        unrealizedPnlPercent: h.unrealizedPnlPercent,
        realizedPnl: entry?.realizedPnl ?? 0,
        totalPnl,
        trades: entry?.trades ?? 0,
      });
    }

    // Add tokens we've fully sold out of
    for (const [sym, entry] of perTokenMap) {
      if (!portfolio.holdings.find(h => h.symbol === sym)) {
        perToken.push({
          symbol: sym,
          tokenId: entry.tokenId,
          tokenName: entry.tokenName,
          amount: 0,
          avgEntry: 0,
          currentPrice: 0,
          value: 0,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          realizedPnl: entry.realizedPnl,
          totalPnl: entry.realizedPnl,
          trades: entry.trades,
        });
      }
    }

    // Sharpe ratio using percentage returns (not raw USD P&L)
    let sharpeRatio = 0;
    const returns = sellTrades.map(t => {
      // Compute % return: pnl / costBasis * 100
      // costBasis = total - pnl (since pnl = totalValue - costBasis)
      const total = t.total ?? 0;
      const pnl = t.pnl ?? 0;
      const costBasis = total - pnl;
      return costBasis > 0 && Number.isFinite(costBasis) ? (pnl / costBasis) * 100 : 0;
    });
    if (returns.length >= 2) {
      const avg = mean(returns);
      const stdDev = sampleStandardDeviation(returns);
      if (stdDev > 0) {
        sharpeRatio = (avg / stdDev) * Math.sqrt(returns.length);
      }
    }

    return {
      startBalance: this.state.startBalance,
      currentCash: this.state.cash,
      holdingsValue: portfolio.totalHoldingsValue,
      totalEquity: portfolio.totalEquity,
      totalReturn: portfolio.totalEquity - this.state.startBalance,
      totalReturnPercent: this.state.startBalance > 0
        ? ((portfolio.totalEquity - this.state.startBalance) / this.state.startBalance) * 100
        : 0,
      totalTrades: this.state.trades.length,
      wins,
      losses,
      winRate: totalSells > 0 ? wins / totalSells : 0,
      bestTrade,
      worstTrade,
      sharpeRatio,
      perToken,
    };
  }

  // ── Signal Integration ──

  /**
   * Fetch current trading signals and generate trade recommendations.
   * Uses the existing runRadar / computeSignals infrastructure.
   */
  async getSignalRecommendations(): Promise<TradeRecommendation[]> {
    const recommendations: TradeRecommendation[] = [];

    try {
      // If we have allowedTokens, filter to those
      const filter = this.config.allowedTokens.length > 0
        ? this.config.allowedTokens
        : undefined;

      // Run radar to get current signals
      const result = await runRadar({
        filter,
        includeTech: true,
        includeNews: false,
        noLog: true,
        quiet: true,
        sortBy: 'signal',
      });

      // Use aggregated signals from the strategy engine
      for (const agg of result.aggregatedSignals) {
        let action: 'buy' | 'sell' | 'hold' = 'hold';
        let confidence = 0;

        if (agg.direction === 'strong_buy' || agg.direction === 'buy') {
          action = 'buy';
          confidence = agg.compositeConfidence;
        } else if (agg.direction === 'strong_sell' || agg.direction === 'sell') {
          action = 'sell';
          confidence = agg.compositeConfidence;
        }

        recommendations.push({
          symbol: agg.symbol,
          tokenId: agg.symbol.toLowerCase(),
          tokenName: agg.tokenName,
          action,
          confidence,
          reason: agg.compositeReason ?? agg.alerts.join('; '),
          currentPrice: agg.lastPrice,
          compositeScore: Math.round(agg.compositeConfidence * 100),
          direction: agg.direction,
        });
      }

      // Fallback: use TokenSignal from signals.ts if no aggregated signals
      if (recommendations.length === 0 && result.signals) {
        for (const token of result.signals) {
          if ('compositeScore' in token && typeof token.compositeScore === 'number') {
            const ts = token as TokenSignal;
            let action: 'buy' | 'sell' | 'hold' = 'hold';
            let confidence = 0;

            if (ts.compositeScore > 50) {
              action = 'buy';
              confidence = Math.min(ts.compositeScore / 100, 1);
            } else if (ts.compositeScore < -50) {
              action = 'sell';
              confidence = Math.min(Math.abs(ts.compositeScore) / 100, 1);
            }

            recommendations.push({
              symbol: ts.symbol,
              tokenId: ts.tokenId,
              tokenName: ts.tokenName,
              action,
              confidence,
              reason: ts.alerts?.join('; ') ?? '',
              currentPrice: ts.lastPrice,
              compositeScore: ts.compositeScore,
              direction: ts.compositeScore > 0 ? 'bullish' : 'bearish',
            });
          }
        }
      }
    } catch (err) {
      logWarn("paper-trade", "Radar scan failed", err);
    }

    return recommendations;
  }

  /**
   * Hermes Agent Play: execute trades based on signal recommendations.
   * The agent passes a set of recommendations; this method executes trades
   * that pass a confidence threshold.
   *
   * @param recommendations Trade recommendations from signals or user
   * @param maxPerTrade Max USD to spend per buy trade (0 = use all cash)
   * @param minConfidence Minimum confidence (0–1) to execute a trade
   * @param maxPositions Maximum number of concurrent positions (default 5)
   * @param profileName Optional profile name to execute trades against a different profile
   * @returns Array of executed trades
   */
  async agentPlay(
    recommendations: TradeRecommendation[],
    maxPerTrade: number = 1000,
    minConfidence: number = 0.3,
    maxPositions: number = 5,
    profileName?: string,
  ): Promise<PaperTrade[]> {
    // If profileName is specified and different from current, delegate to a sub-trader
    if (profileName && profileName !== this.profileName) {
      const subTrader = new PaperTrader({
        ...this.config,
        profileName,
      });
      const restored = await subTrader.load();
      if (!restored) {
        // Profile doesn't exist — create it with default balance
        await subTrader.save();
      }
      const result = await subTrader.agentPlay(recommendations, maxPerTrade, minConfidence, maxPositions);
      await subTrader.save();
      return result;
    }

    const executed: PaperTrade[] = [];

    // Sort by confidence descending
    const sorted = [...recommendations].sort((a, b) => b.confidence - a.confidence);

    for (const rec of sorted) {
      // Defense against upstream scale confusion: clamp confidence to [0,1]
      const conf = Number.isFinite(rec.confidence)
        ? Math.min(1, Math.max(0, rec.confidence))
        : 0;
      if (conf < minConfidence) continue;

      if (rec.action === 'buy' && this.state.cash > 0) {
        // Honour maxPositions: skip if already holding maxPositions distinct tokens
        if (this.state.holdings.length >= maxPositions) continue;

        // Determine position size proportional to confidence
        const alloc = Math.min(maxPerTrade, this.state.cash * conf);
        if (alloc <= 0) continue;

        const amount = alloc / rec.currentPrice;
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const trade = await this.buy(rec.symbol, amount, rec.reason);
        if (trade) executed.push(trade);
      } else if (rec.action === 'sell') {
        // Sell partial holding proportional to confidence
        const holding = this.state.holdings.find(h => h.symbol === rec.symbol);
        if (holding) {
          const sellAmount = holding.amount * conf;
          if (sellAmount > 0) {
            const trade = await this.sell(rec.symbol, sellAmount, rec.reason);
            if (trade) executed.push(trade);
          }
        }
      }
    }

    return executed;
  }

  // ── Profile support ──

  /** Directory containing per-profile state files */
  private get profilesDir(): string {
    const baseDir = expandHome(this.config.dataDir);
    return `${baseDir}/paper-trade/profiles`;
  }

  /** Path to last-profile.txt which stores the active profile name */
  private get lastProfilePath(): string {
    const baseDir = expandHome(this.config.dataDir);
    return `${baseDir}/paper-trade/last-profile.txt`;
  }

  /** Path to the per-profile state file */
  private get stateFilePath(): string {
    const dir = this.profilesDir;
    const fullPath = path.resolve(path.join(dir, `${this.profileName}.json`));
    // Defense-in-depth: verify resolved path stays within profilesDir
    const baseDir = path.resolve(dir);
    if (!fullPath.startsWith(baseDir + path.sep)) {
      throw new Error(`Path traversal blocked for profile: ${this.profileName}`);
    }
    return fullPath;
  }

  /**
   * Validate that a parsed object conforms to PortfolioState shape.
   */
  private validatePortfolioState(data: unknown): data is PortfolioState {
    if (typeof data !== 'object' || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d.cash === 'number' &&
      Array.isArray(d.holdings) &&
      Array.isArray(d.trades) &&
      (d.startBalance === undefined || typeof d.startBalance === 'number')
    );
  }

  /**
   * Save the current portfolio state to a JSON file (profile wrapper format).
   * Also writes last-profile.txt with the active profile name.
   * @param updateActiveProfile When false, skip writing last-profile.txt (for --profile overrides)
   */
  async save(updateActiveProfile: boolean = true): Promise<void> {
    const filePath = this.stateFilePath;

    // Ensure profiles directory exists
    const fs = await import('node:fs');
    fs.mkdirSync(this.profilesDir, { recursive: true });

    const profileData: ProfileStateFile = {
      version: 2,
      profileName: this.profileName,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      state: this.state,
    };

    // Atomic write (prevent corruption)
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(profileData, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);

    // Update last-profile.txt (skip for --profile temporary overrides)
    if (updateActiveProfile) {
      fs.writeFileSync(this.lastProfilePath, `${this.profileName}\n`, 'utf-8');
    }
  }

  /**
   * Load portfolio state from a JSON file (profile-aware).
   * Returns true if state was restored, false if no save file exists.
   *
   * Load order:
   * 1. Try profiles/<profileName>.json
   * 2. If not found, try legacy paper-trader-state.json (migrate)
   * 3. If neither exists, return false (fresh state will be used)
   */
  async load(): Promise<boolean> {
    const fs = await import('node:fs');
    const path = await import('node:path');

    // Ensure profiles dir exists
    fs.mkdirSync(this.profilesDir, { recursive: true });

    const profilePath = this.stateFilePath;
    const dir = expandHome(this.config.dataDir);
    const legacyPath = path.join(dir, 'paper-trader-state.json');

    // 1. Try profile file
    if (existsSync(profilePath)) {
      try {
        const raw = fs.readFileSync(profilePath, 'utf-8');
        const data = JSON.parse(raw) as ProfileStateFile;

        if (data.version !== 2 || !data.state) return false;
        if (!this.validatePortfolioState(data.state)) return false;

        this.state = data.state;
        this.createdAt = data.createdAt;
        return true;
      } catch (err) {
        logWarn("paper-trade", "Profile load failed, starting fresh", err);
        return false;
      }
    }

    // 2. Try legacy migration
    if (existsSync(legacyPath)) {
      try {
        const raw = fs.readFileSync(legacyPath, 'utf-8');
        const legacyState = JSON.parse(raw) as PortfolioState;
        if (!this.validatePortfolioState(legacyState)) return false;

        this.state = legacyState;
        this.createdAt = new Date().toISOString();

        // Immediately save in new format (migrates + writes last-profile)
        await this.save();
        logWarn("paper-trade", `Migrated legacy state to profile "${this.profileName}"`);
        return true;
      } catch (err) {
        logWarn("paper-trade", "Legacy migration load failed", err);
      }
    }

    // 3. No state found
    return false;
  }

  /**
   * Export state as a JSON-serializable object.
   */
  toJSON(): PortfolioState {
    return { ...this.state, holdings: [...this.state.holdings], trades: [...this.state.trades] };
  }

  // ── Reset ──

  /**
   * Reset the portfolio to initial state (fresh $10,000 wallet).
   */
  reset(): void {
    this.state = {
      cash: this.config.startingBalance,
      holdings: [],
      trades: [],
      startBalance: this.config.startingBalance,
    };
    this.tokenCache.clear();
  }

  /**
   * Get the total number of trades executed.
   */
  get tradeCount(): number {
    return this.state.trades.length;
  }

  /**
   * Switch this PaperTrader instance to a different profile.
   * Loads the profile's state from disk and clears the price cache.
   * @returns true if the profile existed and was loaded, false if it was created fresh.
   */
  async switchProfile(profileName: string): Promise<boolean> {
    this.profileName = profileName;
    this.tokenCache.clear();
    this.reset();
    return this.load();
  }

  /**
   * Export closed trades and telemetry state into an AI-ready dataset.
   * @param outputPath Optional file path to write dataset to
   * @param format 'jsonl' or 'csv'
   * @returns The generated dataset content string
   */
  exportDataset(outputPath?: string, format: 'jsonl' | 'csv' = 'jsonl'): string {
    const closedTrades = this.state.trades.filter(t => t.type === 'sell' && typeof t.pnl === 'number');
    if (closedTrades.length === 0) {
      const emptyOut = format === 'csv' ? 'tradeId,symbol,side,entryPrice,exitPrice,pnl,win\n' : '';
      if (outputPath) {
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, emptyOut, 'utf-8');
      }
      return emptyOut;
    }

    if (format === 'csv') {
      const headers = [
        'tradeId',
        'symbol',
        'type',
        'amount',
        'price',
        'total',
        'pnl',
        'fee',
        'slippage',
        'orderType',
        'mfe',
        'mae',
        'holdingDurationMs',
        'win',
        'timestamp',
      ];
      const lines = [headers.join(',')];
      for (const t of closedTrades) {
        const win = (t.pnl ?? 0) > 0 ? 1 : 0;
        lines.push([
          t.id,
          t.symbol,
          t.type,
          t.amount,
          t.price,
          t.total,
          t.pnl ?? 0,
          t.fee ?? 0,
          t.slippage ?? 0,
          t.orderType ?? 'market',
          t.mfe ?? 0,
          t.mae ?? 0,
          t.holdingDurationMs ?? 0,
          win,
          `"${t.timestamp}"`,
        ].join(','));
      }
      const output = lines.join('\n') + '\n';
      if (outputPath) {
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, output, 'utf-8');
      }
      return output;
    }

    // JSONL format
    const lines: string[] = [];
    for (const t of closedTrades) {
      const win = (t.pnl ?? 0) > 0 ? 1 : 0;
      const row: Record<string, unknown> = {
        tradeId: t.id,
        profile: this.profileName,
        symbol: t.symbol,
        tokenId: t.tokenId,
        type: t.type,
        amount: t.amount,
        exitPrice: t.price,
        totalUsd: t.total,
        pnlUsd: t.pnl ?? 0,
        pnlPercent: t.total > 0 && t.pnl !== undefined ? ((t.pnl / (t.total - t.pnl)) * 100) : 0,
        feeUsd: t.fee ?? 0,
        slippagePercent: t.slippage ?? 0,
        orderType: t.orderType ?? 'market',
        mfePercent: t.mfe ?? 0,
        maePercent: t.mae ?? 0,
        holdingDurationMs: t.holdingDurationMs ?? 0,
        win,
        timestamp: t.timestamp,
        reason: t.reason ?? '',
      };

      // Flatten telemetry features into top-level feature keys if present
      if (t.telemetry && typeof t.telemetry === 'object') {
        for (const [k, v] of Object.entries(t.telemetry)) {
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
              row[`feat_${k}_${subK}`] = subV;
            }
          } else {
            row[`feat_${k}`] = v;
          }
        }
      }

      lines.push(JSON.stringify(row));
    }

    const output = lines.join('\n') + (lines.length > 0 ? '\n' : '');
    if (outputPath) {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, output, 'utf-8');
    }
    return output;
  }

  /**
   * Run a multi-profile comparison (RL-style training).
   * Creates one PaperTrader per profile with the specified difficulty,
   * runs agentPlay on each with the same signal data, persists all,
   * then returns a ranked comparison sorted by PnL descending.
   *
   * @param profiles Array of profile configs with name and difficulty
   * @param opts Optional settings: dataDir, maxPerTrade, minConfidence
   * @returns Ranked array of ProfileResult sorted by PnL descending
   */
  static async runComparison(
    profiles: Array<{ name: string; difficulty: Difficulty; maxPositions?: number }>,
    opts?: { dataDir?: string; maxPerTrade?: number; minConfidence?: number },
  ): Promise<ProfileResult[]> {
    const dataDir = opts?.dataDir ?? loadConfig().dataDir;
    const maxPerTrade = opts?.maxPerTrade ?? 1000;
    const minConfidence = opts?.minConfidence ?? 0.3;

    // Get signal data from an ephemeral trader
    const signalTrader = new PaperTrader({ dataDir });
    const recommendations = await signalTrader.getSignalRecommendations();

    const results: ProfileResult[] = [];

    for (const profile of profiles) {
      const trader = new PaperTrader({
        dataDir,
        profileName: profile.name,
        difficulty: profile.difficulty,
      });

      // Reset to ensure clean state
      trader.reset();

      await trader.agentPlay(
        recommendations,
        maxPerTrade,
        minConfidence,
        profile.maxPositions ?? 5,
      );

      await trader.save();

      const report = await trader.getReport();

      results.push({
        profileName: profile.name,
        difficulty: profile.difficulty,
        startBalance: trader.startBalance,
        currentBalance: report.totalEquity,
        totalPnl: report.totalReturn,
        winRate: report.winRate,
        tradeCount: report.totalTrades,
        sharpeLike: report.sharpeRatio,
      });
    }

    // Sort by PnL descending
    results.sort((a, b) => b.totalPnl - a.totalPnl);

    return results;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Factory function
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create a new PaperTrader instance.
 * Automatically tries to restore state from disk if available.
 *
 * @param config Optional configuration
 * @returns Configured PaperTrader instance
 */
export function createPaperTrader(config?: PaperTraderConfig): PaperTrader {
  return new PaperTrader(config);
}

// ═══════════════════════════════════════════════════════════════════════
// Profile management functions
// ═══════════════════════════════════════════════════════════════════════

/**
 * List all available profiles with summary metadata.
 * Returns an empty array if the profiles directory doesn't exist.
 */
export async function listProfiles(dataDir?: string): Promise<ProfileSummary[]> {
  const baseDir = expandHome(dataDir ?? loadConfig().dataDir);
  const profilesDir = `${baseDir}/paper-trade/profiles`;
  const fs = await import('node:fs');
  const path = await import('node:path');

  if (!existsSync(profilesDir)) return [];

  const files = fs.readdirSync(profilesDir)
    .filter((f: string) => f.endsWith('.json'))
    .sort();

  const profiles: ProfileSummary[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(profilesDir, file), 'utf-8');
      const data = JSON.parse(raw) as ProfileStateFile;
      profiles.push({
        profileName: data.profileName,
        cash: data.state.cash,
        tradeCount: data.state.trades.length,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    } catch (err) {
      logWarn("paper-trade", "Corrupt profile file skipped", err);
    }
  }
  return profiles;
}

/**
 * Read the active profile name from last-profile.txt.
 * Returns "trader1" if the file doesn't exist or can't be read.
 */
export function getActiveProfileName(dataDir?: string): string {
  const baseDir = expandHome(dataDir ?? loadConfig().dataDir);
  const lastProfilePath = `${baseDir}/paper-trade/last-profile.txt`;
  try {
    return readFileSync(lastProfilePath, 'utf-8').trim();
  } catch (err) {
    logWarn("paper-trade", "Last-profile file unreadable, using default", err);
    return 'trader1';
  }
}
