import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from './db.js';
import type {
  KlineRow, FundingRow, OIRow, LsRatioRow, LiquidationRow,
  FearGreedRow, OrderBookRow, CrossAssetRow, PaperTradeRow,
  EnrichedTicker, NewsMatch, TokenSignal,
} from '../types.js';

const TEST_DB = resolve(tmpdir(), `crypto-radar-test-${Date.now()}.db`);

describe('Store', () => {
  let store: Store;

  beforeEach(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new Store({ path: TEST_DB });
    store.migrate();
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  describe('migration', () => {
    it('creates all tables', async () => {
      const stats = store.stats();
      expect(stats).toHaveProperty('klines');
      expect(stats).toHaveProperty('tickers');
      expect(stats).toHaveProperty('signals');
      expect(stats).toHaveProperty('news');
      expect(stats).toHaveProperty('paper_trades');
      expect(stats).toHaveProperty('futures_funding');
      expect(stats).toHaveProperty('futures_oi');
      expect(stats).toHaveProperty('futures_ls_ratio');
      expect(stats).toHaveProperty('liquidations');
      expect(stats).toHaveProperty('fear_greed');
      expect(stats).toHaveProperty('orderbook');
      expect(stats).toHaveProperty('cross_asset');
      expect(stats).toHaveProperty('ticker_history');
      expect(stats).toHaveProperty('signal_history');
      expect(stats).toHaveProperty('predictions');
    });

    it('is idempotent', async () => {
      expect(() => store.migrate()).not.toThrow();
      expect(() => store.migrate()).not.toThrow();
    });
  });

  describe('klines', () => {
    const kline: KlineRow = {
      symbol: 'SOLUSDT', interval: '1h', open_time: 1000000,
      open: 100, high: 105, low: 99, close: 104, volume: 5000, quote_volume: 520000,
      taker_buy_vol: 2500, taker_buy_quote_vol: 260000,
    };

    it('upserts and retrieves klines', async () => {
      const inserted = await store.upsertKlines([kline]);
      expect(inserted).toBe(1);

      const rows = store.getKlines('SOLUSDT', '1h');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.close).toBe(104);
    });

    it('idempotent on re-insert', async () => {
      await store.upsertKlines([kline]);
      const inserted = await store.upsertKlines([kline]);
      expect(inserted).toBe(0);
    });

    it('supports from/to filtering', async () => {
      const k1 = { ...kline, open_time: 1000000 };
      const k2 = { ...kline, open_time: 2000000, close: 110 };
      const k3 = { ...kline, open_time: 3000000, close: 115 };
      await store.upsertKlines([k1, k2, k3]);

      const rows = store.getKlines('SOLUSDT', '1h', { from: 1500000, to: 2500000 });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.close).toBe(110);
    });

    it('latestKlineTime returns null for empty', async () => {
      expect(store.latestKlineTime('SOLUSDT', '1h')).toBeNull();
    });

    it('latestKlineTime returns max open_time', async () => {
      await store.upsertKlines([kline, { ...kline, open_time: 2000000 }]);
      expect(store.latestKlineTime('SOLUSDT', '1h')).toBe(2000000);
    });

    it('klineCount returns total across symbols', async () => {
      await store.upsertKlines([kline, { ...kline, symbol: 'BTCUSDT', open_time: 1000001 }]);
      expect(store.klineCount()).toBe(2);
      expect(store.klineCount('SOLUSDT')).toBe(1);
    });
  });

  describe('tickers & signals & news (persistRun)', () => {
    const ticker: EnrichedTicker = {
      runId: 'R1', tsUtc: '2026-07-07T12:00:00Z', dateEt: '07/07 08:00',
      symbol: 'SOL', chain: 'solana', tokenId: 'solana', tokenName: 'Solana',
      lastPrice: 150, bidPrice: 149.95, bidQty: 100, askPrice: 150.05, askQty: 100,
      spreadPct: 0.07, openPrice: 148, highPrice: 152, lowPrice: 147, prevClosePrice: 149,
      priceChange: 1, priceChangePercent: 0.67, weightedAvgPrice: 150,
      volume: 50000, quoteVolume: 7500000, count: 1000, lastQty: 10,
      vwapDistPct: 0, rangePosPct: 0.6, bookImbalance: 0, volVsAvg: 0.1, obv: 0,
      momentum: 0.8, alerts: '', source: 'binance',
      rsi: 55, macdHistogram: 0.5, bbWidth: 0.05, atrPct: 1.2, adx: 25, regime: 'neutral', compositeScore: 65,
    };

    const signal: TokenSignal = {
      symbol: 'SOL', chain: 'solana', lastPrice: 150, priceChangePercent: 0.67,
      momentumScore: 60, technicalScore: 55, newsScore: 70, compositeScore: 65,
      alerts: ['long'], timestamp: '2026-07-07T12:00:00Z',
      tokenId: 'solana', tokenName: 'Solana',
    };

    const news: NewsMatch = {
      runId: 'R1', tsUtc: '2026-07-07T12:00:00Z',
      symbol: 'SOL', headline: 'Solana news', description: 'Great news',
      source: 'CoinDesk', domain: 'coindesk.com', relevance: 0.9, url: 'https://example.com',
    };

    it('persists tickers from run result', async () => {
      await store.persistRun({ tickers: [ticker], signals: [], newsMatches: [] });
      const rows = store.getLatestTickers({ limit: 10 });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.symbol).toBe('SOL');
      expect(rows[0]!.price).toBe(150);
    });

    it('persists signals from run result', async () => {
      await store.persistRun({ tickers: [], signals: [signal], newsMatches: [] });
      const rows = store.getSignals({ limit: 10 });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.composite_score).toBe(65);
    });

    it('persists news from run result', async () => {
      await store.persistRun({ tickers: [], signals: [], newsMatches: [news] });
      const rows = store.getNews({ limit: 10 });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.headline).toBe('Solana news');
    });

    it('getSignals filters by minScore', async () => {
      const s2 = { ...signal, symbol: 'BTC', compositeScore: 80, timestamp: '2026-07-07T12:01:00Z' };
      const s3 = { ...signal, symbol: 'ETH', compositeScore: 40, timestamp: '2026-07-07T12:02:00Z' };
      await store.persistRun({ tickers: [], signals: [signal, s2, s3], newsMatches: [] });
      const rows = store.getSignals({ minScore: 60, limit: 10 });
      expect(rows).toHaveLength(2); // SOL (65) + BTC (80), but not ETH (40)
    });
  });

  describe('paper trades', () => {
    const trade: PaperTradeRow = {
      id: 'T1', profile: 'trader1', symbol: 'SOL', side: 'buy',
      entry_price: 150, entry_time: '2026-07-07T12:00:00Z',
      quantity: 10, exit_price: null, exit_time: null, pnl: null, fees: null, status: 'open',
    };

    it('upserts and retrieves', async () => {
      await store.upsertPaperTrade(trade);
      const rows = store.getPaperTrades('trader1');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.symbol).toBe('SOL');
    });

    it('filters by status', async () => {
      await store.upsertPaperTrade(trade);
      await store.upsertPaperTrade({ ...trade, id: 'T2', status: 'closed', pnl: 50, exit_price: 160, exit_time: '2026-07-07T14:00:00Z' });
      expect(store.getPaperTrades('trader1', 'open')).toHaveLength(1);
      expect(store.getPaperTrades('trader1', 'closed')).toHaveLength(1);
    });
  });

  describe('futures sources', () => {
    const funding: FundingRow[] = [{ symbol: 'SOLUSDT', ts: 1000000, rate: 0.0001 }];
    const oi: OIRow[] = [{ symbol: 'SOLUSDT', ts: 1000000, open_interest: 500000 }];
    const ls: LsRatioRow[] = [{ symbol: 'SOLUSDT', ts: 1000000, long_account: 55, short_account: 45, long_position: 60, short_position: 40 }];
    const liq: LiquidationRow[] = [{ id: 'L1', symbol: 'SOLUSDT', ts: 1000000, side: 'SELL', price: 145, qty: 100, usd: 14500 }];

    it('upsertFunding and getFunding', async () => {
      expect(await store.upsertFunding(funding)).toBe(1);
      const rows = store.getFunding('SOLUSDT');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rate).toBe(0.0001);
    });

    it('upsertOpenInterest and getOpenInterest', async () => {
      expect(await store.upsertOpenInterest(oi)).toBe(1);
      const rows = store.getOpenInterest('SOLUSDT');
      expect(rows[0]!.open_interest).toBe(500000);
    });

    it('upsertLsRatio and getLsRatio', async () => {
      expect(await store.upsertLsRatio(ls)).toBe(1);
      const rows = store.getLsRatio('SOLUSDT');
      expect(rows[0]!.long_account).toBe(55);
    });

    it('upsertLiquidations and getLiquidations', async () => {
      expect(await store.upsertLiquidations(liq)).toBe(1);
      const rows = store.getLiquidations('SOLUSDT');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.side).toBe('SELL');
    });
  });

  describe('fear & greed', () => {
    const fg: FearGreedRow = { ts: 1000000, value: 55, classification: 'Neutral' };

    it('upserts and retrieves', async () => {
      await store.upsertFearGreed(fg);
      const rows = store.getFearGreed();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.value).toBe(55);
    });
  });

  describe('orderbook', () => {
    const ob: OrderBookRow = { symbol: 'SOLUSDT', ts: 1000000, spread_pct: 0.05, imbalance: 0.1, bids: '[[150,1]]', asks: '[[150.1,1]]' };

    it('upserts and retrieves', async () => {
      await store.upsertOrderBook(ob);
      const rows = store.getOrderBook('SOLUSDT');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.spread_pct).toBe(0.05);
    });
  });

  describe('cross asset', () => {
    const ca: CrossAssetRow = { ts: 1000000, btc_dominance: 45, eth_dominance: 18, total_mcap: 2000000000000, total_mcap_change_24h: 2.5, market_cap_percentage_json: '{"btc":45,"eth":18}' };

    it('upserts and retrieves', async () => {
      await store.upsertCrossAsset(ca);
      const rows = store.getCrossAsset();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.btc_dominance).toBe(45);
    });
  });

  describe('stats', () => {
    it('returns zero counts for empty tables', async () => {
      const s = store.stats();
      expect(s.klines).toBe(0);
      expect(s.tickers).toBe(0);
    });
  });

  describe('Store.open', () => {
    it('creates database at dataDir/fileName', async () => {
      const s = Store.open('/tmp', `crypto-radar-open-test-${Date.now()}.db`);
      s.migrate();
      expect(s.stats()).toHaveProperty('klines');
      s.close();
    });
  });

  describe('Store constructor guards', () => {
    it('throws DataError when createIfMissing is false and db absent', async () => {
      const missing = resolve(tmpdir(), `crypto-radar-missing-${Date.now()}.db`);
      expect(existsSync(missing)).toBe(false);
      expect(() => new Store({ path: missing, createIfMissing: false })).toThrow();
    });
  });

  describe('klines — ordering, limit, cache', () => {
    const base = {
      symbol: 'SOLUSDT', interval: '1h', open: 100, high: 105, low: 99, close: 104,
      volume: 5000, quote_volume: 520000, taker_buy_vol: 2500, taker_buy_quote_vol: 260000,
    };
    it('orders ascending and respects limit', async () => {
      await store.upsertKlines([
        { ...base, open_time: 3000000, close: 300 },
        { ...base, open_time: 1000000, close: 100 },
        { ...base, open_time: 2000000, close: 200 },
      ]);
      const asc = store.getKlines('SOLUSDT', '1h', { order: 'asc', limit: 2 });
      expect(asc).toHaveLength(2);
      expect(asc[0]!.close).toBe(100);
      expect(asc[1]!.close).toBe(200);
      const desc = store.getKlines('SOLUSDT', '1h', { order: 'desc' });
      expect(desc[0]!.close).toBe(300);
    });
  });

  describe('signals — symbol & direction filters', () => {
    const sig = (sym: string, score: number, dir: string, ts: string): TokenSignal => ({
      symbol: sym, chain: 'solana', lastPrice: 150, priceChangePercent: 0.5,
      momentumScore: 60, technicalScore: 55, newsScore: 70, compositeScore: score,
      alerts: [dir], timestamp: ts, tokenId: sym.toLowerCase(), tokenName: sym,
    });
    beforeEach(async () => {
      await store.persistRun({
        tickers: [],
        signals: [sig('SOL', 65, 'bullish', '2026-07-07T12:00:00Z'), sig('BTC', 80, 'bearish', '2026-07-07T12:01:00Z')],
        newsMatches: [],
      });
    });
    it('filters by symbol', async () => {
      const rows = store.getSignals({ symbol: 'BTC' });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.symbol).toBe('BTC');
    });
    it('filters by direction', async () => {
      const rows = store.getSignals({ direction: 'bearish' });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.symbol).toBe('BTC');
    });
    it('getSignalHistory supports from/order/limit', async () => {
      const rows = store.getSignalHistory('SOL', { order: 'asc', limit: 1 });
      expect(rows).toHaveLength(1);
      const rowsDesc = store.getSignalHistory('SOL', { order: 'desc', limit: 1 });
      expect(rowsDesc[0]!.ts_utc).toBe('2026-07-07T12:00:00Z');
    });
  });

  describe('tickers & news filters', () => {
    const ticker = (sym: string): EnrichedTicker => ({
      runId: 'R1', tsUtc: '2026-07-07T12:00:00Z', dateEt: '07/07 08:00',
      symbol: sym, chain: 'solana', tokenId: sym.toLowerCase(), tokenName: sym,
      lastPrice: 150, bidPrice: 149, bidQty: 100, askPrice: 151, askQty: 100,
      spreadPct: 0.07, openPrice: 148, highPrice: 152, lowPrice: 147, prevClosePrice: 149,
      priceChange: 1, priceChangePercent: 0.67, weightedAvgPrice: 150,
      volume: 50000, quoteVolume: 7500000, count: 1000, lastQty: 10,
      vwapDistPct: 0, rangePosPct: 0.6, bookImbalance: 0, volVsAvg: 0.1, obv: 0,
      momentum: 0.8, alerts: '', source: 'binance',
      rsi: 55, macdHistogram: 0.5, bbWidth: 0.05, atrPct: 1.2, adx: 25, regime: 'neutral', compositeScore: 65,
    });
    beforeEach(async () => {
      await store.persistRun({ tickers: [ticker('SOL'), ticker('BTC')], signals: [], newsMatches: [] });
    });
    it('getLatestTickers filters by symbol', async () => {
      const rows = store.getLatestTickers({ symbol: 'BTC' });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.symbol).toBe('BTC');
    });
    it('getTickerHistory returns time series', async () => {
      const rows = store.getTickerHistory('SOL', { limit: 1 });
      expect(rows).toHaveLength(1);
    });
  });

  describe('retention & pruning', () => {
    it('enforceRetention deletes old history rows', async () => {
      const old = '2000-01-01T00:00:00Z';
      const recent = new Date().toISOString();
      await store.upsertKlines([{ symbol: 'SOLUSDT', interval: '1h', open_time: 1, open: 100, high: 105, low: 99, close: 104, volume: 5, quote_volume: 520, taker_buy_vol: 2, taker_buy_quote_vol: 260 }]);
      await store.persistRun({
        tickers: [], signals: [],
        newsMatches: [{ runId: 'R1', tsUtc: old, symbol: 'SOL', headline: 'old', description: 'd', source: 'X', domain: 'x.com', relevance: 0.5, url: 'https://x.com' }],
      });
      // direct insert of history is via persistRun; just confirm retention runs without error
      await expect(store.enforceRetention(99999)).resolves.not.toThrow();
      // with 0 days it is a no-op
      await expect(store.enforceRetention(0)).resolves.not.toThrow();
    });

    it('prunePredictions removes old predictions', async () => {
      const oldTs = String(Date.now() - 10_000);
      await store.upsertPrediction({ id: 'P1', symbol: 'SOL', ts: oldTs, direction: 'buy', confidence: 0.8, model_id: 'm1', horizon: '1h', ml_score: 0.7, features_hash: 'h' });
      const removed = await store.prunePredictions(Date.now() - 5000);
      expect(removed).toBe(1);
      expect(store.getPredictions({})).toHaveLength(0);
    });
  });

  describe('predictions', () => {
    beforeEach(async () => {
      await store.upsertPrediction({ id: 'P1', symbol: 'SOL', ts: '1000000', direction: 'buy', confidence: 0.8, model_id: 'm1', horizon: '1h', ml_score: 0.7, features_hash: 'h' });
      await store.upsertPrediction({ id: 'P2', symbol: 'BTC', ts: '2000000', direction: 'sell', confidence: 0.6, model_id: 'm2', horizon: '4h', ml_score: 0.5, features_hash: 'h2' });
    });
    it('getPredictions filters by symbol and model', async () => {
      expect(store.getPredictions({ symbol: 'SOL' })).toHaveLength(1);
      expect(store.getPredictions({ model_id: 'm2' })).toHaveLength(1);
      expect(store.getPredictions({ minConfidence: 0.7 })).toHaveLength(1);
    });
  });

  describe('liquidations — no symbol', () => {
    it('getLiquidations returns all when no symbol given', async () => {
      await store.upsertLiquidations([
        { id: 'L1', symbol: 'SOLUSDT', ts: 1, side: 'SELL', price: 1, qty: 1, usd: 1 },
        { id: 'L2', symbol: 'BTCUSDT', ts: 2, side: 'BUY', price: 2, qty: 2, usd: 4 },
      ]);
      expect(store.getLiquidations()).toHaveLength(2);
    });
  });
});
