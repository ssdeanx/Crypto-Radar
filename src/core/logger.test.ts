// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Logger Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger } from './logger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.fn>;
  let stdoutSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stderrSpy = vi.fn();
    process.stderr.write = stderrSpy;
    stdoutSpy = vi.fn();
    process.stdout.write = stdoutSpy;
    // Reset logger to stdout mode, info level, json format
    logger.reset();
    logger.configure({ level: 'info', format: 'json' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes info messages to stderr in json format', () => {
    logger.info('test message');
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('test message');
    expect(output).toContain('"level":30');
  });

  it('respects log level filtering', () => {
    logger.configure({ level: 'error', format: 'json' });
    logger.info('should not appear');
    logger.error('should appear');
    const messages = stderrSpy.mock.calls.map(c => c[0] as string);
    expect(messages.some(m => m.includes('should appear'))).toBe(true);
    expect(messages.some(m => m.includes('should not appear'))).toBe(false);
  });

  it('writes to file when configured', () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'logger-test-'));
    const logFile = 'test.log';
    logger.configure({ level: 'info', logDir: tmpDir, logFile });

    logger.info('file message');
    const filePath = path.join(tmpDir, logFile);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('file message');

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('child logger adds bindings', () => {
    const child = logger.child({ runId: 'RUN-123' });
    child.info('child test');
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('child test');
    expect(output).toContain('"runId":"RUN-123"');
  });

  it('all log levels write to stderr', () => {
    logger.configure({ level: 'trace', format: 'json' });
    logger.trace('trace msg');
    logger.debug('debug msg');
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');
    logger.fatal('fatal msg');
    expect(stderrSpy).toHaveBeenCalledTimes(6);
  });

  it('writes in text format when configured', () => {
    logger.configure({ level: 'info', format: 'text' });
    logger.info('hello world');
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('[INFO ] hello world');
    expect(output).not.toContain('"level":');
  });

  it('text format includes extra fields', () => {
    logger.configure({ level: 'info', format: 'text' });
    logger.info('test', { symbol: 'SOL', signal: 'buy' });
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('[INFO ] test');
    expect(output).toContain('symbol="SOL"');
    expect(output).toContain('signal="buy"');
  });

  it('stdout method writes to process.stdout', () => {
    logger.stdout('tool output');
    expect(stdoutSpy).toHaveBeenCalledWith('tool output\n');
  });

  it('child logger inherits format setting', () => {
    logger.configure({ level: 'info', format: 'text' });
    const child = logger.child({ module: 'test' });
    child.info('child in text');
    const output = stderrSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('[INFO ] child in text');
    expect(output).toContain('module="test"');
  });
});
