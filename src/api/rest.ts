import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store } from '../store/db.js';
import type { Kline } from '../types.js';
import { getTokenList } from '../tokens.js';
import { computeAllIndicators } from '../indicators.js';
import { detectRegime } from '../analysis/regime.js';
import { loadConfig } from '../core/config.js';

const _startTime = Date.now();

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, code: string, message: string, detail?: string): void {
  const body: Record<string, string> = { error: message, code };
  if (detail !== undefined) body.detail = detail;
  sendJson(res, status, body);
}

function intParam(val: string | null, def: number): number {
  if (val === null) return def;
  const n = Number(val);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

export function createRestHandler(store: Store): (req: IncomingMessage, url: URL, res: ServerResponse) => Promise<void> {
  return async (req, url, res) => {
    const method = req.method ?? 'GET';
    const pathname = url.pathname;

    try {
      // ── POST /api/collect (token-gated) ──
      if (method === 'POST' && pathname === '/api/collect') {
        const config = loadConfig();
        const raw = req.headers['authorization'];
        const auth = Array.isArray(raw) ? raw[0] : raw;
        const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!config.apiToken || token !== config.apiToken) {
          sendError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
          return;
        }
        sendJson(res, 200, { ok: true, message: 'Collection triggered' });
        return;
      }

      // Only GET routes from here
      if (method !== 'GET') {
        sendError(res, 404, 'NOT_FOUND', `Unknown route: ${method} ${pathname}`);
        return;
      }

      // ── GET /api/health ──
      if (pathname === '/api/health') {
        sendJson(res, 200, {
          status: 'ok',
          uptime: Math.floor((Date.now() - _startTime) / 1000),
          stats: store.stats(),
        });
        return;
      }

      // ── GET /api/tickers/:symbol ──
      {
        const m = pathname.match(/^\/api\/tickers\/([^/]+)$/);
        if (m) {
          const rows = store.getLatestTickers({ symbol: m[1]!, limit: 1 });
          if (rows.length === 0) {
            sendError(res, 404, 'NOT_FOUND', `Symbol not found: ${m[1]}`);
            return;
          }
          sendJson(res, 200, rows[0]);
          return;
        }
      }

      // ── GET /api/signals/:symbol ──
      {
        const m = pathname.match(/^\/api\/signals\/([^/]+)$/);
        if (m) {
          const rows = store.getSignals({ limit: 1000 });
          const filtered = rows.filter(r => r.symbol === m[1]);
          if (filtered.length === 0) {
            sendError(res, 404, 'NOT_FOUND', `Symbol not found: ${m[1]}`);
            return;
          }
          sendJson(res, 200, filtered);
          return;
        }
      }

      // ── GET /api/klines/:symbol ──
      {
        const m = pathname.match(/^\/api\/klines\/([^/]+)$/);
        if (m) {
          const interval = url.searchParams.get('interval') ?? '1h';
          const from = url.searchParams.get('from');
          const to = url.searchParams.get('to');
          const limit = intParam(url.searchParams.get('limit'), 500);
          const rows = store.getKlines(m[1]!, interval, {
            from: from !== null ? parseInt(from, 10) : undefined,
            to: to !== null ? parseInt(to, 10) : undefined,
            limit,
          });
          sendJson(res, 200, rows);
          return;
        }
      }

      // ── GET /api/futures/:symbol ──
      {
        const m = pathname.match(/^\/api\/futures\/([^/]+)$/);
        if (m) {
          const type = url.searchParams.get('type') ?? 'funding';
          const limit = intParam(url.searchParams.get('limit'), 50);
          const symbol = m[1]!;
          switch (type) {
            case 'funding':
              sendJson(res, 200, store.getFunding(symbol, limit));
              return;
            case 'oi':
              sendJson(res, 200, store.getOpenInterest(symbol, limit));
              return;
            case 'lsratio':
              sendJson(res, 200, store.getLsRatio(symbol, limit));
              return;
            case 'liquidations':
              sendJson(res, 200, store.getLiquidations(symbol, limit));
              return;
            default:
              sendError(res, 400, 'BAD_PARAMS', `Invalid futures type: ${type}`, 'Must be one of: funding, oi, lsratio, liquidations');
              return;
          }
        }
      }

      // ── GET /api/orderbook/:symbol ──
      {
        const m = pathname.match(/^\/api\/orderbook\/([^/]+)$/);
        if (m) {
          const limit = intParam(url.searchParams.get('limit'), 50);
          sendJson(res, 200, store.getOrderBook(m[1]!, limit));
          return;
        }
      }

      // ── GET /api/tickers ──
      if (pathname === '/api/tickers') {
        const symbol = url.searchParams.get('symbol') ?? undefined;
        const chain = url.searchParams.get('chain') ?? undefined;
        const limit = intParam(url.searchParams.get('limit'), 200);
        sendJson(res, 200, store.getLatestTickers({ symbol, chain, limit }));
        return;
      }

      // ── GET /api/signals ──
      if (pathname === '/api/signals') {
        const symbol = url.searchParams.get('symbol') ?? undefined;
        const minScoreStr = url.searchParams.get('minScore');
        const direction = url.searchParams.get('direction') ?? undefined;
        const limit = intParam(url.searchParams.get('limit'), 200);
        sendJson(res, 200, store.getSignals({
          symbol,
          minScore: minScoreStr !== null ? parseFloat(minScoreStr) : undefined,
          direction,
          limit,
        }));
        return;
      }

      // ── GET /api/news ──
      if (pathname === '/api/news') {
        const symbol = url.searchParams.get('symbol') ?? undefined;
        const limit = intParam(url.searchParams.get('limit'), 50);
        sendJson(res, 200, store.getNews({ symbol, limit }));
        return;
      }

      // ── GET /api/tokens ──
      if (pathname === '/api/tokens') {
        const tokens = getTokenList().map(t => ({
          symbol: t.sym,
          name: t.name,
          chain: t.chain,
          pair: t.pair,
          id: t.id,
        }));
        sendJson(res, 200, tokens);
        return;
      }

      // ── GET /api/regime/:symbol ──
      {
        const m = pathname.match(/^\/api\/regime\/([^/]+)$/);
        if (m) {
          const interval = url.searchParams.get('interval') ?? '1h';
          const limit = intParam(url.searchParams.get('limit'), 200);
          const rows = store.getKlines(m[1]!, interval, { limit });
          if (rows.length < 30) {
            sendError(res, 400, 'INSUFFICIENT_DATA', `Not enough kline data for ${m[1]!}. Need at least 30 candles.`);
            return;
          }
          const klines: Kline[] = rows.map(r => ({
            openTime: r.open_time, open: r.open, high: r.high, low: r.low,
            close: r.close, volume: r.volume, closeTime: 0,
            quoteVolume: r.quote_volume, count: 0,
            takerBuyVol: r.taker_buy_vol, takerBuyQuoteVol: r.taker_buy_quote_vol,
            ignore: 0,
          }));
          const tech = computeAllIndicators(klines);
          const result = detectRegime({
            adx: tech.adx,
            bbWidth: tech.bb?.width ?? null,
            atrPct: tech.atrPct,
            volRatio: tech.volVsAvg,
          });
          sendJson(res, 200, result);
          return;
        }
      }

      // ── GET /api/portfolio/trades ──
      if (pathname === '/api/portfolio/trades') {
        const profile = url.searchParams.get('profile') ?? 'trader1';
        const status = url.searchParams.get('status') ?? undefined;
        const trades = store.getPaperTrades(profile, status as 'open' | 'closed' | undefined);
        sendJson(res, 200, { trades });
        return;
      }

      // ── GET /api/portfolio ──
      if (pathname === '/api/portfolio') {
        const profile = url.searchParams.get('profile') ?? 'trader1';
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

        sendJson(res, 200, {
          profile,
          cash,
          holdings: Array.from(holdingMap.entries())
            .filter(([, h]) => h.quantity !== 0)
            .map(([symbol, h]) => ({ symbol, quantity: h.quantity, avgEntry: h.avgEntry })),
          pnl: totalPnl,
          winRate: totalTrades > 0 ? wins / totalTrades : 0,
          totalTrades,
        });
        return;
      }

      // ── GET /api/fear-greed ──
      if (pathname === '/api/fear-greed') {
        const limit = intParam(url.searchParams.get('limit'), 30);
        sendJson(res, 200, store.getFearGreed(limit));
        return;
      }

      // ── GET /api/cross-asset ──
      if (pathname === '/api/cross-asset') {
        const limit = intParam(url.searchParams.get('limit'), 50);
        sendJson(res, 200, store.getCrossAsset(limit));
        return;
      }

      // ── GET /api/stats ──
      if (pathname === '/api/stats') {
        sendJson(res, 200, store.stats());
        return;
      }

      // ── GET /api/predictions ──
      if (pathname === '/api/predictions') {
        const symbol = url.searchParams.get('symbol') ?? undefined;
        const modelId = url.searchParams.get('model_id') ?? undefined;
        const minConfidence = url.searchParams.get('minConfidence');
        const limit = intParam(url.searchParams.get('limit'), 200);
        sendJson(res, 200, store.getPredictions({
          symbol,
          model_id: modelId,
          minConfidence: minConfidence !== null ? parseFloat(minConfidence) : undefined,
          limit,
        }));
        return;
      }

      // ── GET /api/predictions/:symbol ──
      {
        const m = pathname.match(/^\/api\/predictions\/([^/]+)$/);
        if (m) {
          const limit = intParam(url.searchParams.get('limit'), 50);
          sendJson(res, 200, store.getPredictions({ symbol: m[1]!, limit }));
          return;
        }
      }

      // ── 404 fallback ──
      sendError(res, 404, 'NOT_FOUND', `Unknown route: ${method} ${pathname}`);
    } catch (err) {
      sendError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    }
  };
}
