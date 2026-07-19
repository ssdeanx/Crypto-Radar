// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — CoinGecko API Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSimplePrices, fetchMarketData } from './coingecko.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('CoinGecko API', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetchSimplePrices', () => {
    it('returns empty map for empty ids', async () => {
      const result = await fetchSimplePrices([]);
      expect(result.size).toBe(0);
    });

    it('fetches prices for given coin IDs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bitcoin: { usd: 50000, usd_24h_change: 2.5, usd_market_cap: 1e12, last_updated_at: '1234567890' },
          solana: { usd: 150, usd_24h_change: -1.2, usd_market_cap: 6e10, last_updated_at: '1234567890' },
        }),
      });

      const result = await fetchSimplePrices(['bitcoin', 'solana']);
      expect(result.size).toBe(2);
      expect(result.get('bitcoin')?.usd).toBe(50000);
      expect(result.get('bitcoin')?.usd24hChange).toBe(2.5);
      expect(result.get('solana')?.usd).toBe(150);
    });

    it('handles partial response gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bitcoin: { usd: 50000, usd_24h_change: null, usd_market_cap: null, last_updated_at: null },
        }),
      });

      const result = await fetchSimplePrices(['bitcoin', 'nonexistent']);
      expect(result.size).toBe(1);
      expect(result.get('bitcoin')?.usd).toBe(50000);
    });

    it('handles fetch failure gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      const result = await fetchSimplePrices(['bitcoin']);
      expect(result.size).toBe(0);
    });

    it('handles 429 rate limit with retry', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429, headers: new Map([['retry-after', '1']]) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ bitcoin: { usd: 50000, usd_24h_change: 1.0, usd_market_cap: null, last_updated_at: null } }),
        });

      const result = await fetchSimplePrices(['bitcoin']);
      expect(result.get('bitcoin')?.usd).toBe(50000);
    });
  });

  describe('fetchMarketData', () => {
    it('returns empty array for empty ids', async () => {
      const result = await fetchMarketData([]);
      expect(result).toEqual([]);
    });

    it('fetches market data for given IDs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 50000, market_cap: 1e12, market_cap_rank: 1, total_volume: 3e10, price_change_24h: 1000, price_change_percentage_24h: 2.0, last_updated: '2026-01-01' },
          { id: 'solana', symbol: 'sol', name: 'Solana', current_price: 150, market_cap: 6e10, market_cap_rank: 5, total_volume: 2e9, price_change_24h: -2, price_change_percentage_24h: -1.3, last_updated: '2026-01-01' },
        ],
      });

      const result = await fetchMarketData(['bitcoin', 'solana']);
      expect(result).toHaveLength(2);
      expect(result[0]?.symbol).toBe('BTC');
      expect(result[0]?.currentPrice).toBe(50000);
    });

    it('throws NetworkError on failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
      await expect(fetchMarketData(['bitcoin'])).rejects.toThrow();
    });
  });
});
