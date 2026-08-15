import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { runRadar } from '../../../radar.js';
import { runCollector } from '../../../collector.js';
import { batchPredict, persistPredictions, resolveModelPath, resolveNormStatsPath } from '../../../ml/predict.js';
import { getTokenList, getTopTokensByVolume } from '../../../tokens.js';
import * as fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../../core/logger.js';
import type { TokenDef } from '../../../types.js';

const log = logger.child({ module: 'cron' });

export const cronRoutes: FastifyPluginAsync = async (app) => {
  // Exempt from global rate limiter — Cloud Scheduler must never be throttled
  app.post('/api/cron/scan', { config: { rateLimit: false } }, async (request, reply) => {
    // 1. Security Check — timing-safe compare prevents timing-oracle attacks
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      log.error('CRON_SECRET is not configured in environment variables');
      return reply.status(500).send({ error: 'CRON_SECRET environment variable is not configured.' });
    }

    const apiKeyEnv = process.env['RADAR__API_KEY'];
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
    const authHeader = (request.headers['x-cron-secret'] ?? request.headers['authorization']) as string | undefined;

    const isValidApiKey = Boolean(apiKeyEnv && apiKeyHeader && apiKeyHeader === apiKeyEnv);

    if (!authHeader && !isValidApiKey) {
      return reply.status(401).send({ error: 'Unauthorized: Missing cron secret or x-api-key header.' });
    }

    // Strip "Bearer " prefix if present, then do constant-time compare to prevent timing attacks
    const rawSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const isValidCronSecret = (() => {
      if (!rawSecret) return false;
      try {
        const a = Buffer.from(rawSecret);
        const b = Buffer.from(cronSecret);
        return a.length === b.length && timingSafeEqual(a, b);
      } catch {
        return false;
      }
    })();
    if (!isValidCronSecret && !isValidApiKey) {
      return reply.status(403).send({ error: 'Forbidden: Invalid cron secret or x-api-key.' });
    }

    log.info('Secure cron trigger validated. Starting hourly scan cycle...');

    const start = Date.now();
    let scanResult: Awaited<ReturnType<typeof runRadar>> | undefined;
    let collectorResult: Awaited<ReturnType<typeof runCollector>> | undefined;
    let mlResultCount = 0;

    try {
      // Step A: Auto-resolve top 30 tokens by volume for the scan
      let symbolsToScan: string[] = [];
      try {
        const topTokens = await getTopTokensByVolume(30);
        symbolsToScan = topTokens.map((t: TokenDef) => t.sym);
        log.info(`[cron-scan] Fetched top ${symbolsToScan.length} tokens by volume`);
      } catch (err) {
        log.warn('[cron-scan] Failed to fetch top tokens, using default list', { error: String(err) });
        symbolsToScan = getTokenList().map(t => t.sym).slice(0, 20);
      }

      // Step B: Run Radar Scan
      log.info('[cron-scan] Running market scan...');
      scanResult = await runRadar({
        filter: symbolsToScan,
        sortBy: 'momentum',
        format: 'json',
        quiet: true,
        includeTech: true,
        includeNews: false, // skip news as per legacy cron script --no-news
        includeOnchain: true,
      });

      // Step C: Run Collector (Klines + Futures)
      log.info('[cron-scan] Running historical data collection...');
      collectorResult = await runCollector({
        klines: true,
        futures: true,
        orderbook: true,
        fearGreed: true,
        crossAsset: true,
        symbols: symbolsToScan.map(s => s.endsWith('USDT') ? s : s + 'USDT'),
      });

      // Step D: Run ML Prediction if Model exists
      const modelPath = resolveModelPath();
      if (modelPath) {
        log.info(`[cron-scan] Found trained ML model. Running batch predictions...`);

        // Read training horizon from MANIFEST.json
        let horizon = 5;  // default fallback
        const manifestPath = path.join(path.dirname(modelPath), 'MANIFEST.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            if (manifest.training_config?.horizon) {
              horizon = manifest.training_config.horizon;
            } else if (manifest.horizon) {
              horizon = manifest.horizon;
            }
            log.info(`[cron-scan] Using horizon=${horizon} from MANIFEST`);
          } catch (e) {
            log.warn('[cron-scan] Failed to parse MANIFEST.json for horizon', { error: String(e) });
          }
        }

        const normStatsPath = resolveNormStatsPath();
        let normalizationStats: unknown = undefined;
        if (normStatsPath && fs.existsSync(normStatsPath)) {
          try {
            normalizationStats = JSON.parse(fs.readFileSync(normStatsPath, 'utf-8'));
          } catch (e) {
            log.warn(`[cron-scan] Could not load normalization stats from ${normStatsPath}`, { error: String(e) });
          }
        }

        const predictions = await batchPredict(app.store, symbolsToScan.map(s => s.endsWith('USDT') ? s : s + 'USDT'), '1h', {
          modelPath,
          normalizationStats: normalizationStats as import('../../../ml/types.js').NormalizationStats | undefined,
          minConfidence: 0,
          horizon,
        });

        if (predictions.length > 0) {
          // Enrich with Gemini reasoning — single batch API call instead of N
          try {
            const { batchGenerateReasoning } = await import('../../../analysis/gemini.js');

            // Pre-fetch ticker data and klines for every prediction
            const enriched: Array<{
              symbol: string;
              direction: -1 | 0 | 1;
              confidence: number;
              ticker: { lastPrice: number; priceChangePercent: number };
              signal: { compositeScore: number; regime?: string | null };
              klines: import('../../../types.js').KlineRow[];
            }> = [];

            for (const pred of predictions) {
              const ticker = scanResult?.tickers?.find(t => t.symbol === pred.symbol);
              if (ticker) {
                const klines = await app.store.getKlines(pred.symbol, '1h', { limit: 10, order: 'desc' });
                enriched.push({
                  symbol: pred.symbol,
                  direction: pred.direction,
                  confidence: pred.confidence,
                  ticker: { lastPrice: ticker.lastPrice, priceChangePercent: ticker.priceChangePercent },
                  signal: { compositeScore: ticker.compositeScore ?? 50, regime: ticker.regime },
                  klines,
                });
              }
            }

            // Single batch LLM call for all predictions
            const reasoningMap = await batchGenerateReasoning(enriched);
            for (const pred of predictions) {
              pred.reasoning = reasoningMap.get(pred.symbol) ?? '';
            }
          } catch (geminiErr) {
            log.warn('Failed to generate Gemini reasoning during prediction enrichment', { error: String(geminiErr) });
          }

          await persistPredictions(app.store, predictions, 'cron-automated');
          mlResultCount = predictions.length;
          log.info(`[cron-scan] Persisted ${mlResultCount} ML predictions`);
        } else {
          log.info(`[cron-scan] No ML predictions generated`);
        }
      } else {
        log.info(`[cron-scan] No trained ML model found; skipping prediction step`);
      }

      const durationMs = Date.now() - start;
      log.info(`[cron-scan] Cycle completed successfully in ${durationMs}ms`);

      return {
        status: 'success',
        durationMs,
        scan: {
          runId: scanResult?.run?.runId,
          tokens: scanResult?.run?.numTokens,
          signals: scanResult?.aggregatedSignals?.length,
        },
        collector: {
          klinesInserted: collectorResult?.klinesInserted,
          fundingInserted: collectorResult?.fundingInserted,
          oiInserted: collectorResult?.oiInserted,
          liquidationsInserted: collectorResult?.liquidationsInserted,
        },
        predictions: mlResultCount,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error('Cron scan cycle failed with error', { error: errMsg, stack: err instanceof Error ? err.stack : undefined });
      return reply.status(500).send({
        status: 'error',
        error: errMsg,
      });
    }
  });

  // Automated ML Retraining Endpoint — triggered by Cloud Scheduler or drift detector
  app.post('/api/cron/retrain', { config: { rateLimit: false } }, async (request, reply) => {
    const cronSecret = process.env.CRON_SECRET;
    const apiKeyEnv = process.env['RADAR__API_KEY'];
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
    const authHeader = (request.headers['x-cron-secret'] ?? request.headers['authorization']) as string | undefined;

    const isValidApiKey = Boolean(apiKeyEnv && apiKeyHeader && apiKeyHeader === apiKeyEnv);
    const rawSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const isValidCronSecret = (() => {
      if (!rawSecret || !cronSecret) return false;
      try {
        const a = Buffer.from(rawSecret);
        const b = Buffer.from(cronSecret);
        return a.length === b.length && timingSafeEqual(a, b);
      } catch {
        return false;
      }
    })();

    if (!isValidCronSecret && !isValidApiKey) {
      return reply.status(403).send({ error: 'Forbidden: Invalid cron secret or x-api-key.' });
    }

    log.info('Starting automated ML model retraining cycle...');
    const startTime = Date.now();

    try {
      // 1. Build training dataset
      const { runBuildDataset } = await import('../../../ml/build-dataset-cli.js');
      await runBuildDataset(['--symbols', 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT', '--horizon', '5', '--limit', '500']);

      // 2. Train CatBoost model via Python subprocess
      const { spawn } = await import('node:child_process');
      const python = process.env.RADAR__ML_PYTHON ?? 'python3';
      const datasetPath = path.resolve(process.cwd(), 'data/ml/dataset_train.jsonl');

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(python, [
          'ml/train.py',
          '--data', datasetPath,
          '--output', 'ml/models',
          '--class-weight', 'custom',
        ], { stdio: ['ignore', 'pipe', 'inherit'] });

        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Training process exited with code ${code}`));
        });
      });

      // 3. Sync trained model & normalization stats to GCS storage bucket
      await app.store.syncModelsToBucket();

      const durationMs = Date.now() - startTime;
      log.info(`Automated ML model retraining completed in ${durationMs}ms`);

      return {
        status: 'success',
        durationMs,
        datasetPath,
        modelDir: 'ml/models',
      };
    } catch (retrainErr) {
      const errMsg = retrainErr instanceof Error ? retrainErr.message : String(retrainErr);
      log.error('Automated ML model retraining failed', { error: errMsg });
      return reply.status(500).send({
        status: 'error',
        error: errMsg,
      });
    }
  });
};
