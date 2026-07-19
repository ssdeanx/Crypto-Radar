// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — On-Chain Metrics Tests (DeFiLlama)
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  computeTvlTrend,
  fetchProtocolTvl,
  fetchProtocolFees,
  fetchChainTvl,
  fetchOnChainPrices,
  fetchOnChainMetrics,
  PROTOCOL_MAP,
} from './onchain.js';

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(response: unknown, status = 200): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(response),
  } as Response);
}

function mockFetchError(msg: string): void {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(msg));
}

function makeToken(id: string): { id: string; sym: string; name: string; chain: string; coingeckoId?: string } {
  return { id, sym: id.toUpperCase(), name: id, chain: 'polygon', coingeckoId: id };
}

// ═══════════════════════════════════════════════════════════════════════
// computeTvlTrend
// ═══════════════════════════════════════════════════════════════════════

describe('computeTvlTrend', () => {
  it('returns "flat" when fees7d is 0 or negative', () => {
    expect(computeTvlTrend(100, 0)).toBe('flat');
    expect(computeTvlTrend(100, -50)).toBe('flat');
  });

  it('returns "flat" when fees1d is 0 or negative', () => {
    expect(computeTvlTrend(0, 700)).toBe('flat');
    expect(computeTvlTrend(-10, 700)).toBe('flat');
  });

  it('returns "up" when avgDaily7d > 1.2x fees1d', () => {
    expect(computeTvlTrend(10, 140)).toBe('up');
  });

  it('returns "down" when avgDaily7d < 0.8x fees1d', () => {
    expect(computeTvlTrend(100, 70)).toBe('down');
  });

  it('returns "flat" when fees are in normal range', () => {
    expect(computeTvlTrend(20, 140)).toBe('flat');
  });

  it('returns "flat" when both are zero', () => {
    expect(computeTvlTrend(0, 0)).toBe('flat');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PROTOCOL_MAP
// ═══════════════════════════════════════════════════════════════════════

describe('PROTOCOL_MAP', () => {
  it('maps known token IDs to DeFiLlama protocol slugs', () => {
    expect(PROTOCOL_MAP['aave']).toBe('aave-v3');
    expect(PROTOCOL_MAP['uniswap']).toBe('uniswap-v3');
    expect(PROTOCOL_MAP['lido-dao']).toBe('lido');
    expect(PROTOCOL_MAP['maker']).toBe('makerdao');
    expect(PROTOCOL_MAP['sushi']).toBe('sushi');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchProtocolTvl
// ═══════════════════════════════════════════════════════════════════════

describe('fetchProtocolTvl', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns TVL as a number on success', async () => {
    mockFetch(1_250_000_000);
    expect(await fetchProtocolTvl('aave-v3')).toBe(1_250_000_000);
  });

  it('throws on HTTP error', async () => {
    mockFetch({ error: 'not found' }, 404);
    await expect(fetchProtocolTvl('nonexistent')).rejects.toThrow('DeFiLlama HTTP 404');
  });

  it('throws on network failure', async () => {
    mockFetchError('Network failure');
    await expect(fetchProtocolTvl('aave-v3')).rejects.toThrow('Network failure');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchProtocolFees
// ═══════════════════════════════════════════════════════════════════════

describe('fetchProtocolFees', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns parsed fee totals', async () => {
    mockFetch({ total1d: 100_000, total7d: 700_000, total30d: 3_000_000 });
    const fees = await fetchProtocolFees('aave-v3');
    expect(fees.total1d).toBe(100_000);
    expect(fees.total7d).toBe(700_000);
    expect(fees.total30d).toBe(3_000_000);
  });

  it('defaults missing fields to 0', async () => {
    mockFetch({ total1d: 50_000 });
    const fees = await fetchProtocolFees('aave-v3');
    expect(fees.total1d).toBe(50_000);
    expect(fees.total7d).toBe(0);
    expect(fees.total30d).toBe(0);
  });

  it('throws on fetch error', async () => {
    mockFetchError('timeout');
    await expect(fetchProtocolFees('aave-v3')).rejects.toThrow('timeout');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchChainTvl
// ═══════════════════════════════════════════════════════════════════════

describe('fetchChainTvl', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns latest TVL from history', async () => {
    mockFetch([
      { date: 1_700_000_000, tvl: 10_000_000_000 },
      { date: 1_700_000_002, tvl: 12_000_000_000 },
    ]);
    expect(await fetchChainTvl('Ethereum')).toBe(12_000_000_000);
  });

  it('returns 0 for empty history', async () => {
    mockFetch([]);
    expect(await fetchChainTvl('EmptyChain')).toBe(0);
  });

  it('handles network error', async () => {
    mockFetchError('chain api timeout');
    await expect(fetchChainTvl('Solana')).rejects.toThrow('chain api timeout');
  });

  it('throws on fetch error', async () => {
    mockFetchError('server error');
    await expect(fetchChainTvl('Ethereum')).rejects.toThrow('server error');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchOnChainPrices
// ═══════════════════════════════════════════════════════════════════════

describe('fetchOnChainPrices', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns price map for given coin IDs', async () => {
    mockFetch({ coins: { 'coingecko:bitcoin': { price: 67_000 }, 'coingecko:ethereum': { price: 3_500 } } });
    const prices = await fetchOnChainPrices(['bitcoin', 'ethereum']);
    expect(prices['bitcoin']).toBe(67_000);
    expect(prices['ethereum']).toBe(3_500);
  });

  it('returns empty object for empty coinIds', async () => {
    expect(await fetchOnChainPrices([])).toEqual({});
  });

  it('skips coin IDs not present in response', async () => {
    mockFetch({ coins: { 'coingecko:bitcoin': { price: 67_000 } } });
    const prices = await fetchOnChainPrices(['bitcoin', 'unknown']);
    expect(prices['bitcoin']).toBe(67_000);
    expect(prices['unknown']).toBeUndefined();
  });

  it('handles missing coins field', async () => {
    mockFetch({});
    expect(await fetchOnChainPrices(['bitcoin'])).toEqual({});
  });

  it('handles network error', async () => {
    mockFetchError('API unavailable');
    await expect(fetchOnChainPrices(['bitcoin'])).rejects.toThrow('API unavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// fetchOnChainMetrics
// ═══════════════════════════════════════════════════════════════════════

describe('fetchOnChainMetrics', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

  it('returns protocols and chains for tracked tokens', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tvl/')) return Promise.resolve({ ok: true, json: () => Promise.resolve(500_000_000) } as Response);
      if (url.includes('/summary/fees/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ total1d: 50_000, total7d: 350_000, total30d: 1_500_000 }) } as Response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ date: 1_700_000_000, tvl: 2_000_000_000 }]) } as Response);
    });
    const result = await fetchOnChainMetrics([makeToken('aave')]);
    expect(result.protocols).toHaveLength(1);
    expect(result.protocols[0]!.name).toBe('aave-v3');
    expect(result.protocols[0]!.tvl).toBe(500_000_000);
    expect(result.fetchedAt).toBeDefined();
  });

  it('handles partial protocol failures gracefully', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('uniswap')) return Promise.reject(new Error('rate limited'));
      if (url.includes('/tvl/')) return Promise.resolve({ ok: true, json: () => Promise.resolve(100_000_000) } as Response);
      if (url.includes('/summary/fees/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ total1d: 10_000, total7d: 70_000, total30d: 300_000 }) } as Response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ date: 1_700_000_000, tvl: 2_000_000_000 }]) } as Response);
    });
    const result = await fetchOnChainMetrics([makeToken('aave'), makeToken('uniswap')]);
    expect(result.protocols.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty protocols when no tokens match PROTOCOL_MAP', async () => {
    mockFetch([]);
    expect((await fetchOnChainMetrics([makeToken('unknown-token')])).protocols).toHaveLength(0);
  });

  it('handles all chain TVL fetches failing', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tvl/') || url.includes('/summary/fees/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(100_000_000) } as Response);
      }
      return Promise.reject(new Error('chain api down'));
    });
    const result = await fetchOnChainMetrics([makeToken('aave')]);
    expect(result.protocols).toHaveLength(1);
  });

  it('deduplicates protocol IDs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(100_000_000) } as Response);
    const result = await fetchOnChainMetrics([makeToken('aave'), makeToken('aave')]);
    expect(result.protocols).toHaveLength(1);
  });

  it('returns empty protocols for empty token array', async () => {
    const result = await fetchOnChainMetrics([]);
    expect(result.protocols).toHaveLength(0);
    expect(result.chains).toBeDefined();
    expect(result.fetchedAt).toBeDefined();
  });

  it('handles all protocol fetches failing', async () => {
    mockFetchError('rate limited');
    const result = await fetchOnChainMetrics([makeToken('aave')]);
    expect(result.protocols).toHaveLength(0);
  });
});
