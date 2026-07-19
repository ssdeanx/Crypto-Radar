// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Jupiter DEX Price API Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchJupiterPrices,
  fetchSolanaDexPrices,
  fetchJupiterTokenList,
  toDexPrices,
  getMintAddress,
  getAllMintAddresses,
  getMintCount,
  clearJupiterCache,
} from './jupiter.js';
import type { TokenDef } from './types.js';

// ── fetch mock ──

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  clearJupiterCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  clearJupiterCache();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

describe('fetchJupiterPrices', () => {
  it('returns empty map for empty input', async () => {
    const result = await fetchJupiterPrices([]);
    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and parses usd prices from response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      [SOL_MINT]: { usdPrice: 150.5, priceChange24h: 1.2, liquidity: 1000, decimals: 9, blockId: 1, createdAt: '2024' },
      [BONK_MINT]: { usdPrice: 0.00002, priceChange24h: null, liquidity: null, decimals: 5, blockId: null, createdAt: '2024' },
    }));

    const result = await fetchJupiterPrices([SOL_MINT, BONK_MINT]);
    expect(result.get(SOL_MINT)).toBe(150.5);
    expect(result.get(BONK_MINT)).toBe(0.00002);
  });

  it('dedupes repeated mint addresses', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      [SOL_MINT]: { usdPrice: 150, priceChange24h: null, liquidity: null, decimals: 9, blockId: null, createdAt: '2024' },
    }));
    const result = await fetchJupiterPrices([SOL_MINT, SOL_MINT, SOL_MINT]);
    expect(result.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('omits entries without a numeric usdPrice', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      [SOL_MINT]: { usdPrice: null, priceChange24h: null, liquidity: null, decimals: 9, blockId: null, createdAt: '2024' },
      [BONK_MINT]: { usdPrice: 0.00002, priceChange24h: null, liquidity: null, decimals: 5, blockId: null, createdAt: '2024' },
    }));
    const result = await fetchJupiterPrices([SOL_MINT, BONK_MINT]);
    expect(result.has(SOL_MINT)).toBe(false);
    expect(result.get(BONK_MINT)).toBe(0.00002);
  });

  it('returns empty map on fetch failure (graceful)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const result = await fetchJupiterPrices([SOL_MINT]);
    expect(result.size).toBe(0);
  });

  it('serves from cache on second call (no second fetch)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      [SOL_MINT]: { usdPrice: 150, priceChange24h: null, liquidity: null, decimals: 9, blockId: null, createdAt: '2024' },
    }));
    const first = await fetchJupiterPrices([SOL_MINT]);
    expect(first.get(SOL_MINT)).toBe(150);
    const second = await fetchJupiterPrices([SOL_MINT]);
    expect(second.get(SOL_MINT)).toBe(150);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({
        [SOL_MINT]: { usdPrice: 151, priceChange24h: null, liquidity: null, decimals: 9, blockId: null, createdAt: '2024' },
      }));
    const promise = fetchJupiterPrices([SOL_MINT]);
    // advance through the 5000ms backoff
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;
    expect(result.get(SOL_MINT)).toBe(151);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws NetworkError after exhausting retries on non-429 HTTP error', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    const promise = fetchJupiterPrices([SOL_MINT]);
    // two attempts: 1st fails, sleep(1000) then 2nd fails, sleep(2000) then throw -> caught -> empty
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;
    expect(result.size).toBe(0); // caught + returns empty
    expect(fetchMock).toHaveBeenCalledTimes(2); // MAX_RETRIES
    vi.useRealTimers();
  });

  it('handles malformed JSON gracefully (returns empty)', async () => {
    fetchMock.mockResolvedValue(jsonResponse('not-an-object' as unknown));
    const result = await fetchJupiterPrices([SOL_MINT]);
    expect(result.size).toBe(0);
  });
});

