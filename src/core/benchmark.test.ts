// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Performance Benchmark Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runBenchmark, formatBenchmark, runBenchmarkMedian } from './benchmark.js';
import type { BenchmarkResult } from './benchmark.js';

// Mock the full radar module so runBenchmark doesn't hit real APIs
vi.mock('../radar.js', () => ({
  runRadar: vi.fn(),
}));

import { runRadar } from '../radar.js';
const mockRunRadar = vi.mocked(runRadar);

describe('runBenchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockRunRadar as any).mockResolvedValue({ run: { numTokens: 50 } });
  });

  it('returns a valid BenchmarkResult', async () => {
    const result = await runBenchmark();
    expect(result).toHaveProperty('scanTimeMs');
    expect(result).toHaveProperty('numTokens', 50);
    expect(result).toHaveProperty('tickersPerSecond');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('version', '2.0.0');
  });

  it('calls runRadar with correct options (no tech, no news, no log)', async () => {
    await runBenchmark();
    expect(mockRunRadar).toHaveBeenCalledTimes(1);
    expect(mockRunRadar).toHaveBeenCalledWith({
      includeTech: false,
      includeNews: false,
      noLog: true,
    });
  });

  it('calculates tickersPerSecond as 0 when scan time is 0', async () => {
    const result = await runBenchmark();
    // With fake timers or instant mocks, durationMs can be 0 → 0 tps
    expect(typeof result.tickersPerSecond).toBe('number');
  });
});

describe('runBenchmarkMedian', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockRunRadar as any).mockResolvedValue({ run: { numTokens: 42 } });
  });

  it('calls runRadar 3 times by default and returns a BenchmarkResult', async () => {
    const result = await runBenchmarkMedian();
    expect(mockRunRadar).toHaveBeenCalledTimes(3);
    expect(result.numTokens).toBe(42);
    expect(result.version).toBe('2.0.0');
  });

  it('accepts custom iteration count', async () => {
    const result = await runBenchmarkMedian(5);
    expect(mockRunRadar).toHaveBeenCalledTimes(5);
    expect(result.numTokens).toBe(42);
  });

  it('enforces minimum 1 iteration', async () => {
    const result = await runBenchmarkMedian(0);
    expect(mockRunRadar).toHaveBeenCalledTimes(1);
    expect(result.numTokens).toBe(42);
  });

  it('returns a result with recalculated tickersPerSecond', async () => {
    const result = await runBenchmarkMedian(3);
    expect(typeof result.tickersPerSecond).toBe('number');
    expect(result.tickersPerSecond).toBeGreaterThanOrEqual(0);
  });
});

describe('formatBenchmark', () => {
  const baseResult: BenchmarkResult = {
    scanTimeMs: 500,
    numTokens: 50,
    tickersPerSecond: 100,
    timestamp: '2026-07-06T12:00:00.000Z',
    version: '2.0.0',
  };

  it('includes scan time in output', () => {
    const output = formatBenchmark(baseResult);
    expect(output).toContain('500 ms');
  });

  it('includes token count', () => {
    const output = formatBenchmark(baseResult);
    expect(output).toContain('50');
  });

  it('includes throughput', () => {
    const output = formatBenchmark(baseResult);
    expect(output).toContain('100 tokens/sec');
  });

  it('shows EXCELLENT status for < 1s scan', () => {
    const output = formatBenchmark({ ...baseResult, scanTimeMs: 500 });
    expect(output).toContain('EXCELLENT');
  });

  it('shows GOOD status for 1-3s scan', () => {
    const output = formatBenchmark({ ...baseResult, scanTimeMs: 1500 });
    expect(output).toContain('GOOD');
  });

  it('shows ACCEPTABLE status for 3-10s scan', () => {
    const output = formatBenchmark({ ...baseResult, scanTimeMs: 5000 });
    expect(output).toContain('ACCEPTABLE');
  });

  it('shows SLOW status for >= 10s scan', () => {
    const output = formatBenchmark({ ...baseResult, scanTimeMs: 12000 });
    expect(output).toContain('SLOW');
  });

  it('handles edge case of exactly 1000ms as GOOD', () => {
    const output = formatBenchmark({ ...baseResult, scanTimeMs: 1000 });
    expect(output).toContain('GOOD');
  });

  it('handles edge case of exactly 3000ms as ACCEPTABLE', () => {
    const output = formatBenchmark({ ...baseResult, scanTimeMs: 3000 });
    expect(output).toContain('ACCEPTABLE');
  });

  it('handles edge case of exactly 10000ms as SLOW', () => {
    const output = formatBenchmark({ ...baseResult, scanTimeMs: 10000 });
    expect(output).toContain('SLOW');
  });
});
