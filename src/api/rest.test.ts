// ═══════════════════════════════════════════════════════════════════════
// REST API routes — regression tests (via Fastify app.inject)
//
// Tests the Fastify-ported routes from restRoutes (src/api/fastify/routes/rest.ts).
// Covers the same contract the old Node http handler tested, now via app.inject().
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../core/config.js', () => ({
  loadConfig: vi.fn(() => ({
    apiToken: 'test-token-123',
    dataDir: '/tmp',
  })),
  isCloudMode: vi.fn(() => false),
}));

import { Store } from '../store/db.js';
import { createApp } from './fastify/app.js';

const TEST_DB = resolve(tmpdir(), `crypto-radar-rest-test-${Date.now()}.db`);

describe('REST handler (Fastify)', () => {
  let store: Store;
  let app: Awaited<ReturnType<typeof createApp>>;
  let jwtToken: string;

  beforeEach(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new Store({ path: TEST_DB });
    store.migrate();
    app = await createApp({ store, jwtSecret: 'test-secret', corsOrigin: '*' });
    await app.ready();
    jwtToken = app.jwt.sign({});
  });

  afterEach(async () => {
    try { await app.close(); } catch { /* already closed */ }
    try { store.close(); } catch { /* already closed */ }
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  // ── GET /api/health ──

  describe('GET /api/health', () => {
    it('returns ok status with stats and uptime', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ status: 'ok' });
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('stats');
    });
  });

  // ── GET /api/tickers ──

  describe('GET /api/tickers', () => {
    it('returns empty array when no tickers', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/tickers' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns tickers with limit param', async () => {
      await store.persistRun({
        tickers: [{
          runId: 'R1', tsUtc: '2026-07-07T12:00:00Z', dateEt: '07/07 08:00',
          symbol: 'SOL', chain: 'solana', tokenId: 'solana', tokenName: 'Solana',
          lastPrice: 150, bidPrice: 149.95, bidQty: 100, askPrice: 150.05, askQty: 100,
          spreadPct: 0.07, openPrice: 148, highPrice: 152, lowPrice: 147, prevClosePrice: 149,
          priceChange: 1, priceChangePercent: 0.67, weightedAvgPrice: 150,
          volume: 50000, quoteVolume: 7500000, count: 1000, lastQty: 10,
          vwapDistPct: 0, rangePosPct: 0.6, bookImbalance: 0, volVsAvg: 0.1, obv: 0,
          momentum: 0.8, alerts: '', source: 'binance',
          rsi: 55, macdHistogram: 0.5, bbWidth: 0.05, atrPct: 1.2, adx: 25,
          regime: 'neutral', compositeScore: 65,
        }],
        signals: [],
        newsMatches: [],
      });
      const res = await app.inject({ method: 'GET', url: '/api/tickers?limit=10' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].symbol).toBe('SOL');
    });
  });

  // ── GET /api/tickers/:symbol ──

  describe('GET /api/tickers/:symbol', () => {
    it('returns 404 for missing symbol', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/tickers/NONEXISTENT' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('returns ticker data for existing symbol', async () => {
      await store.persistRun({
        tickers: [{
          runId: 'R1', tsUtc: '2026-07-07T12:00:00Z', dateEt: '07/07 08:00',
          symbol: 'SOL', chain: 'solana', tokenId: 'solana', tokenName: 'Solana',
          lastPrice: 150, bidPrice: 149.95, bidQty: 100, askPrice: 150.05, askQty: 100,
          spreadPct: 0.07, openPrice: 148, highPrice: 152, lowPrice: 147, prevClosePrice: 149,
          priceChange: 1, priceChangePercent: 0.67, weightedAvgPrice: 150,
          volume: 50000, quoteVolume: 7500000, count: 1000, lastQty: 10,
          vwapDistPct: 0, rangePosPct: 0.6, bookImbalance: 0, volVsAvg: 0.1, obv: 0,
          momentum: 0.8, alerts: '', source: 'binance',
          rsi: 55, macdHistogram: 0.5, bbWidth: 0.05, atrPct: 1.2,
        }],
        signals: [],
        newsMatches: [],
      });
      const res = await app.inject({ method: 'GET', url: '/api/tickers/SOL' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ symbol: 'SOL', price: 150 });
    });
  });

  // ── GET /api/signals ──

  describe('GET /api/signals', () => {
    it('returns empty array when no signals', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/signals' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('filters by minScore and direction', async () => {
      await store.persistRun({
        tickers: [],
        signals: [
          { symbol: 'SOL', chain: 'solana', lastPrice: 150, priceChangePercent: 0.67, momentumScore: 60, technicalScore: 55, newsScore: 70, compositeScore: 80, alerts: ['long'], timestamp: '2026-07-07T12:00:00Z', tokenId: 'solana', tokenName: 'Solana' },
          { symbol: 'BTC', chain: 'bitcoin', lastPrice: 50000, priceChangePercent: 0.5, momentumScore: 30, technicalScore: 40, newsScore: 50, compositeScore: 40, alerts: [], timestamp: '2026-07-07T12:01:00Z', tokenId: 'bitcoin', tokenName: 'Bitcoin' },
        ],
        newsMatches: [],
      });
      const res = await app.inject({ method: 'GET', url: '/api/signals?minScore=60&limit=10' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].composite_score).toBe(80);
    });
  });

  // ── GET /api/signals/:symbol ──

  describe('GET /api/signals/:symbol', () => {
    it('returns 404 for missing symbol', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/signals/NONEXISTENT' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('returns signals for matching symbol', async () => {
      await store.persistRun({
        tickers: [],
        signals: [
          { symbol: 'SOL', chain: 'solana', lastPrice: 150, priceChangePercent: 0.67, momentumScore: 60, technicalScore: 55, newsScore: 70, compositeScore: 80, alerts: ['long'], timestamp: '2026-07-07T12:00:00Z', tokenId: 'solana', tokenName: 'Solana' },
          { symbol: 'BTC', chain: 'bitcoin', lastPrice: 50000, priceChangePercent: 0.5, momentumScore: 30, technicalScore: 40, newsScore: 50, compositeScore: 40, alerts: [], timestamp: '2026-07-07T12:01:00Z', tokenId: 'bitcoin', tokenName: 'Bitcoin' },
        ],
        newsMatches: [],
      });
      const res = await app.inject({ method: 'GET', url: '/api/signals/SOL' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].symbol).toBe('SOL');
    });
  });

  // ── GET /api/klines/:symbol ──

  describe('GET /api/klines/:symbol', () => {
    it('returns klines with default interval', async () => {
      await store.upsertKlines([{
        symbol: 'SOLUSDT', interval: '1h', open_time: 1000000,
        open: 100, high: 105, low: 99, close: 104, volume: 5000,
        quote_volume: 520000, taker_buy_vol: 2500, taker_buy_quote_vol: 260000,
      }]);
      const res = await app.inject({ method: 'GET', url: '/api/klines/SOLUSDT' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].close).toBe(104);
    });

    it('accepts interval, from, to, limit params', async () => {
      await store.upsertKlines([
        { symbol: 'SOLUSDT', interval: '1h', open_time: 1000000, open: 100, high: 105, low: 99, close: 104, volume: 5000, quote_volume: 520000, taker_buy_vol: 2500, taker_buy_quote_vol: 260000 },
        { symbol: 'SOLUSDT', interval: '1h', open_time: 2000000, open: 105, high: 110, low: 104, close: 108, volume: 6000, quote_volume: 630000, taker_buy_vol: 3000, taker_buy_quote_vol: 315000 },
        { symbol: 'SOLUSDT', interval: '4h', open_time: 1000000, open: 100, high: 110, low: 99, close: 108, volume: 11000, quote_volume: 1150000, taker_buy_vol: 5500, taker_buy_quote_vol: 575000 },
      ]);
      const res = await app.inject({ method: 'GET', url: '/api/klines/SOLUSDT?interval=4h&limit=5' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
    });
  });

  // ── GET /api/news ──

  describe('GET /api/news', () => {
    it('returns news items', async () => {
      await store.persistRun({
        tickers: [],
        signals: [],
        newsMatches: [{
          runId: 'R1', tsUtc: '2026-07-07T12:00:00Z',
          symbol: 'SOL', headline: 'Solana news', description: 'desc',
          source: 'CoinDesk', domain: 'coindesk.com', relevance: 0.9,
          url: 'https://example.com',
        }],
      });
      const res = await app.inject({ method: 'GET', url: '/api/news?limit=10' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].headline).toBe('Solana news');
    });
  });

  // ── GET /api/portfolio ──

  describe('GET /api/portfolio', () => {
    it('returns empty portfolio when no trades', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/portfolio',
        headers: { authorization: `Bearer ${jwtToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ profile: 'trader1', cash: 100000, holdings: [], totalTrades: 0 });
      expect(body.winRate).toBe(0);
    });

    it('computes holdings and PnL from trades', async () => {
      const trades = [
        { id: 'T1', profile: 'trader1', symbol: 'SOL', side: 'buy', entry_price: 150, entry_time: '2026-07-07T12:00:00Z', quantity: 10, exit_price: null, exit_time: null, pnl: null, fees: null, status: 'open' },
        { id: 'T2', profile: 'trader1', symbol: 'SOL', side: 'buy', entry_price: 160, entry_time: '2026-07-07T13:00:00Z', quantity: 5, exit_price: null, exit_time: null, pnl: null, fees: null, status: 'open' },
        { id: 'T3', profile: 'trader1', symbol: 'BTC', side: 'buy', entry_price: 50000, entry_time: '2026-07-07T12:00:00Z', quantity: 1, exit_price: 52000, exit_time: '2026-07-07T14:00:00Z', pnl: 2000, fees: null, status: 'closed' },
        { id: 'T4', profile: 'trader1', symbol: 'BTC', side: 'buy', entry_price: 51000, entry_time: '2026-07-07T15:00:00Z', quantity: 0.5, exit_price: 49000, exit_time: '2026-07-07T16:00:00Z', pnl: -1000, fees: null, status: 'closed' },
      ];
      for (const t of trades) await store.upsertPaperTrade(t);

      const res = await app.inject({
        method: 'GET', url: '/api/portfolio',
        headers: { authorization: `Bearer ${jwtToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.profile).toBe('trader1');
      expect(body.cash).toBe(98700);
      expect(body.holdings).toHaveLength(1);
      const solHolding = body.holdings.find((h: { symbol: string }) => h.symbol === 'SOL');
      expect(solHolding).toBeDefined();
      expect(solHolding.quantity).toBe(15);
      expect(solHolding.avgEntry).toBeCloseTo(153.33, 1);
      expect(body.pnl).toBe(1000);
      expect(body.winRate).toBe(0.5);
      expect(body.totalTrades).toBe(2);
    });
  });

  // ── GET /api/portfolio/trades ──

  describe('GET /api/portfolio/trades', () => {
    it('returns trades for a profile', async () => {
      await store.upsertPaperTrade({
        id: 'T1', profile: 'trader1', symbol: 'SOL', side: 'buy',
        entry_price: 150, entry_time: '2026-07-07T12:00:00Z',
        quantity: 10, exit_price: null, exit_time: null, pnl: null, fees: null, status: 'open',
      });
      const res = await app.inject({
        method: 'GET', url: '/api/portfolio/trades',
        headers: { authorization: `Bearer ${jwtToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().trades).toHaveLength(1);
    });

    it('filters by status', async () => {
      await store.upsertPaperTrade({
        id: 'T1', profile: 'trader1', symbol: 'SOL', side: 'buy',
        entry_price: 150, entry_time: '2026-07-07T12:00:00Z',
        quantity: 10, exit_price: null, exit_time: null, pnl: null, fees: null, status: 'open',
      });
      await store.upsertPaperTrade({
        id: 'T2', profile: 'trader1', symbol: 'BTC', side: 'buy',
        entry_price: 50000, entry_time: '2026-07-07T12:00:00Z',
        quantity: 1, exit_price: 52000, exit_time: '2026-07-07T14:00:00Z', pnl: 2000, fees: null, status: 'closed',
      });
      const res = await app.inject({
        method: 'GET', url: '/api/portfolio/trades?status=open',
        headers: { authorization: `Bearer ${jwtToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.trades).toHaveLength(1);
      expect(body.trades[0].symbol).toBe('SOL');
    });
  });

  // ── GET /api/futures/:symbol ──

  describe('GET /api/futures/:symbol', () => {
    it('returns funding data by default', async () => {
      await store.upsertFunding([{ symbol: 'SOLUSDT', ts: 1000000, rate: 0.0001 }]);
      const res = await app.inject({ method: 'GET', url: '/api/futures/SOLUSDT?limit=10' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].rate).toBe(0.0001);
    });

    it('returns OI data for type=oi', async () => {
      await store.upsertOpenInterest([{ symbol: 'SOLUSDT', ts: 1000000, open_interest: 500000 }]);
      const res = await app.inject({ method: 'GET', url: '/api/futures/SOLUSDT?type=oi' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].open_interest).toBe(500000);
    });

    it('returns lsratio data', async () => {
      await store.upsertLsRatio([{ symbol: 'SOLUSDT', ts: 1000000, long_account: 55, short_account: 45, long_position: 60, short_position: 40 }]);
      const res = await app.inject({ method: 'GET', url: '/api/futures/SOLUSDT?type=lsratio' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].long_account).toBe(55);
    });

    it('returns liquidations data', async () => {
      await store.upsertLiquidations([{ id: 'L1', symbol: 'SOLUSDT', ts: 1000000, side: 'SELL', price: 145, qty: 100, usd: 14500 }]);
      const res = await app.inject({ method: 'GET', url: '/api/futures/SOLUSDT?type=liquidations' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].side).toBe('SELL');
    });

    it('returns 400 for invalid type', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/futures/SOLUSDT?type=invalid' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'BAD_PARAMS' });
    });
  });

  // ── GET /api/fear-greed ──

  describe('GET /api/fear-greed', () => {
    it('returns fear-greed data', async () => {
      await store.upsertFearGreed({ ts: 1000000, value: 55, classification: 'Neutral' });
      const res = await app.inject({ method: 'GET', url: '/api/fear-greed?limit=10' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].value).toBe(55);
    });
  });

  // ── GET /api/cross-asset ──

  describe('GET /api/cross-asset', () => {
    it('returns cross-asset data', async () => {
      await store.upsertCrossAsset({ ts: 1000000, btc_dominance: 45, eth_dominance: 18, total_mcap: 2000000000000, total_mcap_change_24h: 2.5, market_cap_percentage_json: '{}' });
      const res = await app.inject({ method: 'GET', url: '/api/cross-asset?limit=10' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].btc_dominance).toBe(45);
    });
  });

  // ── GET /api/orderbook/:symbol ──

  describe('GET /api/orderbook/:symbol', () => {
    it('returns orderbook data', async () => {
      await store.upsertOrderBook({ symbol: 'SOLUSDT', ts: 1000000, spread_pct: 0.05, imbalance: 0.1, bids: '[[150,1]]', asks: '[[150.1,1]]' });
      const res = await app.inject({ method: 'GET', url: '/api/orderbook/SOLUSDT?limit=10' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].spread_pct).toBe(0.05);
    });
  });

  // ── GET /api/stats ──

  describe('GET /api/stats', () => {
    it('returns row counts', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/stats' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('klines');
      expect(body).toHaveProperty('tickers');
      expect(body).toHaveProperty('signals');
    });
  });

  // ── POST /api/collect ──

  describe('POST /api/collect', () => {
    it('returns 401 without token', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/collect' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('returns 401 with wrong token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/collect',
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('returns 200 with correct token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/collect',
        headers: { authorization: 'Bearer test-token-123' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, message: 'Collection triggered' });
    });
  });

  // ── 404 handling ──

  describe('404 handling', () => {
    it('returns 404 for unknown GET routes', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/nonexistent' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ── Error responses ──

  describe('error responses', () => {
    it('returns 500 on store error', async () => {
      store.close();
      const res = await app.inject({ method: 'GET', url: '/api/stats' });
      expect(res.statusCode).toBe(500);
    });
  });
});
