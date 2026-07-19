import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FundingRow, OIRow, LsRatioRow, LiquidationRow } from '../types.js';

import {
  fetchFundingRates,
  fetchOpenInterest,
  fetchLongShortRatio,
  fetchTopLongShortPositionRatio,
  fetchLiquidations,
} from './futures.js';

const ORIGINAL_FETCH = globalThis.fetch;

function setupMockFetch(result: unknown, status = 200): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    json: () => Promise.resolve(result),
  } as unknown as Response);
}

function setupFetchError(msg = 'Network failure'): void {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(msg));
}

describe('fetchFundingRates', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns parsed funding rate rows', async () => {
    const mockData = [
      { symbol: 'BTCUSDT', fundingTime: 1700000000000, fundingRate: '0.0001' },
      { symbol: 'BTCUSDT', fundingTime: 1700003600000, fundingRate: '-0.00005' },
    ];
    setupMockFetch(mockData);
    const result = await fetchFundingRates('BTCUSDT');
    expect(result).toHaveLength(2);
    expect(result[0]!).toEqual<FundingRow>({ symbol: 'BTCUSDT', ts: 1700000000, rate: 0.0001 });
    expect(result[1]!).toEqual<FundingRow>({ symbol: 'BTCUSDT', ts: 1700003600, rate: -0.00005 });
  });

  it('handles zero funding rate', async () => {
    setupMockFetch([{ symbol: 'SOLUSDT', fundingTime: 1700000000000, fundingRate: '0' }]);
    const result = await fetchFundingRates('SOLUSDT');
    expect(result[0]!.rate).toBe(0);
  });

  it('returns empty array when API returns empty list', async () => {
    setupMockFetch([]);
    const result = await fetchFundingRates('UNKNOWNSYMBOL');
    expect(result).toEqual([]);
  });

  it('throws on HTTP 500', async () => {
    setupMockFetch({}, 500);
    await expect(fetchFundingRates('BTCUSDT')).rejects.toThrow('HTTP 500');
  });

  it('throws on network failure', async () => {
    setupFetchError('funding api unreachable');
    await expect(fetchFundingRates('BTCUSDT')).rejects.toThrow('funding api unreachable');
  });
});

describe('fetchOpenInterest', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns parsed OI row', async () => {
    const mockData = { symbol: 'BTCUSDT', openInterest: '500000.75', time: 1700000000000 };
    setupMockFetch(mockData);
    const result = await fetchOpenInterest('BTCUSDT');
    expect(result).toHaveLength(1);
    expect(result[0]!).toEqual<OIRow>({ symbol: 'BTCUSDT', ts: 1700000000, open_interest: 500000.75 });
  });

  it('handles zero open interest', async () => {
    setupMockFetch({ symbol: 'NEWPAIR', openInterest: '0', time: 1700000000000 });
    const result = await fetchOpenInterest('NEWPAIR');
    expect(result[0]!.open_interest).toBe(0);
  });

  it('throws on HTTP 429 rate limit', async () => {
    setupMockFetch({}, 429);
    await expect(fetchOpenInterest('BTCUSDT')).rejects.toThrow('HTTP 429');
  });

  it('throws on network failure', async () => {
    setupFetchError('oi api down');
    await expect(fetchOpenInterest('BTCUSDT')).rejects.toThrow('oi api down');
  });
});

