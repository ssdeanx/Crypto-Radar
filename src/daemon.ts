// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Warm Daemon
// ═══════════════════════════════════════════════════════════════════════
//
// Keeps a warm Node.js process running to serve sub-50ms tool calls.
// Pre-fetches and caches ticker data, klines, and exchange info on a
// configurable refresh cycle. Exposes a lightweight HTTP health/status
// endpoint so the Hermes agent can check liveness.
//
// Usage:
//   crypto-radar daemon          # start foreground (default)
//   crypto-radar daemon --port 9876
//   crypto-radar daemon --status  # check if running
//   crypto-radar daemon --stop   # stop running daemon
//
// Environment:
//   RADAR__DAEMON_PORT    — HTTP server port (default: 9877)
//   RADAR__REFRESH_SEC    — cache refresh interval (default: 300 = 5 min)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { fetchAllTickers, fetchKlines } from './binance.js';
import { getTokenList, getBinancePair, getActiveTokenCount, reloadTokenConfig } from './tokens.js';
import { Cache, getGlobalCache } from './core/cache.js';
import { logWarn } from './core/errors.js';
import { Store } from './store/db.js';
import { createWsHub } from './api/ws.js';
import { batchPredict, persistPredictions, resolveActiveModel } from './ml/predict.js';
import { assembleDataset } from './ml/dataset.js';
import { buildFeatures, enrichFeatures } from './ml/features.js';
import { computeLabels } from './ml/labels.js';
import { createApp } from './api/fastify/app.js';
import * as crypto from 'node:crypto';

// ── __dirname shim for ES modules ──

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──

function getPidFile(): string {
  return path.resolve(loadConfig().dataDir, 'daemon.pid');
}
const DEFAULT_PORT = 9877;
const DEFAULT_REFRESH_SEC = 300; // 5 min

const port = parseInt(process.env.PORT ?? process.env.RADAR__DAEMON_PORT ?? String(DEFAULT_PORT), 10);
const refreshMs = parseInt(process.env.RADAR__REFRESH_SEC ?? String(DEFAULT_REFRESH_SEC), 10) * 1000;

const log = logger.child({ module: 'daemon' });

// ── State ──

let _ready = false;
let _startTime = 0;
let _lastRefresh = 0;
let _refreshCount = 0;
let _scanCount = 0;
let _errorCount = 0;
let _store: Store | null = null;
let _wsHub: ReturnType<typeof createWsHub> | null = null;

// ── ML state (F8) ──
let _lastMlTrain = 0;
let _lastMlPredict = 0;
let _mlModelId = '';
let _mlNormalizationStats: import('./ml/types.js').NormalizationStats | null = null;

// ── Warm-up functions ──

