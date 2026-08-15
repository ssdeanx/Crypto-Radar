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

const mockCreateApp = vi.hoisted(() => vi.fn());
vi.mock('./api/fastify/app.js', () => ({ createApp: mockCreateApp }));

// ── Module under test ──

import { isDaemonRunning, stopDaemon } from './daemon.js';

// ── Helpers ──

const originalKill = process.kill;
// Removed unused mockResponse// ═══════════════════════════════════════════════════════════════════════
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
    // Mock createApp to return a mock Fastify that doesn't bind a real port
    mockCreateApp.mockResolvedValue({
      get: vi.fn(),
      post: vi.fn(),
      ready: vi.fn(() => Promise.resolve()),
      close: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
      addHook: vi.fn(),
      setNotFoundHandler: vi.fn(),
      setErrorHandler: vi.fn(),
      register: vi.fn(),
      decorate: vi.fn(),
      decorateReply: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn(), child: vi.fn() },
      server: {},
    } as never);
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

  it('skips PID file write in cloud mode', async () => {
    mockFs.writeFileSync.mockClear();
    process.env['K_SERVICE'] = 'crypto-radar';
    const { runDaemon } = await import('./daemon.js');
    
    // Call runDaemon which triggers writePid
    await runDaemon();
    
    expect(mockFs.writeFileSync).not.toHaveBeenCalledWith(expect.stringContaining('daemon.pid'), expect.any(String));
    
    delete process.env['K_SERVICE'];
  });
});
