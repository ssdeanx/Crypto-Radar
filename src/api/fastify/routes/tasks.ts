// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Cloud Task Handler Routes
// ═══════════════════════════════════════════════════════════════════════
//
// These endpoints are invoked by Google Cloud Tasks (in cloud mode) or
// by the local in-process queue (in local/dev mode).  They are NOT
// intended to be called directly by end users; they are secured via
// a pre-shared CRON_SECRET header (same mechanism used by cron.ts).
//
// Routes
//   POST /api/tasks/gemini-analyze     — LLM analysis on pending traces
//   POST /api/tasks/paper-trade        — Execute paper trades from signals
//   POST /api/tasks/model-retrain      — Trigger Python ML re-train
//   POST /api/tasks/evaluate-outcomes  — Backfill 24 h outcome columns
// ═══════════════════════════════════════════════════════════════════════

import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../../../core/logger.js';
import { analyzeToken } from '../../../core/llm-provider.js';
import { PaperTrader } from '../../../paper-trade.js';

const log = logger.child({ module: 'task-routes' });

// ── Shared secret guard (reused across all task endpoints) ──────────────
function verifyTaskSecret(secret: string | undefined, header: string | undefined): boolean {
  if (!secret || !header) return false;
  const raw = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    const a = Buffer.from(raw);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const taskRoutes: FastifyPluginAsync = async (app) => {

  // ── POST /api/tasks/gemini-analyze ────────────────────────────────────
  // Reads token_traces where needs_analysis = 1, calls analyzeToken() for
  // each, writes direction/confidence/reasoning back, clears the flag.
  app.post('/api/tasks/gemini-analyze', { config: { rateLimit: false } }, async (request, reply) => {
    const cronSecret = process.env['CRON_SECRET'];
    const authHeader = (request.headers['x-cron-secret'] ?? request.headers['authorization']) as string | undefined;

    if (!verifyTaskSecret(cronSecret, authHeader)) {
      return reply.status(403).send({ error: 'Forbidden: Invalid task secret.' });
    }

    const start = Date.now();
    let analyzed = 0;
    let failed = 0;

    try {
      const traces = await app.store.getTracesNeedingAnalysis(50);
      log.info(`[task:gemini-analyze] Found ${traces.length} traces needing analysis`);

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
          log.info(`[task:gemini-analyze] Analyzed ${trace.symbol} → ${result.direction} (${(result.confidence * 100).toFixed(1)}%)`);
        } catch (err) {
          failed++;
          log.warn(`[task:gemini-analyze] Failed to analyze ${trace.symbol}`, { error: String(err) });
        }
      }

      return reply.send({
        status: 'ok',
        analyzed,
        failed,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      log.error('[task:gemini-analyze] Task handler error', { error: String(err) });
      return reply.status(500).send({ error: String(err) });
    }
  });

  // ── POST /api/tasks/paper-trade ───────────────────────────────────────
  // Reads current signals from runRadar, generates recommendations, and
  // executes virtual trades against the default paper-trade profile.
  app.post('/api/tasks/paper-trade', { config: { rateLimit: false } }, async (request, reply) => {
    const cronSecret = process.env['CRON_SECRET'];
    const authHeader = (request.headers['x-cron-secret'] ?? request.headers['authorization']) as string | undefined;

    if (!verifyTaskSecret(cronSecret, authHeader)) {
      return reply.status(403).send({ error: 'Forbidden: Invalid task secret.' });
    }

    const start = Date.now();

    try {
      const dataDir = process.env['RADAR__DATA_DIR'] ?? 'data';
      const trader = new PaperTrader({
        startingBalance: 10_000,
        profileName: 'cloud-auto',
        allowedTokens: [],
        dataDir,
      });

      const restored = await trader.load();
      if (!restored) {
        await trader.save(); // initialise profile if first run
      }

      const recommendations = await trader.getSignalRecommendations();
      log.info(`[task:paper-trade] Got ${recommendations.length} recommendations from signals`);

      const trades = await trader.agentPlay(
        recommendations,
        /* maxPerTrade */ 1_000,
        /* minConfidence */ 0.35,
      );
      await trader.save();

      log.info(`[task:paper-trade] Executed ${trades.length} paper trades`);
      return reply.send({
        status: 'ok',
        recommendations: recommendations.length,
        tradesExecuted: trades.length,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      log.error('[task:paper-trade] Task handler error', { error: String(err) });
      return reply.status(500).send({ error: String(err) });
    }
  });

  // ── POST /api/tasks/model-retrain ─────────────────────────────────────
  // Spawns the Python ML training subprocess using the same logic as the
  // daemon's autoRetrain(), but driven on-demand via a Cloud Task.
  app.post('/api/tasks/model-retrain', { config: { rateLimit: false } }, async (request, reply) => {
    const cronSecret = process.env['CRON_SECRET'];
    const authHeader = (request.headers['x-cron-secret'] ?? request.headers['authorization']) as string | undefined;

    if (!verifyTaskSecret(cronSecret, authHeader)) {
      return reply.status(403).send({ error: 'Forbidden: Invalid task secret.' });
    }

    const start = Date.now();

    // Resolve the training script path
    const trainScript = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../../../../ml/train.py',
    );

    if (!fs.existsSync(trainScript)) {
      log.warn('[task:model-retrain] ML train script not found — skipping');
      return reply.status(404).send({ error: 'ML training script not found on filesystem.' });
    }

    try {
      const { spawn } = await import('node:child_process');
      const python = process.env['RADAR__ML_PYTHON'] ?? 'python3';
      const dataDir = process.env['RADAR__DATA_DIR'] ?? 'data';
      const outputDir = path.resolve(dataDir, 'ml/models');

      const trainArgs: string[] = [
        trainScript,
        '--output', outputDir,
        '--class-weight', 'custom',
        '--seed', '42',
        '--add-ta',
      ];

      log.info('[task:model-retrain] Spawning ML training process', { python, trainScript });

      const exitCode = await new Promise<number>((resolve, reject) => {
        const proc = spawn(python, trainArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        proc.on('error', reject);
        proc.on('close', (code: number | null) => {
          log.info('[task:model-retrain] Training completed', { exitCode: code, stdoutLines: stdout.split('\n').length });
          if (stderr.trim()) {
            log.warn('[task:model-retrain] Training stderr', { stderr: stderr.slice(-2000) });
          }
          resolve(code ?? 1);
        });
      });

      if (exitCode === 0) {
        log.info('[task:model-retrain] Training succeeded, syncing models to GCS...');
        await app.store.syncModelsToBucket();
      }

      return reply.send({
        status: exitCode === 0 ? 'ok' : 'error',
        exitCode,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      log.error('[task:model-retrain] Spawn failed', { error: String(err) });
      return reply.status(500).send({ error: String(err) });
    }
  });

  // ── POST /api/tasks/evaluate-outcomes ─────────────────────────────────
  // For each trace where outcome_evaluated = 0 and 24h has elapsed, fetch
  // the current price from the ticker table, compute PnL, classify the
  // prediction result, and write the outcome columns back.
  app.post('/api/tasks/evaluate-outcomes', { config: { rateLimit: false } }, async (request, reply) => {
    const cronSecret = process.env['CRON_SECRET'];
    const authHeader = (request.headers['x-cron-secret'] ?? request.headers['authorization']) as string | undefined;

    if (!verifyTaskSecret(cronSecret, authHeader)) {
      return reply.status(403).send({ error: 'Forbidden: Invalid task secret.' });
    }

    const start = Date.now();
    let evaluated = 0;
    let skipped = 0;

    try {
      const traces = await app.store.getTracesNeedingOutcome(100);
      log.info(`[task:evaluate-outcomes] Found ${traces.length} traces ready for outcome evaluation`);

      for (const trace of traces) {
        try {
          // Fetch the most recent ticker price for this symbol
          const tickers = await app.store.getLatestTickers({ symbol: trace.symbol, limit: 1 });
          const currentTicker = tickers[0];

          if (!currentTicker || !currentTicker.price || !trace.last_price) {
            skipped++;
            continue;
          }

          const entryPrice: number = parseFloat(String(trace.last_price));
          const exitPrice: number = parseFloat(String(currentTicker.price));

          if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(exitPrice)) {
            skipped++;
            continue;
          }

          const changePct = ((exitPrice - entryPrice) / entryPrice) * 100;

          // Classify outcome vs prediction
          const predDirection = (trace.prediction_direction ?? '').toUpperCase();
          let outcomeClassification = 'NEUTRAL';
          if (predDirection === 'BULLISH' && changePct > 1) {
            outcomeClassification = 'TP'; // true positive
          } else if (predDirection === 'BEARISH' && changePct < -1) {
            outcomeClassification = 'TP';
          } else if (predDirection === 'BULLISH' && changePct < -1) {
            outcomeClassification = 'FP'; // false positive
          } else if (predDirection === 'BEARISH' && changePct > 1) {
            outcomeClassification = 'FP';
          } else {
            outcomeClassification = 'NEUTRAL';
          }

          await app.store.updateTrace(trace.trace_id, {
            outcome_price: exitPrice,
            outcome_change_pct: parseFloat(changePct.toFixed(4)),
            outcome_pnl_pct: parseFloat(changePct.toFixed(4)),
            outcome_classification: outcomeClassification,
            outcome_evaluated: 1,
            outcome_evaluated_at: new Date().toISOString(),
          });

          evaluated++;
          log.info(`[task:evaluate-outcomes] ${trace.symbol} evaluated: ${changePct.toFixed(2)}% → ${outcomeClassification}`);
        } catch (err) {
          skipped++;
          log.warn(`[task:evaluate-outcomes] Failed to evaluate trace ${trace.trace_id}`, { error: String(err) });
        }
      }

      return reply.send({
        status: 'ok',
        evaluated,
        skipped,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      log.error('[task:evaluate-outcomes] Task handler error', { error: String(err) });
      return reply.status(500).send({ error: String(err) });
    }
  });
};
