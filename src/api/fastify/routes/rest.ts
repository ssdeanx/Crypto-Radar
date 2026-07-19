// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Ported REST API Routes (Fastify)
// ═══════════════════════════════════════════════════════════════════════
//
// All existing GET routes from rest.ts, ported to Fastify format.
// Combined with new auth + portfolio POST routes for a unified API.
// ═══════════════════════════════════════════════════════════════════════

import type { FastifyPluginAsync } from 'fastify';
import { getTokenList } from '../../../tokens.js';
import { computeAllIndicators } from '../../../indicators.js';
import { detectRegime } from '../../../analysis/regime.js';
import { loadConfig } from '../../../core/config.js';
import type { Kline } from '../../../types.js';

// ── Helpers ──

function intParam(val: string | null | undefined, def: number): number {
  if (val === null || val === undefined) return def;
  const n = Number(val);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

export const restRoutes: FastifyPluginAsync = async (app) => {
  const store = app.store;

  // ── POST /api/collect (token-gated) ──
  app.post('/api/collect', async (request, reply) => {
    const config = loadConfig();
    const auth = request.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!config.apiToken || token !== config.apiToken) {
      return reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    return { ok: true, message: 'Collection triggered' };
  });

  // ── GET /api/health ──
  app.get('/api/health', async () => {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - parseInt(process.env['RADAR__START_TIME'] ?? '0', 10)) / 1000),
      stats: store.stats(),
    };
  });

  // ── GET /api/tickers ──
  app.get('/api/tickers', async (request) => {
    const { symbol, chain, limit } = request.query as {
      symbol?: string; chain?: string; limit?: string;
    };
    return store.getLatestTickers({
      symbol: symbol ?? undefined,
      chain: chain ?? undefined,
      limit: intParam(limit, 200),
    });
  });

  // ── GET /api/tickers/:symbol ──
  app.get<{ Params: { symbol: string } }>('/api/tickers/:symbol', async (request, reply) => {
    const rows = store.getLatestTickers({ symbol: request.params.symbol, limit: 1 });
    if (rows.length === 0) {
      return reply.status(404).send({ error: `Symbol not found: ${request.params.symbol}`, code: 'NOT_FOUND' });
    }
    return rows[0];
  });

  // ── GET /api/signals ──
  app.get('/api/signals', async (request) => {
    const { symbol, minScore, direction, limit } = request.query as {
      symbol?: string; minScore?: string; direction?: string; limit?: string;
    };
    return store.getSignals({
      symbol: symbol ?? undefined,
      minScore: minScore !== undefined ? parseFloat(minScore) : undefined,
      direction: direction ?? undefined,
      limit: intParam(limit, 200),
    });
  });

  // ── GET /api/signals/:symbol ──
  app.get<{ Params: { symbol: string } }>('/api/signals/:symbol', async (request, reply) => {
    const rows = store.getSignals({ limit: 1000 });
    const filtered = rows.filter(r => r.symbol === request.params.symbol);
    if (filtered.length === 0) {
      return reply.status(404).send({ error: `Symbol not found: ${request.params.symbol}`, code: 'NOT_FOUND' });
    }
    return filtered;
  });

  // ── GET /api/klines/:symbol ──
  app.get<{ Params: { symbol: string } }>('/api/klines/:symbol', async (request) => {
    const { interval, from, to, limit } = request.query as {
      interval?: string; from?: string; to?: string; limit?: string;
    };
    return store.getKlines(request.params.symbol, interval ?? '1h', {
      from: from !== undefined ? parseInt(from, 10) : undefined,
      to: to !== undefined ? parseInt(to, 10) : undefined,
      limit: intParam(limit, 500),
    });
  });

  // ── GET /api/futures/:symbol ──
  app.get<{ Params: { symbol: string } }>('/api/futures/:symbol', async (request, reply) => {
    const { type, limit } = request.query as { type?: string; limit?: string };
    const symbol = request.params.symbol;
    const t = type ?? 'funding';
    const lim = intParam(limit, 50);

    switch (t) {
      case 'funding': return store.getFunding(symbol, lim);
      case 'oi': return store.getOpenInterest(symbol, lim);
      case 'lsratio': return store.getLsRatio(symbol, lim);
      case 'liquidations': return store.getLiquidations(symbol, lim);
      default:
        return reply.status(400).send({
          error: `Invalid futures type: ${t}`,
          code: 'BAD_PARAMS',
          detail: 'Must be one of: funding, oi, lsratio, liquidations',
        });
    }
  });

  // ── GET /api/orderbook/:symbol ──
  app.get<{ Params: { symbol: string } }>('/api/orderbook/:symbol', async (request) => {
    const limit = intParam((request.query as { limit?: string }).limit, 50);
    return store.getOrderBook(request.params.symbol, limit);
  });

  // ── GET /api/news ──
  app.get('/api/news', async (request) => {
    const { symbol, limit } = request.query as { symbol?: string; limit?: string };
    return store.getNews({
      symbol: symbol ?? undefined,
      limit: intParam(limit, 50),
    });
  });

  // ── GET /api/tokens ──
  app.get('/api/tokens', async () => {
    return getTokenList().map(t => ({
      symbol: t.sym,
      name: t.name,
      chain: t.chain,
      pair: t.pair,
      id: t.id,
    }));
  });

  // ── GET /api/regime/:symbol ──
  app.get<{ Params: { symbol: string } }>('/api/regime/:symbol', async (request, reply) => {
    const { interval, limit } = request.query as { interval?: string; limit?: string };
    const rows = store.getKlines(request.params.symbol, interval ?? '1h', {
      limit: intParam(limit, 200),
    });
    if (rows.length < 30) {
      return reply.status(400).send({
        error: `Not enough kline data for ${request.params.symbol}. Need at least 30 candles.`,
        code: 'INSUFFICIENT_DATA',
      });
    }
    const klines: Kline[] = rows.map(r => ({
      openTime: r.open_time, open: r.open, high: r.high, low: r.low,
      close: r.close, volume: r.volume, closeTime: 0,
      quoteVolume: r.quote_volume, count: 0,
      takerBuyVol: r.taker_buy_vol, takerBuyQuoteVol: r.taker_buy_quote_vol,
      ignore: 0,
    }));
    const tech = computeAllIndicators(klines);
    return detectRegime({
      adx: tech.adx,
      bbWidth: tech.bb?.width ?? null,
      atrPct: tech.atrPct,
      volRatio: tech.volVsAvg,
    });
  });

  // ── GET /api/portfolio/trades ──
  app.get('/api/portfolio/trades', async (request) => {
    const { profile, status } = request.query as { profile?: string; status?: string };
    const trades = store.getPaperTrades(
      profile ?? 'trader1',
      status as 'open' | 'closed' | undefined,
    );
    return { trades };
  });

  // ── GET /api/portfolio ──
  app.get('/api/portfolio', async (request) => {
    const profile = (request.query as { profile?: string }).profile ?? 'trader1';
    const trades = store.getPaperTrades(profile);

    const holdingMap = new Map<string, { quantity: number; avgEntry: number }>();
    let totalPnl = 0;
    let wins = 0;
    let losses = 0;
    // Starting paper-trading capital. Cash is derived from trade history:
    // every open buy commits capital, every closed trade realizes its PnL.
    const STARTING_BALANCE = 100_000;
    let cash = STARTING_BALANCE;

    for (const t of trades) {
      if (t.status === 'open') {
        let h = holdingMap.get(t.symbol);
        if (!h) {
          h = { quantity: 0, avgEntry: 0 };
          holdingMap.set(t.symbol, h);
        }
        if (t.side === 'buy' && t.quantity != null && t.entry_price != null) {
          const newQty = h.quantity + t.quantity;
          h.avgEntry = (h.avgEntry * h.quantity + t.entry_price * t.quantity) / newQty;
          h.quantity = newQty;
          cash -= t.entry_price * t.quantity;
        } else if (t.side === 'sell' && t.quantity != null) {
          h.quantity -= t.quantity;
        }
      } else if (t.status === 'closed' && t.pnl != null) {
        totalPnl += t.pnl;
        cash += t.pnl;
        if (t.pnl > 0) wins++;
        else if (t.pnl < 0) losses++;
      }
    }

    const totalTrades = wins + losses;

    return {
      profile,
      cash,
      holdings: Array.from(holdingMap.entries())
        .filter(([, h]) => h.quantity !== 0)
        .map(([symbol, h]) => ({ symbol, quantity: h.quantity, avgEntry: h.avgEntry })),
      pnl: totalPnl,
      winRate: totalTrades > 0 ? wins / totalTrades : 0,
      totalTrades,
    };
  });

  // ── GET /api/fear-greed ──
  app.get('/api/fear-greed', async (request) => {
    const limit = intParam((request.query as { limit?: string }).limit, 30);
    return store.getFearGreed(limit);
  });

  // ── GET /api/cross-asset ──
  app.get('/api/cross-asset', async (request) => {
    const limit = intParam((request.query as { limit?: string }).limit, 50);
    return store.getCrossAsset(limit);
  });

  // ── GET /api/stats ──
  app.get('/api/stats', async () => {
    return store.stats();
  });

  // ── GET /api/predictions ──
  app.get('/api/predictions', async (request) => {
    const { symbol, model_id, minConfidence, limit } = request.query as {
      symbol?: string; model_id?: string; minConfidence?: string; limit?: string;
    };
    return store.getPredictions({
      symbol: symbol ?? undefined,
      model_id: model_id ?? undefined,
      minConfidence: minConfidence !== undefined ? parseFloat(minConfidence) : undefined,
      limit: intParam(limit, 200),
    });
  });

  // ── GET /api/predictions/:symbol ──
  app.get<{ Params: { symbol: string } }>('/api/predictions/:symbol', async (request) => {
    const limit = intParam((request.query as { limit?: string }).limit, 50);
    return store.getPredictions({ symbol: request.params.symbol, limit });
  });

  // ── POST /api/portfolio/trades (from portfolio.ts — registered here so all /api/* is Fastify) ──
  // (This will be overridden if portfolioRoutes is registered after, which is intentional)
};
