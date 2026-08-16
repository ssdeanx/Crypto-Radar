import { describe, it, expect } from 'vitest';
import { evaluateAgentPerformance } from './agent-eval.js';
import type { PaperTrade } from '../paper-trade.js';

describe('Paper Trading Agent Evaluation Scorecard Engine', () => {
  it('returns zeroes for empty trade history', () => {
    const card = evaluateAgentPerformance('empty-profile', []);
    expect(card.totalTrades).toBe(0);
    expect(card.completedTrades).toBe(0);
    expect(card.profitFactor).toBe(0);
    expect(card.sharpeRatio).toBe(0);
  });

  it('computes complete performance scorecard for trading history', () => {
    const mockTrades: PaperTrade[] = [
      {
        id: '1',
        type: 'buy',
        symbol: 'SOL',
        tokenId: 'solana',
        amount: 10,
        price: 100,
        total: 1000,
        timestamp: '2026-08-15T00:00:00Z',
      },
      {
        id: '2',
        type: 'sell',
        symbol: 'SOL',
        tokenId: 'solana',
        amount: 10,
        price: 110,
        total: 1100,
        pnl: 100,
        fee: 1.0,
        holdingDurationMs: 3600000,
        mfe: 12.0,
        mae: 2.0,
        telemetry: { confidence: 0.85, regime: 'trending_up' },
        timestamp: '2026-08-15T01:00:00Z',
      },
      {
        id: '3',
        type: 'sell',
        symbol: 'ETH',
        tokenId: 'ethereum',
        amount: 1,
        price: 2700,
        total: 2700,
        pnl: -50,
        fee: 1.5,
        holdingDurationMs: 1800000,
        mfe: 1.0,
        mae: 3.5,
        telemetry: { confidence: 0.60, regime: 'choppy' },
        timestamp: '2026-08-15T02:00:00Z',
      },
    ];

    const card = evaluateAgentPerformance('alpha-agent', mockTrades, 10000);

    expect(card.totalTrades).toBe(3);
    expect(card.completedTrades).toBe(2);
    expect(card.winRatePct).toBe(50.0);
    expect(card.profitFactor).toBe(2.0); // $100 profit / $50 loss = 2.0
    expect(card.totalRealizedPnlUsd).toBe(47.5); // 100 - 1 - 50 - 1.5 = 47.5
    expect(card.avgHoldingDurationMinutes).toBe(45); // (60 + 30) / 2 = 45 mins
    expect(card.regimeBreakdown['trending_up']?.winRatePct).toBe(100);
    expect(card.regimeBreakdown['choppy']?.winRatePct).toBe(0);
  });
});
