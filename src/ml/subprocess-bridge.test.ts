// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — ML Subprocess Bridge Integration Test
// ═══════════════════════════════════════════════════════════════════════
//
// Spawns the real Python predict.py subprocess to verify the JSONL-based
// stdin/stdout protocol works end-to-end.  Tests are skipped when the
// predict script, a trained model, or the required Python dependencies
// (pandas, catboost, numpy) are not available.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

// ── Path resolution (vitest runs from project root) ───────────────────

const PREDICT_SCRIPT = path.resolve(process.cwd(), 'ml/predict.py');
const MODEL_DIR = path.resolve(process.cwd(), 'ml/models');

// ── Find a model file ────────────────────────────────────────────────

function findModel(): string | null {
  if (!existsSync(MODEL_DIR)) return null;
  const candidates = ['model_20260717_223000.cbm', 'model_20260717_223000.joblib'];
  for (const name of candidates) {
    const fp = path.resolve(MODEL_DIR, name);
    if (existsSync(fp)) return fp;
  }
  return null;
}

// ── Helper: spawn a subprocess, pipe stdin, collect output ───────────

/**
 * Spawn a subprocess, write `stdin` to its pipe, and wait for it to exit.
 * Uses `spawn` from `node:child_process` (not exec/execFile) as required.
 *
 * Returns the combined stdout/stderr and the exit code.  If the binary
 * cannot be spawned (e.g. Python not installed) the error is surfaced
 * via `exitCode: -1` so the test can skip gracefully.
 */
