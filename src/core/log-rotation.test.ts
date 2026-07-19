// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Log Rotation Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rotateLogFile, checkLogRotation } from './log-rotation.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Log Rotation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'log-rotation-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('does nothing if file does not exist', () => {
    expect(() => rotateLogFile(path.join(tmpDir, 'nonexistent.log'))).not.toThrow();
  });

  it('does nothing if file is below max size', () => {
    const fp = path.join(tmpDir, 'small.log');
    fs.writeFileSync(fp, 'small file content');
    expect(() => rotateLogFile(fp, { maxSizeBytes: 1_000_000 })).not.toThrow();
    expect(fs.existsSync(fp)).toBe(true);
  });

  it('rotates file when exceeding max size', () => {
    const fp = path.join(tmpDir, 'big.log');
    // Write enough data to exceed the tiny max size
    const content = 'x'.repeat(200);
    fs.writeFileSync(fp, content);

    rotateLogFile(fp, { maxSizeBytes: 50, maxArchives: 3 });
    // Original file should be truncated
    expect(fs.existsSync(fp)).toBe(true);
    // Archive should exist
    expect(fs.existsSync(fp + '.1.gz')).toBe(true);
  });

  it('rotates multiple times and shifts archives', () => {
    const fp = path.join(tmpDir, 'rolling.log');

    for (let round = 0; round < 3; round++) {
      const content = `round-${round}-data-` + 'x'.repeat(100);
      fs.writeFileSync(fp, content);
      rotateLogFile(fp, { maxSizeBytes: 50, maxArchives: 3 });
    }

    // Should have archives 1.gz, 2.gz, 3.gz
    expect(fs.existsSync(fp + '.1.gz')).toBe(true);
    expect(fs.existsSync(fp + '.2.gz')).toBe(true);
    // File should exist (truncated)
    expect(fs.existsSync(fp)).toBe(true);
  });

  it('checkLogRotation delegates to rotateLogFile', () => {
    const fp = path.join(tmpDir, 'check.log');
    fs.writeFileSync(fp, 'data'.repeat(50));
    expect(() => checkLogRotation(fp, { maxSizeBytes: 30 })).not.toThrow();
    expect(fs.existsSync(fp + '.1.gz')).toBe(true);
  });

  it('handles rotation errors gracefully', () => {
    // Very deeply nested path should not throw
    expect(() => rotateLogFile('/nonexistent/deep/path/file.log')).not.toThrow();
  });
});
