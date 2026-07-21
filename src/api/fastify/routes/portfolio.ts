// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Portfolio Trade Routes
// ═══════════════════════════════════════════════════════════════════════
//
// POST /api/portfolio/trades  — Execute a paper trade
// ═══════════════════════════════════════════════════════════════════════

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { fetchTicker } from '../../../binance.js';
import { getTokenBySymbol } from '../../../tokens.js';
import { fetchSimplePrices } from '../../../coingecko.js';
import { getTokenList } from '../../../tokens.js';
import { randomUUID } from 'node:crypto';
import type { PaperTradeRow } from '../../../types.js';
import { logger } from '../../../core/logger.js';

const log = logger.child({ module: 'portfolio-routes' });

// ── Validation schemas ──

const tradeSchema = z.object({
  symbol: z.string().min(1).max(20).transform(s => s.toUpperCase()),
  side: z.enum(['buy', 'sell']),
  amount: z.number().positive('Amount must be positive'),
  reason: z.string().max(500).optional(),
  profile: z.string().max(64).default('trader1'),
});

// ── Price fetching helper ──

async function getCurrentPrice(symbol: string): Promise<number | null> {
  const upperSym = symbol.toUpperCase();

  // Try Binance first
  try {
    const token = getTokenBySymbol(upperSym);
    if (token) {
      const pair = `${upperSym}USDT`;
      const ticker = await fetchTicker(pair);
      const price = parseFloat(ticker.lastPrice);
      if (price > 0) return price;
    }
  } catch {
    // Fall through
  }

  // Fallback to CoinGecko
  try {
    const allTokens = getTokenList();
    const token = allTokens.find(t => t.sym === upperSym);
    if (token?.coingeckoId) {
      const prices = await fetchSimplePrices([token.coingeckoId]);
      const priceData = prices.get(token.coingeckoId);
      if (priceData && priceData.usd > 0) return priceData.usd;
    }
  } catch {
    // Give up
  }

  return null;
}

// ── Route plugin ──

