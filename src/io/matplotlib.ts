// ═══════════════════════════════════════════════════════════════════════
// Crypto-Radar — Matplotlib Visuals Bridge
// ═══════════════════════════════════════════════════════════════════════

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { Kline } from '../types.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'io:matplotlib' });

/** Resolve python binary in virtualenv or system PATH */
function resolvePythonBinary(): string {
  if (process.env['RADAR__ML_PYTHON']) return process.env['RADAR__ML_PYTHON'];
  const venvPython = path.resolve(process.cwd(), '.venv-ml', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  return 'python3';
}

const SCRIPT_PATH = path.resolve(process.cwd(), 'ml', 'charting.py');

interface ExecuteChartOptions {
  type: 'candlestick' | 'frontier' | 'correlation' | 'equity';
  payload: Record<string, unknown>;
  format?: 'png' | 'svg';
  timeoutMs?: number;
}

/** Spawns ml/charting.py and returns raw image buffer */
export async function executeMatplotlibChart(opts: ExecuteChartOptions): Promise<Buffer> {
  const python = resolvePythonBinary();
  const format = opts.format ?? 'png';
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return new Promise((resolve, reject) => {
    const proc = spawn(python, [SCRIPT_PATH, '--type', opts.type, '--format', format], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Matplotlib charting timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      errChunks.push(chunk);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn matplotlib process: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const stderrMsg = Buffer.concat(errChunks).toString('utf-8');
        log.warn('Matplotlib charting process exited with non-zero code', { code, stderr: stderrMsg });
        reject(new Error(`Matplotlib charting failed (code ${code}): ${stderrMsg}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    // Send payload JSON via stdin
    proc.stdin.write(JSON.stringify(opts.payload));
    proc.stdin.end();
  });
}

/** Render a high-resolution multi-panel candlestick dashboard */
export async function renderCandlestickDashboard(
  symbol: string,
  klines: Kline[],
  format: 'png' | 'svg' = 'png',
): Promise<Buffer> {
  return executeMatplotlibChart({
    type: 'candlestick',
    payload: { symbol, klines },
    format,
  });
}

/** Render Markowitz Efficient Frontier curve and asset allocation */
export async function renderEfficientFrontier(
  expectedReturns: number[],
  covMatrix: number[][],
  weights: number[],
  symbols: string[],
  format: 'png' | 'svg' = 'png',
): Promise<Buffer> {
  return executeMatplotlibChart({
    type: 'frontier',
    payload: { expectedReturns, covMatrix, weights, symbols },
    format,
  });
}

/** Render cross-asset return correlation heatmap */
export async function renderCorrelationHeatmap(
  matrix: number[][],
  symbols: string[],
  format: 'png' | 'svg' = 'png',
): Promise<Buffer> {
  return executeMatplotlibChart({
    type: 'correlation',
    payload: { matrix, symbols },
    format,
  });
}

/** Render paper trading cumulative equity curve & drawdown */
export async function renderPaperTradingEquity(
  trades: Array<{ created_at: number; pnl: number }>,
  startBalance = 100_000,
  format: 'png' | 'svg' = 'png',
): Promise<Buffer> {
  return executeMatplotlibChart({
    type: 'equity',
    payload: { trades, startBalance },
    format,
  });
}
