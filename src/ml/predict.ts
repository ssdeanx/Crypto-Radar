// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — ML Prediction / Inference
// ═══════════════════════════════════════════════════════════════════════
//
// Loads a trained model (via Python subprocess or ONNX Runtime),
// computes features for the latest kline window, and emits predictions
// into the store.
//
// F3: Batching — all symbols are sent in a single JSONL block to the
//     subprocess, not one subprocess per symbol. JSONL preserves native
//     numeric types and null values without CSV escaping or type coercion.
// ═══════════════════════════════════════════════════════════════════════

import * as path from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Store } from '../store/db.js';
import { buildFeatures, enrichFeatures } from './features.js';
import type { FeatureRow, PredictionResult, NormalizationStats, PredictContractHeader } from './types.js';
import { normalizeRow } from './dataset.js';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';

const log = logger.child({ module: 'ml:predict' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Default Python path for subprocess inference */
let PYTHON = process.env.RADAR__ML_PYTHON ?? 'python3';
if (!process.env.RADAR__ML_PYTHON) {
  const venvPath = path.resolve(process.cwd(), '.venv-ml', 'bin', 'python');
  if (existsSync(venvPath)) {
    PYTHON = venvPath;
  }
}

/** Default model path (relative to project root) */
const DEFAULT_MODEL_PATH = resolveActiveModel() ?? resolveModelPath() ?? path.resolve(__dirname, '../../ml/models/model.joblib');

/** Default predict script path — resolved relative to this module */
const PREDICT_SCRIPT = path.resolve(__dirname, '../../ml/predict.py');

/**
 * Max seconds to wait for the Python subprocess before killing it.
 * Prevents the entire daemon prediction cycle from hanging on a stuck
 * subprocess (e.g. model load deadlock, stdin pipe stall).
 */
const SUBPROCESS_TIMEOUT_MS = 60_000;

/**
 * Resolve the active model from MANIFEST.json.
 * Reads ml/models/MANIFEST.json and returns the full path to the active model.
 * Falls back to null if MANIFEST doesn't exist or is unreadable.
 */
export function resolveActiveModel(modelsDir?: string): string | null {
  let dir = modelsDir ?? path.join(loadConfig().dataDir, 'ml', 'models');
  if (!existsSync(dir)) dir = path.resolve(process.cwd(), 'ml', 'models');
  const manifestPath = path.resolve(dir, 'MANIFEST.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as { active_model?: string };
    if (manifest.active_model) {
      const modelPath = path.resolve(dir, manifest.active_model);
      if (existsSync(modelPath)) return modelPath;
    }
  } catch {
    log.warn('Failed to parse MANIFEST.json — falling back to glob-based model resolution');
  }
  return null;
}

/**
 * Resolve the latest trained model file from ml/models/.
 * Scans for model_*.joblib files, returns the newest by mtime.
 * Falls back to model.joblib if no timestamped files exist.
 * Returns null if no model files exist at all.
 */
export function resolveModelPath(modelsDir?: string): string | null {
  let dir = modelsDir ?? path.join(loadConfig().dataDir, 'ml', 'models');
  if (!existsSync(dir)) dir = path.resolve(process.cwd(), 'ml', 'models');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => /^model_.*\.joblib$/.test(f));
  if (files.length === 0) {
    const legacy = path.resolve(dir, 'model.joblib');
    return existsSync(legacy) ? legacy : null;
  }
  files.sort((a, b) => statSync(path.resolve(dir, b)).mtimeMs - statSync(path.resolve(dir, a)).mtimeMs);
  return path.resolve(dir, files[0]!);
}

/**
 * Resolve the latest normalization stats JSON from data/ml/.
 * These are written by dataset.ts during training as: <prefix>_norm_<id>.json
 * Returns null if no norm stats file exists.
 */
export function resolveNormStatsPath(dataDir?: string): string | null {
  const dir = dataDir ?? path.join(loadConfig().dataDir, 'ml');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => f.endsWith('_norm_.json') || /_norm_[a-f0-9]+\.json$/.test(f));
  if (files.length === 0) return null;
  files.sort((a, b) => statSync(path.resolve(dir, b)).mtimeMs - statSync(path.resolve(dir, a)).mtimeMs);
  return path.resolve(dir, files[0]!);
}

