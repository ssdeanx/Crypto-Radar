// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — CLI Unit Tests
// ═══════════════════════════════════════════════════════════════════════
//
// Pure unit tests using vi.mock to intercept all external dependencies.
// Each test sets process.argv to the desired command + args, then
// dynamically imports cli.ts so that program.parse() fires the
// corresponding action handler against mocked modules.
//
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════
// Hoisted mocks — these are hoisted before any imports so vi.mock() can
// reference them. We define every module that cli.ts imports.
// ═══════════════════════════════════════════════════════════════════════

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  copyFileSync: vi.fn(),
  promises: {
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
}));

const mockPath = vi.hoisted(() => ({
  join: (...args: string[]) => args.join('/'),
  resolve: (...args: string[]) => args.join('/'),
  basename: (p: string) => {
    const parts = p.split('/');
    return parts[parts.length - 1] ?? p;
  },
  dirname: (p: string) => {
    const parts = p.split('/');
    return parts.slice(0, -1).join('/') || '.';
  },
  sep: '/',
}));

const mockRadar = vi.hoisted(() => ({
  runRadar: vi.fn(),
  displayRadar: vi.fn(),
}));

const mockTokens = vi.hoisted(() => ({
  getTokenList: vi.fn(),
  getTopTokensByVolume: vi.fn(),
  getBinancePair: vi.fn((t: { pair?: string; sym: string }) => t.pair ?? `${t.sym}USDT`),
}));

const mockBinance = vi.hoisted(() => ({
  fetchKlines: vi.fn(),
}));

const mockCharts = vi.hoisted(() => ({
  priceSparkline: vi.fn(() => '▁▂▃▄▅▆▇█ sparkline'),
  multiMaSparkline: vi.fn(() => '▁▂▃▄▅▆▇█ MA'),
  priceSvgChart: vi.fn(() => '<svg viewBox="0 0 800 400">price</svg>'),
  multiPanelSvgChart: vi.fn(() => '<svg viewBox="0 0 800 600">dashboard</svg>'),
  candlestickSvgChart: vi.fn(() => '<svg viewBox="0 0 800 480">candlestick</svg>'),
}));

// HealthMonitor is a class mock
const mockHealthMonitorInstance = vi.hoisted(() => ({
  check: vi.fn(),
}));

const mockHealth = vi.hoisted(() => ({
  HealthMonitor: function HealthMonitor() { return mockHealthMonitorInstance; },
}));

const mockConfig = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  writeDefaultConfig: vi.fn(),
  resetConfig: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    stdout: vi.fn(),
    child: vi.fn(() => mockLogger.logger),
  },
}));

const mockStrategyEngineInstance = vi.hoisted(() => ({
  getStrategyInfo: vi.fn(),
}));

const mockStrategyEngine = vi.hoisted(() => ({
  StrategyEngine: vi.fn(function StrategyEngine() { return mockStrategyEngineInstance; }),
}));

const mockDaemon = vi.hoisted(() => ({
  runDaemon: vi.fn(),
  isDaemonRunning: vi.fn(),
  stopDaemon: vi.fn(),
}));

const mockBacktest = vi.hoisted(() => ({
  runBacktest: vi.fn(),
  formatBacktest: vi.fn(() => 'Backtest Results\n...'),
}));

const mockRegime = vi.hoisted(() => ({
  detectRegime: vi.fn(() => ({
    regime: 'trending',
    confidence: 0.85,
    indicators: { adx: 30, bbWidth: 0.05, atrPct: 0.02, volRatio: 1.2 },
  })),
  getRegimeWeights: vi.fn(() => ({
    momentum: 0.4,
    meanReversion: 0.2,
    trendFollowing: 0.4,
    positionSize: 0.5,
  })),
  formatRegime: vi.fn(() => '📊 Market Regime: TRENDING\n   Confidence: 85%\n   ADX: 30.0'),
}));

const mockCorrelation = vi.hoisted(() => ({
  computeCorrelationMatrix: vi.fn(() => ({
    symbols: ['SOL', 'BTC', 'ETH'],
    matrix: [[1, 0.5, 0.3], [0.5, 1, 0.4], [0.3, 0.4, 1]],
    timestamps: ['2026-07-12T00:00:00Z'],
  })),
  findTopCorrelations: vi.fn(() => [
    { symbolA: 'SOL', symbolB: 'BTC', correlation: 0.5 },
    { symbolA: 'SOL', symbolB: 'ETH', correlation: 0.3 },
  ]),
  formatCorrelationTable: vi.fn(() => 'Correlation Matrix\n...'),
}));

const mockIndicators = vi.hoisted(() => ({
  computeADX: vi.fn(() => 25),
  computeBB: vi.fn(() => ({
    upper: 110, middle: 100, lower: 90, width: 20, pctWidth: 0.2,
  })),
  computeATR: vi.fn(() => 0.02),
  computeVolVsAvg: vi.fn(() => 0.1),
}));

const mockBenchmark = vi.hoisted(() => ({
  runBenchmark: vi.fn(() => ({
    scanMs: 150,
    indicatorMs: 75,
    totalMs: 300,
    tokens: 30,
  })),
  formatBenchmark: vi.fn(() => 'Benchmark Results\n...'),
  runBenchmarkMedian: vi.fn(),
}));

const mockSqliteExport = vi.hoisted(() => ({
  exportCsvToSql: vi.fn(() => ({
    tickerRows: 100,
    newsRows: 25,
    sqlFile: 'export.sql',
    validationErrors: 0,
    validationTotal: 125,
  })),
}));

