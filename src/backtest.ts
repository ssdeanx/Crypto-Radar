// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Signal Backtesting Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Evaluates signal accuracy by comparing predicted direction to actual
// price movement over a configurable horizon.
//
// Methodology:
//   1. For each signal, locate the matching kline by symbol + close price
//   2. Look N candles ahead from that position
//   3. A signal is "correct" if price moved in the predicted direction
//   4. Reports: win rate, avg return per signal, Sharpe-like ratio,
//      max drawdown, per-direction breakdown
//
// Two operating modes:
//   - Live (from scan): signals at the latest kline; uses the history
//     of klines to validate whether recent price action is consistent
//     with the signal direction.
//   - Historical (from CSV log): signals from the past, each with a
//     timestamp; checks actual subsequent price movement.
//
// No external deps — runs against kline data we already fetch.
//
// Weight Optimization:
//   optimizeWeights() uses iterative grid search to find optimal
//   strategy weights (momentum, mean-reversion, trend-following)
//   by maximizing Sharpe ratio, win rate, or total return.
//   CLI: crypto-radar backtest

import type { Kline } from './types.js';
import type { AggregatedSignal, SignalDirection, StrategySignal } from './analysis/strategies.js';
import { logger } from './core/logger.js';
import { mean, sampleStandardDeviation } from './math/index.js';

// ── Types ──

export interface BacktestResult {
  symbol: string;
  totalSignals: number;
  wins: number;
  losses: number;
  winRate: number;          // 0-1
  totalReturn: number;      // % return if all signals traded
  avgReturn: number;        // avg % per signal
  maxDrawdown: number;      // worst peak-to-trough (as negative %)
  sharpeRatio: number;      // risk-adjusted return
  byDirection: {
    buy: { total: number; wins: number; avgReturn: number };
    sell: { total: number; wins: number; avgReturn: number };
    strong_buy: { total: number; wins: number; avgReturn: number };
    strong_sell: { total: number; wins: number; avgReturn: number };
  };
  /** Optional equity curve values (cumulative returns over time) */
  equityCurve?: number[];
}

export interface BacktestOptions {
  /** How many candles ahead to check (default: 1) */
  horizon: number;
  /** Minimum confidence threshold (0-1, default: 0) */
  minConfidence: number;
  /**
   * Match mode:
   * - 'forward' (default): signal is at the latest kline, validate
   *   against the prior `horizon` candles (retrospective check).
   * - 'historical': signals each have a timestamp, find the kline
   *   whose openTime is nearest, then look `horizon` candles ahead.
   */
  mode?: 'forward' | 'historical';
}

const DEFAULT_OPTIONS: BacktestOptions = {
  horizon: 1,
  minConfidence: 0,
  mode: 'forward',
};

/**
 * Results aggregated across all symbols.
 */
export interface AggregatedBacktestResult {
  bySymbol: Map<string, BacktestResult>;
  totals: BacktestResult;
}

// ── Core backtest ──

/**
 * Run backtest on a set of signals with associated kline data.
 *
 * @param signals Aggregated signals from the strategy engine
 * @param klinesBySymbol Map of symbol → Kline[] (chronological, oldest first)
 * @param options Backtest options (horizon, minConfidence, mode)
 * @returns Per-symbol and aggregated backtest results
 */
export function runBacktest(
  signals: AggregatedSignal[],
  klinesBySymbol: Map<string, Kline[]>,
  options: BacktestOptions = DEFAULT_OPTIONS,
): AggregatedBacktestResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Group signals by symbol
  const signalsBySymbol = new Map<string, AggregatedSignal[]>();
  for (const sig of signals) {
    // Skip neutral signals and low-confidence signals
    if (sig.direction === 'neutral') continue;
    if (!Number.isFinite(sig.compositeConfidence) || sig.compositeConfidence < opts.minConfidence) continue;

    const arr = signalsBySymbol.get(sig.symbol) ?? [];
    arr.push(sig);
    signalsBySymbol.set(sig.symbol, arr);
  }

  const bySymbol = new Map<string, BacktestResult>();

  for (const [symbol, symSignals] of signalsBySymbol) {
    const klines = klinesBySymbol.get(symbol);
    if (!klines || klines.length < opts.horizon + 1) continue;

    const result = backtestSymbol(symSignals, klines, opts);
    bySymbol.set(symbol, result);
  }

  const totals = aggregateResults(Array.from(bySymbol.values()));

  return { bySymbol, totals };
}

