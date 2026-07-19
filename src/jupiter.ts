// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Jupiter DEX Price API (Solana)
// ═══════════════════════════════════════════════════════════════════════
//
// Fetches Solana token prices from Jupiter DEX aggregator.
// Free API — no key required (keyless: 30 req/min).
// API: Jupiter Price API V3
//
// Endpoint:
//   GET https://api.jup.ag/price/v3?ids=<mint_addresses>
//
// This enables coverage of Solana-native tokens not listed on any CEX.
//
// References:
//   https://developers.jup.ag/docs/price/index

import { CryptoRadarError, NetworkError, DataError } from './core/errors.js';
import { logger } from './core/logger.js';
import { Cache } from './core/cache.js';
import type { TokenDef, DexPrice } from './types.js';

// ── Constants ──

const PRICE_URL = 'https://api.jup.ag/price/v3';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const CACHE_TTL_MS = 300_000; // 5 min

// ── Mint Address Registry ──

/**
 * Mapping from our token IDs to Jupiter mint addresses for Solana tokens.
 *
 * Jupiter uses base58 mint addresses (not CoinGecko IDs).
 * Verified against Jupiter Price API V3 and CoinGecko platform addresses.
 *
 * Tokens include: SOL, JUP, JTO, RAY, BONK, PYTH, KMNO, ORCA,
 * WIF, BOME, AUDIO, FIDA, RENDER, PUMP — all Solana-native.
 */
const SOLANA_MINT_MAP: Record<string, string> = {
  'solana':        'So11111111111111111111111111111111111111112',
  'jupiter':       'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'jito':          'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
  'raydium':       '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'bonk':          'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'pyth-network':  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  'kamino':        'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS',
  'orca':          'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  'dogwifcoin':    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'book-of-meme':  'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
  'audius':        '9LzCMqDgTKYz9Drzqnpgee3SGa89up3a247ypMj2xrqM',
  'bonfida':       'EchesyfXePKdLtoiZSL8pBe8Myagyy8ZRqsACNCFGnvp',
  'render-token':  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
  'pump-fun':      'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn',
};

// ── Response Types ──

interface JupiterPriceEntry {
  usdPrice: number | null;
  priceChange24h: number | null;
  liquidity: number | null;
  decimals: number;
  blockId: number | null;
  createdAt: string;
}

type JupiterPriceResponse = Record<string, JupiterPriceEntry>;

// ── Cache ──

const priceCache = new Cache(CACHE_TTL_MS);

// ── HTTP Client ──

