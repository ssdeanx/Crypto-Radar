// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — CLI Integration Tests
// ═══════════════════════════════════════════════════════════════════════
//
// Spawns the compiled CLI (dist/cli.js) as a child process and verifies
// expected stdout/exit-code behavior for help output and a live scan.
// All tests skip when dist/cli.js is absent (not yet built).
//
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_PATH = resolve(__dirname, '../dist/cli.js');

const CLI_BUILT = existsSync(CLI_PATH);

// ── Helpers ────────────────────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI as a subprocess and collect stdout / stderr / exit code.
 * Never throws — non-zero exits are captured in the result struct.
 */
async function runCli(
  args: string[],
  timeout = 60_000,
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolvePromise, reject) => {
      execFile(
        'node',
        [CLI_PATH, ...args],
        { timeout, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error: any, stdout: string, stderr: string) => {
          if (error) {
            reject(Object.assign(error, { stdout, stderr }));
          } else {
            resolvePromise({ stdout, stderr });
          }
        },
      );
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: string; status?: number };
    return {
      stdout: (e.stdout ?? '').toString().trim(),
      stderr: (e.stderr ?? '').toString().trim(),
      exitCode: e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? -1 : (e.status ?? 1),
    };
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('CLI Integration', () => {
  // ── 1: --help ───────────────────────────────────────────────────────

  it.skipIf(!CLI_BUILT)(
    '--help exits 0 and shows crypto-radar description',
    async () => {
      const { stdout, exitCode } = await runCli(['--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('crypto-radar');
      expect(stdout).toContain('Enterprise crypto market intelligence');
    },
  );

  // ── 2: scan --help ─────────────────────────────────────────────────

  it.skipIf(!CLI_BUILT)(
    'scan --help lists scan options',
    async () => {
      const { stdout, exitCode } = await runCli(['scan', '--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('scan');
      expect(stdout).toContain('--dynamic');
      expect(stdout).toContain('--format');
      expect(stdout).toContain('--no-news');
      expect(stdout).toContain('--no-tech');
      expect(stdout).toContain('--filter');
    },
  );

  // ── 3: live scan — json output ────────────────────────────────────

  it.skipIf(!CLI_BUILT)(
    'scan --dynamic 3 --no-news --no-tech --format json returns valid JSON',
    async () => {
      const { stdout, stderr, exitCode } = await runCli(
        ['scan', '--dynamic', '3', '--no-news', '--no-tech', '--format', 'json'],
        120_000, // live Binance API calls may take a while
      );

      expect(exitCode).toBe(0);
      expect(stdout.length).toBeGreaterThan(0);

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        expect.fail(
          `CLI output was not valid JSON.\nstdout (first 500): ${stdout.slice(0, 500)}\nstderr: ${stderr.slice(0, 500)}`,
        );
      }

      expect(parsed).toHaveProperty('tickers');
      expect(Array.isArray(parsed.tickers)).toBe(true);
      expect((parsed.tickers as unknown[]).length).toBeGreaterThanOrEqual(1);

      // Spot-check a few fields on the first ticker
      const ticker = (parsed.tickers as Record<string, unknown>[])[0]!;
      expect(ticker).toHaveProperty('symbol');
      expect(ticker).toHaveProperty('lastPrice');
      expect(ticker).toHaveProperty('priceChangePercent');
    },
    120_000, // vitest test timeout must exceed execFile timeout
  );
});
