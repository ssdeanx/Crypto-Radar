// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — User-Triggered Action Routes (JWT-gated)
// ═══════════════════════════════════════════════════════════════════════
//
// Proxies system-level pipeline operations to user-facing JWT-authenticated
// endpoints. All pipeline ops require `role: admin` on the JWT. Trade
// execution requires any valid JWT.
//
// Routes:
//   POST /api/actions/scan       — trigger pipeline scan + collector
//   POST /api/actions/analyze    — trigger gemini-analyze on pending traces
//   POST /api/actions/retrain    — trigger ML model retrain
//   POST /api/actions/trade      — auto-trade from current signals
// ═══════════════════════════════════════════════════════════════════════

import type { FastifyPluginAsync } from 'fastify';
import { runRadar } from '../../../radar.js';
import { runCollector } from '../../../collector.js';
import { logger } from '../../../core/logger.js';
import { getTokenList, getTopTokensByVolume } from '../../../tokens.js';
import type { TokenDef } from '../../../types.js';

const log = logger.child({ module: 'action-routes' });

export const actionRoutes: FastifyPluginAsync = async (app) => {

  // ── Auth guard helper ──
  async function requireAdmin(request: any, reply: any) {
    try {
      await request.jwtVerify();
      const user = request.user as { role?: string };
      if (user.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin role required', code: 'FORBIDDEN' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
  }

  async function requireAuth(request: any, reply: any) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
  }

  // ── POST /api/actions/scan — trigger pipeline scan + collector ──
  app.post('/scan', { preHandler: [requireAdmin] }, async () => {
    log.info('[action:scan] User-triggered scan starting...');
    const start = Date.now();

    // Resolve top tokens by volume (same logic as cron.ts)
    let symbols: string[] = [];
    try {
      const topTokens = await getTopTokensByVolume(30);
      symbols = topTokens.map((t: TokenDef) => t.sym);
    } catch {
      symbols = getTokenList().map(t => t.sym).slice(0, 20);
    }

    // Run radar scan
    const scanResult = await runRadar({
      filter: symbols,
      sortBy: 'momentum',
      format: 'json',
      quiet: true,
      includeTech: true,
      includeNews: false,
      includeOnchain: true,
      store: app.store,
    });

    // Run collector
    const collectorResult = await runCollector({
      klines: true,
      futures: true,
      orderbook: true,
      fearGreed: true,
      crossAsset: true,
      symbols: symbols.map(s => s.endsWith('USDT') ? s : s + 'USDT'),
    });

    const durationMs = Date.now() - start;
    log.info(`[action:scan] Complete in ${durationMs}ms`);

    return {
      status: 'success',
      durationMs,
      scan: {
        runId: scanResult.run.runId,
        tokens: scanResult.run.numTokens,
        signals: scanResult.aggregatedSignals.length,
      },
      collector: {
        klinesInserted: collectorResult.klinesInserted,
        fundingInserted: collectorResult.fundingInserted,
      },
    };
  });

  // ── POST /api/actions/analyze — trigger gemini analysis on pending traces ──
  app.post('/analyze', { preHandler: [requireAdmin] }, async (request, reply) => {
    log.info('[action:analyze] Request from', { ip: request.ip, url: request.url });
    const start = Date.now();
    let analyzed = 0;
    let failed = 0;

    try {
      const traces = await app.store.getTracesNeedingAnalysis(50);
      const { analyzeToken } = await import('../../../core/llm-provider.js');

      for (const trace of traces) {
        try {
          const result = await analyzeToken(trace.symbol, {
            last_price: trace.last_price,
            price_change_pct: trace.price_change_pct,
            volume: trace.volume,
            regime: trace.regime,
            composite_score: trace.composite_score,
            direction: trace.direction,
            rsi: trace.rsi,
            macd_histogram: trace.macd_histogram,
            bb_width: trace.bb_width,
            atr_pct: trace.atr_pct,
            adx: trace.adx,
          });

          await app.store.updateTrace(trace.trace_id, {
            analysis_text: result.reasoning,
            prediction_direction: result.direction,
            prediction_confidence: result.confidence,
            gemini_raw: result.raw,
            needs_analysis: 0,
            analyzed_at: new Date().toISOString(),
          });

          analyzed++;
        } catch (err) {
          failed++;
          log.warn(`[action:analyze] Failed ${trace.symbol}`, { error: String(err) });
        }
      }
    } catch (err) {
      log.error('[action:analyze] Handler error', { error: String(err) });
      return reply.status(500).send({ error: String(err) });
    }

    log.info(`[action:analyze] Complete: ${analyzed} analyzed, ${failed} failed in ${Date.now() - start}ms`);
    return { status: 'success', analyzed, failed, durationMs: Date.now() - start };
  });

  // ── POST /api/actions/retrain — trigger ML model retrain ──
  app.post('/retrain', { preHandler: [requireAdmin] }, async (request, reply) => {
    log.info('[action:retrain] Request from', { ip: request.ip, url: request.url });
    const start = Date.now();

    const trainScript = new URL('../../../../ml/train.py', import.meta.url).pathname;
    const fs = await import('node:fs');
    const path = await import('node:path');

    if (!fs.existsSync(trainScript)) {
      return reply.status(404).send({ error: 'ML training script not found on filesystem.' });
    }

    try {
      const { spawn } = await import('node:child_process');
      const python = process.env['RADAR__ML_PYTHON'] ?? 'python3';
      const dataDir = process.env['RADAR__DATA_DIR'] ?? 'data';
      const outputDir = path.resolve(dataDir, 'ml/models');

      const trainArgs = [
        trainScript,
        '--output', outputDir,
        '--class-weight', 'custom',
        '--seed', '42',
        '--add-ta',
      ];

      const exitCode = await new Promise<number>((resolve, reject) => {
        const proc = spawn(python, trainArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.on('error', reject);
        proc.on('close', (code: number | null) => resolve(code ?? 1));
      });

      if (exitCode === 0) {
        await app.store.syncModelsToBucket();
      }

      log.info(`[action:retrain] Complete with exit code ${exitCode} in ${Date.now() - start}ms`);
      return { status: exitCode === 0 ? 'success' : 'error', exitCode, durationMs: Date.now() - start };
    } catch (err) {
      log.error('[action:retrain] Error', { error: String(err) });
      return reply.status(500).send({ error: String(err) });
    }
  });

  // ── POST /api/actions/trade — auto-trade from current signals ──
  app.post('/trade', { preHandler: [requireAuth] }, async (request, reply) => {
    log.info('[action:trade] Request from', { ip: request.ip, url: request.url });

    const { PaperTrader } = await import('../../../paper-trade.js');
    const dataDir = process.env['RADAR__DATA_DIR'] ?? 'data';

    const trader = new PaperTrader({
      startingBalance: 10_000,
      profileName: 'frontend-auto',
      allowedTokens: [],
      dataDir,
    });

    const restored = await trader.load();
    if (!restored) {
      await trader.save();
    }

    const recommendations = await trader.getSignalRecommendations();
    const trades = await trader.agentPlay(
      recommendations,
      /* maxPerTrade */ 1_000,
      /* minConfidence */ 0.35,
    );
    await trader.save();

    log.info(`[action:trade] Executed ${trades.length} paper trades`);
    return reply.send({
      status: 'success',
      recommendations: recommendations.length,
      tradesExecuted: trades.length,
    });
  });
};
