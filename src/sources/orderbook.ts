import { fetchDepth } from '../binance.js';
import { CircuitBreaker } from '../core/circuit-breaker.js';
import { RateLimiter } from '../core/rate-limiter.js';
import type { OrderBookRow } from '../types.js';

const breaker = new CircuitBreaker({ name: 'orderbook', failureThreshold: 3, cooldownMs: 60_000 });
const limiter = new RateLimiter(10, 1000);

export async function snapshotOrderBook(symbol: string): Promise<OrderBookRow | null> {
  await limiter.waitForToken();
  return breaker.call(async () => {
    try {
      const depth = await fetchDepth(symbol, 20);
      if (!depth || !depth.bids || !depth.asks || depth.bids.length === 0 || depth.asks.length === 0) return null;

      const bestBid = parseFloat(depth.bids[0]![0]);
      const bestAsk = parseFloat(depth.asks[0]![0]);
      const bidQty = parseFloat(depth.bids[0]![1]);
      const askQty = parseFloat(depth.asks[0]![1]);
      const spreadPct = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : 0;
      const totalQty = bidQty + askQty;
      const imbalance = totalQty > 0 ? (bidQty - askQty) / totalQty : 0;

      return {
        symbol,
        ts: Math.floor(Date.now() / 1000),
        spread_pct: spreadPct,
        imbalance,
        bids: JSON.stringify(depth.bids.slice(0, 20)),
        asks: JSON.stringify(depth.asks.slice(0, 20)),
      };
    } catch {
      return null;
    }
  });
}
