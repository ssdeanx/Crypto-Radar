// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Warm Daemon Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';

// ── Hoisted mocks ──

const mockHttp = vi.hoisted(() => ({ createServer: vi.fn() }));
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(), writeFileSync: vi.fn(), readFileSync: vi.fn(),
  unlinkSync: vi.fn(), mkdirSync: vi.fn(),
}));
const mockBinance = vi.hoisted(() => ({ fetchAllTickers: vi.fn(), fetchKlines: vi.fn() }));
const mockTokens = vi.hoisted(() => ({
  getTokenList: vi.fn(), getBinancePair: vi.fn(),
  getActiveTokenCount: vi.fn(), reloadTokenConfig: vi.fn(),
}));
const mockCacheModule = vi.hoisted(() => {
  class MockCacheClass {
    set = vi.fn(); get = vi.fn(); has = vi.fn(); clear = vi.fn();
    stats = vi.fn(() => ({ size: 0, keys: [] }));
  }
  const mockInstance = new MockCacheClass();
  return {
    Cache: MockCacheClass,
    getGlobalCache: vi.fn(() => mockInstance),
  };
});

vi.mock('node:http', () => mockHttp);
vi.mock('node:fs', () => mockFs);
vi.mock('./binance.js', () => mockBinance);
vi.mock('./tokens.js', () => mockTokens);
vi.mock('./core/cache.js', () => mockCacheModule);

// ── Module under test ──

import { isDaemonRunning, stopDaemon } from './daemon.js';

// ── Helpers ──

const originalKill = process.kill;
function mockResponse() {
  return { writeHead: vi.fn().mockReturnThis(), end: vi.fn(), setHeader: vi.fn() };
}

// ═══════════════════════════════════════════════════════════════════════
// isDaemonRunning
// ═══════════════════════════════════════════════════════════════════════

describe('isDaemonRunning', () => {
  beforeEach(() => { vi.clearAllMocks(); process.kill = vi.fn(); });
  afterEach(() => { process.kill = originalKill; });

  it('returns true when pid exists and process is alive', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('12345\n');
    (process.kill as ReturnType<typeof vi.fn>).mockReturnValue(true);
    expect(isDaemonRunning()).toBe(true);
  });

  it('returns false when pid file is missing', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(isDaemonRunning()).toBe(false);
  });

  it('returns false and cleans stale pid when process is dead', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('99999\n');
    (process.kill as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('ESRCH'); });
    expect(isDaemonRunning()).toBe(false);
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });

  it('returns false when pid file has invalid content', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('not-a-number\n');
    expect(isDaemonRunning()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// stopDaemon
// ═══════════════════════════════════════════════════════════════════════

describe('stopDaemon', () => {
  beforeEach(() => { vi.clearAllMocks(); process.kill = vi.fn(); });
  afterEach(() => { process.kill = originalKill; });

  it('sends SIGTERM when pid file exists', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('12345\n');
    (process.kill as ReturnType<typeof vi.fn>).mockReturnValue(true);
    expect(stopDaemon()).toBe(true);
    expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
  });

  it('returns false when no pid file', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(stopDaemon()).toBe(false);
  });

  it('returns false and cleans up when kill fails', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('12345\n');
    (process.kill as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('ESRCH'); });
    expect(stopDaemon()).toBe(false);
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Daemon start-up (Fastify-based)
// ═══════════════════════════════════════════════════════════════════════

describe('HTTP server', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    // We still need mockHttp.createServer to not throw, but Fastify manages its own server
    mockHttp.createServer.mockReturnValue({
      listen: vi.fn((...args: unknown[]) => {
        const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] as () => void : undefined;
        cb?.();
      }),
      close: vi.fn(),
      address: vi.fn(() => null),
      addListener: vi.fn(),
      emit: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
      listeners: vi.fn(() => []),
      eventNames: vi.fn(() => []),
      getMaxListeners: vi.fn(() => 10),
      setMaxListeners: vi.fn(),
      listenerCount: vi.fn(() => 0),
      prependListener: vi.fn(),
      prependOnceListener: vi.fn(),
      rawListeners: vi.fn(() => []),
    } as any);
    mockBinance.fetchAllTickers.mockResolvedValue(new Map([['SOLUSDT', { symbol: 'SOLUSDT', lastPrice: '150' }]]));
    mockBinance.fetchKlines.mockResolvedValue([]);
    mockTokens.getTokenList.mockReturnValue([]);
    mockTokens.getActiveTokenCount.mockReturnValue(42);
    mockFs.existsSync.mockReturnValue(false);

    const daemonMod = await import('./daemon.js');
    daemonMod.runDaemon();
    await vi.advanceTimersByTimeAsync(1000);
  });

  afterAll(() => { vi.useRealTimers(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('writes PID file on start', () => {
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('daemon.pid'), expect.any(String));
  });
});
