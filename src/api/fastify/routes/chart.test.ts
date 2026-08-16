import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../app.js';
import { Store } from '../../../store/db.js';

const TEST_DB = resolve(tmpdir(), `crypto-radar-fastify-chart-test-${Date.now()}.db`);

describe('Matplotlib Chart Fastify Routes', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new Store({ path: TEST_DB });
    await store.migrate();

    // Seed mock kline data for SOL
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 30; i++) {
      rows.push({
        symbol: 'SOL',
        interval: '1h',
        open_time: now - (30 - i) * 3600000,
        open: 150 + i * 0.5,
        high: 152 + i * 0.5,
        low: 149 + i * 0.5,
        close: 151 + i * 0.5,
        volume: 10000 + i * 100,
        quote_volume: 1500000,
        taker_buy_vol: 5000,
        taker_buy_quote_vol: 750000,
      });
    }
    await store.upsertKlines(rows);

    app = await createApp({
      store,
      jwtSecret: 'test-secret-key-12345678901234567890',
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    store.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('GET /api/chart/:symbol returns binary PNG image', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chart/SOL',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.rawPayload.length).toBeGreaterThan(1000);
  });

  it('GET /api/chart/:symbol with ?format=base64 returns JSON image payload', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chart/SOL?format=base64',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.symbol).toBe('SOL');
    expect(body.image).toMatch(/^data:image\/png;base64,/);
  });

  it('GET /api/chart/frontier returns Markowitz efficient frontier visual', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chart/frontier',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('GET /api/chart/correlation returns cross-asset heatmap', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chart/correlation',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('GET /api/chart/portfolio returns paper trading equity curve', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chart/portfolio',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });
});