/**
 * Batch predict for multiple symbols in a single subprocess call (F3).
 *
 * For each symbol, computes features from the latest klines, normalizes
 * using training stats, and sends all rows as CSV to the Python subprocess.
 * The subprocess returns a JSON array of predictions.
 *
 * F3: Single Python spawn for all symbols → ~200ms total instead of
 *      ~300ms × N symbols.
 */
export async function batchPredict(
  store: Store,
  symbols: string[],
  interval: string,
  opts: {
    modelPath?: string;
    normalizationStats?: NormalizationStats;
    minConfidence?: number;
    horizon?: number;
    /** Compute SHAP feature attribution for each prediction */
    explain?: boolean;
  } = {},
): Promise<PredictionResult[]> {
  const {
    modelPath = DEFAULT_MODEL_PATH,
    normalizationStats,
    minConfidence = 0,
    horizon = 5,
    explain = false,
  } = opts;

  const results: PredictionResult[] = [];

  // Build feature rows for each symbol
  const featureRows: FeatureRow[] = [];
  const allKlinesMap = new Map<string, number[]>();

  const btcKlines = (await store.getKlines('BTCUSDT', interval, { limit: 200, order: 'desc' })).reverse();
  const ethKlines = (await store.getKlines('ETHUSDT', interval, { limit: 200, order: 'desc' })).reverse();
  const solKlines = (await store.getKlines('SOLUSDT', interval, { limit: 200, order: 'desc' })).reverse();
  const polKlines = (await store.getKlines('POLUSDT', interval, { limit: 200, order: 'desc' })).reverse();
  const referenceKlines = new Map<string, number[]>();
  if (btcKlines.length >= 20) referenceKlines.set('BTCUSDT', btcKlines.map(k => k.close));
  if (ethKlines.length >= 20) referenceKlines.set('ETHUSDT', ethKlines.map(k => k.close));
  if (solKlines.length >= 20) referenceKlines.set('SOLUSDT', solKlines.map(k => k.close));
  if (polKlines.length >= 20) referenceKlines.set('POLUSDT', polKlines.map(k => k.close));

  for (const symbol of symbols) {
    try {
      // Fetch latest 200 klines (sufficient for all indicators)
      const klines = (await store.getKlines(symbol, interval, { limit: 200, order: 'desc' })).reverse();
      if (klines.length < 60) {
        log.debug(`Skipping ${symbol}: insufficient klines (${klines.length})`);
        continue;
      }
      allKlinesMap.set(symbol, klines.map(k => k.close));

      // Fetch cross-asset and funding for alignment (F2)
      const crossAsset = await store.getCrossAsset(100);
      const funding = await store.getFunding(symbol, 50);

      const rows = await buildFeatures(
        symbol, interval, klines,
        { includeReturns: true, includeIndicators: true, includeCrossAsset: true, includeFutures: true, includeTemporal: true },
        crossAsset, funding, referenceKlines,
      );

      // Only use the latest feature row for prediction
      if (rows.length > 0) {
        // Take the last (most recent) feature row
        const latest = rows[rows.length - 1]!;

        // Normalize if stats are available (F5)
        if (normalizationStats) {
          const normalized = normalizeRow(latest as unknown as Record<string, unknown>, normalizationStats);
          featureRows.push(normalized as unknown as FeatureRow);
        } else {
          featureRows.push(latest);
        }
      }
    } catch (err) {
      log.warn(`Failed to build features for ${symbol}`, { error: String(err) });
    }
  }

  enrichFeatures(featureRows, allKlinesMap);

  if (featureRows.length === 0) {
    log.warn('No feature rows to predict');
    return [];
  }

  // F3: Send all rows as a single JSONL block to the subprocess
  const modelId = path.basename(modelPath);

  try {
    const predictionRows = await runSubprocessInference(featureRows, modelPath, { explain });

    for (const pred of predictionRows) {
      if (pred.confidence >= minConfidence) {
        pred.modelId = modelId;
        pred.horizon = horizon;
        results.push(pred);
      }
    }
  } catch (err) {
    log.error('Subprocess inference failed', { error: String(err) });
  }

  return results;
}

/** Validate model direction output — must be -1, 0, or 1 */
function validateDirection(v: unknown): -1 | 0 | 1 {
  if (v === -1 || v === 0 || v === 1) return v;
  log.warn(`Invalid direction from model: ${v}, defaulting to 0`);
  return 0;
}

/**
 * Run Python subprocess inference (F3: batch mode).
 *
 * Writes feature rows as JSONL to subprocess stdin (one JSON object per
 * line), reads JSON array from stdout. JSONL preserves native numeric types
 * and null values without any CSV escaping or type coercion.
 */
