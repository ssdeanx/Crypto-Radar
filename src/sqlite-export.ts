// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — SQLite Export Bridge
// ═══════════════════════════════════════════════════════════════════════
//
// Exports radar CSV log data as SQLite-compatible SQL INSERT statements.
// Zero external dependencies — uses only Node.js built-ins (fs, path).
//
// Usage:
//   crypto-radar export-sqlite > radar.sql
//   sqlite3 radar.db < radar.sql
//
// Or pipe directly:
//   crypto-radar export-sqlite --stdout | sqlite3 radar.db

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';

// ── Schema validation ────────────────────────────────────────────────

/** Expected columns for the ticker CSV log */
const TICKER_COLUMNS = [
  'run_id', 'ts_utc', 'date_et', 'symbol', 'chain', 'lastPrice',
  'bidPrice', 'bidQty', 'askPrice', 'askQty', 'spreadPct', 'openPrice',
  'highPrice', 'lowPrice', 'prevClosePrice', 'priceChangePercent',
  'weightedAvgPrice', 'priceChange', 'volume', 'quoteVolume', 'count',
  'lastQty', 'vwapDistPct', 'rangePosPct', 'bookImbalance', 'volVsAvg',
  'obv', 'momentum', 'alerts', 'openTime', 'closeTime', 'source',
] as const;

/** Expected columns for the news CSV log */
const NEWS_COLUMNS = [
  'run_id', 'ts_utc', 'symbol', 'headline', 'description',
  'source', 'domain', 'relevance',
] as const;

/** Numeric columns in ticker CSV that must parse to finite numbers */
const TICKER_NUMERIC_COLUMNS = new Set([
  'lastPrice', 'bidPrice', 'bidQty', 'askPrice', 'askQty', 'spreadPct',
  'openPrice', 'highPrice', 'lowPrice', 'prevClosePrice', 'priceChangePercent',
  'weightedAvgPrice', 'priceChange', 'volume', 'quoteVolume', 'count',
  'lastQty', 'vwapDistPct', 'rangePosPct', 'bookImbalance', 'volVsAvg',
  'obv', 'momentum', 'openTime', 'closeTime',
]);

/** Numeric columns in news CSV that must parse to finite numbers */
const NEWS_NUMERIC_COLUMNS = new Set(['relevance']);

// ── Interfaces ───────────────────────────────────────────────────────

export interface CsvToSqlOptions {
  /** Path to the output SQL file. If omitted, writes to stdout. */
  outputPath?: string;
  /** Force output to stdout even when outputPath is set. */
  toStdout?: boolean;
  /** If true, only validate — do not write SQL. */
  validateOnly?: boolean;
}

export interface CsvRow {
  [key: string]: string | undefined;
}

export interface ValidationResult {
  line: number;
  field: string;
  message: string;
  value: string;
}

export interface ExportResult {
  tickerRows: number;
  newsRows: number;
  sqlFile: string | null;
  validationErrors: number;
  validationTotal: number;
  validationDetails: ValidationResult[];
}

// ── CSV Parsing (no external deps) ────────────────────────────────────

/**
 * Parse a single CSV line into an object keyed by header.
 * Handles quoted fields (") and escaped quotes ("").
 */
function parseCsvLine(line: string, headers: readonly string[]): CsvRow {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());

  const row: CsvRow = {};
  for (let i = 0; i < headers.length; i++) {
    row[headers[i]!] = fields[i];
  }
  return row;
}

// ── Validation ────────────────────────────────────────────────────────

/**
 * Validate a parsed CSV row against expected schema.
 * Returns an array of validation errors (empty = valid).
 */
function validateRow(
  row: CsvRow,
  columns: readonly string[],
  numericColumns: Set<string>,
  lineNum: number,
): ValidationResult[] {
  const errors: ValidationResult[] = [];

  for (const col of columns) {
    const val = row[col];
    const isPresent = val !== undefined && val !== '';

    // Required fields that must be present
    const requiredFields = new Set(['run_id', 'ts_utc', 'symbol', 'chain']);

    if (!isPresent) {
      // Missing trailing columns are nullable (NULL) — only hard-error on required fields
      // but still log the missing field as a validation note
      if (requiredFields.has(col)) {
        errors.push({ line: lineNum, field: col, message: 'Missing required field', value: String(val) });
      }
      continue;
    }

    // Check numeric fields
    if (numericColumns.has(col)) {
      const num = Number(val);
      if (!Number.isFinite(num)) {
        errors.push({ line: lineNum, field: col, message: 'Expected numeric value', value: val });
      }
    }

    // Check 'chain' is a known value (ticker table)
    if (col === 'chain') {
      const known = ['solana', 'polygon', 'bnb', 'xrp', 'ethereum', 'bitcoin',
        'dogecoin', 'cardano', 'sui', 'aptos', 'sei', 'celestia',
        'injective', 'thorchain', 'cosmos', 'multi'];
      if (!known.includes(val.toLowerCase())) {
        errors.push({ line: lineNum, field: col, message: `Unknown chain: ${val}`, value: val });
      }
    }

    // Check 'symbol' is present and uppercase
    if (col === 'symbol') {
      if (!/^[A-Z0-9]+$/.test(val)) {
        errors.push({ line: lineNum, field: col, message: 'Symbol should be uppercase alphanumeric', value: val });
      }
    }
  }

  return errors;
}

