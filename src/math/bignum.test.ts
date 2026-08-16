import { describe, it, expect } from 'vitest';
import { computeExactCompounding, evaluateArbitrageCycle, type ArbitrageHop } from './bignum.js';

describe('High-Precision Financial Arithmetic Engine (BigNumber MathJS)', () => {
  it('computes exact zero-loss trade compounding and fee deductions', () => {
    const tradeReturns = [0.10, -0.05, 0.20]; // 10% gain, 5% loss, 20% gain
    const res = computeExactCompounding(10000, tradeReturns, 0.001, 0.0005);

    expect(Number(res.initialCapital)).toBe(10000);
    expect(Number(res.finalCapital)).toBeGreaterThan(12000);
    expect(Number(res.netPnl)).toBeGreaterThan(2000);
    expect(Number(res.totalFeesPaid)).toBeGreaterThan(0);
    expect(Number(res.totalSlippagePaid)).toBeGreaterThan(0);
  });

  it('evaluates profitable cross-token arbitrage cycle', () => {
    // 3-hop triangle: Token A -> Token B -> Token C -> Token A
    const hops: ArbitrageHop[] = [
      { fromSymbol: 'USDT', toSymbol: 'SOL', exchangeRate: 1 / 150, takerFeeRate: 0.0005, slippageRate: 0.0001 },
      { fromSymbol: 'SOL', toSymbol: 'ETH', exchangeRate: 150 / 2500, takerFeeRate: 0.0005, slippageRate: 0.0001 },
      { fromSymbol: 'ETH', toSymbol: 'USDT', exchangeRate: 2600, takerFeeRate: 0.0005, slippageRate: 0.0001 }, // 2600 gives ~3.8% arbitrage spread
    ];

    const arb = evaluateArbitrageCycle(1000, hops);
    expect(arb.isProfitable).toBe(true);
    expect(arb.netMultiplier).toBeGreaterThan(1.0);
    expect(Number(arb.outputAmount)).toBeGreaterThan(1000);
  });

  it('detects unprofitable arbitrage cycle eaten by fees', () => {
    const hops: ArbitrageHop[] = [
      { fromSymbol: 'USDT', toSymbol: 'SOL', exchangeRate: 1 / 150, takerFeeRate: 0.01, slippageRate: 0.01 },
      { fromSymbol: 'SOL', toSymbol: 'USDT', exchangeRate: 150, takerFeeRate: 0.01, slippageRate: 0.01 },
    ];

    const arb = evaluateArbitrageCycle(1000, hops);
    expect(arb.isProfitable).toBe(false);
    expect(arb.netMultiplier).toBeLessThan(1.0);
  });
});
