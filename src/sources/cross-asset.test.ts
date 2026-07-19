import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CrossAssetRow } from '../types.js';

import { fetchGlobalData } from './cross-asset.js';

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

describe('fetchGlobalData', () => {
  beforeEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('returns parsed cross-asset row', async () => {
    const mockData = {
      data: {
        market_cap_percentage: { btc: 45.5, eth: 18.2 },
        total_market_cap: { usd: 2500000000000 },
        market_cap_change_percentage_24h_usd: -2.5,
      },
    };
    setupMockFetch(mockData);
    const result = await fetchGlobalData();
    expect(result).not.toBeNull();
    expect(result!.ts).toBeGreaterThan(0);
    expect(result!.btc_dominance).toBeCloseTo(45.5, 1);
    expect(result!.eth_dominance).toBeCloseTo(18.2, 1);
    expect(result!.total_mcap).toBe(2500000000000);
    expect(result!.total_mcap_change_24h).toBeCloseTo(-2.5, 1);
    expect(result!.market_cap_percentage_json).toBe(
      JSON.stringify({ btc: 45.5, eth: 18.2 }),
    );
  });

  it('handles zero total market cap', async () => {
    const mockData = {
      data: {
        market_cap_percentage: { btc: 50 },
        total_market_cap: { usd: 0 },
        market_cap_change_percentage_24h_usd: 0,
      },
    };
    setupMockFetch(mockData);
    const result = await fetchGlobalData();
    expect(result!.total_mcap).toBe(0);
    expect(result!.total_mcap_change_24h).toBe(0);
  });

  it('handles missing btc dominance key', async () => {
    const mockData = {
      data: {
        market_cap_percentage: { eth: 50 },
        total_market_cap: { usd: 1000000 },
        market_cap_change_percentage_24h_usd: 5,
      },
    };
    setupMockFetch(mockData);
    const result = await fetchGlobalData();
    expect(result!.btc_dominance).toBeNull();
    expect(result!.eth_dominance).toBe(50);
  });

  it('handles missing eth dominance key', async () => {
    const mockData = {
      data: {
        market_cap_percentage: { btc: 50 },
        total_market_cap: { usd: 1000000 },
        market_cap_change_percentage_24h_usd: 5,
      },
    };
    setupMockFetch(mockData);
    const result = await fetchGlobalData();
    expect(result!.eth_dominance).toBeNull();
  });

  it('handles missing usd total_market_cap key', async () => {
    const mockData = {
      data: {
        market_cap_percentage: { btc: 50 },
        total_market_cap: {},
        market_cap_change_percentage_24h_usd: 5,
      },
    };
    setupMockFetch(mockData);
    const result = await fetchGlobalData();
    expect(result!.total_mcap).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    setupMockFetch({}, 500);
    const result = await fetchGlobalData();
    expect(result).toBeNull();
  });

  it('returns null on network failure', async () => {
    setupFetchError('coingecko unreachable');
    const result = await fetchGlobalData();
    expect(result).toBeNull();
  });
});
