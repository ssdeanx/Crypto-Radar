// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Paper Trading Agent Evaluation Scorecard
// ═══════════════════════════════════════════════════════════════════════
//
// Computes institutional-grade performance scorecards for trading agents:
// - Profit Factor & Mathematical Expectancy
// - Sharpe, Sortino & Calmar Ratios
// - Directional Hit Rate & Brier Calibration Score
// - MFE/MAE Excursion Efficiencies
// - Market Regime Scorecard (Bullish vs. Bearish vs. Choppy)
// ═══════════════════════════════════════════════════════════════════════

import type { PaperTrade } from '../paper-trade.js';
import {
  computeBrierScore,
  computeExpectedCalibrationError,
  computeSharpeRatio,
  computeSortinoRatio,
  computeMaxDrawdown,
} from '../math/eval.js';

export interface AgentPerformanceScorecard {
  profileName: string;
  totalTrades: number;
  completedTrades: number;
  winRatePct: number;
  profitFactor: number;
  expectancyUsd: number;
  totalRealizedPnlUsd: number;
  totalFeeUsd: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdownPct: number;
  brierScore: number;
  expectedCalibrationError: number;
  avgHoldingDurationMinutes: number;
  avgMfePercent: number;
  avgMaePercent: number;
  mfeToMaeRatio: number;
  regimeBreakdown: Record<string, { trades: number; winRatePct: number; pnlUsd: number }>;
}

/**
 * Evaluates an agent's complete paper-trading history and generates an audit scorecard.
 */
export function evaluateAgentPerformance(
  profileName: string,
  trades: readonly PaperTrade[],
  startBalance = 10000,
): AgentPerformanceScorecard {
  const sellTrades = trades.filter(t => t.type === 'sell' && t.pnl !== undefined);
  const totalTrades = trades.length;
  const completedTrades = sellTrades.length;

  if (completedTrades === 0) {
    return {
      profileName,
      totalTrades,
      completedTrades: 0,
      winRatePct: 0,
      profitFactor: 0,
      expectancyUsd: 0,
      totalRealizedPnlUsd: 0,
      totalFeeUsd: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      maxDrawdownPct: 0,
      brierScore: 0,
      expectedCalibrationError: 0,
      avgHoldingDurationMinutes: 0,
      avgMfePercent: 0,
      avgMaePercent: 0,
      mfeToMaeRatio: 1.0,
      regimeBreakdown: {},
    };
  }

  let grossProfits = 0;
  let grossLosses = 0;
  let wins = 0;
  let totalFees = 0;
  let totalHoldMs = 0;
  let totalMfe = 0;
  let totalMae = 0;
  let holdCount = 0;

  const returns: number[] = [];
  const confidences: number[] = [];
  const outcomes: number[] = [];
  const equityCurve: number[] = [startBalance];
  let runningCash = startBalance;

  const regimeMap: Record<string, { trades: number; wins: number; pnl: number }> = {};

  for (const t of sellTrades) {
    const pnl = t.pnl ?? 0;
    const fee = t.fee ?? 0;
    totalFees += fee;
    runningCash += pnl - fee;
    equityCurve.push(runningCash);

    const costBasis = t.total - pnl;
    const ret = costBasis > 0 ? pnl / costBasis : 0;
    returns.push(ret);

    if (pnl > 0) {
      grossProfits += pnl;
      wins++;
      outcomes.push(1);
    } else {
      grossLosses += Math.abs(pnl);
      outcomes.push(0);
    }

    const conf = (t.telemetry?.confidence as number | undefined) ?? 0.5;
    confidences.push(conf);

    if (t.holdingDurationMs) {
      totalHoldMs += t.holdingDurationMs;
      holdCount++;
    }
    if (t.mfe) totalMfe += t.mfe;
    if (t.mae) totalMae += t.mae;

    const regime = (t.telemetry?.regime as string | undefined) ?? 'unknown';
    if (!regimeMap[regime]) {
      regimeMap[regime] = { trades: 0, wins: 0, pnl: 0 };
    }
    regimeMap[regime]!.trades++;
    if (pnl > 0) regimeMap[regime]!.wins++;
    regimeMap[regime]!.pnl += pnl;
  }

  const winRate = (wins / completedTrades) * 100;
  const profitFactor = grossLosses > 0 ? Number((grossProfits / grossLosses).toFixed(2)) : grossProfits > 0 ? 99.99 : 0;
  const avgWin = wins > 0 ? grossProfits / wins : 0;
  const losses = completedTrades - wins;
  const avgLoss = losses > 0 ? grossLosses / losses : 0;
  const expectancy = ((winRate / 100) * avgWin) - (((100 - winRate) / 100) * avgLoss);

  const sharpe = computeSharpeRatio(returns);
  const sortino = computeSortinoRatio(returns);
  const ddInfo = computeMaxDrawdown(equityCurve);
  const totalPnl = runningCash - startBalance;
  const annualizedReturnPct = (totalPnl / startBalance) * 100;
  const calmar = ddInfo.maxDrawdownPct > 0 ? Number((annualizedReturnPct / ddInfo.maxDrawdownPct).toFixed(2)) : 0;

  const brier = computeBrierScore(confidences, outcomes);
  const ece = computeExpectedCalibrationError(confidences, outcomes);

  const avgHoldMin = holdCount > 0 ? (totalHoldMs / holdCount) / 60000 : 0;
  const avgMfe = completedTrades > 0 ? totalMfe / completedTrades : 0;
  const avgMae = completedTrades > 0 ? totalMae / completedTrades : 0;
  const mfeMaeRatio = avgMae > 0 ? Number((avgMfe / avgMae).toFixed(2)) : 1.0;

  const regimeBreakdown: Record<string, { trades: number; winRatePct: number; pnlUsd: number }> = {};
  for (const [r, stat] of Object.entries(regimeMap)) {
    regimeBreakdown[r] = {
      trades: stat.trades,
      winRatePct: stat.trades > 0 ? Number(((stat.wins / stat.trades) * 100).toFixed(1)) : 0,
      pnlUsd: Number(stat.pnl.toFixed(2)),
    };
  }

  return {
    profileName,
    totalTrades,
    completedTrades,
    winRatePct: Number(winRate.toFixed(1)),
    profitFactor,
    expectancyUsd: Number(expectancy.toFixed(2)),
    totalRealizedPnlUsd: Number(totalPnl.toFixed(2)),
    totalFeeUsd: Number(totalFees.toFixed(2)),
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    calmarRatio: calmar,
    maxDrawdownPct: ddInfo.maxDrawdownPct,
    brierScore: brier,
    expectedCalibrationError: ece,
    avgHoldingDurationMinutes: Number(avgHoldMin.toFixed(1)),
    avgMfePercent: Number(avgMfe.toFixed(2)),
    avgMaePercent: Number(avgMae.toFixed(2)),
    mfeToMaeRatio: mfeMaeRatio,
    regimeBreakdown,
  };
}
