// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — SQLite Export Tests
// ═══════════════════════════════════════════════════════════════════════
//
// Tests the exportCsvToSql function with various CSV inputs (valid,
// empty, malformed) by mocking the file-system and config loader so no
// actual disk I/O or production configuration is needed.
//
// All tests use validateOnly: true to avoid SQL generation & file writes.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks (hoisted before imports) ─────────────────────────────

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const mockConfig = vi.hoisted(() => ({
  loadConfig: vi.fn(),
}));

// ── Module-level mocks ─────────────────────────────────────────────────

vi.mock('node:fs', () => mockFs);
vi.mock('./core/config.js', () => mockConfig);

// ── Import after mocks are set up ─────────────────────────────────────

import { exportCsvToSql } from './sqlite-export.js';

// ── Test Helpers ──────────────────────────────────────────────────────

/**
 * Expected ticker CSV columns (from TICKER_COLUMNS in sqlite-export.ts).
 */
const TICKER_HEADER =
  'run_id,ts_utc,date_et,symbol,chain,lastPrice,bidPrice,bidQty,askPrice,askQty,' +
  'spreadPct,openPrice,highPrice,lowPrice,prevClosePrice,priceChangePercent,' +
  'weightedAvgPrice,priceChange,volume,quoteVolume,count,lastQty,vwapDistPct,' +
  'rangePosPct,bookImbalance,volVsAvg,obv,momentum,alerts,openTime,closeTime,source';

/**
 * One valid ticker data row matching the header above.
 */
const VALID_TICKER_ROW =
  'TEST-001,2026-07-06T12:00:00Z,07/06 08:00,SOL,solana,' +
  '150.00,149.95,100,150.05,200,' +
  '0.03,148.00,152.00,147.00,148.50,' +
  '1.01,150.00,1.50,5000000,750000000,' +
  '25000,50,0.5,0.6,0.1,0.2,' +
  '1000,2.5,,1234567890,1234567890,binance';

/** Valid ticker CSV (header + 1 data row). */
const VALID_TICKER_CSV = `${TICKER_HEADER}\n${VALID_TICKER_ROW}\n`;

/** Empty ticker CSV (header only). */
const EMPTY_TICKER_CSV = `${TICKER_HEADER}\n`;

/** Malformed ticker CSV rows. */
const MALFORMED_TICKER_CSV = `${TICKER_HEADER}\n` +
  // Row 2: missing required run_id, ts_utc, and chain; lowercase symbol
  ',2026-07-06T12:00:00Z,07/06 08:00,sol,unknown-chain,' +
  'abc,149.95,100,150.05,200,' +
  '0.03,148.00,152.00,147.00,148.50,' +
  '1.01,150.00,1.50,5000000,750000000,' +
  '25000,50,0.5,0.6,0.1,0.2,' +
  '1000,2.5,,1234567890,1234567890,binance\n' +
  // Row 3: valid row (to show that parsing continues past errors)
  `${VALID_TICKER_ROW}\n` +
  // Row 4: missing symbol (required)
  'TEST-003,2026-07-06T14:00:00Z,07/06 10:00,,solana,' +
  '200.00,199.95,100,200.05,200,' +
  '0.02,198.00,202.00,197.00,198.50,' +
  '1.01,200.00,2.00,3000000,600000000,' +
  '20000,40,0.3,0.4,0.1,0.0,' +
  '500,1.5,,9876543210,9876543210,binance\n';

const DATA_DIR = '/tmp/test-export-data';

// ── Tests ──────────────────────────────────────────────────────────────

describe('exportCsvToSql', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Provide a predictable config
    mockConfig.loadConfig.mockReturnValue({ dataDir: DATA_DIR });

    // Default: ticker CSV exists, news CSV does not
    mockFs.existsSync.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.includes('crypto-radar-log.csv')) return true;
      return false;
    });

    // Default readFileSync returns empty (overridden per-test)
    mockFs.readFileSync.mockReturnValue('');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1: Valid CSV data ─────────────────────────────────────────────

  it('returns correct row count and zero validation errors for valid CSV', () => {
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.includes('crypto-radar-log.csv')) {
        return VALID_TICKER_CSV;
      }
      return '';
    });

    const result = exportCsvToSql({ validateOnly: true });

    expect(result.tickerRows).toBe(1);
    expect(result.newsRows).toBe(0);
    expect(result.validationErrors).toBe(0);
    expect(result.validationTotal).toBe(1);
    expect(result.validationDetails).toEqual([]);
  });

  // ── 2: Empty CSV (headers only) ───────────────────────────────────

  it('handles empty CSV (headers with no data rows)', () => {
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.includes('crypto-radar-log.csv')) {
        return EMPTY_TICKER_CSV;
      }
      return '';
    });

    const result = exportCsvToSql({ validateOnly: true });

    expect(result.tickerRows).toBe(0);
    expect(result.newsRows).toBe(0);
    expect(result.validationErrors).toBe(0);
    expect(result.validationTotal).toBe(0);
  });

  // ── 3: Malformed data ─────────────────────────────────────────────

  it('reports validation errors for malformed CSV data', () => {
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.includes('crypto-radar-log.csv')) {
        return MALFORMED_TICKER_CSV;
      }
      return '';
    });

    const result = exportCsvToSql({ validateOnly: true });

    // All 3 data rows should be counted (even invalid ones)
    expect(result.tickerRows).toBe(3);
    expect(result.newsRows).toBe(0);
    // Expect validation errors (row 1: missing run_id, lowercase symbol, unknown chain;
    //                         row 3: missing symbol)
    expect(result.validationErrors).toBeGreaterThanOrEqual(1);
    expect(result.validationTotal).toBe(3);

    // Verify specific validation detail entries
    const details = result.validationDetails;
    expect(details.length).toBeGreaterThanOrEqual(1);

    // Row 1 (lines start at index 2 in the CSV) should have errors
    const line2Errors = details.filter((d) => d.line === 2);
    expect(line2Errors.length).toBeGreaterThanOrEqual(1);

    // Row 3 (3rd data line, 4th line in file) should have missing symbol
    const line4Errors = details.filter((d) => d.line === 4);
    const missingSymbol = line4Errors.find((d) => d.field === 'symbol');
    expect(missingSymbol).toBeDefined();
    expect(missingSymbol!.message).toContain('Missing required field');
  });

  // ── 4: Both CSV files missing ─────────────────────────────────────

  it('gracefully handles missing CSV files (zero rows, no crash)', () => {
    // existsSync returns false for everything
    mockFs.existsSync.mockReturnValue(false);

    const result = exportCsvToSql({ validateOnly: true });

    expect(result.tickerRows).toBe(0);
    expect(result.newsRows).toBe(0);
    expect(result.validationErrors).toBe(0);
    expect(result.validationTotal).toBe(0);
  });

  // ── 5: SQL output via outputPath ──────────────────────────────────

  it('writes SQL to the specified output file', () => {
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.includes('crypto-radar-log.csv')) {
        return VALID_TICKER_CSV;
      }
      return '';
    });

    const result = exportCsvToSql({
      outputPath: '/tmp/test-export/output.sql',
    });

    expect(result.tickerRows).toBe(1);
    expect(result.newsRows).toBe(0);
    expect(result.validationErrors).toBe(0);
    expect(result.sqlFile).toBe('/tmp/test-export/output.sql');

    // writeFileSync should have been called with SQL content
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/test-export/output.sql',
      expect.stringContaining('INSERT INTO radar_scans'),
      'utf-8',
    );

    // mkdirSync should have been called to create parent dir
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/test-export'),
      { recursive: true },
    );
  });
});