const mockCollector = vi.hoisted(() => ({
  runCollector: vi.fn(() => ({
    klinesInserted: 1000,
    fundingInserted: 50,
    oiInserted: 25,
    lsInserted: 10,
    liquidationsInserted: 5,
    fearGreedInserted: 7,
    orderBookInserted: 0,
    crossAssetInserted: 0,
    durationMs: 5000,
    errors: [],
  })),
}));

const mockPdfExport = vi.hoisted(() => ({
  generateHtmlReport: vi.fn(() => '<!DOCTYPE html><html><body>Report</body></html>'),
  generateSignalSnapshot: vi.fn(() => '<!DOCTYPE html><html><body>Snapshot</body></html>'),
}));

const mockOutput = vi.hoisted(() => ({
  validateOutput: vi.fn(() => []),
  toJSONLine: vi.fn((obj: unknown) => JSON.stringify(obj)),
}));

const mockStoreInstance = vi.hoisted(() => ({
  migrate: vi.fn(),
  stats: vi.fn(() => ({ tickers: 500, klines: 10000, predictions: 50 })),
  getPredictions: vi.fn(() => []),
  getKlines: vi.fn(() => []),
  getCrossAsset: vi.fn(() => []),
  getFunding: vi.fn(() => []),
  close: vi.fn(),
}));

const mockStore = vi.hoisted(() => ({
  Store: {
    open: vi.fn(() => mockStoreInstance),
  },
}));

const mockPredict = vi.hoisted(() => ({
  batchPredict: vi.fn(() => []),
  persistPredictions: vi.fn(),
}));

// ═══════════════════════════════════════════════════════════════════════
// Module-level mocks
// ═══════════════════════════════════════════════════════════════════════

vi.mock('node:fs', () => mockFs);
vi.mock('node:path', () => mockPath);
vi.mock('./radar.js', () => mockRadar);
vi.mock('./tokens.js', () => mockTokens);
vi.mock('./binance.js', () => mockBinance);
vi.mock('./io/charts.js', () => mockCharts);
vi.mock('./monitor/health.js', () => mockHealth);
vi.mock('./core/config.js', () => mockConfig);
vi.mock('./core/logger.js', () => mockLogger);
vi.mock('./analysis/engine.js', () => mockStrategyEngine);
vi.mock('./daemon.js', () => mockDaemon);
vi.mock('./backtest.js', () => mockBacktest);
vi.mock('./analysis/regime.js', () => mockRegime);
vi.mock('./analysis/correlation.js', () => mockCorrelation);
vi.mock('./indicators.js', () => mockIndicators);
vi.mock('./core/benchmark.js', () => mockBenchmark);
vi.mock('./sqlite-export.js', () => mockSqliteExport);
vi.mock('./collector.js', () => mockCollector);
vi.mock('./pdf-export.js', () => mockPdfExport);
vi.mock('./output.js', () => mockOutput);
vi.mock('./store/db.js', () => mockStore);
vi.mock('./ml/predict.js', () => mockPredict);

// ═══════════════════════════════════════════════════════════════════════
// Shared test data
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_RESULT = {
  tickers: [
    {
      symbol: 'SOL', lastPrice: 150, priceChangePercent: 2.5,
      volume: 5_000_000, quoteVolume: 750_000_000,
      high: 152, low: 148,
    },
    {
      symbol: 'BTC', lastPrice: 50000, priceChangePercent: 1.2,
      volume: 10_000_000, quoteVolume: 500_000_000_000,
      high: 50500, low: 49500,
    },
  ],
  technicals: new Map(),
  newsMatches: [],
  signals: [],
  aggregatedSignals: [
    { symbol: 'SOL', direction: 'BUY', confidence: 0.8, source: 'momentum', signal: 'strong_buy' },
    { symbol: 'BTC', direction: 'SELL', confidence: 0.6, source: 'mean_reversion', signal: 'weak_sell' },
  ],
  onchain: null,
  run: {
    runId: 'RADAR-UNIT-TEST',
    tsUtc: '2026-07-12T12:00:00Z',
    numTokens: 2,
    numSignals: 2,
    durationMs: 423,
  },
};

const SOL_TOKEN = {
  id: 'solana', sym: 'SOL', name: 'Solana',
  chain: 'solana' as const, pair: 'SOLUSDT', coingeckoId: 'solana',
};

const BTC_TOKEN = {
  id: 'bitcoin', sym: 'BTC', name: 'Bitcoin',
  chain: 'bitcoin' as const, pair: 'BTCUSDT', coingeckoId: 'bitcoin',
};

const ETH_TOKEN = {
  id: 'ethereum', sym: 'ETH', name: 'Ethereum',
  chain: 'ethereum' as const, pair: 'ETHUSDT', coingeckoId: 'ethereum',
};

const MOCK_KLINES = Array.from({ length: 100 }, (_, i) => ({
  openTime: i * 3600000,
  open: 100 + Math.sin(i * 0.1) * 10,
  high: 110 + Math.sin(i * 0.1) * 10,
  low: 90 + Math.sin(i * 0.1) * 10,
  close: 105 + Math.sin(i * 0.1) * 10,
  volume: 1000 + Math.random() * 500,
  closeTime: (i + 1) * 3600000 - 1,
}));

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

let originalArgv: string[];
let exitSpy: ReturnType<typeof vi.spyOn>;
let exitCodes: number[];

// Helpers to assert against the mocked logger (cli.ts uses the structured
// logger from core/logger.js instead of console.log/console.error).
function loggerStdoutCalls(): string[] {
  return mockLogger.logger.stdout.mock.calls.map(c => String(c[0] ?? ''));
}
function loggerInfoCalls(): string[] {
  return mockLogger.logger.info.mock.calls.map(c => String(c[0] ?? ''));
}
function loggerErrorCalls(): string[] {
  return mockLogger.logger.error.mock.calls.map(c => String(c[0] ?? ''));
}

