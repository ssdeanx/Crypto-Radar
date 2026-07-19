import { CircuitBreaker } from '../core/circuit-breaker.js';
import { RateLimiter } from '../core/rate-limiter.js';
import type { CrossAssetRow } from '../types.js';

const breaker = new CircuitBreaker({ name: 'coingecko', failureThreshold: 3, cooldownMs: 60_000 });
const limiter = new RateLimiter(5, 1000);

export async function fetchGlobalData(): Promise<CrossAssetRow | null> {
  await limiter.waitForToken();
  return breaker.call(async () => {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/global');
      if (!res.ok) return null;
      const json = await res.json() as {
        data: {
          market_cap_percentage: Record<string, number>;
          total_market_cap: Record<string, number>;
          market_cap_change_percentage_24h_usd: number;
        };
      };
      const d = json.data;
      return {
        ts: Math.floor(Date.now() / 1000),
        btc_dominance: d.market_cap_percentage['btc'] ?? null,
        eth_dominance: d.market_cap_percentage['eth'] ?? null,
        total_mcap: d.total_market_cap['usd'] ?? null,
        total_mcap_change_24h: d.market_cap_change_percentage_24h_usd,
        market_cap_percentage_json: JSON.stringify(d.market_cap_percentage),
      };
    } catch {
      return null;
    }
  });
}
