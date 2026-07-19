// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Error Classes Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  CryptoRadarError,
  NetworkError,
  RateLimitError,
  DataError,
  ConfigError,
  CacheError,
  SignalError,
} from './errors.js';

describe('CryptoRadarError', () => {
  it('creates error with code and message', () => {
    const err = new CryptoRadarError('TEST_CODE', 'test message');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err.recoverable).toBe(false);
    expect(err.context).toBeUndefined();
  });

  it('accepts options', () => {
    const err = new CryptoRadarError('RECOVERABLE', 'something failed', {
      recoverable: true,
      context: { source: 'test' },
    });
    expect(err.recoverable).toBe(true);
    expect(err.context).toEqual({ source: 'test' });
  });
});

describe('NetworkError', () => {
  it('creates with source string', () => {
    const err = new NetworkError('binance', new Error('timeout'));
    expect(err).toBeInstanceOf(CryptoRadarError);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.recoverable).toBe(true);
    expect(err.message).toContain('binance');
    expect(err.message).toContain('timeout');
  });

  it('handles string cause', () => {
    const err = new NetworkError('coingecko', 'connection refused');
    expect(err.message).toContain('connection refused');
  });
});

describe('RateLimitError', () => {
  it('creates with retry time', () => {
    const err = new RateLimitError('binance', 5000);
    expect(err.code).toBe('RATE_LIMIT');
    expect(err.retryAfterMs).toBe(5000);
    expect(err.recoverable).toBe(true);
    expect(err.message).toContain('binance');
  });

  it('uses default retry time', () => {
    const err = new RateLimitError('coingecko');
    expect(err.retryAfterMs).toBe(10_000);
  });
});

describe('DataError', () => {
  it('creates with source and reason', () => {
    const err = new DataError('binance', 'invalid JSON');
    expect(err.code).toBe('DATA_ERROR');
    expect(err.recoverable).toBe(false);
    expect(err.message).toContain('binance');
    expect(err.message).toContain('invalid JSON');
  });
});

describe('ConfigError', () => {
  it('creates with key and message', () => {
    const err = new ConfigError('binanceBaseUrl', 'invalid URL');
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.recoverable).toBe(false);
    expect(err.message).toContain('binanceBaseUrl');
    expect(err.message).toContain('invalid URL');
  });
});

describe('CacheError', () => {
  it('creates with operation and reason', () => {
    const err = new CacheError('set', 'out of memory');
    expect(err.code).toBe('CACHE_ERROR');
    expect(err.recoverable).toBe(true);
    expect(err.message).toContain('set');
  });
});

describe('SignalError', () => {
  it('creates with strategy name and reason', () => {
    const err = new SignalError('momentum', 'insufficient data');
    expect(err.code).toBe('SIGNAL_ERROR');
    expect(err.recoverable).toBe(true);
    expect(err.message).toContain('momentum');
    expect(err.message).toContain('insufficient data');
  });
});