function sleep(ms: number): Promise<void> {
  return new Promise(r => {
    const t = setTimeout(r, ms);
    t.unref();
  });
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        if (res.status === 429) {
          // Rate limited — back off
          await sleep(5_000 * attempt);
          continue;
        }
        throw new NetworkError('jupiter', `HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    } catch (err) {
      if (err instanceof CryptoRadarError && !(err instanceof NetworkError)) throw err;
      if (attempt === retries) {
        throw new NetworkError('jupiter', err instanceof Error ? err.message : String(err));
      }
      await sleep(1_000 * attempt);
    }
  }
  throw new NetworkError('jupiter', `Failed after ${retries} retries`);
}

// ── Public API ──

/**
 * Fetch token prices from Jupiter Price API V3.
 *
 * Accepts raw Solana mint addresses and returns a map of
 * mint address → USD price. Tokens without a reliable price
 * (per Jupiter's heuristics) are omitted from the response.
 *
 * @param mintAddresses Array of Solana mint addresses (base58)
 * @returns Map of mint address -> USD price
 */
export async function fetchJupiterPrices(
  mintAddresses: string[],
): Promise<Map<string, number>> {
  if (mintAddresses.length === 0) return new Map();

  const deduped = [...new Set(mintAddresses)];
  const cacheKey = `jupiter_prices_${deduped.sort().join(',')}`;

  // Check cache first
  const cached = priceCache.get<Map<string, number>>(cacheKey);
  if (cached !== undefined) {
    logger.debug('Jupiter price cache hit', { mints: deduped.length });
    return cached;
  }

  const ids = deduped.join(',');
  const url = `${PRICE_URL}?ids=${ids}`;

  try {
    const res = await fetchWithRetry(url);
    const data = (await res.json()) as JupiterPriceResponse;

    if (typeof data !== 'object' || data === null) {
      throw new DataError('JUPITER_BAD_RESPONSE', 'Jupiter price response is not an object');
    }

    const result = new Map<string, number>();

    for (const mint of deduped) {
      const entry = data[mint];
      if (entry && typeof entry.usdPrice === 'number') {
        result.set(mint, entry.usdPrice);
      }
    }

    // Cache the result
    priceCache.set(cacheKey, result, CACHE_TTL_MS);

    logger.debug('Jupiter prices fetched', {
      requested: deduped.length,
      received: result.size,
    });

    return result;
  } catch (err) {
    logger.warn('Jupiter price fetch failed', {
      mints: deduped.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
}

/**
 * Get Jupiter DEX prices for all Solana tokens in the registry.
 *
 * Maps token IDs → mint addresses → prices, filtering to only
 * tokens with known Solana mint addresses. Returns a Map of
 * token ID → USD price.
 *
 * @param tokens Full token list from the registry
 * @returns Map of token ID -> USD price
 */
export async function fetchSolanaDexPrices(
  tokens: TokenDef[],
): Promise<Map<string, number>> {
  // Filter to Solana-chain tokens with known mint addresses
  const solanaTokens = tokens.filter(
    t => t.chain === 'solana' || t.chain === 'multi' && t.chains?.includes('solana'),
  );

  if (solanaTokens.length === 0) return new Map();

  // Build: token ID → mint address, collect unique mints
  const idToMint = new Map<string, string>();
  const mintAddresses: string[] = [];

  for (const token of solanaTokens) {
    const mint = SOLANA_MINT_MAP[token.id];
    if (mint) {
      idToMint.set(token.id, mint);
      mintAddresses.push(mint);
    }
  }

  if (mintAddresses.length === 0) return new Map();

  // Fetch all prices in one call
  const mintPrices = await fetchJupiterPrices(mintAddresses);

  // Map back from mint address → token ID
  const result = new Map<string, number>();

  // Reverse: mint → tokenId
  const mintToId = new Map<string, string>();
  for (const [tokenId, mint] of idToMint) {
    mintToId.set(mint, tokenId);
  }

  for (const [mint, price] of mintPrices) {
    const tokenId = mintToId.get(mint);
    if (tokenId) {
      result.set(tokenId, price);
    }
  }

  return result;
}

/**
 * Fetch the full Jupiter strict token list.
 *
 * Returns tokens that have been vetted by the Jupiter team.
 * Note: This endpoint may require an API key for non-trivial use.
 * Returns empty array on failure (graceful degradation).
 */
export async function fetchJupiterTokenList(): Promise<
  Array<{ address: string; symbol: string; name: string; decimals: number }>
> {
  try {
    const url = 'https://api.jup.ag/tokens/v2/tag/verified';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      logger.warn('Jupiter token list fetch failed', { status: res.status });
      return [];
    }

    const data = (await res.json()) as Array<{
      address: string;
      symbol: string;
      name: string;
      decimals: number;
    }>;

    return data.map(t => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
    }));
  } catch (err) {
    logger.warn('Jupiter token list error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Build DexPrice records from Jupiter price results.
 *
 * Converts the raw price map into DexPrice entries suitable for
 * integration with the rest of the radar system.
 *
 * @param priceMap Map of token ID -> USD price
 * @param source Price source identifier (default: 'jupiter')
 * @returns Array of DexPrice entries
 */
export function toDexPrices(
  priceMap: Map<string, number>,
  source: DexPrice['source'] = 'jupiter',
): DexPrice[] {
  const now = Date.now();
  const entries: DexPrice[] = [];

  for (const [tokenId, price] of priceMap) {
    entries.push({
      source,
      price,
      tokenId,
      timestamp: now,
    });
  }

  return entries;
}

/**
 * Get the registered mint address for a token ID.
 *
 * @param tokenId Token identifier (e.g. 'solana', 'bonk')
 * @returns Mint address or undefined if not found
 */
export function getMintAddress(tokenId: string): string | undefined {
  return SOLANA_MINT_MAP[tokenId];
}

/**
 * Get all registered mint addresses.
 *
 * @returns Record of token ID -> mint address
 */
export function getAllMintAddresses(): Record<string, string> {
  return { ...SOLANA_MINT_MAP };
}

/**
 * Get the count of registered Solana mint addresses.
 */
export function getMintCount(): number {
  return Object.keys(SOLANA_MINT_MAP).length;
}

// ── Cache management ──

/**
 * Clear the Jupiter price cache.
 */
export function clearJupiterCache(): void {
  priceCache.clear();
  logger.debug('Jupiter price cache cleared');
}
