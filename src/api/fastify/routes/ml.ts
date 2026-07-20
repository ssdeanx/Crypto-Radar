// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — ML Pipeline API Routes
// ═══════════════════════════════════════════════════════════════════════
//
// Exposes ML pipeline health, model info, drift events, and performance
// metrics for observability and monitoring.
// ═══════════════════════════════════════════════════════════════════════

import type { FastifyPluginAsync } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { resolveActiveModel } from '../../../ml/predict.js';
import { computeCalibration } from '../../../ml/monitor.js';
import { loadConfig } from '../../../core/config.js';
import { getTokenList } from '../../../tokens.js';

export const mlRoutes: FastifyPluginAsync = async (app) => {
  const store = app.store;

  // ── GET /api/ml/status — ML pipeline health ──
  app.get('/api/ml/status', async () => {
    const config = loadConfig();
    let modelsDir = path.join(config.dataDir, 'ml', 'models');
    if (!existsSync(modelsDir)) {
      modelsDir = path.resolve(process.cwd(), 'ml', 'models');
    }
    const manifestPath = path.resolve(modelsDir, 'MANIFEST.json');
    const hasManifest = existsSync(manifestPath);

    let activeModelInfo: Record<string, unknown> | null = null;
    let modelsCount = 0;

    if (hasManifest) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        activeModelInfo = manifest.models?.find(
          (m: Record<string, unknown>) => m.path === manifest.active_model,
        ) ?? null;
        modelsCount = manifest.models?.length ?? 0;
      } catch {
        // ignore parse errors
      }
    }

    const stats = await store.stats();

    return {
      enabled: config.ml?.enabled ?? false,
      activeModel: activeModelInfo ? {
        id: activeModelInfo.path,
        accuracy: activeModelInfo.accuracy,
        f1Weighted: activeModelInfo.f1_weighted,
        f1Macro: activeModelInfo.f1_macro,
        features: activeModelInfo.features,
        trainingTimestamp: activeModelInfo.training_timestamp,
        isProduction: activeModelInfo.is_production,
      } : null,
      activeModelPath: resolveActiveModel(modelsDir),
      modelsCount,
      lastTrain: activeModelInfo?.training_timestamp ?? null,
      predictions24h: stats.predictions ?? 0,
      driftEvents24h: stats.drift_events ?? 0,
      storeStats: {
        tickers: stats.tickers ?? 0,
        klines: stats.klines ?? 0,
        predictions: stats.predictions ?? 0,
        supportedTokens: getTokenList().length,
      },
    };
  });

  // ── GET /api/ml/models — list all models ──
  app.get('/api/ml/models', async () => {
    let modelsDir = path.join(loadConfig().dataDir, 'ml', 'models');
    if (!existsSync(modelsDir)) {
      modelsDir = path.resolve(process.cwd(), 'ml', 'models');
    }
    const manifestPath = path.join(modelsDir, 'MANIFEST.json');
    if (!existsSync(manifestPath)) {
      return { models: [], activeModel: null };
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      return {
        activeModel: manifest.active_model ?? null,
        models: (manifest.models ?? []).map((m: Record<string, unknown>) => ({
          id: m.path,
          accuracy: m.accuracy,
          f1Weighted: m.f1_weighted,
          f1Macro: m.f1_macro,
          features: m.features,
          trainingTimestamp: m.training_timestamp,
          isProduction: m.is_production,
        })),
        retiredCount: manifest.retired_models?.length ?? 0,
      };
    } catch {
      return { models: [], activeModel: null, error: 'Failed to parse manifest' };
    }
  });

  // ── GET /api/ml/drift — recent drift events ──
  app.get('/api/ml/drift', async (request) => {
    const query = request.query as { limit?: string };
    const limit = parseInt(query.limit ?? '50', 10);
    const events = await store.getDriftEvents({ limit });
    return { events, count: events.length };
  });

  // ── GET /api/ml/predictions — recent predictions ──
  app.get('/api/ml/predictions', async (request) => {
    const query = request.query as { limit?: string; symbol?: string };
    const limit = parseInt(query.limit ?? '50', 10);
    const predictions = await store.getPredictions({
      limit,
      symbol: query.symbol,
    });
    return { predictions, count: predictions.length };
  });

  // ── GET /api/ml/calibration — prediction calibration report ──
  app.get('/api/ml/calibration', async () => {
    const calibration = await computeCalibration(store);
    return calibration;
  });

  // ── GET /api/ml/online — online model metrics ──
  app.get('/api/ml/online', async () => {
    const { onlineMetrics } = await import('../../../ml/online.js');
    const metrics = await onlineMetrics();
    return metrics ?? { status: 'unavailable', message: 'No online model trained yet' };
  });
};
