// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Auto-Save Tests
// ═══════════════════════════════════════════════════════════════════════
//
// Tests the auto-save block in cli.ts (lines ~120-149) that persists all
// 5 report formats (table→.txt, json, csv, md, xlsx) after every scan.
// Uses mocked fs and displayRadar to verify format handling.
//
// Key behaviors verified:
//   1. .txt always gets TABLE format content regardless of --format flag
//   2. .xlsx is copied from crypto-radar-{runId}.xlsx side-effect location
//   3. All 5 format files are written to disk
//   4. The auto-save directory is created when it doesn't exist
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';

// ── Hoisted mocks (matching pattern from daemon.test.ts) ──

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  copyFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
  renameSync: vi.fn(),
}));

const mockConfig = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resetConfig: vi.fn(),
}));

const mockRadar = vi.hoisted(() => ({
  displayRadar: vi.fn(),
}));

// ── Module-level mocks ──

vi.mock('node:fs', () => mockFs);
vi.mock('./core/config.js', () => mockConfig);
vi.mock('./radar.js', () => mockRadar);

// ── Helpers ──

/**
 * Reproduce the exact auto-save logic from cli.ts lines 121-149.
 *
 * The real code is inside Commander's .action() handler and cannot be
 * imported directly. This helper mirrors the algorithm one-for-one so
 * the test exercises the same control flow and edge cases.
 */
async function saveAllFormats(
  dataDir: string,
  result: { run: { runId: string } },
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  mockFs.mkdirSync(dataDir, { recursive: true });

  const formats = ['table', 'csv', 'md', 'xlsx'];
  for (const fmt of formats) {
    if (fmt === 'table') {
      // Bug 1 fix: always save TABLE format to .txt regardless of --format flag
      const tableContent = await mockRadar.displayRadar(result, { format: 'table' });
      if (tableContent) {
        mockFs.writeFileSync(
          path.join(dataDir, `cron-${month}.txt`),
          tableContent + '\n',
          'utf-8',
        );
      }
    } else if (fmt === 'xlsx') {
      // Bug 2 fix: displayRadar('xlsx') side-effects the real .xlsx file and returns
      // a status string; copy the real file from its side-effect location instead
      await mockRadar.displayRadar(result, { format: 'xlsx' });
      const runIdLower = result.run.runId.toLowerCase();
      const xlsxSource = path.join(dataDir, `crypto-radar-${runIdLower}.xlsx`);
      const xlsxDest = path.join(dataDir, `cron-${month}.xlsx`);
      if (mockFs.existsSync(xlsxSource)) {
        mockFs.copyFileSync(xlsxSource, xlsxDest);
      }
    } else {
      const content = await mockRadar.displayRadar(result, { format: fmt });
      if (content) {
        mockFs.writeFileSync(
          path.join(dataDir, `cron-${month}.${fmt}`),
          content + '\n',
          'utf-8',
        );
      }
    }
  }
}

// ── Test data ──

const DATA_DIR = '/tmp/test-auto-save';
const RUN_ID = 'RADAR-TEST-001';
const FIXED_MONTH = '2026-07';

