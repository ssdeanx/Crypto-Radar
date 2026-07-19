// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Online Learning Layer (River)
// ═══════════════════════════════════════════════════════════════════════
//
// Wraps ml/online.py as a subprocess. Provides an incrementally-updating
// online learning model that catches slow concept drift between full
// CatBoost retrains. Updates are ~µs per row vs ~minutes for CatBoost.
//
// Architecture:
//   Daemon refresh cycle:
//     1. Run CatBoost batchPredict() → store predictions
//     2. When actual outcomes are known (next close), call trainStep()
//     3. Periodically call getMetrics() to check online model health
//     4. If online model detects concept drift, trigger autoRetrain()
// ═══════════════════════════════════════════════════════════════════════

import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'ml:online' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON = process.env.RADAR__ML_PYTHON ?? 'python3';
const ONLINE_SCRIPT = path.resolve(__dirname, '../../ml/online.py');
const DEFAULT_MODEL_PATH = path.resolve(__dirname, '../../ml/models/online_model.pkl');

/** Backend response from "train" action */
export interface OnlineTrainResult {
  status: string;
  total_updates: number;
}

/** Backend response from "predict" action */
export interface OnlinePredictionResult {
  direction: number | null;
  confidence: number;
  probs: Record<number, number>;
}

/** Backend response from "metrics" action */
export interface OnlineMetricsResult {
  total_updates: number;
  class_distribution: Record<string, number>;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  concept_drift_events: number;
}

/**
 * Train the online model on a single labeled example (partial_fit).
 * Should be called when the actual outcome of a prediction is known
 * (e.g., on the next kline close).
 */
export async function onlineTrain(
  features: Record<string, number>,
  label: -1 | 0 | 1,
  modelPath?: string,
): Promise<OnlineTrainResult> {
  const result = await runOnlineAction('train', {
    features: JSON.stringify(features),
    label: String(label),
    path: modelPath ?? DEFAULT_MODEL_PATH,
  });
  return JSON.parse(result) as OnlineTrainResult;
}

/**
 * Predict using the online model.
 * Returns direction, confidence, and per-class probabilities.
 */
export async function onlinePredict(
  features: Record<string, number>,
  modelPath?: string,
): Promise<OnlinePredictionResult> {
  try {
    const result = await runOnlineAction('predict', {
      features: JSON.stringify(features),
      path: modelPath ?? DEFAULT_MODEL_PATH,
    });
    return JSON.parse(result) as OnlinePredictionResult;
  } catch {
    // Online model not trained yet — return uniform prediction
    return { direction: 0, confidence: 1 / 3, probs: { '-1': 1 / 3, '0': 1 / 3, '1': 1 / 3 } };
  }
}

/**
 * Get streaming performance metrics from the online model.
 */
export async function onlineMetrics(modelPath?: string): Promise<OnlineMetricsResult | null> {
  const mp = modelPath ?? DEFAULT_MODEL_PATH;
  if (!existsSync(mp)) return null;
  try {
    const result = await runOnlineAction('metrics', { path: mp });
    return JSON.parse(result) as OnlineMetricsResult;
  } catch {
    return null;
  }
}

/**
 * Reset the online model (delete the pickle file).
 */
export async function onlineReset(modelPath?: string): Promise<void> {
  await runOnlineAction('reset', { path: modelPath ?? DEFAULT_MODEL_PATH });
}

/**
 * Run a CLI action against ml/online.py via subprocess.
 */
async function runOnlineAction(
  action: string,
  args: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliArgs = [ONLINE_SCRIPT, '--action', action];
    for (const [key, val] of Object.entries(args)) {
      cliArgs.push(`--${key}`, val);
    }

    const proc = spawn(PYTHON, cliArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Online subprocess timed out (action=${action})`));
    }, 15_000);

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Online subprocess error: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Online subprocess exited with code ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    proc.stdin.end();
  });
}