// ── SQL Escaping ──────────────────────────────────────────────────────

/** Escape a string literal for SQLite (single-quote doubling). */
function sqlEscape(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

/** Format a value for SQL INSERT — numbers go raw, strings get quoted. */
function sqlValue(val: string, numeric: boolean): string {
  if (val === '' || val === undefined) return 'NULL';
  if (numeric) {
    const num = Number(val);
    return Number.isFinite(num) ? String(num) : 'NULL';
  }
  return sqlEscape(val);
}

// ── SQL Generation ───────────────────────────────────────────────────

function generateTickerTable(): string {
  const textCols = new Set(['run_id', 'ts_utc', 'date_et', 'symbol', 'chain', 'alerts', 'source']);
  const intCols = new Set(['count', 'openTime', 'closeTime']);
  const cols = TICKER_COLUMNS.map(c => {
    const sqlCol = toSqlCol(c);
    const required = new Set(['run_id', 'ts_utc', 'symbol', 'chain']);
    const notNull = required.has(c) ? ' NOT NULL' : '';
    let type = 'REAL';
    if (textCols.has(c)) type = 'TEXT';
    else if (intCols.has(c)) type = 'INTEGER';
    return `  ${sqlCol} ${type}${notNull}`;
  });
  return `CREATE TABLE IF NOT EXISTS radar_scans (\n${cols.join(',\n')}\n);`;
}

function generateNewsTable(): string {
  const cols = NEWS_COLUMNS.map(c => {
    const sqlCol = toSqlCol(c);
    const required = new Set(['run_id', 'ts_utc', 'symbol']);
    const notNull = required.has(c) ? ' NOT NULL' : '';
    const type = c === 'relevance' ? 'REAL' : 'TEXT';
    return `  ${sqlCol} ${type}${notNull}`;
  });
  return `CREATE TABLE IF NOT EXISTS radar_news (\n${cols.join(',\n')}\n);`;
}

/**
 * Map CSV column names to SQL column names (camelCase -> snake_case).
 */
function toSqlCol(csvCol: string): string {
  return csvCol
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase();
}

/**
 * Generate SQL INSERT INTO statements for a batch of parsed rows.
 */
function generateInserts(
  tableName: string,
  rows: CsvRow[],
  columns: readonly string[],
  numericColumns: Set<string>,
): string[] {
  if (rows.length === 0) return [];

  const sqlCols = columns.map(c => toSqlCol(c));
  const colList = sqlCols.join(', ');

  return rows.map(row => {
    const values = columns.map(col => {
      const val = row[col];
      return sqlValue(val ?? '', numericColumns.has(col));
    });
    return `INSERT INTO ${tableName} (${colList}) VALUES (${values.join(', ')});`;
  });
}

// ── File Exists Helper ────────────────────────────────────────────────

function tryReadFile(path: string): string | null {
  try {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
  } catch {
    // File not accessible — return null
  }
  return null;
}

// ── Main Export Function ─────────────────────────────────────────────

/**
 * Read radar CSV log files, validate the data, and generate
 * SQLite-compatible INSERT statements.
 *
 * @param options  Export options (output path, validation-only, etc.)
 * @returns        ExportResult with row counts, validation errors, and SQL file path
 */
export function exportCsvToSql(options: CsvToSqlOptions = {}): ExportResult {
  const config = loadConfig();
  const dataDir = resolve(config.dataDir);

  const tickerLog = resolve(dataDir, 'crypto-radar-log.csv');
  const newsLog = resolve(dataDir, 'crypto-radar-news.csv');

  const tickerContent = tryReadFile(tickerLog);
  const newsContent = tryReadFile(newsLog);

  // Parse ticker CSV
  const tickerRows: CsvRow[] = [];
  const newsRows: CsvRow[] = [];
  const allErrors: ValidationResult[] = [];

  if (tickerContent) {
    const lines = tickerContent.trim().split('\n');
    const rawHeader = lines[0];
    if (rawHeader) {
      const parsedHeader = rawHeader.split(',').map(h => h.trim());
      // Validate header matches expected columns
      for (let i = 0; i < Math.min(parsedHeader.length, TICKER_COLUMNS.length); i++) {
        if (parsedHeader[i] !== TICKER_COLUMNS[i]) {
          allErrors.push({
            line: 0,
            field: TICKER_COLUMNS[i]!,
            message: `Header mismatch at column ${i}: expected '${TICKER_COLUMNS[i]}', got '${parsedHeader[i]}'`,
            value: parsedHeader[i] ?? '',
          });
        }
      }

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trim() === '') continue;
        const row = parseCsvLine(line, TICKER_COLUMNS);
        const errors = validateRow(row, TICKER_COLUMNS, TICKER_NUMERIC_COLUMNS, i + 1);
        allErrors.push(...errors);
        tickerRows.push(row);
      }
    }
  } else {
    logger.error('[export-sqlite] Ticker CSV log not found — run a radar scan first');
  }

  // Parse news CSV
  if (newsContent) {
    const lines = newsContent.trim().split('\n');
    const rawHeader = lines[0];
    if (rawHeader) {
      const parsedHeader = rawHeader.split(',').map(h => h.trim());
      for (let i = 0; i < Math.min(parsedHeader.length, NEWS_COLUMNS.length); i++) {
        if (parsedHeader[i] !== NEWS_COLUMNS[i]) {
          allErrors.push({
            line: 0,
            field: NEWS_COLUMNS[i]!,
            message: `Header mismatch at column ${i}: expected '${NEWS_COLUMNS[i]}', got '${parsedHeader[i]}'`,
            value: parsedHeader[i] ?? '',
          });
        }
      }

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trim() === '') continue;
        const row = parseCsvLine(line, NEWS_COLUMNS);
        const errors = validateRow(row, NEWS_COLUMNS, NEWS_NUMERIC_COLUMNS, i + 1);
        allErrors.push(...errors);
        newsRows.push(row);
      }
    }
  } else {
    logger.error('[export-sqlite] News CSV log not found — run a radar scan with news enabled first');
  }

  const total = tickerRows.length + newsRows.length;
  const errCount = allErrors.length;

  // If validate-only, return early with error details
  if (options.validateOnly) {
    if (allErrors.length > 0) {
      for (const e of allErrors) {
        logger.error(`  [line ${e.line}] ${e.field}: ${e.message} (value: ${e.value})`);
      }
    }
    return {
      tickerRows: tickerRows.length,
      newsRows: newsRows.length,
      sqlFile: null,
      validationErrors: errCount,
      validationTotal: total,
      validationDetails: allErrors,
    };
  }

  // Generate SQL
  const sqlParts: string[] = [
    '-- Hermes Crypto Radar — SQLite Export',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Tickers: ${tickerRows.length} rows, News: ${newsRows.length} rows`,
    `-- Validation errors: ${allErrors.length}`,
    '',
    'BEGIN TRANSACTION;',
    '',
    generateTickerTable(),
    '',
    ...(tickerRows.length > 0
      ? ['-- Ticker data', ...generateInserts('radar_scans', tickerRows, TICKER_COLUMNS, TICKER_NUMERIC_COLUMNS), '']
      : ['-- No ticker data to export', '']),
    generateNewsTable(),
    '',
    ...(newsRows.length > 0
      ? ['-- News data', ...generateInserts('radar_news', newsRows, NEWS_COLUMNS, NEWS_NUMERIC_COLUMNS), '']
      : ['-- No news data to export', '']),
    'COMMIT;',
    '',
  ];

  const sql = sqlParts.join('\n');

  // Write to file or stdout
  let sqlFile: string | null = null;
  if (options.toStdout || !options.outputPath) {
    // Write to stdout — the caller should redirect
    process.stdout.write(sql);

    // If no output path given but we still want to report a file, write to default
    if (!options.outputPath) {
      sqlFile = null; // reported as stdout
    }
  } else {
    const outPath = resolve(options.outputPath);
    const dir = dirname(outPath);
    if (dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(outPath, sql, 'utf-8');
    sqlFile = outPath;
  }

  return {
    tickerRows: tickerRows.length,
    newsRows: newsRows.length,
    sqlFile,
    validationErrors: errCount,
    validationTotal: total,
    validationDetails: allErrors,
  };
}
