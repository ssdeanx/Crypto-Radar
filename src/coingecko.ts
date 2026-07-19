// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — CoinGecko API Client
// ═══════════════════════════════════════════════════════════════════════
//
// Free tier: 10-30 calls/min, no API key required for public endpoints.
// Primary use: fallback/alternative price data for tokens not on Binance
// and supplemental market data (market cap, rank, categories).
//
// References:
//   https://docs.coingecko.com/reference/simple-price
//   https://docs.coingecko.com/reference/coins-markets

import { CryptoRadarError, NetworkError, RateLimitError, DataError } from './core/errors.js';
import { logger } from './core/logger.js';

const BASE_URL = 'https://api.coingecko.com/api/v3';
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;

export interface CoinGeckoPrice {
  usd: number;
  usd24hChange: number | null;
  usdMarketCap: number | null;
  lastUpdatedAt: string | null;
}

export interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  currentPrice: number;
  marketCap: number;
  marketCapRank: number | null;
  totalVolume: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  lastUpdated: string;
}

// ── HTTP Client ──

function timeoutSignal(ms: number): AbortController {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl;
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = timeoutSignal(FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'Accept': 'application/json' },
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') ?? '10', 10);
        throw new RateLimitError('coingecko', retryAfter * 1000);
      }

      if (res.status === 404) {
        throw new DataError('coingecko', `Resource not found: ${url}`);
      }

      if (!res.ok) {
        throw new NetworkError('coingecko', `HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1_000 * attempt);
    }
  }
  throw new NetworkError('coingecko', `Failed after ${retries} retries`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => {
    const t = setTimeout(r, ms);
    t.unref();
  });
}

// ── Public API ──

/**
 * Fetch simple prices for multiple coin IDs.
 *
 * Batches up to 250 IDs per call. Returns a map of coin ID -> { usd, 24h_change }.
 *
 * @param ids Array of CoinGecko coin IDs (e.g. ['bitcoin', 'solana', 'uniswap'])
 * @returns Map of id -> CoinGeckoPrice
 */
export async function fetchSimplePrices(ids: string[]): Promise<Map<string, CoinGeckoPrice>> {
  if (ids.length === 0) return new Map();

  const result = new Map<string, CoinGeckoPrice>();

  // Batch in chunks of 100 (free tier safe)
  const batchSize = 100;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const idsParam = batch.join(',');
    const url = `${BASE_URL}/simple/price?ids=${idsParam}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true`;

    try {
      const res = await fetchWithRetry(url);
      const data = (await res.json()) as Record<string, Record<string, number | string>>;

      for (const id of batch) {
        const entry = data[id];
        if (entry && typeof entry.usd === 'number') {
          result.set(id, {
            usd: entry.usd as number,
            usd24hChange: (entry.usd_24h_change as number) ?? null,
            usdMarketCap: (entry.usd_market_cap as number) ?? null,
            lastUpdatedAt: entry.last_updated_at?.toString() ?? null,
          });
        }
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        throw err;
      }
      logger.warn(`CoinGecko batch price fetch failed`, {
        batchSize: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });
      // Return partial results for successful IDs
      continue;
    }
  }

  return result;
}

/**
 * Fetch detailed market data for multiple coin IDs.
 *
 * Provides richer data: market cap rank, total volume, 24h price change.
 *
 * @param ids Array of CoinGecko coin IDs
 * @param vsCurrency Target currency (default: 'usd')
 * @returns Array of CoinGeckoMarketData
 */
export async function fetchMarketData(
  ids: string[],
  vsCurrency = 'usd',
): Promise<CoinGeckoMarketData[]> {
  if (ids.length === 0) return [];

  const idsParam = ids.join(',');
  const url = `${BASE_URL}/coins/markets?vs_currency=${vsCurrency}&ids=${idsParam}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;

  try {
    const res = await fetchWithRetry(url);
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) {
      throw new CryptoRadarError('COINGECKO_BAD_RESPONSE', `Expected array from coins/markets, got ${typeof json}`, {
        recoverable: false,
        context: { source: 'coingecko' },
      });
    }
    const data = json as Array<Record<string, unknown>>;

    return data.map((coin) => ({
      id: coin.id as string,
      symbol: (coin.symbol as string)?.toUpperCase(),
      name: coin.name as string,
      currentPrice: (coin.current_price as number) ?? 0,
      marketCap: (coin.market_cap as number) ?? 0,
      marketCapRank: (coin.market_cap_rank as number | null) ?? null,
      totalVolume: (coin.total_volume as number) ?? 0,
      priceChange24h: (coin.price_change_24h as number) ?? 0,
      priceChangePercent24h: (coin.price_change_percentage_24h as number) ?? 0,
      lastUpdated: (coin.last_updated as string) ?? '',
    }));
  } catch (err) {
    throw new NetworkError('coingecko', `Market data fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

