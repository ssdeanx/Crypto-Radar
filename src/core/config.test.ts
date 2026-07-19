// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Configuration Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resetConfig, writeDefaultConfig } from './config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Configuration', () => {
  let tmpDir: string;

  beforeEach(() => {
    resetConfig();
    tmpDir = mkdtempSync(path.join(tmpdir(), 'radar-test-'));
  });

  afterEach(() => {
    resetConfig();
    // Clean up temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('loads default config', () => {
    const config = loadConfig();
    expect(config.binanceBaseUrl).toBe('https://data-api.binance.vision');
    expect(config.fetchTimeoutMs).toBe(10_000);
    expect(config.maxRetries).toBe(3);
    expect(config.cacheTtlMs).toBe(300_000);
    expect(config.logLevel).toBe('info');
    expect(config.sources.binance).toBe(true);
    expect(config.sources.coinGecko).toBe(false);
    expect(config.indicatorPeriods.rsi).toBe(14);
  });

  it('uses cached instance on second call', () => {
    const config1 = loadConfig();
    const config2 = loadConfig();
    expect(config1).toBe(config2); // same instance
  });

  it('resetConfig clears cached instance', () => {
    const config1 = loadConfig();
    resetConfig();
    const config2 = loadConfig();
    expect(config1).not.toBe(config2);
  });

  it('merges file overrides', () => {
    const configPath = path.join(tmpDir, 'radar.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      fetchTimeoutMs: 5000,
      logLevel: 'debug',
      indicatorPeriods: { rsi: 7 },
    }));

    const config = loadConfig(configPath);
    expect(config.fetchTimeoutMs).toBe(5000);
    expect(config.logLevel).toBe('debug');
    // Nested merge
    expect(config.indicatorPeriods.rsi).toBe(7);
    // Default still applies
    expect(config.maxRetries).toBe(3);
  });

  it('applies environment overrides', () => {
    process.env['RADAR__LOG_LEVEL'] = 'warn';
    process.env['RADAR__CACHE_TTL_MS'] = '60000';

    const config = loadConfig();
    expect(config.logLevel).toBe('warn');
    expect(config.cacheTtlMs).toBe(60000);

    delete process.env['RADAR__LOG_LEVEL'];
    delete process.env['RADAR__CACHE_TTL_MS'];
  });

  it('handles missing config file gracefully by using defaults', () => {
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config.fetchTimeoutMs).toBe(10_000);
  });

  it('writeDefaultConfig creates correct file', () => {
    const fp = path.join(tmpDir, 'default-config.json');
    writeDefaultConfig(fp);
    expect(fs.existsSync(fp)).toBe(true);
    const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    expect(content.binanceBaseUrl).toBe('https://data-api.binance.vision');
    expect(content.dataDir).toBe('/data/crypto-radar');
  });
});