export const portfolioRoutes: FastifyPluginAsync = async (app) => {
  // ── POST /api/portfolio/trades ──
  app.post('/trades', async (request, reply) => {
    const parsed = tradeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        detail: parsed.error.issues.map(i => i.message).join('; '),
      });
    }

    const { symbol, side, amount, reason, profile } = parsed.data;

    // Validate token exists
    const token = getTokenBySymbol(symbol);
    if (!token) {
      return reply.status(400).send({
        error: `Unknown token: ${symbol}`,
        code: 'UNKNOWN_TOKEN',
      });
    }

    // Get current price
    const price = await getCurrentPrice(symbol);
    if (price === null || price <= 0) {
      return reply.status(503).send({
        error: 'Unable to fetch current price',
        code: 'PRICE_UNAVAILABLE',
      });
    }

    const totalCost = amount * price;
    const now = new Date().toISOString();
    const tradeId = `PT-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    // For sell trades, check if there's an open position to close
    if (side === 'sell') {
      const openTrades = await app.store.getPaperTrades(profile, 'open');
      const heldQty = openTrades
        .filter(t => t.symbol === symbol && t.side === 'buy')
        .reduce((sum, t) => sum + (t.quantity ?? 0), 0);
      const soldQty = openTrades
        .filter(t => t.symbol === symbol && t.side === 'sell')
        .reduce((sum, t) => sum + (t.quantity ?? 0), 0);
      const available = heldQty - soldQty;

      if (available <= 0) {
        return reply.status(400).send({
          error: `No open position to sell for ${symbol}`,
          code: 'NO_POSITION',
        });
      }
      if (amount > available) {
        return reply.status(400).send({
          error: `Cannot sell ${amount} ${symbol}, only ${available.toFixed(4)} available`,
          code: 'INSUFFICIENT_POSITION',
        });
      }
    }

    // Create the trade record
    const trade: PaperTradeRow = {
      id: tradeId,
      profile,
      symbol,
      side,
      entry_price: price,
      entry_time: now,
      quantity: amount,
      exit_price: null,
      exit_time: null,
      pnl: null,
      fees: 0,
      status: 'open',
    };

    // If sell, try to match against open buys and compute PnL
    if (side === 'sell') {
      const openBuys = (await app.store.getPaperTrades(profile, 'open'))
        .filter(t => t.symbol === symbol && t.side === 'buy')
        .sort((a, b) => (a.entry_time ?? '').localeCompare(b.entry_time ?? '')); // FIFO

      let remaining = amount;
      let totalPnl = 0;

      for (const buy of openBuys) {
        if (remaining <= 0) break;
        const buyQty = buy.quantity ?? 0;
        const used = Math.min(buyQty, remaining);
        const buyPrice = buy.entry_price ?? 0;
        const pnl = (price - buyPrice) * used;
        totalPnl += pnl;
        remaining -= used;

        // Close the buy trade (or reduce quantity)
        if (used >= buyQty) {
          await app.store.upsertPaperTrade({
            ...buy,
            exit_price: price,
            exit_time: now,
            pnl: (buy.pnl ?? 0) + pnl,
            status: 'closed',
          });
        } else {
          // Partial close: update existing trade quantity and create a closed trade
          await app.store.upsertPaperTrade({
            ...buy,
            quantity: buyQty - used,
          });
          await app.store.upsertPaperTrade({
            ...trade,
            id: tradeId + '-PARTIAL',
            quantity: used,
            exit_price: price,
            exit_time: now,
            pnl,
            status: 'closed',
          });
        }
      }

      // Update the main sell trade record
      trade.pnl = totalPnl;
      trade.exit_price = price;
      trade.exit_time = now;
      trade.status = 'closed';
    }

    await app.store.upsertPaperTrade(trade);

    log.info('Paper trade executed', {
      profile,
      symbol,
      side,
      amount,
      price,
      total: totalCost,
      status: trade.status,
      ...(reason ? { reason } : {}),
    });

    return reply.status(201).send({
      trade: {
        id: trade.id,
        profile: trade.profile,
        symbol: trade.symbol,
        side: trade.side,
        entry_price: trade.entry_price,
        entry_time: trade.entry_time,
        quantity: trade.quantity,
        exit_price: trade.exit_price,
        exit_time: trade.exit_time,
        pnl: trade.pnl,
        status: trade.status,
        reason: reason ?? null,
      },
      price,
      total: totalCost,
    });
  });

  // ── GET /api/portfolio/history (returns all trades with summary) ──
  app.get('/history', async (request, reply) => {
    const { profile } = request.query as { profile?: string };
    const trades = await app.store.getPaperTrades(profile ?? 'trader1');

    let totalPnl = 0;
    let wins = 0;
    let losses = 0;
    for (const t of trades) {
      if (t.status === 'closed' && t.pnl != null) {
        totalPnl += t.pnl;
        if (t.pnl > 0) wins++;
        else if (t.pnl < 0) losses++;
      }
    }

    return reply.send({
      trades,
      summary: {
        totalTrades: trades.length,
        closedTrades: wins + losses,
        wins,
        losses,
        winRate: (wins + losses) > 0 ? wins / (wins + losses) : 0,
        totalPnl,
      },
    });
  });

  // ── POST /api/portfolio/chat ──
  app.post('/chat', async (request, reply) => {
    const chatSchema = z.object({
      message: z.string().min(1),
      profile: z.string().max(64).default('trader1'),
    });

    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        detail: parsed.error.issues.map(i => i.message).join('; '),
      });
    }

    const { message, profile } = parsed.data;

    try {
      const trades = await app.store.getPaperTrades(profile);
      let totalPnl = 0;
      let wins = 0;
      let losses = 0;
      const openPositions: Record<string, number> = {};

      for (const t of trades) {
        if (t.status === 'closed' && t.pnl != null) {
          totalPnl += t.pnl;
          if (t.pnl > 0) wins++;
          else if (t.pnl < 0) losses++;
        } else if (t.status === 'open') {
          const qty = t.quantity ?? 0;
          if (t.side === 'buy') {
            openPositions[t.symbol] = (openPositions[t.symbol] || 0) + qty;
          } else {
            openPositions[t.symbol] = (openPositions[t.symbol] || 0) - qty;
          }
        }
      }

      for (const sym of Object.keys(openPositions)) {
        const qty = openPositions[sym];
        if (qty === undefined || qty <= 0) delete openPositions[sym];
      }

      const activeTokens = getTokenList().map(t => `${t.sym} (${t.name})`).join(', ');

      const systemPrompt = `You are a professional AI Quant Trading Advisor for the Hermes Crypto Radar.
The user is playing a paper trading game. You have access to their active portfolio state:
- Profile: "${profile}"
- Total Realised P&L: $${totalPnl.toFixed(2)}
- Performance: ${wins} wins, ${losses} losses (Win Rate: ${((wins / (wins + losses || 1)) * 100).toFixed(1)}%)
- Current Open Positions: ${JSON.stringify(openPositions)}
- Supported tokens for trade: [${activeTokens}]

