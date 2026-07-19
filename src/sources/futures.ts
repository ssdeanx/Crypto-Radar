import { CircuitBreaker } from '../core/circuit-breaker.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { DataError } from '../core/errors.js';
import type { FundingRow, OIRow, LsRatioRow, LiquidationRow } from '../types.js';

const FUTURES_BASE = 'https://fapi.binance.com';
const breaker = new CircuitBreaker({ name: 'binance-futures', failureThreshold: 3, cooldownMs: 60_000 });
const limiter = new RateLimiter(10, 1000);

async function futuresFetch<T>(path: string): Promise<T> {
  await limiter.waitForToken();
  return breaker.call(async () => {
    const res = await fetch(`${FUTURES_BASE}${path}`);
    if (!res.ok) throw new DataError('binance-futures', `HTTP ${res.status}: ${res.statusText}`);
    return res.json() as Promise<T>;
  });
}

export async function fetchFundingRates(symbol: string, limit = 30): Promise<FundingRow[]> {
  const data = await futuresFetch<Array<{ symbol: string; fundingTime: number; fundingRate: string }>>(`/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`);
  return data.map(d => ({ symbol: d.symbol, ts: Math.floor(d.fundingTime / 1000), rate: parseFloat(d.fundingRate) }));
}

export async function fetchOpenInterest(symbol: string): Promise<OIRow[]> {
  const data = await futuresFetch<{ symbol: string; openInterest: string; time: number }>(`/fapi/v1/openInterest?symbol=${symbol}`);
  return [{ symbol: data.symbol, ts: Math.floor(data.time / 1000), open_interest: parseFloat(data.openInterest) }];
}

export async function fetchLongShortRatio(symbol: string, period = '5m', limit = 30): Promise<LsRatioRow[]> {
  const data = await futuresFetch<Array<{ symbol: string; longAccount: string; shortAccount: string; longPosition: string; shortPosition: string; timestamp: number }>>(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`);
  return data.map(d => ({
    symbol: d.symbol, ts: Math.floor(d.timestamp / 1000),
    long_account: parseFloat(d.longAccount), short_account: parseFloat(d.shortAccount),
    long_position: 0, short_position: 0,
  }));
}

export async function fetchTopLongShortPositionRatio(symbol: string, period = '5m', limit = 30): Promise<LsRatioRow[]> {
  const data = await futuresFetch<Array<{ symbol: string; longPosition: string; shortPosition: string; timestamp: number }>>(`/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${period}&limit=${limit}`);
  return data.map(d => ({
    symbol: d.symbol, ts: Math.floor(d.timestamp / 1000),
    long_account: 0, short_account: 0,
    long_position: parseFloat(d.longPosition), short_position: parseFloat(d.shortPosition),
  }));
}

export async function fetchLiquidations(symbol: string, limit = 50): Promise<LiquidationRow[]> {
  try {
    const data = await futuresFetch<Array<{ symbol: string; time: number; side: string; price: string; origQty: string; executedQty: string; usdValue?: string }>>(`/fapi/v1/forceOrders?symbol=${symbol}&limit=${limit}`);
    return data.map(d => ({
      id: `${d.symbol}-${d.time}-${d.side}`,
      symbol: d.symbol, ts: Math.floor(d.time / 1000),
      side: d.side, price: parseFloat(d.price),
      qty: parseFloat(d.executedQty),
      usd: d.usdValue ? parseFloat(d.usdValue) : parseFloat(d.price) * parseFloat(d.executedQty),
    }));
  } catch {
    return [];
  }
}