async function runSubprocessInference(
  rows: FeatureRow[],
  modelPath: string,
  opts?: { explain?: boolean },
): Promise<PredictionResult[]> {
  return new Promise((resolve, reject) => {
    if (rows.length === 0) {
      resolve([]);
      return;
    }

    const firstRow = rows[0];
    if (!firstRow) {
      resolve([]);
      return;
    }
    const excludeKeys = new Set(['symbol', 'interval', 'open_time']);

    // Build JSONL: one JSON object per feature row, feature keys only
    const jsonlLines: string[] = [];
    for (const row of rows) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (!excludeKeys.has(k)) obj[k] = v;
      }
      jsonlLines.push(JSON.stringify(obj));
    }

    // Prepend contract header: validates TS-PY feature alignment
    const features = Object.keys(firstRow).filter(k => !excludeKeys.has(k));
    const header: PredictContractHeader & Record<string, unknown> = {
      _header: true,
      _features: features,
      _featureCount: features.length,
      _timestamp: new Date().toISOString(),
    };
    jsonlLines.unshift(JSON.stringify(header));

    const jsonlData = jsonlLines.join('\n');

    // Symbol map for matching results back to input rows
    const symbolMap = rows.map(r => r.symbol);
    // Spawn Python subprocess
    const predictArgs = [PREDICT_SCRIPT, '--model', modelPath];
    if (opts?.explain) {
      predictArgs.push('--explain');
    }
    const proc = spawn(PYTHON, predictArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // Timeout guard — prevents the daemon hanging on a stuck subprocess
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(
        `Subprocess timed out after ${SUBPROCESS_TIMEOUT_MS / 1000}s (model=${path.basename(modelPath)})`,
      ));
    }, SUBPROCESS_TIMEOUT_MS);

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Subprocess error: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(`Subprocess exited with code ${code}: ${stderr || '(no stderr)'}`));
        return;
      }

      if (stderr) {
        log.debug('Predict subprocess stderr', { stderr });
      }

      try {
        // Parse JSON array of predictions
        const predictions: { direction: number; confidence: number; probs?: number[] }[] =
          JSON.parse(stdout);

        // Warn if prediction count doesn't match input rows
        if (predictions.length !== symbolMap.length) {
          log.warn(`Prediction count mismatch: ${predictions.length} predictions vs ${symbolMap.length} input rows`);
        }

        // Validate minimum shape of each prediction
        for (let i = 0; i < predictions.length; i++) {
          const p = predictions[i]!;
          if (p.direction === undefined || p.confidence === undefined) {
            reject(new Error(`Prediction at index ${i} missing required fields (direction/confidence)`));
            return;
          }
        }

        // Map back to symbols
        const results: PredictionResult[] = predictions.map((p, i) => ({
          symbol: symbolMap[i] ?? 'unknown',
          open_time: rows[i]?.open_time as number ?? 0,
          direction: validateDirection(p.direction),
          confidence: p.confidence,
          probs: p.probs,
          horizon: 5,
          modelId: '',
        }));

        resolve(results);
      } catch (err) {
        reject(new Error(`Failed to parse subprocess output: ${err}`));
      }
    });

    // Write JSONL to stdin and close
    proc.stdin.write(jsonlData);
    proc.stdin.end();
  });
}

/**
 * Write prediction results to the store.
 *
 * Creates a SHA-1 hash ID from (symbol, open_time, modelId) for
 * deduplication. Maps numeric directions to string labels for DB storage.
 *
 * @param store   Store instance for persistence
 * @param results Prediction results to persist
 * @param modelId Model identifier to tag all rows
 */
export async function persistPredictions(
  store: Store,
  results: PredictionResult[],
  modelId: string,
): Promise<void> {
  for (const r of results) {
    const id = createHash('sha1').update(`${r.symbol}|${r.open_time}|${modelId}`).digest('hex');
    await store.upsertPrediction({
      id,
      symbol: r.symbol,
      ts: String(r.open_time),
      direction: r.direction === 1 ? 'buy' : r.direction === -1 ? 'sell' : 'neutral',
      confidence: r.confidence,
      model_id: modelId,
      horizon: r.horizon,
      ml_score: r.confidence,
      features_hash: null,
      reasoning: r.reasoning ?? undefined,
    });
  }
  log.info(`Persisted ${results.length} predictions for model ${modelId}`);
}
