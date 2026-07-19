import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OrderBookRow } from '../types.js';

const mockFetchDepth = vi.hoisted(() => vi.fn());

vi.mock('../binance.js', () => ({
  fetchDepth: mockFetchDepth,
}));

import { snapshotOrderBook } from './orderbook.js';

describe('snapshotOrderBook', () => {
  afterEach(() => {
    mockFetchDepth.mockReset();
  });

  it('returns parsed order book row with spread and imbalance', async () => {
    mockFetchDepth.mockResolvedValue({
      lastUpdateId: 12345,
      bids: [['100.0', '10.0'], ['99.5', '5.0']],
      asks: [['101.0', '5.0'], ['101.5', '3.0']],
    });

    const result = await snapshotOrderBook('BTCUSDT');
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('BTCUSDT');
    expect(result!.ts).toBeGreaterThan(0);
    expect(result!.spread_pct).toBeCloseTo(1.0, 5);
    expect(result!.imbalance).toBeCloseTo(0.33333, 4);
    expect(result!.bids).toBe(JSON.stringify([['100.0', '10.0'], ['99.5', '5.0']]));
    expect(result!.asks).toBe(JSON.stringify([['101.0', '5.0'], ['101.5', '3.0']]));
  });

  it('calculates negative imbalance for sell-side dominant book', async () => {
    mockFetchDepth.mockResolvedValue({
      lastUpdateId: 1,
      bids: [['100.0', '5.0']],
      asks: [['101.0', '20.0']],
    });

    const result = await snapshotOrderBook('SOLUSDT');
    expect(result!.imbalance).toBeCloseTo(-0.6, 4);
  });

  it('calculates positive imbalance for buy-side dominant book', async () => {
    mockFetchDepth.mockResolvedValue({
      lastUpdateId: 1,
      bids: [['100.0', '20.0']],
      asks: [['101.0', '5.0']],
    });

    const result = await snapshotOrderBook('SOLUSDT');
    expect(result!.imbalance).toBeCloseTo(0.6, 4);
  });

  it('handles zero spread when bid equals ask', async () => {
    mockFetchDepth.mockResolvedValue({
      lastUpdateId: 1,
      bids: [['100.0', '10.0']],
      asks: [['100.0', '10.0']],
    });

    const result = await snapshotOrderBook('STABLEPAIR');
    expect(result!.spread_pct).toBe(0);
    expect(result!.imbalance).toBe(0);
  });

  it('returns null when bids array is empty', async () => {
    mockFetchDepth.mockResolvedValue({
      lastUpdateId: 1,
      bids: [],
      asks: [['101.0', '5.0']],
    });

    const result = await snapshotOrderBook('BTCUSDT');
    expect(result).toBeNull();
  });

  it('returns null when asks array is empty', async () => {
    mockFetchDepth.mockResolvedValue({
      lastUpdateId: 1,
      bids: [['100.0', '10.0']],
      asks: [],
    });

    const result = await snapshotOrderBook('BTCUSDT');
    expect(result).toBeNull();
  });

  it('returns null when bids is undefined', async () => {
    mockFetchDepth.mockResolvedValue({
      lastUpdateId: 1,
      asks: [['101.0', '5.0']],
    });

    const result = await snapshotOrderBook('BTCUSDT');
    expect(result).toBeNull();
  });

  it('returns null when fetchDepth returns null', async () => {
    mockFetchDepth.mockResolvedValue(null);

    const result = await snapshotOrderBook('BTCUSDT');
    expect(result).toBeNull();
  });

  it('returns null when fetchDepth rejects', async () => {
    mockFetchDepth.mockRejectedValue(new Error('depth fetch failed'));

    const result = await snapshotOrderBook('BTCUSDT');
    expect(result).toBeNull();
  });
});