describe('fetchLongShortRatio', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns parsed LS ratio rows', async () => {
    const mockData = [
      {
        symbol: 'BTCUSDT', longAccount: '1.5', shortAccount: '1.2',
        longPosition: '0', shortPosition: '0', timestamp: 1700000000000,
      },
    ];
    setupMockFetch(mockData);
    const result = await fetchLongShortRatio('BTCUSDT');
    expect(result).toHaveLength(1);
    expect(result[0]!).toEqual<LsRatioRow>({
      symbol: 'BTCUSDT', ts: 1700000000,
      long_account: 1.5, short_account: 1.2,
      long_position: 0, short_position: 0,
    });
  });

  it('accepts custom period and limit parameters', async () => {
    setupMockFetch([]);
    const result = await fetchLongShortRatio('BTCUSDT', '1h', 50);
    expect(result).toEqual([]);
  });

  it('handles ratio values of zero', async () => {
    const mockData = [
      {
        symbol: 'BTCUSDT', longAccount: '0', shortAccount: '0',
        longPosition: '0', shortPosition: '0', timestamp: 1700000000000,
      },
    ];
    setupMockFetch(mockData);
    const result = await fetchLongShortRatio('BTCUSDT');
    expect(result[0]!.long_account).toBe(0);
    expect(result[0]!.short_account).toBe(0);
  });
});

describe('fetchTopLongShortPositionRatio', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns parsed top position ratio rows', async () => {
    const mockData = [
      { symbol: 'BTCUSDT', longPosition: '60.5', shortPosition: '39.5', timestamp: 1700000000000 },
    ];
    setupMockFetch(mockData);
    const result = await fetchTopLongShortPositionRatio('BTCUSDT');
    expect(result).toHaveLength(1);
    expect(result[0]!).toEqual<LsRatioRow>({
      symbol: 'BTCUSDT', ts: 1700000000,
      long_account: 0, short_account: 0,
      long_position: 60.5, short_position: 39.5,
    });
  });

  it('handles multiple data points', async () => {
    const mockData = [
      { symbol: 'BTCUSDT', longPosition: '55', shortPosition: '45', timestamp: 1700000000000 },
      { symbol: 'BTCUSDT', longPosition: '52', shortPosition: '48', timestamp: 1700003600000 },
    ];
    setupMockFetch(mockData);
    const result = await fetchTopLongShortPositionRatio('BTCUSDT');
    expect(result).toHaveLength(2);
    expect(result[1]!.long_position).toBe(52);
  });
});

describe('fetchLiquidations', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns parsed liquidation rows with usdValue', async () => {
    const mockData = [
      {
        symbol: 'BTCUSDT', time: 1700000000000, side: 'SELL',
        price: '65000', origQty: '1.5', executedQty: '1.5', usdValue: '97500',
      },
    ];
    setupMockFetch(mockData);
    const result = await fetchLiquidations('BTCUSDT');
    expect(result).toHaveLength(1);
    expect(result[0]!).toEqual<LiquidationRow>({
      id: 'BTCUSDT-1700000000000-SELL',
      symbol: 'BTCUSDT', ts: 1700000000,
      side: 'SELL', price: 65000,
      qty: 1.5, usd: 97500,
    });
  });

  it('falls back to price * qty when usdValue is missing', async () => {
    const mockData = [
      {
        symbol: 'SOLUSDT', time: 1700000000000, side: 'BUY',
        price: '150', origQty: '10', executedQty: '10',
      },
    ];
    setupMockFetch(mockData);
    const result = await fetchLiquidations('SOLUSDT');
    expect(result[0]!.usd).toBe(1500);
  });

  it('handles executedQty different from origQty', async () => {
    const mockData = [
      {
        symbol: 'ETHUSDT', time: 1800000000000, side: 'SELL',
        price: '3000', origQty: '5', executedQty: '3.5',
      },
    ];
    setupMockFetch(mockData);
    const result = await fetchLiquidations('ETHUSDT');
    expect(result[0]!.qty).toBe(3.5);
  });

  it('returns empty array on HTTP error', async () => {
    setupMockFetch({}, 500);
    const result = await fetchLiquidations('BTCUSDT');
    expect(result).toEqual([]);
  });

  it('returns empty array on network failure', async () => {
    setupFetchError('network error');
    const result = await fetchLiquidations('BTCUSDT');
    expect(result).toEqual([]);
  });

  it('returns empty array when API returns empty list', async () => {
    setupMockFetch([]);
    const result = await fetchLiquidations('BTCUSDT');
    expect(result).toEqual([]);
  });
});
