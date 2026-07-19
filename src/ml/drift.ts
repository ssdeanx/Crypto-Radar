// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Concept Drift Detection
// ═══════════════════════════════════════════════════════════════════════
//
// Wraps ml/detect_drift.py as a subprocess call. Reads recent predictions
// from the store, runs them through the river drift detector, and returns
// a drift report. Optionally triggers auto-retrain on drift detection.
// ═══════════════════════════════════════════════════════════════════════

import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Store } from '../store/db.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'ml:drift' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Python executable for subprocess calls */
const PYTHON = process.env.RADAR__ML_PYTHON ?? 'python3';

/** Path to detect_drift.py */
const DRIFT_SCRIPT = path.resolve(__dirname, '../../ml/detect_drift.py');

/** Default max predictions to analyze for drift */
const DEFAULT_MAX_RECORDS = 1000;

/** Result from a drift detection run */
export interface DriftReport {
  drift_detected: boolean;
  warnings: DriftWarning[];
  detector_stats: {
    total_observations: number;
    current_width: number;
    total_detections: number;
    model: string;
  };
}

/** A single drift warning event */
export interface DriftWarning {
  index: number;
  message: string;
  open_time?: number;
}

/**
 * Run drift detection on recent predictions.
 *
 * Reads the latest predictions from the store, sends them as JSON
 * to the Python drift detector, and returns the report.
 *
 * @param store - SQLite store instance
 * @param opts - Options
 * @returns DriftReport — always returns a valid report (never throws)
 */
export async function detectDrift(
  store: Store,
  opts: {
    model?: 'ADWIN' | 'PageHinkley' | 'KSWIN';
    delta?: number;
    maxRecords?: number;
    timeoutMs?: number;
  } = {},
): Promise<DriftReport> {
  const {
    model = 'ADWIN',
    delta = 0.002,
    maxRecords = DEFAULT_MAX_RECORDS,
    timeoutMs = 30_000,
  } = opts;

  // Default empty report
  const emptyReport: DriftReport = {
    drift_detected: false,
    warnings: [],
    detector_stats: {
      total_observations: 0,
      current_width: 0,
      total_detections: 0,
      model,
    },
  };

  // Check that the drift script exists
  if (!existsSync(DRIFT_SCRIPT)) {
    log.warn(`Drift detection script not found: ${DRIFT_SCRIPT}`);
    return emptyReport;
  }

  try {
    // Get recent predictions from store
    const predictions = store.getPredictions({ limit: maxRecords });
    if (predictions.length < 10) {
      log.debug(`Drift detection skipped: only ${predictions.length} predictions available (need ≥10)`);
      return emptyReport;
    }

    // Build JSON input array
    const records = predictions.map(p => ({
      symbol: p.symbol,
      confidence: p.confidence,
      open_time: p.ts ? new Date(p.ts).getTime() : undefined,
    }));

    // Run Python subprocess
    const result = await runDriftSubprocess(records, { model, delta, timeoutMs });
    return result;
  } catch (err) {
    log.warn('Drift detection error', { error: String(err) });
    return emptyReport;
  }
}

/**
 * Run the Python drift detection subprocess.
 */
async function runDriftSubprocess(
  records: Array<{ symbol: string; confidence: number; open_time?: number }>,
  opts: { model: string; delta: number; timeoutMs: number },
): Promise<DriftReport> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [
      DRIFT_SCRIPT,
      '--model', opts.model,
      '--delta', String(opts.delta),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Drift subprocess timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Drift subprocess error: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) {
        try {
          const report = JSON.parse(stdout) as DriftReport;
          resolve(report);
        } catch {
          reject(new Error(`Failed to parse drift report JSON: ${stdout.slice(0, 200)}`));
        }
      } else {
        reject(new Error(`Drift subprocess exited with code ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    // Send JSON input via stdin
    const input = JSON.stringify(records);
    proc.stdin.write(input);
    proc.stdin.end();
  });
}
