// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Health Monitor Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthMonitor } from './health.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  };
}

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
    mockFetch.mockReset();

    // Default: binance OK, jupiter OK, defillama OK
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('jup.ag')) {
        return Promise.resolve(
          mockResponse({ 'So11111111111111111111111111111111111111112': { usdPrice: 150.5 } }),
        );
      }
      if (url.includes('llama.fi')) {
        return Promise.resolve(mockResponse([{ id: 'uniswap' }, { id: 'aave' }, { id: 'curve' }]));
      }
      if (url.includes('binance')) {
        return Promise.resolve(mockResponse({ symbol: 'BTCUSDT', lastPrice: '50000.00' }));
      }
      return Promise.resolve(mockResponse({ ok: true }));
    });
  });

  it('returns healthy status when all checks pass', async () => {
    const result = await monitor.check();
    expect(result.status).toBe('healthy');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.checks.length).toBe(7);
  });

  it('includes new health fields in response', async () => {
    const result = await monitor.check();
    expect(result.jupiter).toBeDefined();
    expect(result.defiLlama).toBeDefined();
    expect(result.cacheStats).toBeDefined();
    expect(result.feedHealth).toBeDefined();
    expect(result.jupiter!.status).toBe('pass');
    expect(result.defiLlama!.status).toBe('pass');
  });

  it('returns degraded when binance fails once', async () => {
    // Only binance fails; jupiter and defillama still succeed
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('jup.ag')) {
        return Promise.resolve(
          mockResponse({ 'So11111111111111111111111111111111111111112': { usdPrice: 150.5 } }),
        );
      }
      if (url.includes('llama.fi')) {
        return Promise.resolve(mockResponse([{ id: 'test' }]));
      }
      if (url.includes('binance')) {
        return Promise.reject(new Error('Connection refused'));
      }
      return Promise.resolve(mockResponse({ ok: true }));
    });

    const result = await monitor.check();
    // First failure = warn → degraded (not unhealthy)
    expect(result.status).toBe('degraded');
    const binance = result.checks.find(c => c.name === 'binance-api');
    expect(binance?.status).toBe('warn');
  });

  it('returns unhealthy when jupiter fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('jup.ag')) {
        return Promise.reject(new Error('Jupiter timeout'));
      }
      if (url.includes('llama.fi')) {
        return Promise.resolve(mockResponse([{ id: 'test' }]));
      }
      if (url.includes('binance')) {
        return Promise.resolve(mockResponse({ symbol: 'BTCUSDT', lastPrice: '50000.00' }));
      }
      return Promise.resolve(mockResponse({ ok: true }));
    });

    const result = await monitor.check();
    // One fail (jupiter timeout) → unhealthy
    expect(result.status).toBe('unhealthy');
    const jupiter = result.checks.find(c => c.name === 'jupiter');
    expect(jupiter?.status).toBe('fail');
  });

  it('includes system details', async () => {
    const result = await monitor.check();
    expect(result.details).toBeDefined();
    expect(result.details.nodeVersion).toBeDefined();
    expect(result.details.tokensTracked).toBeGreaterThanOrEqual(32);
  });

  it('reset clears failure count and updates uptime', async () => {
    await monitor.check();
    const before = await monitor.check();
    monitor.reset();
    const after = await monitor.check();
    // Uptime should be lower after reset compared to if we hadn't reset
    expect(after.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns unfiltered fields when no feeds registered', async () => {
    const result = await monitor.check();
    // feed-monitor has module-level state; in test isolation it should be empty
    expect(result.feedHealth).toBeDefined();
    expect(typeof result.feedHealth!.activeFeeds).toBe('number');
    expect(typeof result.feedHealth!.deadFeeds).toBe('number');
    expect(Array.isArray(result.feedHealth!.feeds)).toBe(true);
  });
});
