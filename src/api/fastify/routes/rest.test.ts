// ═══════════════════════════════════════════════════════════════════════
// Fastify REST routes — regression tests
//
// Guards the production contract the dashboard depends on:
//   - GET /api/portfolio/trades returns a { trades: [...] } envelope (F24)
//   - GET /api/portfolio derives cash from trade history, never hardcodes it (F26)
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../../store/db.js';
import { createApp } from '../app.js';

const TEST_DB = resolve(tmpdir(), `crypto-radar-fastify-rest-test-${Date.now()}.db`);

describe('Fastify REST routes', () => {
  let store: Store;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new Store({ path: TEST_DB });
    store.migrate();
    app = await createApp({ store, jwtSecret: 'test-secret', corsOrigin: '*' });
    await app.ready();
  });

  afterEach(async () => {
    try { await app.close(); } catch { /* already closed */ }
    try { store.close(); } catch { /* already closed */ }
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  describe('GET /api/portfolio/trades', () => {
    it('returns a { trades: [...] } envelope, not a raw array (F24)', async () => {
      await store.upsertPaperTrade({
        id: 'T1', profile: 'trader1', symbol: 'SOL', side: 'buy',
        entry_price: 150, entry_time: '2026-07-07T12:00:00Z',
        quantity: 10, exit_price: null, exit_time: null, pnl: null, fees: null, status: 'open',
      });
      const res = await app.inject({ method: 'GET', url: '/api/portfolio/trades' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('trades');
      expect(Array.isArray(body.trades)).toBe(true);
      expect(body.trades).toHaveLength(1);
      expect(body.trades[0].symbol).toBe('SOL');
    });
  });

  describe('GET /api/portfolio', () => {
    it('derives cash from trade history — starting balance when no trades (F26)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/portfolio' });
      expect(res.statusCode).toBe(200);
      expect(res.json().cash).toBe(100_000);
    });

    it('computes holdings, realized PnL, and win rate from trades (F26)', async () => {
      const trades = [
        { id: 'T1', profile: 'trader1', symbol: 'SOL', side: 'buy', entry_price: 150, entry_time: '2026-07-07T12:00:00Z', quantity: 10, exit_price: null, exit_time: null, pnl: null, fees: null, status: 'open' },
        { id: 'T2', profile: 'trader1', symbol: 'SOL', side: 'buy', entry_price: 160, entry_time: '2026-07-07T13:00:00Z', quantity: 5, exit_price: null, exit_time: null, pnl: null, fees: null, status: 'open' },
        { id: 'T3', profile: 'trader1', symbol: 'BTC', side: 'buy', entry_price: 50000, entry_time: '2026-07-07T12:00:00Z', quantity: 1, exit_price: 52000, exit_time: '2026-07-07T14:00:00Z', pnl: 2000, fees: null, status: 'closed' },
        { id: 'T4', profile: 'trader1', symbol: 'BTC', side: 'buy', entry_price: 51000, entry_time: '2026-07-07T15:00:00Z', quantity: 0.5, exit_price: 49000, exit_time: '2026-07-07T16:00:00Z', pnl: -1000, fees: null, status: 'closed' },
      ];
      for (const t of trades) await store.upsertPaperTrade(t);

      const res = await app.inject({ method: 'GET', url: '/api/portfolio' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // 100000 - (150*10) - (160*5) + 2000 - 1000 = 98700
      expect(body.cash).toBe(98700);
      expect(body.holdings).toHaveLength(1);
      const sol = body.holdings.find((h: { symbol: string }) => h.symbol === 'SOL');
      expect(sol.quantity).toBe(15);
      expect(sol.avgEntry).toBeCloseTo(153.33, 1);
      expect(body.pnl).toBe(1000);
      expect(body.winRate).toBe(0.5);
      expect(body.totalTrades).toBe(2);
    });
  });
});
