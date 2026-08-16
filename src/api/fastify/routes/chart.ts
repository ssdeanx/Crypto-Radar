// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Matplotlib Chart Routes (Fastify)
// ═══════════════════════════════════════════════════════════════════════

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  renderCandlestickDashboard,
  renderEfficientFrontier,
  renderCorrelationHeatmap,
  renderPaperTradingEquity,
} from '../../../io/matplotlib.js';
import type { Kline } from '../../../types.js';

function toSchema<T extends z.ZodType>(schema: T): Record<string, unknown> {
  const json = z.toJSONSchema(schema);
  delete (json as Record<string, unknown>)['$schema'];
  return json;
}

const symbolParamsSchema = z.object({ symbol: z.string().min(1) });

const chartQuerySchema = z.object({
  interval: z.enum(['15m', '1h', '4h', '1d']).default('1h').optional(),
  limit: z.coerce.number().int().min(10).max(500).default(100).optional(),
  format: z.enum(['png', 'base64']).default('png').optional(),
}).passthrough();

const portfolioChartQuerySchema = z.object({
  profile: z.string().default('trader1').optional(),
  format: z.enum(['png', 'base64']).default('png').optional(),
}).passthrough();

const frontierQuerySchema = z.object({
  symbols: z.string().default('BTC,ETH,SOL,AVAX').optional(),
  format: z.enum(['png', 'base64']).default('png').optional(),
}).passthrough();

const correlationQuerySchema = z.object({
  symbols: z.string().default('BTC,ETH,SOL,BNB,AVAX').optional(),
  format: z.enum(['png', 'base64']).default('png').optional(),
}).passthrough();

export const chartRoutes: FastifyPluginAsync = async (app) => {
  const store = app.store;

  // ── GET /api/chart/candlestick/:symbol or /api/chart/:symbol ──
  app.get<{ Params: { symbol: string } }>(
    '/api/chart/:symbol',
    { schema: { params: toSchema(symbolParamsSchema), querystring: toSchema(chartQuerySchema) } },
    async (request, reply) => {
      const { interval, limit, format } = request.query as {
        interval?: '15m' | '1h' | '4h' | '1d';
        limit?: number;
        format?: 'png' | 'base64';
      };

      const sym = request.params.symbol.toUpperCase();
      const rows = await store.getKlines(sym, interval ?? '1h', { limit: limit ?? 100 });

      if (rows.length < 5) {
        return reply.status(404).send({
          error: `Insufficient kline data for ${sym} to generate chart visual.`,
          code: 'NOT_ENOUGH_DATA',
        });
      }

      const klines: Kline[] = rows.map((r) => ({
        openTime: r.open_time,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        closeTime: r.open_time + 3600000,
        quoteVolume: r.quote_volume,
        count: 0,
        takerBuyVol: r.taker_buy_vol,
        takerBuyQuoteVol: r.taker_buy_quote_vol,
        ignore: 0,
      }));

      try {
        const pngBuffer = await renderCandlestickDashboard(sym, klines, 'png');

        if (format === 'base64') {
          return {
            symbol: sym,
            format: 'png',
            image: `data:image/png;base64,${pngBuffer.toString('base64')}`,
          };
        }

        reply.type('image/png');
        return reply.send(pngBuffer);
      } catch (err) {
        return reply.status(500).send({
          error: `Failed to render chart: ${String(err)}`,
          code: 'CHART_RENDER_ERROR',
        });
      }
    },
  );

  // ── GET /api/chart/frontier ──
  app.get(
    '/api/chart/frontier',
    { schema: { querystring: toSchema(frontierQuerySchema) } },
    async (request, reply) => {
      const { symbols, format } = request.query as {
        symbols?: string;
        format?: 'png' | 'base64';
      };

      const symList = (symbols ?? 'BTC,ETH,SOL,AVAX').split(',').map((s) => s.trim().toUpperCase());
      const n = symList.length;

      // Mock / estimated return distribution for visualization
      const returns = symList.map((_, i) => 0.12 + i * 0.03);
      const cov = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0.05 + i * 0.01 : 0.02)),
      );
      const weights = Array.from({ length: n }, () => 1 / n);

      try {
        const pngBuffer = await renderEfficientFrontier(returns, cov, weights, symList, 'png');

        if (format === 'base64') {
          return {
            symbols: symList,
            format: 'png',
            image: `data:image/png;base64,${pngBuffer.toString('base64')}`,
          };
        }

        reply.type('image/png');
        return reply.send(pngBuffer);
      } catch (err) {
        return reply.status(500).send({
          error: `Failed to render efficient frontier visual: ${String(err)}`,
          code: 'CHART_RENDER_ERROR',
        });
      }
    },
  );

  // ── GET /api/chart/correlation ──
  app.get(
    '/api/chart/correlation',
    { schema: { querystring: toSchema(correlationQuerySchema) } },
    async (request, reply) => {
      const { symbols, format } = request.query as {
        symbols?: string;
        format?: 'png' | 'base64';
      };

      const symList = (symbols ?? 'BTC,ETH,SOL,BNB,AVAX').split(',').map((s) => s.trim().toUpperCase());
      const n = symList.length;
      const matrix = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 1.0 : Number((0.5 + ((i + j) % 4) * 0.1).toFixed(2)))),
      );

      try {
        const pngBuffer = await renderCorrelationHeatmap(matrix, symList, 'png');

        if (format === 'base64') {
          return {
            symbols: symList,
            format: 'png',
            image: `data:image/png;base64,${pngBuffer.toString('base64')}`,
          };
        }

        reply.type('image/png');
        return reply.send(pngBuffer);
      } catch (err) {
        return reply.status(500).send({
          error: `Failed to render correlation heatmap visual: ${String(err)}`,
          code: 'CHART_RENDER_ERROR',
        });
      }
    },
  );

  // ── GET /api/chart/portfolio ──
  app.get(
    '/api/chart/portfolio',
    { schema: { querystring: toSchema(portfolioChartQuerySchema) } },
    async (request, reply) => {
      const { profile, format } = request.query as {
        profile?: string;
        format?: 'png' | 'base64';
      };

      const trades = await store.getPaperTrades(profile ?? 'trader1');
      const formattedTrades = trades.map((t) => ({
        created_at: typeof t.entry_time === 'string' ? new Date(t.entry_time).getTime() : Date.now(),
        pnl: t.pnl ?? 0,
      }));

      try {
        const pngBuffer = await renderPaperTradingEquity(formattedTrades, 100_000, 'png');

        if (format === 'base64') {
          return {
            profile: profile ?? 'trader1',
            format: 'png',
            image: `data:image/png;base64,${pngBuffer.toString('base64')}`,
          };
        }

        reply.type('image/png');
        return reply.send(pngBuffer);
      } catch (err) {
        return reply.status(500).send({
          error: `Failed to render portfolio chart: ${String(err)}`,
          code: 'CHART_RENDER_ERROR',
        });
      }
    },
  );
};