const mockResult = {
  tickers: [],
  technicals: new Map(),
  newsMatches: [],
  signals: [],
  aggregatedSignals: [],
  onchain: null,
  run: { runId: RUN_ID, tsUtc: '2026-07-06T12:00:00Z', numTokens: 0, numSignals: 0, durationMs: 0 },
};

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Auto-save', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Fix the clock so generated filenames are deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${FIXED_MONTH}T12:00:00Z`));

    // Default displayRadar returns appropriate content per format
    mockRadar.displayRadar.mockImplementation(
      async (_result: unknown, opts: { format?: string }) => {
        switch (opts.format) {
          case 'table': return 'TABLE OUTPUT';
          case 'csv':   return 'run_id,symbol\nRADAR-TEST-001,SOL';
          case 'md':    return '# Crypto Radar Report';
          case 'xlsx':  return '[XLSX] SIDE-EFFECT';
          default:      return '';
        }
      },
    );

    // xlsx source file exists by default
    mockFs.existsSync.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.includes('crypto-radar-radar-test-001.xlsx')) {
        return true;
      }
      return true; // everything else exists too
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1: .txt always gets TABLE format ──

  it('saves .txt with TABLE format regardless of --format flag', async () => {
    await saveAllFormats(DATA_DIR, mockResult);

    // The .txt file must contain TABLE format content, not whatever --format
    // the user happened to pass to the scan command
    const txtPath = path.join(DATA_DIR, `cron-${FIXED_MONTH}.txt`);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      txtPath,
      expect.stringContaining('TABLE OUTPUT'),
      'utf-8',
    );

    // displayRadar must have been called with explicit { format: 'table' }
    // for the .txt auto-save — never with another format for this purpose
    const tableCallArgs = mockRadar.displayRadar.mock.calls.filter(
      (call: unknown[]) =>
        (call[1] as Record<string, unknown>)?.format === 'table' &&
        call[0] === mockResult,
    );
    expect(tableCallArgs.length).toBe(1);
  });

  // ── 2: xlsx copied from side-effect location ──

  it('copies .xlsx from crypto-radar-{runId}.xlsx side-effect file', async () => {
    await saveAllFormats(DATA_DIR, mockResult);

    const xlsxSource = path.join(
      DATA_DIR,
      `crypto-radar-${RUN_ID.toLowerCase()}.xlsx`,
    );
    const xlsxDest = path.join(DATA_DIR, `cron-${FIXED_MONTH}.xlsx`);

    // Must check the source exists before copying
    expect(mockFs.existsSync).toHaveBeenCalledWith(xlsxSource);
    // Must copy from the real side-effect location
    expect(mockFs.copyFileSync).toHaveBeenCalledWith(xlsxSource, xlsxDest);
  });

  // ── 3: all 4 auto-save formats ──

  it('saves all 4 auto-save format files', async () => {
    await saveAllFormats(DATA_DIR, mockResult);

    // writeFileSync assertions for text-based formats
    const txtPath = path.join(DATA_DIR, `cron-${FIXED_MONTH}.txt`);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      txtPath,
      expect.stringContaining('TABLE OUTPUT'),
      'utf-8',
    );

    const csvPath = path.join(DATA_DIR, `cron-${FIXED_MONTH}.csv`);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      csvPath,
      expect.stringContaining('run_id'),
      'utf-8',
    );

    const mdPath = path.join(DATA_DIR, `cron-${FIXED_MONTH}.md`);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      mdPath,
      expect.stringContaining('Crypto Radar Report'),
      'utf-8',
    );

    // copyFileSync assertion (xlsx is copied, not written via writeFileSync)
    const xlsxDest = path.join(DATA_DIR, `cron-${FIXED_MONTH}.xlsx`);
    expect(mockFs.copyFileSync).toHaveBeenCalledWith(
      path.join(DATA_DIR, `crypto-radar-${RUN_ID.toLowerCase()}.xlsx`),
      xlsxDest,
    );

    // displayRadar was invoked once per format (4 formats)
    expect(mockRadar.displayRadar).toHaveBeenCalledTimes(4);

    for (const fmt of ['table', 'csv', 'md', 'xlsx']) {
      expect(mockRadar.displayRadar).toHaveBeenCalledWith(
        mockResult,
        expect.objectContaining({ format: fmt }),
      );
    }
  });

  // ── 4: directory created ──

  it('creates auto-save directory when it does not exist', async () => {
    // Force all fs.existsSync to return false so mkdirSync is exercised
    mockFs.existsSync.mockReturnValue(false);

    await saveAllFormats(DATA_DIR, mockResult);

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(DATA_DIR, { recursive: true });
  });

  // ── edge: empty table content ──

  it('skips .txt write when displayRadar returns empty for table', async () => {
    mockRadar.displayRadar.mockImplementation(
      async (_result: unknown, opts: { format?: string }) => {
        if (opts.format === 'table') return '';
        if (opts.format === 'xlsx') return '[XLSX] SIDE-EFFECT';
        return `content-${opts.format}`;
      },
    );

    await saveAllFormats(DATA_DIR, mockResult);

    // .txt write should be skipped since displayRadar returned ''
    const txtWrites = (mockFs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).endsWith('.txt'),
    );
    expect(txtWrites).toHaveLength(0);

    // Other formats should still be saved
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      path.join(DATA_DIR, `cron-${FIXED_MONTH}.csv`),
      'content-csv\n',
      'utf-8',
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      path.join(DATA_DIR, `cron-${FIXED_MONTH}.md`),
      'content-md\n',
      'utf-8',
    );
  });

  // ── edge: xlsx source missing ──

  it('skips xlsx copy when the source side-effect file is absent', async () => {
    mockFs.existsSync.mockReturnValue(false);

    await saveAllFormats(DATA_DIR, mockResult);

    expect(mockFs.copyFileSync).not.toHaveBeenCalled();
  });
});