describe('fetchSolanaDexPrices', () => {
  const solToken: TokenDef = {
    id: 'solana', sym: 'SOL', name: 'Solana', chain: 'solana',
    pair: 'SOLUSDT', coingeckoId: 'solana',
  } as unknown as TokenDef;

  const bonkToken: TokenDef = {
    id: 'bonk', sym: 'BONK', name: 'Bonk', chain: 'solana',
    pair: 'BONKUSDT', coingeckoId: 'bonk',
  } as unknown as TokenDef;

  const btcToken: TokenDef = {
    id: 'bitcoin', sym: 'BTC', name: 'Bitcoin', chain: 'bitcoin',
    pair: 'BTCUSDT', coingeckoId: 'bitcoin',
  } as unknown as TokenDef;

  const multiToken: TokenDef = {
    id: 'rendertoken', sym: 'RNDR', name: 'Render', chain: 'multi',
    chains: ['solana', 'ethereum'], pair: 'RNDRUSDT', coingeckoId: 'render-token',
  } as unknown as TokenDef;

  it('returns empty map when no solana tokens', async () => {
    clearJupiterCache();
    const result = await fetchSolanaDexPrices([btcToken]);
    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty map when solana tokens have no known mint', async () => {
    clearJupiterCache();
    const unknownSol: TokenDef = {
      id: 'mystery', sym: 'MYST', name: 'Mystery', chain: 'solana',
      pair: 'MYSTUSDT', coingeckoId: 'mystery',
    } as unknown as TokenDef;
    const result = await fetchSolanaDexPrices([unknownSol]);
    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps token IDs to prices via mints (including multi/solana)', async () => {
    clearJupiterCache();
    fetchMock.mockResolvedValue(jsonResponse({
      [SOL_MINT]: { usdPrice: 150, priceChange24h: null, liquidity: null, decimals: 9, blockId: null, createdAt: '2024' },
      [BONK_MINT]: { usdPrice: 0.00002, priceChange24h: null, liquidity: null, decimals: 5, blockId: null, createdAt: '2024' },
    }));
    const result = await fetchSolanaDexPrices([solToken, bonkToken, btcToken, multiToken]);
    // multiToken (rendertoken) has no mint in map, so only solana+bonk resolve
    expect(result.get('solana')).toBe(150);
    expect(result.get('bonk')).toBe(0.00002);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty map when price fetch fails', async () => {
    clearJupiterCache();
    fetchMock.mockRejectedValue(new Error('down'));
    const result = await fetchSolanaDexPrices([solToken]);
    expect(result.size).toBe(0);
  });
});

describe('fetchJupiterTokenList', () => {
  it('returns mapped token list on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse([
      { address: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9 },
      { address: BONK_MINT, symbol: 'BONK', name: 'Bonk', decimals: 5 },
    ]));
    const result = await fetchJupiterTokenList();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ address: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9 });
  });

  it('returns empty array on non-ok status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    const result = await fetchJupiterTokenList();
    expect(result).toEqual([]);
  });

  it('returns empty array on fetch error', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    const result = await fetchJupiterTokenList();
    expect(result).toEqual([]);
  });
});

describe('toDexPrices', () => {
  it('converts price map to DexPrice entries', () => {
    const map = new Map<string, number>([
      ['solana', 150],
      ['bonk', 0.00002],
    ]);
    const entries = toDexPrices(map);
    expect(entries).toHaveLength(2);
    const sol = entries.find(e => e.tokenId === 'solana')!;
    expect(sol.source).toBe('jupiter');
    expect(sol.price).toBe(150);
    expect(typeof sol.timestamp).toBe('number');
  });

  it('uses provided valid source', () => {
    const entries = toDexPrices(new Map([['solana', 1]]), 'orca');
    expect(entries[0].source).toBe('orca');
  });

  it('returns empty array for empty map', () => {
    expect(toDexPrices(new Map())).toEqual([]);
  });
});

describe('mint registry helpers', () => {
  it('getMintAddress returns mint for known token', () => {
    expect(getMintAddress('solana')).toBe(SOL_MINT);
  });

  it('getMintAddress returns undefined for unknown token', () => {
    expect(getMintAddress('not-a-token')).toBeUndefined();
  });

  it('getAllMintAddresses returns a copy of the registry', () => {
    const all = getAllMintAddresses();
    expect(all['solana']).toBe(SOL_MINT);
    // mutating result does not affect internal map
    all['solana'] = 'tampered';
    expect(getMintAddress('solana')).toBe(SOL_MINT);
  });

  it('getMintCount returns number of registered mints', () => {
    expect(getMintCount()).toBeGreaterThan(0);
    expect(getMintCount()).toBe(Object.keys(getAllMintAddresses()).length);
  });
});
