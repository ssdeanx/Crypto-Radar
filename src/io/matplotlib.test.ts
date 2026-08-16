import { describe, it, expect } from 'vitest';
import {
  renderCandlestickDashboard,
  renderEfficientFrontier,
  renderCorrelationHeatmap,
  renderPaperTradingEquity,
} from './matplotlib.js';
import type { Kline } from '../types.js';

describe('Matplotlib Visuals Bridge', () => {
  const sampleKlines: Kline[] = Array.from({ length: 40 }, (_, i) => ({
    openTime: 1723700000000 + i * 3600000,
    open: 100 + Math.sin(i) * 5,
    high: 105 + Math.sin(i) * 5,
    low: 95 + Math.sin(i) * 5,
    close: 102 + Math.sin(i) * 5,
    volume: 1000 + i * 50,
    closeTime: 1723700000000 + (i + 1) * 3600000,
    quoteVolume: 100000,
    count: 100,
    takerBuyVol: 500,
    takerBuyQuoteVol: 50000,
    ignore: 0,
  }));

  it('renders candlestick dashboard as valid PNG buffer', async () => {
    const pngBuffer = await renderCandlestickDashboard('SOL', sampleKlines, 'png');
    expect(Buffer.isBuffer(pngBuffer)).toBe(true);
    expect(pngBuffer.length).toBeGreaterThan(1000);
    // Check PNG signature 89 50 4E 47
    expect(pngBuffer.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('renders efficient frontier as valid PNG buffer', async () => {
    const returns = [0.12, 0.18, 0.15];
    const cov = [
      [0.04, 0.01, 0.02],
      [0.01, 0.06, 0.03],
      [0.02, 0.03, 0.05],
    ];
    const weights = [0.3, 0.4, 0.3];
    const symbols = ['BTC', 'ETH', 'SOL'];

    const pngBuffer = await renderEfficientFrontier(returns, cov, weights, symbols, 'png');
    expect(Buffer.isBuffer(pngBuffer)).toBe(true);
    expect(pngBuffer.length).toBeGreaterThan(1000);
    expect(pngBuffer.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('renders correlation heatmap as valid PNG buffer', async () => {
    const matrix = [
      [1.0, 0.65, 0.72],
      [0.65, 1.0, 0.81],
      [0.72, 0.81, 1.0],
    ];
    const symbols = ['BTC', 'ETH', 'SOL'];

    const pngBuffer = await renderCorrelationHeatmap(matrix, symbols, 'png');
    expect(Buffer.isBuffer(pngBuffer)).toBe(true);
    expect(pngBuffer.length).toBeGreaterThan(1000);
    expect(pngBuffer.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('renders paper trading equity chart as valid PNG buffer', async () => {
    const trades = [
      { created_at: 1723700000000, pnl: 250 },
      { created_at: 1723703600000, pnl: -100 },
      { created_at: 1723707200000, pnl: 450 },
    ];

    const pngBuffer = await renderPaperTradingEquity(trades, 100_000, 'png');
    expect(Buffer.isBuffer(pngBuffer)).toBe(true);
    expect(pngBuffer.length).toBeGreaterThan(1000);
    expect(pngBuffer.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});
