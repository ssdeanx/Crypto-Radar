import { CircuitBreaker } from '../core/circuit-breaker.js';
import { RateLimiter } from '../core/rate-limiter.js';
import type { FearGreedRow } from '../types.js';

const breaker = new CircuitBreaker({ name: 'alternative-me', failureThreshold: 3, cooldownMs: 60_000 });
const limiter = new RateLimiter(5, 1000);

export async function fetchFearGreed(limit = 30): Promise<FearGreedRow[]> {
  await limiter.waitForToken();
  return breaker.call(async () => {
    const res = await fetch(`https://api.alternative.me/fng/?limit=${limit}`);
    if (!res.ok) return [];
    const json = await res.json() as { data: Array<{ value: string; value_classification: string; timestamp: string }> };
    return json.data.map(d => ({
      ts: parseInt(d.timestamp, 10),
      value: parseInt(d.value, 10),
      classification: d.value_classification,
    }));
  });
}
