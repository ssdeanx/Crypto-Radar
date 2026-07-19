// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Cache Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Cache } from './cache.js';

describe('Cache', () => {
  let cache: Cache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new Cache(1000); // 1s default TTL
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves values', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('returns undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('respects TTL expiry', () => {
    cache.set('key1', 'value1', 500);
    expect(cache.get('key1')).toBe('value1');
    vi.advanceTimersByTime(501);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('uses default TTL when not specified', () => {
    cache.set('key1', 'value1');
    vi.advanceTimersByTime(999);
    expect(cache.get('key1')).toBe('value1');
    vi.advanceTimersByTime(2);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('delete removes key', () => {
    cache.set('key1', 'value1');
    cache.delete('key1');
    expect(cache.get('key1')).toBeUndefined();
  });

  it('has returns true for fresh keys', () => {
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
  });

  it('has returns false for expired keys', () => {
    cache.set('key1', 'value1', 100);
    vi.advanceTimersByTime(101);
    expect(cache.has('key1')).toBe(false);
  });

  it('has returns false for missing keys', () => {
    expect(cache.has('nonexistent')).toBe(false);
  });

  it('clear removes all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('stats returns size and keys', () => {
    cache.set('x', 10);
    cache.set('y', 20);
    const s = cache.stats();
    expect(s.size).toBe(2);
    expect(s.keys).toContain('x');
    expect(s.keys).toContain('y');
  });

  it('stats purges expired entries', () => {
    cache.set('a', 1, 100);
    cache.set('b', 2, 10000);
    vi.advanceTimersByTime(150);
    const s = cache.stats();
    expect(s.size).toBe(1);
    expect(s.keys).toEqual(['b']);
  });

  it('memoize caches function results', async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    const memoized = cache.memoize(fn);

    expect(await memoized(5)).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);

    // Second call should use cache
    expect(await memoized(5)).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);

    // Different args should call function again
    expect(await memoized(10)).toBe(20);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('memoize respects custom key function', async () => {
    const fn = vi.fn(async (a: number, b: number) => a + b);
    const memoized = cache.memoize(fn, (a, b) => `${a}+${b}`);

    expect(await memoized(1, 2)).toBe(3);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await memoized(1, 2)).toBe(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stores complex objects', () => {
    const obj = { name: 'test', nested: { value: 42 } };
    cache.set('obj', obj);
    const retrieved = cache.get<typeof obj>('obj');
    expect(retrieved).toEqual(obj);
  });
});
