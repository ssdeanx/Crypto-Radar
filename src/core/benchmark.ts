// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Performance Benchmark
// ═══════════════════════════════════════════════════════════════════════
//
// Measures scan performance across token counts and reports regressions.
// Run with: npm run benchmark

import { runRadar } from '../radar.js';

export interface BenchmarkResult {
  scanTimeMs: number;
  numTokens: number;
  tickersPerSecond: number;
  timestamp: string;
  /** Version info for regression tracking */
  version: string;
}

/**
 * Run a single benchmark scan and return timing metrics.
 * Skips technical indicators and news to measure raw scan throughput.
 */
export async function runBenchmark(): Promise<BenchmarkResult> {
  const start = Date.now();
  const result = await runRadar({
    includeTech: false,
    includeNews: false,
    noLog: true,
  });
  const durationMs = Date.now() - start;

  return {
    scanTimeMs: durationMs,
    numTokens: result.run.numTokens,
    tickersPerSecond: durationMs > 0
      ? Math.round((result.run.numTokens / durationMs) * 1000)
      : 0,
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  };
}

/**
 * Run a series of benchmark iterations and return the median result.
 * Useful for reducing noise from network jitter.
 *
 * @param iterations Number of runs (default: 3, minimum: 1)
 * @returns The median benchmark result
 */
export async function runBenchmarkMedian(iterations: number = 3): Promise<BenchmarkResult> {
  const count = Math.max(1, iterations);
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < count; i++) {
    const r = await runBenchmark();
    results.push(r);
  }

  // Sort by scanTimeMs and return the median
  results.sort((a, b) => a.scanTimeMs - b.scanTimeMs);
  const median = results[Math.floor(results.length / 2)]!;

  return {
    ...median,
    tickersPerSecond: median.scanTimeMs > 0
      ? Math.round((median.numTokens / median.scanTimeMs) * 1000)
      : 0,
  };
}

/**
 * Format a benchmark result for terminal display.
 */
export function formatBenchmark(result: BenchmarkResult): string {
  const lines: string[] = [];

  lines.push('┌─────────────────────────────────────────────────────────┐');
  lines.push('│        Hermes Crypto Radar — Performance Benchmark     │');
  lines.push('└─────────────────────────────────────────────────────────┘');
  lines.push('');
  lines.push(`  Scan Time:       ${result.scanTimeMs} ms`);
  lines.push(`  Tokens Scanned:  ${result.numTokens}`);
  lines.push(`  Throughput:      ${result.tickersPerSecond} tokens/sec`);
  lines.push(`  Timestamp:       ${result.timestamp}`);
  lines.push('');

  // Quick health assessment
  if (result.scanTimeMs < 1000) {
    lines.push('  Status: \x1b[32mEXCELLENT\x1b[0m (< 1s scan)');
  } else if (result.scanTimeMs < 3000) {
    lines.push('  Status: \x1b[32mGOOD\x1b[0m (< 3s scan)');
  } else if (result.scanTimeMs < 10000) {
    lines.push('  Status: \x1b[33mACCEPTABLE\x1b[0m (< 10s scan)');
  } else {
    lines.push('  Status: \x1b[31mSLOW\x1b[0m (>= 10s scan — investigate)');
  }
  lines.push('');

  return lines.join('\n');
}