/**
 * Set process.argv for the target command, reset the module registry,
 * and dynamically import cli.ts so that program.parse() fires.
 * All external deps are mocked so no real I/O or network occurs.
 *
 * NOTE: Commander v15's parse() does NOT await async action handlers.
 * It attaches .catch() and returns synchronously, so import() always
 * resolves. We spy on process.exit (no-op) and use a microtask delay
 * after import to let Commander's async handlers flush.
 */
async function runCommand(args: string[]): Promise<void> {
  process.argv = ['node', 'cli.ts', ...args];

  vi.resetModules();
  await import('./cli.ts');

  // Allow Commander's async action handler .catch() to fire,
  // and any process.exit calls inside error handlers to resolve.
  await new Promise(resolve => setTimeout(resolve, 50));
}

beforeEach(() => {
  originalArgv = process.argv;

  // Spy on process.exit to record calls without throwing.
  // Commander v15 catches async handler rejections and calls process.exit,
  // so a throwing spy would cause cascading errors through Commander's
  // internal catch/exit cycle. A silent spy avoids this.
  exitCodes = [];
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    exitCodes.push(Number(code ?? 0));
  });

  // Default mock config returns a valid config
  mockConfig.loadConfig.mockReturnValue({
    dataDir: '/tmp/test-radar-data',
    binanceBaseUrl: 'https://api.binance.com',
    fetchTimeoutMs: 10000,
    maxRetries: 3,
    cacheTtlMs: 300000,
    rateLimitMax: 100,
    rateLimitWindowMs: 60000,
    logLevel: 'info',
    ml: { enabled: true },
  });

  // Default mock radar result
  mockRadar.runRadar.mockResolvedValue(DEFAULT_RESULT);
  mockRadar.displayRadar.mockResolvedValue(JSON.stringify(DEFAULT_RESULT, null, 2));

  // Default mock token list
  mockTokens.getTokenList.mockReturnValue([SOL_TOKEN, BTC_TOKEN, ETH_TOKEN]);
  mockTokens.getTopTokensByVolume.mockResolvedValue([SOL_TOKEN, BTC_TOKEN]);

  // Default mock klines
  mockBinance.fetchKlines.mockResolvedValue(MOCK_KLINES);

  // Default mock health
  mockHealthMonitorInstance.check.mockResolvedValue({
    status: 'healthy',
    uptime: 3600,
    checks: [
      { name: 'binance-api', status: 'pass', latencyMs: 120, message: 'API reachable' },
      { name: 'data-dir', status: 'pass', latencyMs: 2, message: 'Writable' },
    ],
    cacheStats: { entries: 150, hitRate: 87, memoryEstimate: 45056 },
    feedHealth: {
      feeds: [
        { name: 'coindesk', status: 'healthy', consecutiveFailures: 0 },
      ],
    },
    details: { version: '2.0.0' },
  });

  // Default mock strategy info
  mockStrategyEngineInstance.getStrategyInfo.mockReturnValue({
    strategies: [
      {
        name: 'Momentum',
        description: 'Trend momentum strategy',
        timeframe: '1h',
        weight: 0.4,
      },
      {
        name: 'Mean-Reversion',
        description: 'Mean reversion strategy',
        timeframe: '4h',
        weight: 0.3,
      },
    ],
    marketState: { volatility: 'medium', trend: 'mixed' },
  });

  // Default mock fs.existsSync returns false (files don't exist)
  mockFs.existsSync.mockReturnValue(false);
  mockFs.mkdirSync.mockReturnValue(undefined);

  // Default mock export
  mockSqliteExport.exportCsvToSql.mockReturnValue({
    tickerRows: 100,
    newsRows: 25,
    sqlFile: 'export.sql',
    validationErrors: 0,
    validationTotal: 125,
  });

  // Default mock validate
  mockOutput.validateOutput.mockReturnValue([]);
});