async function prewarmTickers(): Promise<void> {
  const start = Date.now();
  try {
    const tickers = await fetchAllTickers();
    getGlobalCache().set('radar:tickers', tickers, 600_000);
    log.info(`Ticker cache warmed: ${tickers.size} pairs in ${Date.now() - start}ms`);
  } catch (err) {
    _errorCount++;
    log.warn(`Ticker prewarm failed`, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function prewarmKlines(): Promise<void> {
  const tokens = getTokenList();
  const tokenCount = tokens.length;
  let okCount = 0;
  const start = Date.now();

  // Pre-warm 1h klines for each token (the most commonly requested interval)
  for (const token of tokens) {
    const pair = getBinancePair(token);
    const cacheKey = `radar:${pair}:1h`;
    if (!getGlobalCache().has(cacheKey)) {
      try {
        const klines = await fetchKlines(pair, '1h', 200);
        getGlobalCache().set(cacheKey, klines, 600_000);
        okCount++;
      } catch {
        // non-fatal per token
      }
    }
  }

  log.info(`Kline cache warmed: ${okCount}/${tokenCount} tokens in ${Date.now() - start}ms`);
}

async function refreshAll(): Promise<void> {
  log.info('Cache refresh cycle starting...');
  await prewarmTickers();
  await prewarmKlines();
  _lastRefresh = Date.now();
  _refreshCount++;
  _ready = true;

  // F8: ML pipeline — train → predict → detect drift
  if (_store) {
    const config = loadConfig();
    if (config.ml?.enabled) {
      await autoRetrain(config);
      await runMlPrediction(config);
      await runDriftDetection(config);
    }
  }

  log.info(`Cache refresh complete (#${_refreshCount})`);
}

// ── ML Auto-Retrain (F8) ──

const INTERVALS = ['15m', '1h', '4h', '1d'] as const;

async function autoRetrain(config: ReturnType<typeof loadConfig>): Promise<void> {
  const retrainHours = config.ml?.training?.retrainIntervalHours ?? 24;
  const lookbackDays = config.ml?.training?.lookbackDays ?? 90;
  const now = Date.now();

  if (_lastMlTrain > 0 && (now - _lastMlTrain) < retrainHours * 3_600_000) {
    return; // Not due yet
  }

  if (!_store) return;

  // Verify Python environment exists before attempting
  if (!fs.existsSync(path.resolve(__dirname, '../../ml/train.py'))) {
    log.warn('ML train script not found — skipping auto-retrain');
    return;
  }

  log.info('ML auto-retrain starting...');
  const start = Date.now();

  try {
    const symbols = config.ml?.training?.symbols ?? getTokenList().map(t => t.sym).slice(0, 20);

    // Collect feature rows + labels from the store
    const allFeatures: import('./ml/types.js').FeatureRow[] = [];
    const allLabels: import('./ml/types.js').LabelRow[] = [];
    const allKlinesBySymbol = new Map<string, number[]>();

    const btcKlines = (await _store.getKlines('BTCUSDT', '1h', { limit: 200, order: 'desc' })).reverse();
    const ethKlines = (await _store.getKlines('ETHUSDT', '1h', { limit: 200, order: 'desc' })).reverse();
    const solKlines = (await _store.getKlines('SOLUSDT', '1h', { limit: 200, order: 'desc' })).reverse();
    const polKlines = (await _store.getKlines('POLUSDT', '1h', { limit: 200, order: 'desc' })).reverse();
    const referenceKlines = new Map<string, number[]>();
    if (btcKlines.length >= 20) referenceKlines.set('BTCUSDT', btcKlines.map(k => k.close));
    if (ethKlines.length >= 20) referenceKlines.set('ETHUSDT', ethKlines.map(k => k.close));
    if (solKlines.length >= 20) referenceKlines.set('SOLUSDT', solKlines.map(k => k.close));
    if (polKlines.length >= 20) referenceKlines.set('POLUSDT', polKlines.map(k => k.close));

    for (const symbol of symbols) {
      for (const interval of INTERVALS) {
        const klines = (await _store.getKlines(symbol, interval, {
          limit: Math.max(60, lookbackDays * 24),
          order: 'desc',
        })).reverse();
        if (klines.length < 60) continue;
        allKlinesBySymbol.set(`${symbol}:${interval}`, klines.map(k => k.close));

        const crossAsset = await _store.getCrossAsset(200);
        const funding = await _store.getFunding(symbol, 100);

        const features = await buildFeatures(
          symbol, interval, klines,
          {
            includeReturns: true, includeIndicators: true,
            includeCrossAsset: true, includeFutures: true,
            includeTemporal: true,
          },
          crossAsset, funding, referenceKlines,
        );

        const closes = klines.map(k => k.close);
        const horizon = config.ml?.training?.labelHorizon ?? 5;
        const labels = computeLabels(closes, interval, {
          classHorizon: horizon,
          useVolatilityThreshold: true,
        }, klines);

        // Align labels with feature rows by open_time using a Map (avoids O(n²) findIndex)
        const labelByTime = new Map<number, import('./ml/types.js').LabelRow>();
        for (const lbl of labels) {
          if (lbl.label_class !== null) {
            labelByTime.set(lbl.open_time, lbl);
          }
        }

        for (const f of features) {
          const matched = labelByTime.get(f.open_time);
          if (matched) {
            allFeatures.push(f);
            allLabels.push(matched);
          }
        }
      }
    }

    enrichFeatures(allFeatures, allKlinesBySymbol);

    if (allFeatures.length < 100) {
      log.warn(`Auto-retrain skipped: only ${allFeatures.length} rows (need ≥100)`);
      return;
    }

    // Assemble dataset and train
    const dataset = assembleDataset(allFeatures, allLabels, {
      labelHorizon: config.ml?.training?.labelHorizon ?? 5,
      testSplit: 0.15,
      valSplit: 0.15,
      normalize: true,
      outputPathPrefix: `data/ml/auto_${crypto.createHash('md5').update(String(now)).digest('hex').slice(0, 8)}`,
    });

    // Spawn Python training subprocess
    const { spawn } = await import('node:child_process');
    const python = process.env.RADAR__ML_PYTHON ?? 'python3';

    // Build training args from config
    const trainArgs: string[] = [
      path.resolve(__dirname, '../../ml/train.py'),
      '--data', dataset.trainPath,
      '--output', path.resolve(config.dataDir, 'ml/models'),
      '--class-weight', 'custom',
      '--seed', '42',
    ];
    if (config.ml?.training?.optimize) {
      trainArgs.push('--optimize', '--optuna-trials', String(config.ml.training.optunaTrials ?? 30));
    }
    if (config.ml?.training?.cvFolds && config.ml.training.cvFolds > 0) {
      trainArgs.push('--cv-folds', String(config.ml.training.cvFolds));
    }
    if (config.ml?.training?.balance) {
      trainArgs.push('--balance');
    }
    if (config.ml?.training?.shap) {
      trainArgs.push('--shap');
    }
    // Always add TA features (they improve accuracy significantly)
    trainArgs.push('--add-ta');

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(python, trainArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          // Log training stderr (may contain CatBoost progress, warnings)
          if (stderr) {
            const lines = stderr.trim().split('\n').filter(l => l);
            for (const line of lines) {
              log.debug(`[train] ${line}`);
            }
          }
          // Parse metrics from stdout JSON
          try {
            const metrics = JSON.parse(stdout);
            _mlModelId = metrics.model_path ?? 'unknown';
            _lastMlTrain = Date.now();
            _mlNormalizationStats = dataset.normalizationStats;
            log.info(`ML auto-retrain complete: ${dataset.rowCount} rows, ${dataset.featureCount} features, accuracy=${metrics.accuracy?.toFixed(3)}`);
          } catch {
            log.info('ML auto-retrain complete (metrics parse skipped)');
            _lastMlTrain = Date.now();
          }
          resolve();
        } else {
          log.warn(`ML auto-retrain failed with code ${code}`);
          reject(new Error(`Training subprocess exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        log.warn('ML auto-retrain subprocess error', { error: String(err) });
        reject(err);
      });
    });
  } catch (err) {
    log.warn('ML auto-retrain error', { error: String(err) });
    throw err;
  }

  log.info(`ML auto-retrain finished in ${Date.now() - start}ms`);
}

async function runMlPrediction(config: ReturnType<typeof loadConfig>): Promise<void> {
  if (!_store || !_mlModelId) return;

  const symbols = config.ml?.training?.symbols ?? getTokenList().map(t => t.sym).slice(0, 20);
  const minConfidence = config.ml?.prediction?.minConfidence ?? 0.6;

  try {
    const results = await batchPredict(_store, symbols, '1h', {
      modelPath: _mlModelId,
      normalizationStats: _mlNormalizationStats ?? undefined,
      minConfidence,
    });

    if (results.length > 0) {
      await persistPredictions(_store, results, _mlModelId);
    }

    _lastMlPredict = Date.now();
  } catch (err) {
    log.warn('ML prediction error', { error: String(err) });
  }
}

// ── ML Drift Detection ──

/**
 * Run concept drift detection on recent predictions.
 * If drift is detected and auto-retrain is not recently done,
 * triggers an immediate retraining cycle.
 */
async function runDriftDetection(config: ReturnType<typeof loadConfig>): Promise<void> {
  if (!_store) return;

  // Only run drift detection if we have an active model and predictions
  if (!_mlModelId) return;

  try {
    const { detectDrift } = await import('./ml/drift.js');
    const report = await detectDrift(_store, {
      model: 'ADWIN',
      delta: 0.002,
      maxRecords: 500,
    });

    if (report.drift_detected) {
      log.warn(
        `Concept drift detected: ${report.detector_stats.total_detections} events ` +
        `out of ${report.detector_stats.total_observations} observations`
      );

      // Persist drift events to store
      const now = new Date().toISOString();
      for (const warning of report.warnings) {
        await _store.insertDriftEvent({
          id: `drift_${now}_${warning.index}`,
          ts: now,
          model_id: path.basename(_mlModelId),
          detector: 'ADWIN',
          index: warning.index,
          symbol: undefined, // symbol is in the message
          confidence: undefined,
          message: warning.message,
        });
      }

      // Auto-retrain trigger: if last train was >1h ago, retrain immediately
      const retrainCooldownMs = 3_600_000; // 1 hour
      if (Date.now() - _lastMlTrain > retrainCooldownMs) {
        log.info('Drift detected and cooldown elapsed — triggering auto-retrain');
        await autoRetrain(config);
      } else {
        log.info('Drift detected but within retrain cooldown — skipping auto-retrain');
      }
    } else {
      log.debug('No drift detected');
    }
  } catch (err) {
    log.warn('Drift detection error', { error: String(err) });
  }
}

// ── Fastify server ──

async function startFastify(): Promise<{ fastify: import('fastify').FastifyInstance }> {
  const jwtSecretRaw = process.env['RADAR__JWT_SECRET'];
  if (!jwtSecretRaw) {
    if (process.env['NODE_ENV'] === 'production') {
      log.fatal('RADAR__JWT_SECRET must be set in production');
      process.exit(1);
    }
    log.warn('RADAR__JWT_SECRET not set — using dev default (NOT for production)');
  }
  const jwtSecret = jwtSecretRaw ?? 'dev-secret-change-in-production';
  const fastify = await createApp({
    store: _store!,
    jwtSecret,
    corsOrigin: [
      'https://crypto-radar.vercel.app',
      'http://localhost:5173',
      'http://localhost:4173',
    ],
  });

  // ── Daemon management routes (registered directly on Fastify) ──
  fastify.get('/', () => ({
    status: _ready ? 'ready' : 'warming',
    uptime: _startTime > 0 ? Math.floor((Date.now() - _startTime) / 1000) : 0,
    ready: _ready,
    lastRefresh: _lastRefresh,
    refreshCount: _refreshCount,
    scanCount: _scanCount,
    errorCount: _errorCount,
    lastMlPredict: _lastMlPredict,
    activeTokens: getActiveTokenCount(),
    cacheEntries: getGlobalCache().stats().size,
    cacheHealth: Cache.getAllHealthStats(),
    refreshIntervalMs: refreshMs,
    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
  }));

  fastify.get('/health', () => ({
    status: _ready ? 'ready' : 'warming',
    uptime: _startTime > 0 ? Math.floor((Date.now() - _startTime) / 1000) : 0,
    ready: _ready,
    lastRefresh: _lastRefresh,
    refreshCount: _refreshCount,
    scanCount: _scanCount,
    errorCount: _errorCount,
    activeTokens: getActiveTokenCount(),
    cacheEntries: getGlobalCache().stats().size,
    refreshIntervalMs: refreshMs,
    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
  }));

  fastify.get('/refresh', async (_req, reply) => {
    try {
      await refreshAll();
      return { ok: true, refreshCount: _refreshCount };
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  fastify.get('/reload-config', (_req, reply) => {
    try {
      reloadTokenConfig();
      return { ok: true, activeTokens: getActiveTokenCount() };
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  fastify.post('/scan-complete', () => {
    _scanCount++;
    if (_wsHub) _wsHub.broadcast('news', { scanCount: _scanCount, ts: Date.now() });
    return { ok: true, scanCount: _scanCount };
  });

  // Note: 404 catch-all is already registered by createApp() in api/fastify/app.ts.
  // Calling setNotFoundHandler again on the same instance throws
  // "Not found handler already set", so we must not re-register it here.

  await fastify.ready();
  return { fastify };
}

// ── PID file management ──

function writePid(): void {
  const dir = path.dirname(getPidFile());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getPidFile(), String(process.pid));
}

function readPid(): number | null {
  try {
    if (fs.existsSync(getPidFile())) {
      return parseInt(fs.readFileSync(getPidFile(), 'utf-8').trim(), 10);
    }
  } catch { /* ignore */ }
  return null;
}

function removePid(): void {
  try {
    if (fs.existsSync(getPidFile())) fs.unlinkSync(getPidFile());
  } catch { /* ignore */ }
}

// ── Main entry ──

export async function runDaemon(): Promise<void> {
  log.info(`Starting Crypto Radar daemon on port ${port}...`);

  const config = loadConfig();
  try {
    _store = Store.open(config.dataDir);
    await _store.migrate();
    log.info('SQLite store opened and migrated');
  } catch (err) {
    log.warn('Failed to open store, continuing without persistence', { error: String(err) });
  }

  writePid();
  _startTime = Date.now();

  // ── Initialize ML model from MANIFEST (if available) ──
  const activeModelPath = resolveActiveModel();
  if (activeModelPath) {
    _mlModelId = activeModelPath;
    log.info(`ML model loaded from MANIFEST: ${path.basename(activeModelPath)}`);
  } else {
    log.info('No ML model found in MANIFEST — predictions disabled until first auto-retrain');
  }

  // ── Start Fastify API server ──
  if (!_store) {
    log.warn('No store available — halting');
    return;
  }

  const { fastify } = await startFastify();

  // Start Fastify server first — we need the underlying http.Server for WebSocket
  await fastify.listen({ port, host: '0.0.0.0' });
  _ready = true;
  log.info(`Daemon ready on http://0.0.0.0:${port} — refresh every ${refreshMs / 1000}s`);

  // ── WebSocket push hub (attaches to Fastify's underlying http.Server) ──
  try {
    _wsHub = createWsHub(fastify.server, _store);
    log.info('WebSocket push hub started');
  } catch (err) {
    log.warn('Failed to start WebSocket hub', { error: String(err) });
  }

  // Initial warm-up
  log.info('Pre-warming caches...');
  await refreshAll();

  // Periodic refresh
  const refreshTimer = setInterval(() => {
    refreshAll().catch(err => {
      _errorCount++;
      log.error('Periodic refresh failed', { error: String(err) });
    });
  }, refreshMs);
  refreshTimer.unref();

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down daemon...');
    clearInterval(refreshTimer);
    if (_wsHub) _wsHub.close();
    await fastify.close();
    if (_store) _store.close();
    removePid();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    _errorCount++;
    log.error('Uncaught exception', { error: String(err) });
  });
}

// ── CLI helpers ──

export function isDaemonRunning(): boolean {
  const pid = readPid();
  if (!pid) return false;
  try {
    // On Linux, signal 0 checks if process exists
    process.kill(pid, 0);
    return true;
  } catch (err) {
    logWarn("daemon", "Process check failed", err);
    // Process not found — stale pid
    removePid();
    return false;
  }
}

export function stopDaemon(): boolean {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    removePid();
    return false;
  }
}
