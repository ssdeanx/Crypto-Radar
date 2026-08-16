// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — High-Precision Financial Arithmetic Engine (BigNumber)
// ═══════════════════════════════════════════════════════════════════════
//
// Institutional arbitrary-precision mathematical operations via MathJS BigNumber:
// - Exact zero-loss trade compounding over N periods
// - Multi-tier fee stacking & slippage decay calculation
// - Cross-token cyclic arbitrage net multiplier validation
// ═══════════════════════════════════════════════════════════════════════

import * as math from 'mathjs';

export interface ExactTradeResult {
  initialCapital: string;
  finalCapital: string;
  netPnl: string;
  netPnlPercentage: string;
  totalFeesPaid: string;
  totalSlippagePaid: string;
}

export interface ArbitrageHop {
  fromSymbol: string;
  toSymbol: string;
  exchangeRate: number; // e.g. SOL -> USDC @ 150
  takerFeeRate: number; // e.g. 0.001 (0.1%)
  slippageRate: number; // e.g. 0.0005 (0.05%)
}

/**
 * Computes exact compounded portfolio return over a sequence of trade returns, fees, and slippages.
 *
 * @param startingCapital - Initial account balance (e.g. 10000.0)
 * @param tradeReturns - Array of percentage returns per trade (e.g. [0.05, -0.02, 0.03])
 * @param feeRate - Fixed taker fee rate per trade (e.g. 0.001)
 * @param slippageRate - Fixed slippage rate per trade (e.g. 0.0005)
 */
export function computeExactCompounding(
  startingCapital: number | string,
  tradeReturns: number[],
  feeRate = 0.001,
  slippageRate = 0.0005,
): ExactTradeResult {
  let capital = math.bignumber(startingCapital);
  const initial = math.bignumber(startingCapital);
  let totalFees = math.bignumber(0);
  let totalSlippage = math.bignumber(0);

  const feeFrac = math.bignumber(feeRate);
  const slipFrac = math.bignumber(slippageRate);

  for (const ret of tradeReturns) {
    const retFrac = math.bignumber(ret);

    // Apply gross trade return: capital = capital * (1 + ret)
    const grossMultiplier = math.add(math.bignumber(1), retFrac) as math.BigNumber;
    capital = math.multiply(capital, grossMultiplier) as math.BigNumber;

    // Apply fee: fee = capital * feeRate
    const fee = math.multiply(capital, feeFrac) as math.BigNumber;
    totalFees = math.add(totalFees, fee) as math.BigNumber;
    capital = math.subtract(capital, fee) as math.BigNumber;

    // Apply slippage: slippage = capital * slippageRate
    const slip = math.multiply(capital, slipFrac) as math.BigNumber;
    totalSlippage = math.add(totalSlippage, slip) as math.BigNumber;
    capital = math.subtract(capital, slip) as math.BigNumber;
  }

  const netPnl = math.subtract(capital, initial) as math.BigNumber;
  const netPnlPct = math.multiply(
    math.divide(netPnl, initial) as math.BigNumber,
    math.bignumber(100),
  ) as math.BigNumber;

  return {
    initialCapital: math.format(initial, { precision: 8 }),
    finalCapital: math.format(capital, { precision: 8 }),
    netPnl: math.format(netPnl, { precision: 8 }),
    netPnlPercentage: `${math.format(netPnlPct, { precision: 4 })}%`,
    totalFeesPaid: math.format(totalFees, { precision: 8 }),
    totalSlippagePaid: math.format(totalSlippage, { precision: 8 }),
  };
}

/**
 * Validates whether a cyclic multi-hop arbitrage path yields a positive net return after fees.
 * Path: A -> B -> C -> A
 *
 * @param initialAmount - Input token amount
 * @param hops - Sequence of exchange hops
 */
export function evaluateArbitrageCycle(
  initialAmount: number | string,
  hops: ArbitrageHop[],
): { isProfitable: boolean; netMultiplier: number; outputAmount: string; profitPercentage: string } {
  if (hops.length === 0) {
    const initStr = String(initialAmount);
    return { isProfitable: false, netMultiplier: 1.0, outputAmount: initStr, profitPercentage: '0.00%' };
  }

  let current = math.bignumber(initialAmount);
  const start = math.bignumber(initialAmount);
  let cumulativeMultiplier = math.bignumber(1);

  for (const hop of hops) {
    const rate = math.bignumber(hop.exchangeRate);
    const fee = math.bignumber(hop.takerFeeRate);
    const slip = math.bignumber(hop.slippageRate);

    // Effective hop multiplier = rate * (1 - fee) * (1 - slip)
    const afterFee = math.subtract(math.bignumber(1), fee) as math.BigNumber;
    const afterSlip = math.subtract(math.bignumber(1), slip) as math.BigNumber;
    const hopMult = math.multiply(math.multiply(rate, afterFee) as math.BigNumber, afterSlip) as math.BigNumber;

    current = math.multiply(current, hopMult) as math.BigNumber;
    cumulativeMultiplier = math.multiply(cumulativeMultiplier, hopMult) as math.BigNumber;
  }

  const pnlPct = math.multiply(
    math.divide(math.subtract(current, start) as math.BigNumber, start) as math.BigNumber,
    math.bignumber(100),
  ) as math.BigNumber;

  const multNum = Number(math.format(cumulativeMultiplier, { precision: 6 }));
  const isProfitable = multNum > 1.0;

  return {
    isProfitable,
    netMultiplier: multNum,
    outputAmount: math.format(current, { precision: 8 }),
    profitPercentage: `${math.format(pnlPct, { precision: 4 })}%`,
  };
}
