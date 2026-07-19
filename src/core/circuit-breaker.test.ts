// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Circuit Breaker Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed', () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.getFailureCount()).toBe(0);
  });

  it('calls function and returns result', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
    const result = await cb.call(async () => 'success');
    expect(result).toBe('success');
  });

  it('tracks failures and trips after threshold', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
    const failingFn = async () => { throw new Error('fail'); };

    for (let i = 0; i < 3; i++) {
      await expect(cb.call(failingFn)).rejects.toThrow('fail');
    }

    expect(cb.getState()).toBe('OPEN');
    expect(cb.getFailureCount()).toBe(3);
  });

  it('returns fallback when circuit is open and fallback provided', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 2, cooldownMs: 5000 });
    const failingFn = async () => { throw new Error('fail'); };

    await expect(cb.call(failingFn)).rejects.toThrow('fail');
    await expect(cb.call(failingFn)).rejects.toThrow('fail');

    // Circuit should be OPEN now
    const fallback = async () => 'fallback-result';
    const result = await cb.call(failingFn, fallback);
    expect(result).toBe('fallback-result');
  });

  it('transitions to HALF_OPEN after cooldown', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 2, cooldownMs: 1000 });
    const failingFn = async () => { throw new Error('fail'); };

    await expect(cb.call(failingFn)).rejects.toThrow('fail');
    await expect(cb.call(failingFn)).rejects.toThrow('fail');
    expect(cb.getState()).toBe('OPEN');

    // Advance past cooldown
    vi.advanceTimersByTime(1001);

    // getState should show HALF_OPEN now
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('resets to CLOSED after successful probe in HALF_OPEN', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 2, cooldownMs: 1000 });
    const failingFn = async () => { throw new Error('fail'); };

    await expect(cb.call(failingFn)).rejects.toThrow('fail');
    await expect(cb.call(failingFn)).rejects.toThrow('fail');
    expect(cb.getState()).toBe('OPEN');

    vi.advanceTimersByTime(1001);

    // Successful call should close circuit
    await cb.call(async () => 'ok');
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.getFailureCount()).toBe(0);
  });

  it('recordFailure increments counter', () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getFailureCount()).toBe(2);
    expect(cb.getState()).toBe('CLOSED');
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
  });

  it('reset clears state', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 2, cooldownMs: 1000 });
    const failingFn = async () => { throw new Error('fail'); };

    // Two sequential calls — both must execute to trip the breaker
    await cb.call(failingFn).catch(() => {});
    await cb.call(failingFn).catch(() => {});

    expect(cb.getState()).toBe('OPEN');
    cb.reset();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.getFailureCount()).toBe(0);
  });

  it('throws without fallback when open', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, cooldownMs: 5000 });
    await expect(cb.call(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    await expect(cb.call(async () => 'should not run')).rejects.toThrow('Circuit breaker "test" is OPEN');
  });
});
