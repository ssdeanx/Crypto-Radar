// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Log Rotation
// ═══════════════════════════════════════════════════════════════════════

import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from './config.js';
import { logWarn } from './errors.js';

export interface LogRotationOptions {
  maxSizeBytes: number;
  maxArchives: number;
}

const DEFAULT_OPTIONS: LogRotationOptions = {
  maxSizeBytes: 10 * 1024 * 1024,
  maxArchives: 5,
};

/**
 * Rotate a log file when it exceeds the configured size threshold.
 * Compresses the current file to .1.gz and shifts existing archives.
 *
 * @param filePath Path to the log file
 * @param options Optional rotation settings (maxSizeBytes, maxArchives)
 */
export function rotateLogFile(
  filePath: string,
  options?: Partial<LogRotationOptions>,
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size < opts.maxSizeBytes) return;
    for (let i = opts.maxArchives - 1; i >= 1; i--) {
      const src = `${filePath}.${i}.gz`;
      const dst = `${filePath}.${i + 1}.gz`;
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
    const archive1 = `${filePath}.1.gz`;
    if (fs.existsSync(archive1)) {
      fs.renameSync(archive1, `${filePath}.2.gz`);
    }
    const content = fs.readFileSync(filePath);
    const compressed = zlib.gzipSync(content);
    fs.writeFileSync(archive1, compressed);
    fs.writeFileSync(filePath, '');
  } catch (err) {
    logWarn('log-rotation', `Failed to rotate ${filePath}`, err);
  }
}

/**
 * Convenience wrapper for rotateLogFile.
 * Delegates to rotateLogFile with the same signature.
 *
 * @param filePath Path to the log file
 * @param options Optional rotation settings
 */
export function checkLogRotation(
  filePath: string,
  options?: Partial<LogRotationOptions>,
): void {
  rotateLogFile(filePath, options);
}

// ── Data Retention Pruning ──

/**
 * Prune log files older than N days based on config.
 * Called before each log write.
 *
 * @param dataDir Directory containing log files to prune
 */
export function pruneOldLogs(dataDir: string): void {
  const config = loadConfig();
  const retentionDays = config.logRetentionDays ?? 0;
  if (retentionDays <= 0) return; // disabled

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const dir = path.resolve(dataDir);
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir);
  // Never prune the canonical accumulating datasets — they are meant to grow
  // indefinitely (rolling history), not be treated as disposable logs.
  const PROTECTED = new Set(['crypto-radar-log.csv', 'crypto-radar-news.csv']);
  for (const file of files) {
    if (!file.endsWith('.csv')) continue;
    if (PROTECTED.has(file)) continue;
    const fp = path.resolve(dir, file);
    try {
      const stats = fs.statSync(fp);
      if (stats.mtimeMs < cutoffMs) {
        // Also remove associated checksum file if present
        const shaPath = fp + '.sha256';
        if (fs.existsSync(shaPath)) fs.unlinkSync(shaPath);
        fs.unlinkSync(fp);
      }
    } catch { /* skip files we can't stat */ }
  }
}

// ── SHA-256 File Integrity Checksums ──

/**
 * Compute SHA-256 checksum of a file's contents.
 *
 * @param filePath Path to the file to checksum
 * @returns Hex-encoded SHA-256 checksum, or null on error
 */
export function computeFileChecksum(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Write data to a log file with an accompanying SHA-256 checksum file.
 * The checksum is stored at <filePath>.sha256 for independent verification.
 * Uses atomic write (tmp + rename) for the data file.
 *
 * @param filePath Path to the log file
 * @param data Data content to write
 */
export function writeLogWithChecksum(filePath: string, data: string): void {
  const checksum = createHash('sha256').update(data).digest('hex');
  const checksumPath = filePath + '.sha256';

  // Atomic write for data file
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);

  // Write checksum file
  fs.writeFileSync(checksumPath, checksum + '\n');
}

/**
 * Verify a log file against its checksum file.
 * Returns true if checksum matches or no checksum file exists
 * (backward compatibility with existing logs).
 *
 * @param filePath Path to the log file to verify
 * @returns True if checksum matches or no checksum file exists
 */
export function verifyLogChecksum(filePath: string): boolean {
  const checksumPath = filePath + '.sha256';
  if (!fs.existsSync(checksumPath)) return true; // no checksum to verify against

  try {
    const expected = fs.readFileSync(checksumPath, 'utf-8').trim();
    const actual = createHash('sha256').update(fs.readFileSync(filePath, 'utf-8')).digest('hex');
    return expected === actual;
  } catch {
    return false;
  }
}
