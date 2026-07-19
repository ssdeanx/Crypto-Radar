// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — On-Chain Metrics (DeFiLlama)
// ═══════════════════════════════════════════════════════════════════════
//
// Fetches on-chain data from DeFiLlama's public API:
//   - Chain-level TVL (total value locked)
//   - Protocol TVL and fees (1d/7d/30d)
//   - Current prices via coins.llama.fi (CoinGecko mirror)
//
// All endpoints are free, no API key required.
// Rate limit: ~10 requests/sec (be conservative).
//
// API Docs: https://defillama.com/docs/api

import { logger } from './core/logger.js';
import type { TokenDef } from './types.js';

const BASE_URL = 'https://api.llama.fi';
const COINS_URL = 'https://coins.llama.fi';

// ── Types ──────────────────────────────────────────────────────────────

export interface ProtocolMetrics {
  name: string;
  tvl: number;
  fees1d: number | null;
  fees7d: number | null;
  fees30d: number | null;
  /** Trend direction inferred from fee growth as a TVL proxy */
  tvlTrend: 'up' | 'flat' | 'down';
}

export interface ChainMetrics {
  chain: string;
  tvl: number;
  protocols: number;
}

export interface OnChainMetrics {
  /** Per-protocol aggregated metrics */
  protocols: ProtocolMetrics[];
  /** Chain-level TVL data */
  chains: ChainMetrics[];
  /** Timestamp of the fetch */
  fetchedAt: string;
}

// ── Mapping: token IDs → DeFiLlama protocol slugs ─────────────────────
//
// Our tracked tokens that map to DeFiLlama protocols.
// Key = token.id in our registry, Value = DeFiLlama protocol slug

export const PROTOCOL_MAP: Record<string, string> = {
  'aave': 'aave-v3',
  'uniswap': 'uniswap-v3',
  'curve-dao-token': 'curve-dex',
  'compound-governance-token': 'compound-v3',
  'lido-dao': 'lido',
  'balancer': 'balancer-v3',
  'sushi': 'sushi',
  'jupiter': 'jupiter-lend',
  'raydium': 'raydium-amm',
  'kamino': 'kamino-lend',
  'maker': 'makerdao',
  'thorchain': 'thorchain',
};

const CHAIN_SLUGS: Record<string, string> = {
  solana: 'Solana',
  polygon: 'Polygon',
  ethereum: 'Ethereum',
  bnb: 'BSC',
  bitcoin: 'Bitcoin',
};

// ── HTTP helpers ───────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`DeFiLlama HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Compute TVL trend direction from fee data as a proxy for protocol health.
 * Compares annualised daily fees (fees7d/7) against recent 1d fees to detect
 * growth or decline.
 *
 * @returns 'up' if fees are accelerating, 'down' if decelerating, 'flat' otherwise
 */
export function computeTvlTrend(fees1d: number, fees7d: number): 'up' | 'flat' | 'down' {
  if (fees7d <= 0 || fees1d <= 0) return 'flat';
  const avgDaily7d = fees7d / 7;
  if (avgDaily7d > fees1d * 1.2) return 'up';
  if (avgDaily7d < fees1d * 0.8) return 'down';
  return 'flat';
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Fetch current TVL for a protocol by slug.
 * Returns the TVL in USD as a number.
 */
export async function fetchProtocolTvl(slug: string): Promise<number> {
  const data = await fetchJson(`${BASE_URL}/tvl/${slug}`);
  return data as number;
}

/**
 * Fetch fee summary for a protocol.
 * Returns 1d, 7d, and 30d fee totals in USD.
 */
export async function fetchProtocolFees(slug: string): Promise<{
  total1d: number;
  total7d: number;
  total30d: number;
}> {
  const data = await fetchJson(
    `${BASE_URL}/summary/fees/${slug}?dataType=dailyFees`,
  ) as Record<string, unknown>;
  return {
    total1d: (data.total1d as number) ?? 0,
    total7d: (data.total7d as number) ?? 0,
    total30d: (data.total30d as number) ?? 0,
  };
}

/**
 * Fetch the latest chain-level TVL.
 */
export async function fetchChainTvl(chainSlug: string): Promise<number> {
  const data = await fetchJson(`${BASE_URL}/v2/historicalChainTvl/${chainSlug}`);
  const history = data as Array<{ date: number; tvl: number }>;
  if (!history || history.length === 0) return 0;
  return history[history.length - 1]!.tvl;
}

/**
 * Fetch current prices for a list of CoinGecko token IDs.
 * Returns a map of coin ID → price.
 */
export async function fetchOnChainPrices(
  coinIds: string[],
): Promise<Record<string, number>> {
  if (coinIds.length === 0) return {};
  const ids = coinIds.map(id => `coingecko:${id}`).join(',');
  const data = await fetchJson(`${COINS_URL}/prices/current/${ids}`) as {
    coins: Record<string, { price: number }>;
  };
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(data.coins ?? {})) {
    const id = key.replace('coingecko:', '');
    result[id] = val.price;
  }
  return result;
}

/**
 * Fetch on-chain metrics for the tokens we track that have DeFiLlama protocols.
 * Returns aggregated protocol metrics + chain TVL.
 */
export async function fetchOnChainMetrics(
  tokens: TokenDef[],
): Promise<OnChainMetrics> {
  const log = logger.child({ module: 'onchain' });
  const protocols: ProtocolMetrics[] = [];
  const chainsMap = new Map<string, number>();

  // Fetch protocol-level data
  const protocolIds = [...new Set(
    tokens
      .map(t => PROTOCOL_MAP[t.id])
      .filter(Boolean),
  )] as string[];

  log.info(`Fetching on-chain metrics for ${protocolIds.length} protocols...`);

  // Batch protocol TVL + fees in parallel (limit concurrency)
  const BATCH = 5;
  for (let i = 0; i < protocolIds.length; i += BATCH) {
    const batch = protocolIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (slug) => {
        const [tvl, fees] = await Promise.all([
          fetchProtocolTvl(slug),
          fetchProtocolFees(slug).catch(() => ({ total1d: 0, total7d: 0, total30d: 0 })),
        ]);
        return { slug, tvl, fees };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { slug, tvl, fees } = result.value;
        // Compute TVL trend direction from fee growth as a proxy
        const tvlTrend = computeTvlTrend(fees.total1d, fees.total7d);
        protocols.push({
          name: slug,
          tvl,
          fees1d: fees.total1d,
          fees7d: fees.total7d,
          fees30d: fees.total30d,
          tvlTrend,
        });
      } else {
        log.warn('Protocol fetch failed', { error: result.reason?.message ?? String(result.reason) });
      }
    }
  }

  // Fetch chain-level TVL for chains we track
  const chainSlugs = [...new Set(Object.values(CHAIN_SLUGS))];
  const chainResults = await Promise.allSettled(
    chainSlugs.map(async (slug) => {
      const tvl = await fetchChainTvl(slug);
      return { slug, tvl };
    }),
  );

  for (const result of chainResults) {
    if (result.status === 'fulfilled') {
      chainsMap.set(result.value.slug, result.value.tvl);
    }
  }

  const chains: ChainMetrics[] = Array.from(chainsMap.entries()).map(
    ([chain, tvl]) => ({
      chain,
      tvl,
      protocols: protocolIds.filter(
        p => p.includes(chain.toLowerCase()),
      ).length,
    }),
  );

  log.info(`On-chain metrics: ${protocols.length} protocols, ${chains.length} chains`);
  return { protocols, chains, fetchedAt: new Date().toISOString() };
}
