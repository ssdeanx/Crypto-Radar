// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — End-to-End Smoke Tests
// ═══════════════════════════════════════════════════════════════════════
//
// These tests run the compiled CLI against live Binance API.
// They are skipped by default (describe.skip) so CI doesn't fail.
// Run with: npx vitest run src/e2e.test.ts --reporter=verbose

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const CLI = 'node dist/cli.js';

function runCLI(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`${CLI} ${args}`, {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? '').toString().trim(),
      stderr: (err.stderr ?? '').toString().trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe.skip('End-to-End CLI Smoke Tests', () => {
  it('live scan returns valid JSON', () => {
    const result = runCLI('scan --filter SOL --no-news --format json');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);

    let parsed: any;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      // If JSON parse fails, check if CLI printed an error to stderr
      expect(result.stderr).toBe('');
      throw new Error(`Failed to parse CLI output as JSON: ${result.stdout.slice(0, 500)}`);
    }

    expect(parsed).toHaveProperty('tickers');
    expect(Array.isArray(parsed.tickers)).toBe(true);
    expect(parsed.tickers.length).toBeGreaterThanOrEqual(1);

    const ticker = parsed.tickers[0];
    expect(ticker).toHaveProperty('symbol');
    expect(ticker).toHaveProperty('lastPrice');
    expect(ticker).toHaveProperty('priceChangePercent');
  });

  it('health check returns ok', () => {
    const result = runCLI('health');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('ok');
  });

  it('tokens list has 30+ entries', () => {
    const result = runCLI('tokens --format json');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);

    let parsed: any;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      expect(result.stderr).toBe('');
      throw new Error(`Failed to parse CLI output as JSON: ${result.stdout.slice(0, 500)}`);
    }

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(30);
  });
});