/**
 * Run backtest for a single symbol's signals.
 */
function backtestSymbol(
  signals: AggregatedSignal[],
  klines: Kline[],
  opts: BacktestOptions,
): BacktestResult {
  const byDirection = {
    buy: { total: 0, wins: 0, avgReturn: 0 },
    sell: { total: 0, wins: 0, avgReturn: 0 },
    strong_buy: { total: 0, wins: 0, avgReturn: 0 },
    strong_sell: { total: 0, wins: 0, avgReturn: 0 },
  };

  type TradeOutcome = { win: boolean; returnPct: number };
  const allOutcomes: TradeOutcome[] = [];

  for (const signal of signals) {
    const klineIndex = findSignalKlineIndex(signal, klines, opts.mode ?? 'forward');
    if (klineIndex < 0) continue;

    const lookahead = klineIndex + opts.horizon;
    if (lookahead >= klines.length) continue;

    const entryKline = klines[klineIndex]!;
    const exitKline = klines[lookahead]!;
    const effectiveDirection = signal.direction === 'strong_buy'
      ? 'buy'
      : signal.direction === 'strong_sell'
        ? 'sell'
        : signal.direction;

    // Calculate actual price change
    const priceChange = exitKline.close - entryKline.close;
    const returnPct = entryKline.close > 0
      ? (priceChange / entryKline.close) * 100
      : 0;

    // Determine if signal was correct
    const isWin = effectiveDirection === 'buy'
      ? priceChange >= 0
      : priceChange <= 0;

    const outcome: TradeOutcome = { win: isWin, returnPct };
    allOutcomes.push(outcome);

    // Update per-direction stats
    const dir = signal.direction as keyof typeof byDirection;
    if (dir in byDirection) {
      byDirection[dir].total++;
      if (isWin) byDirection[dir].wins++;
      byDirection[dir].avgReturn += returnPct;
    }
  }

  // Compute averages
  for (const key of Object.keys(byDirection) as Array<keyof typeof byDirection>) {
    const d = byDirection[key];
    if (d.total > 0) {
      d.avgReturn = parseFloat((d.avgReturn / d.total).toFixed(4));
    }
  }

  const totalSignals = allOutcomes.length;
  const wins = allOutcomes.filter(o => o.win).length;
  const losses = totalSignals - wins;
  const winRate = totalSignals > 0 ? wins / totalSignals : 0;

  const totalReturn = allOutcomes.reduce((s, o) => s + o.returnPct, 0);
  const avgReturn = totalSignals > 0 ? totalReturn / totalSignals : 0;

  // Max drawdown: running sum of returns, track peak-to-trough
  let maxDrawdown = 0;
  let peak = 0;
  let runningSum = 0;
  for (const o of allOutcomes) {
    runningSum += o.returnPct;
    if (runningSum > peak) peak = runningSum;
    const drawdown = peak - runningSum;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Sharpe-like ratio: avgReturn / stdDev (annualized approximation)
  const sharpeRatio = computeSharpe(allOutcomes.map(o => o.returnPct));

  return {
    symbol: signals[0]!.symbol,
    totalSignals,
    wins,
    losses,
    winRate: parseFloat(winRate.toFixed(4)),
    totalReturn: parseFloat(totalReturn.toFixed(4)),
    avgReturn: parseFloat(avgReturn.toFixed(4)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
    sharpeRatio,
    byDirection,
  };
}

/**
 * Find the kline array index corresponding to this signal.
 *
 * In 'forward' mode, the signal was generated at the latest kline
 * (last element in the array). In 'historical' mode, we find the
 * kline whose openTime is closest to the signal's timestamp.
 */
function findSignalKlineIndex(
  signal: AggregatedSignal,
  klines: Kline[],
  mode: 'forward' | 'historical',
): number {
  if (mode === 'forward') {
    // Signal is at the latest kline position
    // Match by close price proximity (within 0.5% tolerance)
    const price = signal.lastPrice;
    for (let i = klines.length - 1; i >= Math.max(0, klines.length - 10); i--) {
      const k = klines[i]!;
      if (k.close > 0) {
        const diff = Math.abs(k.close - price) / k.close;
        if (diff < 0.005) return i; // within 0.5%
      }
    }
    // Fallback: use the last kline
    logger.debug(`Signal for ${signal.symbol}: lastPrice ${signal.lastPrice} didn't match any close within 0.5%% — matching to last kline (idx ${klines.length - 1})`);
    return klines.length - 1;
  }

  // Historical mode: match by timestamp
  const sigTs = new Date(signal.timestamp).getTime();
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < klines.length; i++) {
    const dist = Math.abs(klines[i]!.openTime - sigTs);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Compute a Sharpe-like ratio from per-trade returns.
 * Ratio > 1 is good, > 2 is very good, > 3 is excellent.
 * Returns 0 if there's no variability (all same return).
 */
function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;

  const n = returns.length;
  const avg = mean(returns);
  const stdDev = sampleStandardDeviation(returns);

  if (stdDev === 0) return 0;

  return parseFloat(((avg / stdDev) * Math.sqrt(n)).toFixed(4));
}

/**
 * Aggregate multiple per-symbol results into one combined result.
 */
function aggregateResults(results: BacktestResult[]): BacktestResult {
  if (results.length === 0) {
    return {
      symbol: '*ALL*',
      totalSignals: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalReturn: 0,
      avgReturn: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      byDirection: {
        buy: { total: 0, wins: 0, avgReturn: 0 },
        sell: { total: 0, wins: 0, avgReturn: 0 },
        strong_buy: { total: 0, wins: 0, avgReturn: 0 },
        strong_sell: { total: 0, wins: 0, avgReturn: 0 },
      },
    };
  }

  const aggregated: BacktestResult = {
    symbol: '*ALL*',
    totalSignals: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalReturn: 0,
    avgReturn: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    byDirection: {
      buy: { total: 0, wins: 0, avgReturn: 0 },
      sell: { total: 0, wins: 0, avgReturn: 0 },
      strong_buy: { total: 0, wins: 0, avgReturn: 0 },
      strong_sell: { total: 0, wins: 0, avgReturn: 0 },
    },
  };

  for (const r of results) {
    aggregated.totalSignals += r.totalSignals;
    aggregated.wins += r.wins;
    aggregated.losses += r.losses;
    aggregated.totalReturn += r.totalReturn;
    aggregated.avgReturn += r.avgReturn * r.totalSignals; // weighted sum
    aggregated.maxDrawdown = Math.max(aggregated.maxDrawdown, r.maxDrawdown);

    for (const key of Object.keys(aggregated.byDirection) as Array<keyof typeof aggregated.byDirection>) {
      aggregated.byDirection[key].total += r.byDirection[key].total;
      aggregated.byDirection[key].wins += r.byDirection[key].wins;
    }
  }

  aggregated.winRate = aggregated.totalSignals > 0
    ? aggregated.wins / aggregated.totalSignals
    : 0;
  aggregated.avgReturn = aggregated.totalSignals > 0
    ? aggregated.avgReturn / aggregated.totalSignals
    : 0;

  // Combined Sharpe (weighted average)
  let weightedSharpe = 0;
  for (const r of results) {
    weightedSharpe += r.sharpeRatio * r.totalSignals;
  }
  aggregated.sharpeRatio = aggregated.totalSignals > 0
    ? parseFloat((weightedSharpe / aggregated.totalSignals).toFixed(4))
    : 0;

  // Per-direction avg returns
  for (const key of Object.keys(aggregated.byDirection) as Array<keyof typeof aggregated.byDirection>) {
    const d = aggregated.byDirection[key];
    // Collect average from each result weighted by total
    let weightedSum = 0;
    let totalCount = 0;
    for (const r of results) {
      const rd = r.byDirection[key];
      if (rd.total > 0) {
        weightedSum += rd.avgReturn * rd.total;
        totalCount += rd.total;
      }
    }
    d.avgReturn = totalCount > 0
      ? parseFloat((weightedSum / totalCount).toFixed(4))
      : 0;
  }

  return aggregated;
}

// ── Weight Optimization ──

/**
 * Result of automated strategy weight optimization.
 */
export interface WeightOptimizationResult {
  /** Best performing weight combo */
  bestWeights: {
    momentum: number;
    meanReversion: number;
    trendFollowing: number;
  };
  /** Performance of the best combo */
  performance: {
    winRate: number;
    totalReturn: number;
    sharpeRatio: number;
  };
  /** How the current default weights compare */
  defaultPerformance: {
    winRate: number;
    totalReturn: number;
    sharpeRatio: number;
  } | null;
  /** Improvement from default */
  improvement: {
    winRate: number;       // percentage points
    totalReturn: number;   // percentage points
    sharpeRatio: number;   // points
  } | null;
  /** Number of combinations tested */
  combinationsTested: number;
  /** ISO-8601 timestamp of optimization run */
  timestamp: string;
}

/** Default strategy weights: momentum 0.4, mean-reversion 0.2, trend-following 0.4 */
const OPTIMIZE_DEFAULT_WEIGHTS = { momentum: 0.4, meanReversion: 0.2, trendFollowing: 0.4 };

/**
 * Generate all weight combinations that sum to 1.0 with a given step size.
 * Each combination respects a minimum weight threshold.
 */
function* generateWeightCombinations(
  step: number,
  minWeight: number,
): Generator<{ momentum: number; meanReversion: number; trendFollowing: number }> {
  const steps = Math.round(1 / step);
  for (let mi = 0; mi <= steps; mi++) {
    const m = Math.round(mi * step * 100) / 100;
    if (m < minWeight || m > 1) continue;
    for (let mri = 0; mri <= steps - mi; mri++) {
      const mr = Math.round(mri * step * 100) / 100;
      if (mr < minWeight) continue;
      const tf = Math.round((1 - m - mr) * 100) / 100;
      if (tf < minWeight) continue;
      yield { momentum: m, meanReversion: mr, trendFollowing: tf };
    }
  }
}

/**
 * Recompute a signal's direction and confidence using different strategy weights.
 * Mirrors the aggregation logic from StrategyEngine.aggregate() so that
 * the optimization accurately reflects how the strategy engine would behave
 * at runtime under those weights.
 */
function recompositeSignal(
  signal: AggregatedSignal,
  weights: { momentum: number; meanReversion: number; trendFollowing: number },
): AggregatedSignal {
  const totalWeight = weights.momentum + weights.meanReversion + weights.trendFollowing;
  const weightMap: Record<string, number> = {
    'momentum': weights.momentum,
    'mean-reversion': weights.meanReversion,
    'trend-following': weights.trendFollowing,
  };

  let weightedConfidence = 0;
  const dirVotes: { buy: number; sell: number; neutral: number; strong_buy: number; strong_sell: number } = {
    buy: 0, sell: 0, neutral: 0, strong_buy: 0, strong_sell: 0,
  };

  for (const raw of signal.signals) {
    const s: StrategySignal = raw;
    const w = weightMap[s.strategy] ?? (1 / Math.max(signal.signals.length, 1));
    const normalized = totalWeight > 0 ? w / totalWeight : w;
    weightedConfidence += s.confidence * normalized;
    const voteWeight = s.confidence * normalized;
    if (s.direction in dirVotes) {
      dirVotes[s.direction as keyof typeof dirVotes] += voteWeight;
    }
    if (s.direction === 'strong_buy') dirVotes['buy'] = (dirVotes['buy'] ?? 0) + voteWeight;
    if (s.direction === 'strong_sell') dirVotes['sell'] = (dirVotes['sell'] ?? 0) + voteWeight;
  }

  let direction: SignalDirection;
  const buyVotes = (dirVotes['buy'] ?? 0) + (dirVotes['strong_buy'] ?? 0);
  const sellVotes = (dirVotes['sell'] ?? 0) + (dirVotes['strong_sell'] ?? 0);
  if (buyVotes > sellVotes && buyVotes > 0.3) {
    direction = buyVotes > 0.5 ? 'strong_buy' : 'buy';
  } else if (sellVotes > buyVotes && sellVotes > 0.3) {
    direction = sellVotes > 0.5 ? 'strong_sell' : 'sell';
  } else {
    direction = 'neutral';
  }

  return {
    ...signal,
    direction,
    compositeConfidence: Math.round(weightedConfidence * 100) / 100,
  };
}

/**
 * Automatically find the best strategy weights for a given historical dataset.
 * Tests combinations of weights (e.g., stepping by 0.1) and picks the best
 * based on Sharpe ratio (risk-adjusted return).
 *
 * The function uses individual strategy signals stored within each
 * AggregatedSignal to recomposite direction/confidence under candidate
 * weights, then runs the standard backtest to score each combination.
 *
 * @param signals - Historical aggregated signals (must have individual
 *   strategy breakdowns in the `signals` array)
 * @param klinesBySymbol - Map of symbol → kline data (chronological,
 *   oldest first)
 * @param options - Optional tuning parameters
 * @returns Best weights found, their performance, comparison to defaults,
 *   and improvement metrics
 */
export function optimizeWeights(
  signals: AggregatedSignal[],
  klinesBySymbol: Map<string, Kline[]>,
  options?: {
    /** Step size for weight combinations (default: 0.1) */
    step?: number;
    /** Metric to optimize: 'sharpe' | 'winRate' | 'totalReturn' (default: 'sharpe') */
    metric?: 'sharpe' | 'winRate' | 'totalReturn';
    /** Minimum weight per strategy (default: 0.1) */
    minWeight?: number;
  },
): WeightOptimizationResult {
  const step = options?.step ?? 0.1;
  const metric = options?.metric ?? 'sharpe';
  const minWeight = options?.minWeight ?? 0.1;

  // Only consider signals that have individual strategy breakdowns
  const validSignals = signals.filter(s => s.signals && s.signals.length > 0);
  if (validSignals.length === 0) {
    logger.warn('No signals with individual strategy data found — weight optimization requires signals from the strategy engine');
    return {
      bestWeights: { ...OPTIMIZE_DEFAULT_WEIGHTS },
      performance: { winRate: 0, totalReturn: 0, sharpeRatio: 0 },
      defaultPerformance: null,
      improvement: null,
      combinationsTested: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // Run default weights first for baseline comparison
  const defaultSignals = validSignals.map(s => recompositeSignal(s, OPTIMIZE_DEFAULT_WEIGHTS));
  const defaultResult = runBacktest(defaultSignals, klinesBySymbol);
  const defaultPerformance = {
    winRate: defaultResult.totals.winRate,
    totalReturn: defaultResult.totals.totalReturn,
    sharpeRatio: defaultResult.totals.sharpeRatio,
  };

  // Iteratively test every valid weight combination
  let bestWeights = { ...OPTIMIZE_DEFAULT_WEIGHTS };
  let bestPerformance = { ...defaultPerformance };
  let combinationsTested = 0;

  for (const combo of generateWeightCombinations(step, minWeight)) {
    const recomposited = validSignals.map(s => recompositeSignal(s, combo));
    if (recomposited.length === 0) continue;

    const result = runBacktest(recomposited, klinesBySymbol);
    combinationsTested++;

    const score = metric === 'winRate'
      ? result.totals.winRate
      : metric === 'totalReturn'
        ? result.totals.totalReturn
        : result.totals.sharpeRatio;

    const bestScore = metric === 'winRate'
      ? bestPerformance.winRate
      : metric === 'totalReturn'
        ? bestPerformance.totalReturn
        : bestPerformance.sharpeRatio;

    if (score > bestScore) {
      bestWeights = { ...combo };
      bestPerformance = {
        winRate: result.totals.winRate,
        totalReturn: result.totals.totalReturn,
        sharpeRatio: result.totals.sharpeRatio,
      };
    }
  }

  // Calculate deltas vs default
  const improvement = {
    winRate: parseFloat((bestPerformance.winRate - defaultPerformance.winRate).toFixed(4)),
    totalReturn: parseFloat((bestPerformance.totalReturn - defaultPerformance.totalReturn).toFixed(4)),
    sharpeRatio: parseFloat((bestPerformance.sharpeRatio - defaultPerformance.sharpeRatio).toFixed(4)),
  };

  return {
    bestWeights,
    performance: bestPerformance,
    defaultPerformance,
    improvement,
    combinationsTested,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format weight optimization results as a readable terminal table.
 *
 * @param result - The WeightOptimizationResult to format
 * @returns Colorized terminal string
 */
export function formatOptimization(result: WeightOptimizationResult): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║   Hermes Crypto Radar — Strategy Weight Optimization       ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');

  lines.push(`Combinations tested: ${result.combinationsTested}`);
  lines.push('');

  lines.push('── Best Weights ──');
  lines.push('');
  lines.push(`  Momentum:         ${coloredNum(result.bestWeights.momentum * 100, true, 4)}%`);
  lines.push(`  Mean Reversion:   ${coloredNum(result.bestWeights.meanReversion * 100, true, 4)}%`);
  lines.push(`  Trend Following:  ${coloredNum(result.bestWeights.trendFollowing * 100, true, 4)}%`);
  lines.push('');

  lines.push('── Best Performance ──');
  lines.push('');
  lines.push(`  Win Rate:         ${coloredPct(result.performance.winRate)}`);
  lines.push(`  Total Return:     ${coloredNum(result.performance.totalReturn, true)}%`);
  lines.push(`  Sharpe Ratio:     ${coloredNum(result.performance.sharpeRatio, result.performance.sharpeRatio >= 0)}`);
  lines.push('');

  if (result.defaultPerformance) {
    lines.push('── Default Performance (0.4, 0.2, 0.4) ──');
    lines.push('');
    lines.push(`  Win Rate:         ${coloredPct(result.defaultPerformance.winRate)}`);
    lines.push(`  Total Return:     ${coloredNum(result.defaultPerformance.totalReturn, true)}%`);
    lines.push(`  Sharpe Ratio:     ${coloredNum(result.defaultPerformance.sharpeRatio, result.defaultPerformance.sharpeRatio >= 0)}`);
    lines.push('');

    lines.push('── Improvement ──');
    lines.push('');

    const imp = result.improvement!;
    lines.push(`  Win Rate:         ${coloredNum(imp.winRate * 100, imp.winRate >= 0, 4)} pp`);
    lines.push(`  Total Return:     ${coloredNum(imp.totalReturn, imp.totalReturn >= 0)} pp`);
    lines.push(`  Sharpe Ratio:     ${coloredNum(imp.sharpeRatio, imp.sharpeRatio >= 0)} pts`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Formatting ──

/**
 * Calculate win rate as a percentage string from a result.
 */
export function winRate(result: BacktestResult): string {
  return `${(result.winRate * 100).toFixed(1)}%`;
}

/**
 * Calculate win rate as a percentage string from aggregated result.
 */
export function overallWinRate(aggregated: AggregatedBacktestResult): string {
  return winRate(aggregated.totals);
}

/**
 * Format backtest results as a readable terminal table.
 */
export function formatBacktest(aggregated: AggregatedBacktestResult): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║        Hermes Crypto Radar — Backtest Results              ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');

  // ── Totals ──
  const t = aggregated.totals;
  lines.push('── Overall ──');
  lines.push('');
  lines.push(`  Win Rate:        ${coloredPct(t.winRate)}  (${t.wins}/${t.totalSignals})`);
  lines.push(`  Total Return:    ${coloredNum(t.totalReturn, true)}%`);
  lines.push(`  Avg Return/Trade: ${coloredNum(t.avgReturn, true)}%`);
  lines.push(`  Max Drawdown:    ${coloredNum(-t.maxDrawdown, false)}%`);
  lines.push(`  Sharpe Ratio:    ${coloredNum(t.sharpeRatio, t.sharpeRatio >= 0)}`);
  lines.push('');

  // ── Per-direction breakdown ──
  lines.push('── By Direction ──');
  lines.push('');
  lines.push('  Direction      Total   Wins    Rate      Avg Return');
  lines.push('  ─────────      ─────   ────    ────      ──────────');

  for (const dir of ['strong_buy', 'buy', 'sell', 'strong_sell'] as const) {
    const d = aggregated.totals.byDirection[dir];
    if (d.total === 0) continue;
    const label = dir === 'strong_buy' ? 'Strong Buy ' :
                  dir === 'strong_sell' ? 'Strong Sell' :
                  dir === 'buy' ? 'Buy        ' : 'Sell       ';
    lines.push(
      `  ${label}  ${String(d.total).padStart(5)}  ${String(d.wins).padStart(5)}  ${coloredPct(d.wins / d.total, 4)}  ${coloredNum(d.avgReturn, true, 8)}%`,
    );
  }
  lines.push('');

  // ── Per-symbol breakdown ──
  if (aggregated.bySymbol.size > 0) {
    lines.push('── By Symbol ──');
    lines.push('');
    lines.push('  Symbol    Signals   Win Rate     Avg Return    Sharpe');
    lines.push('  ──────    ───────   ────────     ──────────    ──────');

    for (const [sym, r] of aggregated.bySymbol) {
      lines.push(
        `  ${sym.padEnd(8)} ${String(r.totalSignals).padStart(5)}     ${coloredPct(r.winRate, 4)}      ${coloredNum(r.avgReturn, true, 8)}%  ${coloredNum(r.sharpeRatio, r.sharpeRatio >= 0)}`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format individual backtest result.
 */
export function formatSingleBacktest(result: BacktestResult): string {
  const lines: string[] = [];

  lines.push(`Symbol:     ${result.symbol}`);
  lines.push(`Win Rate:   ${coloredPct(result.winRate)}  (${result.wins}/${result.totalSignals})`);
  lines.push(`Total Ret:  ${coloredNum(result.totalReturn, true)}%`);
  lines.push(`Avg Ret:    ${coloredNum(result.avgReturn, true)}%`);
  lines.push(`Max DD:     ${coloredNum(-result.maxDrawdown, false)}%`);
  lines.push(`Sharpe:     ${coloredNum(result.sharpeRatio, result.sharpeRatio >= 0)}`);

  return lines.join('\n');
}

// ── Helpers ──

function coloredPct(value: number, pad = 4): string {
  const pct = (value * 100).toFixed(1) + '%';
  const padded = pct.padStart(pad + 2);
  // Simple ASCII coloring (no picocolors dependency needed)
  if (value >= 0.6) return `\x1b[32m${padded}\x1b[0m`;  // green
  if (value >= 0.4) return `\x1b[33m${padded}\x1b[0m`;  // yellow
  if (value >= 0) return `\x1b[31m${padded}\x1b[0m`;    // red
  return padded;
}

function coloredNum(value: number, positive: boolean, pad = 6): string {
  const str = value.toFixed(2).padStart(pad);
  if (positive) return `\x1b[32m${str}\x1b[0m`;
  return `\x1b[31m${str}\x1b[0m`;
}