afterEach(() => {
  process.argv = originalArgv;
  exitSpy?.mockRestore();
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — scan command
// ═══════════════════════════════════════════════════════════════════════

describe('scan command', () => {
  it('runs default scan with auto-dynamic token selection', async () => {
    await runCommand(['scan']);

    expect(mockTokens.getTopTokensByVolume).toHaveBeenCalledWith(30);
    expect(mockRadar.runRadar).toHaveBeenCalledTimes(1);
    expect(mockRadar.displayRadar).toHaveBeenCalled();
    expect(mockLogger.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[done]'),
    );
  });

  it('passes --filter symbols to runRadar', async () => {
    await runCommand(['scan', '--filter', 'SOL', 'BTC']);

    expect(mockTokens.getTopTokensByVolume).not.toHaveBeenCalled();
    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: ['SOL', 'BTC'],
      }),
    );
  });

  it('uses --dynamic N to override auto-dynamic count', async () => {
    await runCommand(['scan', '--dynamic', '10']);

    expect(mockTokens.getTopTokensByVolume).toHaveBeenCalledWith(10);
  });

  it('uses DEFAULT_TOP_N=30 when no --filter and no --dynamic', async () => {
    await runCommand(['scan']);

    expect(mockTokens.getTopTokensByVolume).toHaveBeenCalledWith(30);
  });

  it('uses DYNAMIC_FLAG_TOP_N=50 when bare --dynamic is passed', async () => {
    await runCommand(['scan', '--dynamic']);

    expect(mockTokens.getTopTokensByVolume).toHaveBeenCalledWith(50);
  });

  it('passes --chain option', async () => {
    await runCommand(['scan', '--chain', 'solana', '--filter', 'SOL']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ chain: 'solana' }),
    );
  });

  it('passes --sort option', async () => {
    await runCommand(['scan', '--sort', 'volume', '--filter', 'SOL']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'volume' }),
    );
  });

  it('passes --format option', async () => {
    await runCommand(['scan', '--format', 'json', '--filter', 'SOL']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'json' }),
    );
  });

  it('passes --quiet flag', async () => {
    await runCommand(['scan', '--quiet', '--filter', 'SOL']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ quiet: true }),
    );
  });

  it('passes --no-tech to skip technicals', async () => {
    await runCommand(['scan', '--no-tech', '--filter', 'SOL']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ includeTech: false }),
    );
  });

  it('passes --no-news to skip news', async () => {
    await runCommand(['scan', '--no-news', '--filter', 'SOL']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ includeNews: false }),
    );
  });

  it('passes --onchain flag', async () => {
    await runCommand(['scan', '--onchain', '--filter', 'SOL']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ includeOnchain: true }),
    );
  });

  it('passes --period option', async () => {
    await runCommand(['scan', '--period', '4h', '--filter', 'SOL']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ period: '4h' }),
    );
  });

  it('handles auto-dynamic fetch failure gracefully', async () => {
    mockTokens.getTopTokensByVolume.mockRejectedValue(new Error('API down'));

    await runCommand(['scan']);

    expect(mockLogger.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch top tokens'),
    );
    expect(mockRadar.runRadar).toHaveBeenCalled();
  });

  it('handles scan runtime error by exiting with code 1', async () => {
    mockRadar.runRadar.mockRejectedValue(new Error('Scan crashed'));

    await runCommand(['scan']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — chart command
// ═══════════════════════════════════════════════════════════════════════

describe('chart command', () => {
  it('generates default sparkline chart for a valid token', async () => {
    await runCommand(['chart', 'SOL']);

    expect(mockTokens.getTokenList).toHaveBeenCalled();
    expect(mockBinance.fetchKlines).toHaveBeenCalledWith('SOLUSDT', '1h', 100);
    expect(mockCharts.priceSparkline).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(expect.stringContaining('SOL Price'));
  });

  it('generates MA chart with --type ma', async () => {
    await runCommand(['chart', 'BTC', '--type', 'ma']);

    expect(mockCharts.multiMaSparkline).toHaveBeenCalled();
  });

  it('generates SVG chart with --type svg', async () => {
    await runCommand(['chart', 'ETH', '--type', 'svg']);

    expect(mockCharts.priceSvgChart).toHaveBeenCalled();
  });

  it('generates dashboard with --type dashboard', async () => {
    await runCommand(['chart', 'SOL', '--type', 'dashboard']);

    expect(mockCharts.multiPanelSvgChart).toHaveBeenCalled();
  });

  it('generates candlestick chart with --type candlestick', async () => {
    await runCommand(['chart', 'BTC', '--type', 'candlestick']);

    expect(mockCharts.candlestickSvgChart).toHaveBeenCalled();
  });

  it('generates watermark demo with --type watermark', async () => {
    await runCommand(['chart', 'SOL', '--type', 'watermark']);

    expect(mockCharts.priceSvgChart).toHaveBeenCalled();
  });

  it('passes --period and --lookback to fetchKlines', async () => {
    await runCommand(['chart', 'SOL', '--period', '4h', '--lookback', '50']);

    expect(mockBinance.fetchKlines).toHaveBeenCalledWith('SOLUSDT', '4h', 50);
  });

  it('passes --width for SVG charts', async () => {
    await runCommand(['chart', 'SOL', '--type', 'svg', '--width', '1200']);

    expect(mockCharts.priceSvgChart).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      1200,
    );
  });

  it('errors when token is not in token list', async () => {
    await runCommand(['chart', 'UNKNOWN']);
    expect(exitCodes).toContain(1);
  });

  it('errors when token not found in token list', async () => {
    mockTokens.getTokenList.mockReturnValue([SOL_TOKEN]);
    await runCommand(['chart', 'NONEXIST']);
    expect(exitCodes).toContain(1);
  });

  it('errors when klines fetch returns empty array', async () => {
    mockBinance.fetchKlines.mockResolvedValue([]);

    await runCommand(['chart', 'SOL']);
    expect(exitCodes).toContain(1);
  });

  it('errors on chart generation failure', async () => {
    mockBinance.fetchKlines.mockRejectedValue(new Error('Binance down'));

    await runCommand(['chart', 'SOL']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — strategies command
// ═══════════════════════════════════════════════════════════════════════

describe('strategies command', () => {
  it('lists available strategies', async () => {
    await runCommand(['strategies']);

    expect(mockStrategyEngine.StrategyEngine).toHaveBeenCalled();
    expect(mockStrategyEngineInstance.getStrategyInfo).toHaveBeenCalled();
  });

  it('works with alias "strat"', async () => {
    await runCommand(['strat']);

    expect(mockStrategyEngineInstance.getStrategyInfo).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — tokens command
// ═══════════════════════════════════════════════════════════════════════

describe('tokens command', () => {
  it('lists all tracked tokens', async () => {
    await runCommand(['tokens']);

    expect(mockTokens.getTokenList).toHaveBeenCalled();
  });

  it('filters tokens by --chain', async () => {
    await runCommand(['tokens', '--chain', 'solana']);

    expect(mockTokens.getTokenList).toHaveBeenCalled();
  });

  it('handles empty chain filter gracefully', async () => {
    mockTokens.getTokenList.mockReturnValue([]);

    await runCommand(['tokens', '--chain', 'nonexistent']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — search command
// ═══════════════════════════════════════════════════════════════════════

describe('search command', () => {
  it('searches tokens by exact symbol match', async () => {
    await runCommand(['search', 'SOL']);

    expect(mockLogger.logger.stdout).toHaveBeenCalled();
  });

  it('outputs JSON with --json flag', async () => {
    await runCommand(['search', 'BTC', '--json']);

    const jsonCalls = mockLogger.logger.stdout.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('['),
    );
    expect(jsonCalls.length).toBeGreaterThan(0);
    const parsed = JSON.parse(jsonCalls[0][0] as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty('symbol');
    expect(parsed[0]).toHaveProperty('score');
    expect(parsed[0]).toHaveProperty('matchField');
  });

  it('respects --limit option', async () => {
    await runCommand(['search', 'SOL', '--limit', '5']);
    expect(mockLogger.logger.stdout).toHaveBeenCalled();
  });

  it('shows "no tokens matching" for unmatched queries', async () => {
    await runCommand(['search', 'ZZZZNOTFOUND']);

    expect(mockLogger.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('No tokens matching'),
    );
  });

  it('handles fuzzy matching for partial queries', async () => {
    await runCommand(['search', 'ola']);

    expect(mockLogger.logger.stdout).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — signals command
// ═══════════════════════════════════════════════════════════════════════

describe('signals command', () => {
  it('generates composite signals', async () => {
    await runCommand(['signals']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'signal' }),
    );
    expect(mockRadar.displayRadar).toHaveBeenCalled();
  });

  it('passes --filter to runRadar', async () => {
    await runCommand(['signals', '--filter', 'SOL']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ filter: ['SOL'] }),
    );
  });

  it('passes --format option', async () => {
    await runCommand(['signals', '--format', 'json']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'json' }),
    );
  });

  it('handles signal generation failure', async () => {
    mockRadar.runRadar.mockRejectedValue(new Error('Signal error'));

    await runCommand(['signals']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — news command
// ═══════════════════════════════════════════════════════════════════════

describe('news command', () => {
  it('fetches and displays news', async () => {
    await runCommand(['news']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ includeTech: false }),
    );
    expect(mockRadar.displayRadar).toHaveBeenCalled();
  });

  it('passes --filter option', async () => {
    await runCommand(['news', '--filter', 'BTC']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ filter: ['BTC'] }),
    );
  });

  it('handles news fetch failure', async () => {
    mockRadar.runRadar.mockRejectedValue(new Error('News error'));

    await runCommand(['news']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — health command
// ═══════════════════════════════════════════════════════════════════════

describe('health command', () => {
  it('runs health checks and displays results', async () => {
    await runCommand(['health']);

    expect(mockHealthMonitorInstance.check).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(expect.stringContaining('HEALTHY'));
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(expect.stringContaining('binance-api'));
    // Check Details: is logged somewhere
    expect(mockLogger.logger.stdout.mock.calls.some(call =>
      typeof call[0] === 'string' && call[0].includes('Details:'),
    )).toBe(true);
  });

  it('shows degraded status when checks report warn', async () => {
    mockHealthMonitorInstance.check.mockResolvedValue({
      status: 'degraded',
      uptime: 3600,
      checks: [
        { name: 'binance-api', status: 'warn', latencyMs: 5000, message: 'Slow response' },
      ],
      cacheStats: { entries: 150, hitRate: 87, memoryEstimate: 45056 },
      feedHealth: {
        feeds: [
          { name: 'coindesk', status: 'healthy', consecutiveFailures: 0 },
        ],
      },
      details: { version: '2.0.0' },
    });

    await runCommand(['health']);

    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(expect.stringContaining('DEGRADED'));
  });

  it('shows failing status when critical check fails', async () => {
    mockHealthMonitorInstance.check.mockResolvedValue({
      status: 'fail',
      uptime: 300,
      checks: [
        { name: 'binance-api', status: 'fail', latencyMs: 0, message: 'Unreachable' },
      ],
      cacheStats: null,
      feedHealth: null,
      details: { error: 'Connection refused' },
    });

    await runCommand(['health']);

    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(expect.stringContaining('FAIL'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — configure command
// ═══════════════════════════════════════════════════════════════════════

describe('configure command', () => {
  it('generates default config with --generate', async () => {
    await runCommand(['configure', '--generate']);

    expect(mockConfig.writeDefaultConfig).toHaveBeenCalledWith('radar.config.json');
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(
      expect.stringContaining('Generated radar.config.json'),
    );
  });

  it('shows current config with --show', async () => {
    await runCommand(['configure', '--show']);

    expect(mockConfig.loadConfig).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(
      expect.stringContaining('dataDir'),
    );
  });

  it('shows usage when no flags given', async () => {
    await runCommand(['configure']);

    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(
      expect.stringContaining('Usage'),
    );
  });

  it('works with alias "config"', async () => {
    await runCommand(['config', '--show']);

    expect(mockConfig.loadConfig).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — export-sqlite command
// ═══════════════════════════════════════════════════════════════════════

describe('export-sqlite command', () => {
  it('exports CSV to SQL stdout by default', async () => {
    await runCommand(['export-sqlite']);

    expect(mockSqliteExport.exportCsvToSql).toHaveBeenCalledWith(
      expect.objectContaining({
        toStdout: true,
        validateOnly: false,
      }),
    );
    expect(mockLogger.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Exported 100 ticker rows'),
    );
  });

  it('writes to file with --output', async () => {
    await runCommand(['export-sqlite', '--output', '/tmp/export.sql']);

    expect(mockSqliteExport.exportCsvToSql).toHaveBeenCalledWith(
      expect.objectContaining({
        outputPath: '/tmp/export.sql',
        toStdout: false,
      }),
    );
  });

  it('supports --validate-only mode', async () => {
    mockSqliteExport.exportCsvToSql.mockReturnValue({
      tickerRows: 0,
      newsRows: 0,
      sqlFile: undefined,
      validationErrors: 3,
      validationTotal: 125,
    });

    await runCommand(['export-sqlite', '--validate-only']);

    expect(mockSqliteExport.exportCsvToSql).toHaveBeenCalledWith(
      expect.objectContaining({ validateOnly: true }),
    );
    expect(mockLogger.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Validation: 3 errors'),
    );
  });

  it('works with alias "export-db"', async () => {
    await runCommand(['export-db']);

    expect(mockSqliteExport.exportCsvToSql).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — regime command
// ═══════════════════════════════════════════════════════════════════════

describe('regime command', () => {
  it('detects market regime for a valid token', async () => {
    await runCommand(['regime', 'SOL']);

    expect(mockTokens.getTokenList).toHaveBeenCalled();
    expect(mockBinance.fetchKlines).toHaveBeenCalledWith('SOLUSDT', '1h', 200);
    expect(mockIndicators.computeADX).toHaveBeenCalled();
    expect(mockIndicators.computeBB).toHaveBeenCalled();
    expect(mockRegime.detectRegime).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(
      expect.stringContaining('Market Regime'),
    );
  });

  it('passes --period and --lookback', async () => {
    await runCommand(['regime', 'BTC', '--period', '4h', '--lookback', '100']);

    expect(mockBinance.fetchKlines).toHaveBeenCalledWith('BTCUSDT', '4h', 100);
  });

  it('shows regime weights with --weights', async () => {
    await runCommand(['regime', 'SOL', '--weights']);

    expect(mockRegime.getRegimeWeights).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(
      expect.stringContaining('Regime-Adapted Strategy Weights'),
    );
  });

  it('errors on unknown token', async () => {
    await runCommand(['regime', 'UNKNOWN']);
    expect(exitCodes).toContain(1);
  });

  it('errors on insufficient kline data', async () => {
    mockBinance.fetchKlines.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => MOCK_KLINES[i]!),
    );

    await runCommand(['regime', 'SOL']);
    expect(exitCodes).toContain(1);
  });

  it('errors on regime detection failure', async () => {
    mockBinance.fetchKlines.mockRejectedValue(new Error('Kline fetch failed'));

    await runCommand(['regime', 'SOL']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — correlation command
// ═══════════════════════════════════════════════════════════════════════

describe('correlation command', () => {
  it('computes correlation matrix with auto-detected symbols', async () => {
    await runCommand(['correlation']);

    expect(mockTokens.getTopTokensByVolume).toHaveBeenCalledWith(10);
    expect(mockTokens.getTokenList).toHaveBeenCalled();
    expect(mockBinance.fetchKlines).toHaveBeenCalled();
    expect(mockCorrelation.computeCorrelationMatrix).toHaveBeenCalled();
    expect(mockCorrelation.formatCorrelationTable).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalled();
  });

  it('uses --symbols when provided', async () => {
    await runCommand(['correlation', '--symbols', 'SOL', 'BTC']);

    expect(mockTokens.getTopTokensByVolume).not.toHaveBeenCalled();
    expect(mockBinance.fetchKlines).toHaveBeenCalledTimes(2);
  });

  it('passes --count for auto-detection', async () => {
    await runCommand(['correlation', '--count', '5']);

    expect(mockTokens.getTopTokensByVolume).toHaveBeenCalledWith(5);
  });

  it('passes --period and --lookback', async () => {
    await runCommand(['correlation', '--symbols', 'SOL', 'BTC', '--period', '4h', '--lookback', '50']);

    expect(mockBinance.fetchKlines).toHaveBeenCalledWith(
      expect.any(String),
      '4h',
      50,
    );
  });

  it('outputs JSON with --json flag', async () => {
    await runCommand(['correlation', '--symbols', 'SOL', 'BTC', '--json']);

    expect(mockCorrelation.computeCorrelationMatrix).toHaveBeenCalled();
    const jsonCall = mockLogger.logger.stdout.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('symbols'),
    );
    expect(jsonCall).toBeDefined();
  });

  it('errors with fewer than 2 valid tokens', async () => {
    mockTokens.getTokenList.mockReturnValue([SOL_TOKEN]);

    await runCommand(['correlation', '--symbols', 'SOL']);
    expect(exitCodes).toContain(1);
  });

  it('errors on correlation computation failure', async () => {
    mockBinance.fetchKlines.mockRejectedValue(new Error('API error'));

    await runCommand(['correlation', '--symbols', 'SOL', 'BTC']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — report command
// ═══════════════════════════════════════════════════════════════════════

describe('report command', () => {
  it('generates full HTML report', async () => {
    await runCommand(['report']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({
        includeTech: true,
        includeNews: true,
        includeOnchain: true,
        noLog: true,
      }),
    );
    expect(mockPdfExport.generateHtmlReport).toHaveBeenCalled();
    expect(mockLogger.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Report written to'),
    );
  });

  it('generates signal snapshot with --snapshot', async () => {
    await runCommand(['report', '--snapshot']);

    expect(mockPdfExport.generateSignalSnapshot).toHaveBeenCalled();
    expect(mockLogger.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('signal snapshot'),
    );
  });

  it('writes to custom output path', async () => {
    await runCommand(['report', '--output', '/tmp/custom-report.html']);

    expect(mockPdfExport.generateHtmlReport).toHaveBeenCalled();
    expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
      '/tmp/custom-report.html',
      expect.any(String),
      'utf-8',
    );
  });

  it('handles report generation failure', async () => {
    mockRadar.runRadar.mockRejectedValue(new Error('Scan failed'));

    await runCommand(['report']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — validate command
// ═══════════════════════════════════════════════════════════════════════

describe('validate command', () => {
  beforeEach(() => {
    // Make fs.existsSync return true for the CSV path
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      'symbol,lastPrice,volume\nSOL,150,5000000\nBTC,50000,10000000\n',
    );
  });

  it('validates a CSV file successfully', async () => {
    await runCommand(['validate']);

    expect(mockFs.existsSync).toHaveBeenCalled();
    expect(mockOutput.validateOutput).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(
      expect.stringContaining('Validation passed'),
    );
  });

  it('uses custom --file path', async () => {
    await runCommand(['validate', '--file', '/tmp/custom.csv']);

    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/custom.csv'),
      'utf-8',
    );
  });

  it('rejects path traversal outside allowed dirs', async () => {
    await runCommand(['validate', '--file', '/etc/passwd']);
    expect(exitCodes).toContain(1);
  });

  it('handles missing file', async () => {
    mockFs.existsSync.mockReturnValue(false);

    await runCommand(['validate']);
    expect(exitCodes).toContain(1);
  });

  it('outputs errors as JSON with --json', async () => {
    mockOutput.validateOutput.mockReturnValue([
      { field: 'lastPrice', message: 'Invalid number', value: 'abc' },
    ]);
    mockFs.readFileSync.mockReturnValue(
      'symbol,lastPrice\nSOL,abc\n',
    );

    await runCommand(['validate', '--json']);

    const jsonCall = mockLogger.logger.stdout.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('field'),
    );
    expect(jsonCall).toBeDefined();
  });

  it('handles CSV file with no data rows', async () => {
    mockFs.readFileSync.mockReturnValue('symbol,lastPrice\n');

    await runCommand(['validate']);
    expect(exitCodes).toContain(1);
  });

  it('handles validation failure by exiting with code 1', async () => {
    mockOutput.validateOutput.mockReturnValue([
      { field: 'volume', message: 'Missing', value: undefined },
    ]);

    await runCommand(['validate']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — collect command
// ═══════════════════════════════════════════════════════════════════════

describe('collect command', () => {
  it('runs historical collector with default options', async () => {
    await runCommand(['collect']);

    expect(mockCollector.runCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        klines: true,
        futures: true,
      }),
    );
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(
      expect.stringContaining('[collect]'),
    );
  });

  it('passes --backfill days', async () => {
    await runCommand(['collect', '--backfill', '30']);

    expect(mockCollector.runCollector).toHaveBeenCalledWith(
      expect.objectContaining({ backfillDays: 30 }),
    );
  });

  it('passes --symbol to resolve symbols to Binance pairs', async () => {
    await runCommand(['collect', '--symbol', 'SOL', 'BTC']);

    expect(mockCollector.runCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        symbols: ['SOLUSDT', 'BTCUSDT'],
      }),
    );
  });

  it('passes --orderbook, --fear-greed, --cross-asset flags', async () => {
    await runCommand(['collect', '--orderbook', '--fear-greed', '--cross-asset']);

    expect(mockCollector.runCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        orderbook: true,
        fearGreed: true,
        crossAsset: true,
      }),
    );
  });

  it('reports collector errors in output', async () => {
    mockCollector.runCollector.mockResolvedValue({
      klinesInserted: 0,
      fundingInserted: 0,
      oiInserted: 0,
      lsInserted: 0,
      liquidationsInserted: 0,
      fearGreedInserted: 0,
      orderBookInserted: 0,
      crossAssetInserted: 0,
      durationMs: 3000,
      errors: ['Rate limit exceeded'],
    });

    await runCommand(['collect']);
    expect(exitCodes).toContain(1);
  });

  it('handles collector failure', async () => {
    mockCollector.runCollector.mockRejectedValue(new Error('Collector error'));

    await runCommand(['collect']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — daemon command
// ═══════════════════════════════════════════════════════════════════════

describe('daemon command', () => {
  it('shows status when --status is passed and daemon is running', async () => {
    mockDaemon.isDaemonRunning.mockReturnValue(true);

    await runCommand(['daemon', '--status']);

    expect(mockDaemon.isDaemonRunning).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(expect.stringContaining('RUNNING'));
  });

  it('shows stopped status when daemon is not running', async () => {
    mockDaemon.isDaemonRunning.mockReturnValue(false);

    await runCommand(['daemon', '--status']);
    expect(exitCodes).toContain(1);
  });

  it('stops daemon when --stop is passed and succeeds', async () => {
    mockDaemon.stopDaemon.mockReturnValue(true);

    await runCommand(['daemon', '--stop']);

    expect(mockDaemon.stopDaemon).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
  });

  it('handles --stop when no daemon is running', async () => {
    mockDaemon.stopDaemon.mockReturnValue(false);

    await runCommand(['daemon', '--stop']);
    expect(exitCodes).toContain(1);
  });

  it('starts daemon in foreground by default', async () => {
    await runCommand(['daemon']);

    expect(mockDaemon.runDaemon).toHaveBeenCalled();
  });

  it('passes --port and --refresh to environment vars', async () => {
    await runCommand(['daemon', '--port', '9999', '--refresh', '600']);

    expect(mockDaemon.runDaemon).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — backtest command
// ═══════════════════════════════════════════════════════════════════════

describe('backtest command', () => {
  it('runs backtest with radar data', async () => {
    mockRadar.runRadar.mockResolvedValue({
      ...DEFAULT_RESULT,
      aggregatedSignals: [
        { symbol: 'SOL', direction: 'BUY', confidence: 0.8, source: 'momentum', signal: 'strong_buy' },
      ],
    });
    mockBinance.fetchKlines.mockResolvedValue(MOCK_KLINES);

    await runCommand(['backtest']);

    expect(mockRadar.runRadar).toHaveBeenCalledWith(
      expect.objectContaining({ includeTech: true, noLog: true }),
    );
    expect(mockBinance.fetchKlines).toHaveBeenCalled();
    expect(mockBacktest.runBacktest).toHaveBeenCalled();
    expect(mockBacktest.formatBacktest).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalled();
  });

  it('filters by --symbol', async () => {
    mockRadar.runRadar.mockResolvedValue({
      ...DEFAULT_RESULT,
      aggregatedSignals: [
        { symbol: 'SOL', direction: 'BUY', confidence: 0.8, source: 'momentum', signal: 'strong_buy' },
        { symbol: 'BTC', direction: 'SELL', confidence: 0.6, source: 'mean_reversion', signal: 'weak_sell' },
      ],
    });

    await runCommand(['backtest', '--symbol', 'SOL']);

    expect(mockBacktest.runBacktest).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ symbol: 'SOL' }),
      ]),
      expect.any(Map),
      expect.any(Object),
    );
  });

  it('passes --horizon and --confidence', async () => {
    mockRadar.runRadar.mockResolvedValue({
      ...DEFAULT_RESULT,
      aggregatedSignals: [
        { symbol: 'SOL', direction: 'BUY', confidence: 0.8, source: 'momentum', signal: 'strong_buy' },
      ],
    });

    await runCommand(['backtest', '--horizon', '5', '--confidence', '0.5']);

    expect(mockBacktest.runBacktest).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Map),
      expect.objectContaining({
        horizon: 5,
        minConfidence: 0.5,
      }),
    );
  });

  it('errors when no signals are available', async () => {
    mockRadar.runRadar.mockResolvedValue({
      ...DEFAULT_RESULT,
      aggregatedSignals: [],
    });

    await runCommand(['backtest']);
    expect(exitCodes).toContain(1);
  });

  it('handles backtest failure', async () => {
    mockRadar.runRadar.mockRejectedValue(new Error('Backtest error'));

    await runCommand(['backtest']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — ml command
// ═══════════════════════════════════════════════════════════════════════

describe('ml command', () => {
  beforeEach(() => {
    mockStoreInstance.getPredictions.mockReturnValue([]);
    mockStoreInstance.getKlines.mockReturnValue([]);
  });

  it('shows ML pipeline status', async () => {
    await runCommand(['ml', 'status']);

    expect(mockStore.Store.open).toHaveBeenCalled();
    expect(mockStoreInstance.stats).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(expect.stringContaining('ML Pipeline Status'));
  });

  it('shows latest prediction in status when available', async () => {
    mockStoreInstance.getPredictions.mockReturnValue([
      { symbol: 'SOL', direction: 'BUY', confidence: 0.75, timestamp: '2026-07-12T12:00:00Z' },
    ]);
    mockStoreInstance.stats.mockReturnValue({ tickers: 500, klines: 10000, predictions: 50 });

    await runCommand(['ml', 'status']);

    expect(mockLogger.logger.stdout).toHaveBeenCalledWith(
      expect.stringContaining('Latest pred'),
    );
  });

  it('errors on insufficient data for training', async () => {
    mockStoreInstance.getKlines.mockReturnValue([]);

    await runCommand(['ml', 'train']);
    expect(exitCodes).toContain(1);
  });

  it('errors on predict with no predictions', async () => {
    mockPredict.batchPredict.mockResolvedValue([]);

    await runCommand(['ml', 'predict']);
    expect(exitCodes).toContain(1);
  });

  it('errors on unknown action', async () => {
    await runCommand(['ml', 'unknown_action']);
    expect(exitCodes).toContain(1);
  });

  it('handles ML command failure', async () => {
    mockStore.Store.open.mockImplementation(() => {
      throw new Error('Store error');
    });

    await runCommand(['ml', 'status']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — benchmark command
// ═══════════════════════════════════════════════════════════════════════

describe('benchmark command', () => {
  it('runs performance benchmark', async () => {
    await runCommand(['benchmark']);

    // Default iterations=3 => median path
    expect(mockBenchmark.runBenchmarkMedian).toHaveBeenCalledWith(3);
    expect(mockBenchmark.formatBenchmark).toHaveBeenCalled();
    expect(mockLogger.logger.stdout).toHaveBeenCalled();
  });

  it('passes --iterations option', async () => {
    await runCommand(['benchmark', '--iterations', '5']);

    expect(mockBenchmark.runBenchmarkMedian).toHaveBeenCalledWith(5);
  });

  it('handles benchmark failure', async () => {
    mockBenchmark.runBenchmarkMedian.mockRejectedValue(new Error('Benchmark error'));

    await runCommand(['benchmark']);
    expect(exitCodes).toContain(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tests — default behavior (no command → scan)
// ═══════════════════════════════════════════════════════════════════════

describe('default behavior', () => {
  it('defaults to scan when no command given and argv length <= 2', async () => {
    process.argv = ['node', 'cli.ts'];
    vi.resetModules();
    await import('./cli.ts');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockTokens.getTopTokensByVolume).toHaveBeenCalledWith(30);
  });
});