Your role is to:
1. Help the user analyze their trading history and active positions.
2. Offer technical analysis insights when asked.
3. Help them execute trades dynamically.

To execute a buy or sell trade, output a special command block at the end of your response:
[TRADE: { "action": "buy"|"sell", "symbol": "TICKER", "amount": number, "reason": "brief reason" }]
For example: "[TRADE: { "action": "buy", "symbol": "BTC", "amount": 0.05, "reason": "RSI oversold" }]"

Keep your response friendly, professional, and quantitative.`;

      const baseURL = process.env.RADAR__AI_BASE_URL;
      const aiEnv = process.env.RADAR__AI_ENV || (baseURL ? 'DEV' : 'PROD');
      let responseText = '';

      if (aiEnv === 'DEV') {
        const { generateChat } = await import('../../../analysis/openai-compatible.js');
        responseText = await generateChat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ]);
      } else {
        const { generateGeminiReasoning } = await import('../../../analysis/gemini.js');
        const prompt = `${systemPrompt}\n\nUser Message: ${message}\n\nResponse:`;
        responseText = await generateGeminiReasoning(prompt);
      }

      let executedTrade: Record<string, unknown> | null = null;
      const tradeMatch = responseText.match(/\[TRADE:\s*(\{.*?\})\s*\]/s);
      if (tradeMatch && tradeMatch[1]) {
        try {
          const tradeCmd = JSON.parse(tradeMatch[1]);
          const symbol = String(tradeCmd.symbol).toUpperCase();
          const side = String(tradeCmd.action).toLowerCase() as 'buy' | 'sell';
          const amount = parseFloat(tradeCmd.amount);
          const reason = tradeCmd.reason || 'AI Advisor automated trade';

          if (['buy', 'sell'].includes(side) && amount > 0 && getTokenBySymbol(symbol)) {
            const price = await getCurrentPrice(symbol);
            if (price && price > 0) {
              const now = new Date().toISOString();
              const tradeId = `PT-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;

              const tradeRow: PaperTradeRow = {
                id: tradeId,
                profile,
                symbol,
                side,
                entry_price: price,
                entry_time: now,
                quantity: amount,
                exit_price: null,
                exit_time: null,
                pnl: null,
                fees: 0,
                status: 'open',
              };

              if (side === 'sell') {
                const openBuys = (await app.store.getPaperTrades(profile, 'open'))
                  .filter(t => t.symbol === symbol && t.side === 'buy')
                  .sort((a, b) => (a.entry_time ?? '').localeCompare(b.entry_time ?? ''));

                let remaining = amount;
                let totalPnl = 0;

                for (const buy of openBuys) {
                  if (remaining <= 0) break;
                  const buyQty = buy.quantity ?? 0;
                  const used = Math.min(buyQty, remaining);
                  const buyPrice = buy.entry_price ?? 0;
                  const pnl = (price - buyPrice) * used;
                  totalPnl += pnl;
                  remaining -= used;

                  if (used >= buyQty) {
                    await app.store.upsertPaperTrade({ ...buy, exit_price: price, exit_time: now, pnl: (buy.pnl ?? 0) + pnl, status: 'closed' });
                  } else {
                    await app.store.upsertPaperTrade({ ...buy, quantity: buyQty - used });
                    await app.store.upsertPaperTrade({ ...tradeRow, id: tradeId + '-PARTIAL', quantity: used, exit_price: price, exit_time: now, pnl, status: 'closed' });
                  }
                }
                tradeRow.pnl = totalPnl;
                tradeRow.exit_price = price;
                tradeRow.exit_time = now;
                tradeRow.status = 'closed';
              }

              await app.store.upsertPaperTrade(tradeRow);
              log.info('AI Advisor paper trade executed', { profile, symbol, side, amount, price, reason });
              executedTrade = { id: tradeId, symbol, side, amount, price, total: amount * price };
              responseText = responseText.replace(/\[TRADE:\s*(\{.*?\})\s*\]/s, `\n\n*(Executed Trade: ${side.toUpperCase()} ${amount} ${symbol} at $${price})*`);
            }
          }
        } catch (e) {
          log.warn('AI Advisor trade parse/execute failed', { error: String(e) });
        }
      }

      return reply.send({
        response: responseText,
        executedTrade,
      });
    } catch (err) {
      log.error('AI portfolio advisor failed', { error: String(err) });
      return reply.status(500).send({ error: String(err) });
    }
  });
};
