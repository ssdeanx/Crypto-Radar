// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Rate Limiter Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with full tokens', () => {
    const rl = new RateLimiter(5, 1000);
    expect(rl.available()).toBe(5);
  });

  it('allows consumption within limits', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.available()).toBe(0);
  });

  it('blocks when tokens exhausted', () => {
    const rl = new RateLimiter(2, 1000);
    rl.tryConsume();
    rl.tryConsume();
    expect(rl.tryConsume()).toBe(false);
  });

  it('refills tokens after interval', () => {
    const rl = new RateLimiter(2, 1000);
    rl.tryConsume();
    rl.tryConsume();
    expect(rl.tryConsume()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(rl.available()).toBe(2);
    expect(rl.tryConsume()).toBe(true);
  });

  it('consumeOrWait returns 0 when tokens available', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.consumeOrWait()).toBe(0);
    expect(rl.available()).toBe(2);
  });

  it('consumeOrWait returns wait time when rate limited', () => {
    const rl = new RateLimiter(1, 1000);
    rl.tryConsume();
    const wait = rl.consumeOrWait();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(1000);
  });

  it('available returns correct count after mixed operations', () => {
    const rl = new RateLimiter(5, 2000);
    expect(rl.available()).toBe(5);
    rl.tryConsume();
    rl.tryConsume();
    expect(rl.available()).toBe(3);
  });

  it('handles zero tokens gracefully', () => {
    const rl = new RateLimiter(0, 1000);
    expect(rl.tryConsume()).toBe(false);
    expect(rl.available()).toBe(0);
  });
});