function runSubprocess(
  args: string[],
  stdin: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('python3', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('error', (err: Error) => {
      // Binary not found or other spawn-level error — resolve gracefully
      // so the test can bail without a hard failure.
      resolve({ stdout: '', stderr: `spawn error: ${err.message}`, exitCode: -1 });
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });

    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

// ── Build a comprehensive synthetic feature row ──────────────────────

/**
 * Build a synthetic feature row that mirrors the ~90+ features that
 * src/ml/features.ts produces at inference time.  All values are z-score
 * normalised (mean 0, std ~1) so CatBoost can digest them without
 * exploding gradients.
 */
function makeFeatureRow(): Record<string, number> {
  return {
    // ── Price features ──
    open: 1.02,
    high: 1.05,
    low: 0.98,
    close: 1.01,
    volume: 1.10,
    quote_volume: 1.08,

    // ── Returns ──
    return_1: 0.002,
    return_5: 0.015,
    return_10: 0.032,
    return_20: 0.058,
    log_return_1: 0.0019,
    log_return_5: 0.0148,
    log_return_10: 0.0315,
    volume_sma_5: 1.05,
    volume_sma_20: 1.02,
    volume_ratio_5: 1.048,
    volume_ratio_20: 1.078,

    // ── Cross-asset ──
    btc_dominance: 45.2,
    total_mcap: 2_500_000_000_000,
    total_mcap_change_24h: 0.012,
    eth_dominance: 18.5,

    // ── Futures ──
    funding_rate: 0.0001,
    funding_rate_change: 0.00002,

    // ── Temporal ──
    hour_of_day: 14,
    day_of_week: 3,
    day_of_month: 15,
    month: 6,
    is_weekend: 0,

    // ── Technical indicators ──
    rsi: 0.45,
    mfi: 0.52,
    macd_macd: 0.12,
    macd_signal: 0.10,
    macd_histogram: 0.02,
    bb_upper: 1.15,
    bb_middle: 1.00,
    bb_lower: 0.85,
    bb_width: 0.30,
    bb_position: 0.60,
    atr_pct: 0.015,
    volatility_ratio: 1.20,
    regime_trending: 0.25,
    regime_ranging: 0.60,
    regime_volatile: 0.10,
    regime_quiet: 0.05,
    trend_r2_10: 0.72,
    trend_slope_10: 0.005,
    trend_r2_20: 0.68,
    trend_slope_20: 0.004,
    trend_r2_50: 0.55,
    trend_slope_50: 0.003,
    vol_trend: 1.05,
    vol_vs_avg: 1.08,
    ema50_dist_pct: 0.015,
    obv: 1.2e6,
    stoch_k: 0.55,
    stoch_d: 0.50,
    ichimoku_conversion: 98.5,
    ichimoku_base: 97.2,
    ichimoku_span_a: 99.0,
    ichimoku_span_b: 95.5,
    williams_r: -35.0,
    cmf: 0.05,
    tsi: 0.12,
    adx: 22.0,
    adx_strength: 0,
    psar: 100.5,
    cci: 50.0,
    keltner_width: 0.08,
    keltner_position: 0.55,
    roc: 0.03,
    vwap: 100.2,
    force_index: 5000,
    adl: 2.5e6,
    chaikin_osc: 10000,
    stoch_rsi: 0.42,
    stoch_rsi_k: 0.45,
    stoch_rsi_d: 0.40,
    trix: 0.005,
    kst: 1.5,
    kst_signal: 1.2,
    elder_bull_power: 0.5,
    elder_bear_power: -0.3,
    fisher: -0.1,
    mass_index: 25.0,

    // ── Cross-asset trailing correlation ──
    corr_btc_20: 0.65,
    corr_btc_10: 0.62,
    corr_eth_20: 0.55,
    corr_eth_10: 0.52,
    corr_sol_20: 0.45,
    corr_sol_10: 0.42,
    corr_pol_20: 0.35,
    corr_pol_10: 0.32,

    // ── Volume profile ──
    vah: 105.0,
    val: 95.0,
    poc: 100.0,
    va_position: 0.50,

    // ── Market breadth (PCA) ──
    pca_market_breadth: 0.72,
  };
}

/** All feature keys (excludes symbol/interval/open_time) */
const ALL_FEATURES = Object.keys(makeFeatureRow());

/**
 * Build TS-PY contract JSONL: a header line followed by data lines.
 * Mirrors the protocol in predict.ts -> runSubprocessInference().
 */
function buildContractJsonl(rowCount: number): string {
  const header = {
    _header: true,
    _features: ALL_FEATURES,
    _featureCount: ALL_FEATURES.length,
    _timestamp: new Date().toISOString(),
  };
  const rows = Array.from({ length: rowCount }, () => makeFeatureRow());
  return [JSON.stringify(header), ...rows.map(r => JSON.stringify(r))].join('\n');
}

// ── Python dependency probe ──────────────────────────────────────────
//
// Returns true if python3 is available AND can import the packages that
// predict.py needs (pandas, numpy, catboost).  Uses spawnSync for a
// synchronous probe so the outer describe block can skipIf when the ML
// environment hasn't been set up.

import { spawnSync } from 'node:child_process';

function pythonDepsAvailable(): boolean {
  try {
    const result = spawnSync('python3', ['-c', 'import pandas; import numpy; import catboost'], {
      stdio: 'pipe',
      timeout: 10_000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ── Prerequisite guards ──────────────────────────────────────────────

const hasPredictScript = existsSync(PREDICT_SCRIPT);
const modelPath = findModel();
const hasModel = modelPath !== null;

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!hasPredictScript || !pythonDepsAvailable())('ML subprocess bridge', () => {

  // ───────────────────────────────────────────────────────────────────
  // Test 1 — valid JSONL input -> exit 0 + valid JSON array
  // ───────────────────────────────────────────────────────────────────

  describe.skipIf(!hasModel)('with valid JSONL input and trained model', () => {
    it('exits 0 and returns a valid JSON array', async () => {
      const jsonl = buildContractJsonl(1);
      const result = await runSubprocess(
        [PREDICT_SCRIPT, '--model', modelPath!],
        jsonl,
      );

      // Graceful skip when Python is not available on the host
      if (result.exitCode === -1) {
        return;
      }

      expect(result.exitCode).toBe(0);

      let parsed: unknown;
      expect(() => { parsed = JSON.parse(result.stdout); }).not.toThrow();
      expect(Array.isArray(parsed)).toBe(true);
      // The array should have predictions for each data row
      expect((parsed as unknown[]).length).toBe(1);
    });

    it('returns predictions with direction, confidence, and probs fields', async () => {
      const jsonl = buildContractJsonl(2);
      const result = await runSubprocess(
        [PREDICT_SCRIPT, '--model', modelPath!],
        jsonl,
      );

      if (result.exitCode === -1) return;

      expect(result.exitCode).toBe(0);
      const predictions = JSON.parse(result.stdout) as unknown[];

      for (const pred of predictions) {
        expect(pred).toHaveProperty('direction');
        expect(pred).toHaveProperty('confidence');
        expect(pred).toHaveProperty('probs');
        expect(Array.isArray((pred as Record<string, unknown>).probs)).toBe(true);
        expect((pred as Record<string, unknown[]>).probs).toHaveLength(3);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Test 2 — garbage input -> exit 1
  // ───────────────────────────────────────────────────────────────────
  // Garbage on stdin should cause pd.read_json(lines=True) to throw,
  // which predict.py catches and exits with code 1.  The --model value
  // doesn't matter for this test path because JSONL parsing happens
  // before model prediction.

  it('exits with code 1 on garbage input', async () => {
    const modelArg = modelPath ?? '/tmp/nonexistent_model.cbm';
    const garbageInput = 'not valid json at all\n{{{broken}}}\n';

    const result = await runSubprocess(
      [PREDICT_SCRIPT, '--model', modelArg],
      garbageInput,
    );

    if (result.exitCode === -1) return; // Python not available

    expect(result.exitCode).toBe(1);

    // When predict.py errors before any print() (e.g. import failure at
    // module level), stdout can be empty.  If available, verify it's valid
    // JSON; otherwise skip the JSON assertion.
    if (result.stdout) {
      expect(() => { JSON.parse(result.stdout); }).not.toThrow();
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // Test 3 — empty input -> exit 1 ("No numeric feature columns found")
  // ───────────────────────────────────────────────────────────────────
  // When the header is provided without data rows, predict.py removes
  // the header and finds zero numeric columns -> exit 1.

  it('exits with code 1 when only a header row is provided (no data)', async () => {
    if (!hasModel) return;

    const headerOnly = JSON.stringify({
      _header: true,
      _features: ALL_FEATURES,
      _featureCount: ALL_FEATURES.length,
      _timestamp: new Date().toISOString(),
    });

    const result = await runSubprocess(
      [PREDICT_SCRIPT, '--model', modelPath!],
      headerOnly,
    );

    if (result.exitCode === -1) return;

    expect(result.exitCode).toBe(1);

    if (result.stdout) {
      const err = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(err).toHaveProperty('error');
    }
  });
});
