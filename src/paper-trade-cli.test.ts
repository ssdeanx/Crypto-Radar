// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Paper Trading CLI Tests
// ═══════════════════════════════════════════════════════════════════════
//
// Tests each Commander.js sub-command: buy, sell, portfolio, report,
// signals, history, agent, reset, config, and profile sub-commands.
// All PaperTrader methods are mocked to avoid real API calls.
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Shared state accessible from vi.mock factory (must use vi.hoisted) ──

const mockState = vi.hoisted(() => {
  const fns: Record<string, ReturnType<typeof vi.fn>> = {};
  const trader: Record<string, any> = {};

  class MockPaperTrader {
    constructor(_config?: any) {
      return mockState.trader;
    }
  }

  function buildMockTrader(): Record<string, any> {
    const buyFn = vi.fn();
    const sellFn = vi.fn();
    const getPortfolioFn = vi.fn();
    const getReportFn = vi.fn();
    const getSignalRecommendationsFn = vi.fn();
    const agentPlayFn = vi.fn();
    const saveFn = vi.fn();
    const loadFn = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const resetFn = vi.fn();
    const getPriceFn = vi.fn<() => Promise<number | null>>();

    Object.assign(fns, {
      buyFn, sellFn, getPortfolioFn, getReportFn,
      getSignalRecommendationsFn, agentPlayFn, saveFn, loadFn, resetFn, getPriceFn,
    });

    const t: Record<string, any> = {
      cash: 10_000,
      startBalance: 10_000,
      holdings: [],
      trades: [],
      tradeCount: 0,
      buy: buyFn,
      sell: sellFn,
      getPortfolio: getPortfolioFn,
      getReport: getReportFn,
      getSignalRecommendations: getSignalRecommendationsFn,
      getRawState: vi.fn(() => ({ holdings: t.holdings, trades: t.trades })),
      agentPlay: agentPlayFn,
      save: saveFn,
      load: loadFn,
      reset: resetFn,
      getPrice: getPriceFn,
    };

    Object.keys(t).forEach(k => { trader[k] = t[k]; });
    return trader;
  }

  return { fns, trader, buildMockTrader, MockPaperTrader };
});

// References accessible from test bodies (not from vi.mock factory)
const m = mockState.trader;
const fns = mockState.fns;

vi.mock('./paper-trade.js', () => {
  mockState.buildMockTrader();
  return {
    PaperTrader: mockState.MockPaperTrader,
    createPaperTrader: vi.fn().mockReturnValue(mockState.trader),
    listProfiles: vi.fn<() => Promise<any[]>>(),
    getActiveProfileName: vi.fn<() => string>(),
    expandHome: vi.fn<(p: string) => string>().mockImplementation((p: string) => p.replace(/^~/, '/home/user')),
  };
});

vi.mock('./core/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({ dataDir: '~/.hermes/data/crypto-radar' }),
}));

// Mock the structured logger — paper-trade-cli uses logger.stdout/info/error/warn
// instead of console.log/console.error. We collect calls for output assertions.
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

vi.mock('./core/logger.js', () => mockLogger);

// Mock node:fs to avoid real file system operations in profile commands
const fsMock = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('trader1\n'),
  readdirSync: vi.fn().mockReturnValue([]),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
}));

vi.mock('node:fs', () => fsMock);

// ── Imports (after vi.mock hoisting) ──

import { createPaperTradeCommand } from './paper-trade-cli.js';
import { PaperTrader, createPaperTrader, listProfiles, getActiveProfileName, expandHome } from './paper-trade.js';

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

async function runCommand(
  args: string[],
  cmd = createPaperTradeCommand(),
): Promise<{ output: string; exitCode: number }> {
  const origExit = process.exit;
  const origArgv = process.argv;

  let exitCode = 0;

  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new ExitSignal(code ?? 0);
  }) as any;

  process.argv = ['node', 'paper-trade', ...args];

  try {
    await cmd.parseAsync(['node', 'paper-trade', ...args]);
  } catch (err: unknown) {
    if (err instanceof ExitSignal) {
      exitCode = err.code;
    } else {
      throw err;
    }
  } finally {
    process.exit = origExit;
    process.argv = origArgv;
  }

  // Collect all logger calls (paper-trade-cli uses the structured logger).
  // Stringify objects the way the real logger would (extra fields appended).
  const stringifyCall = (call: unknown[]): string =>
    call.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg === 'object') {
        const obj = arg as Record<string, unknown>;
        if ('message' in obj && Object.keys(obj).length === 1) return String(obj.message);
        return JSON.stringify(obj);
      }
      return String(arg);
    }).join(' ');

  const allCalls = [
    ...mockLogger.logger.stdout.mock.calls.map(stringifyCall),
    ...mockLogger.logger.info.mock.calls.map(stringifyCall),
    ...mockLogger.logger.warn.mock.calls.map(stringifyCall),
    ...mockLogger.logger.error.mock.calls.map(stringifyCall),
  ];

  return { output: allCalls.join('\n'), exitCode };
}

class ExitSignal extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

function resetMocks() {
  // Don't use vi.clearAllMocks — it wipes module-level mock defaults (node:fs etc.)
  // Instead, selectively reset only the mocks we explicitly manage
  (createPaperTrader as ReturnType<typeof vi.fn>).mockClear();
  (listProfiles as ReturnType<typeof vi.fn>).mockReset();
  (getActiveProfileName as ReturnType<typeof vi.fn>).mockReset();
  // Rebuild a fresh mock trader into the shared objects
  mockState.buildMockTrader();
  (createPaperTrader as ReturnType<typeof vi.fn>).mockReturnValue(mockState.trader);
  // Reset node:fs mock defaults (individual tests may override these)
  fsMock.existsSync.mockReturnValue(true);
  fsMock.unlinkSync.mockReset();
  fsMock.writeFileSync.mockReset();
  // Clear logger mock calls between tests
  mockLogger.logger.info.mockClear();
  mockLogger.logger.warn.mockClear();
  mockLogger.logger.error.mockClear();
  mockLogger.logger.stdout.mockClear();
}

// ═══════════════════════════════════════════════════════════════════════
// buy command
// ═══════════════════════════════════════════════════════════════════════

describe('buy command', () => {
  beforeEach(() => resetMocks());

  it('buys successfully and displays confirmation', async () => {
    fns.buyFn.mockResolvedValue({
      id: 'PT-ABC-1',
      type: 'buy',
      symbol: 'SOL',
      amount: 10,
      price: 150,
      total: 1500,
      timestamp: '2025-01-01T00:00:00.000Z',
    });

    const { output, exitCode } = await runCommand(['buy', 'SOL', '10']);
    expect(exitCode).toBe(0);
    expect(fns.buyFn).toHaveBeenCalledWith('SOL', 10);
    expect(fns.saveFn).toHaveBeenCalledWith(true);
    expect(output).toContain('BOUGHT');
    expect(output).toContain('SOL');
    expect(output).toContain('150');
  });

  it('rejects invalid symbol (null price) with error and exit 1', async () => {
    fns.buyFn.mockResolvedValue(null);
    fns.getPriceFn.mockResolvedValue(null);

    const { output, exitCode } = await runCommand(['buy', 'UNKNOWN', '10']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Could not fetch price');
  });

  it('rejects insufficient funds with error and exit 1', async () => {
    fns.buyFn.mockResolvedValue(null);
    fns.getPriceFn.mockResolvedValue(200);
    fns.getPortfolioFn.mockResolvedValue({
      cash: 100,
      holdings: [],
      totalHoldingsValue: 0,
      totalEquity: 100,
    });

    const { output, exitCode } = await runCommand(['buy', 'BTC', '10']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Insufficient funds');
  });

  it('handles API failure during buy with exit 1', async () => {
    fns.buyFn.mockRejectedValue(new Error('Network error'));

    const { output, exitCode } = await runCommand(['buy', 'SOL', '5']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Buy failed');
    expect(output).toContain('Network error');
  });

  it('passes --profile override and calls save(false)', async () => {
    fns.buyFn.mockResolvedValue({
      id: 'PT-ABC-2', type: 'buy', symbol: 'ETH', amount: 1, price: 3000, total: 3000, timestamp: '',
    });

    const { exitCode } = await runCommand(['buy', 'ETH', '1', '--profile', 'alt']);
    expect(exitCode).toBe(0);
    expect(fns.saveFn).toHaveBeenCalledWith(false);
  });

  it('handles non-Error rejection gracefully', async () => {
    fns.buyFn.mockRejectedValue('String error');

    const { output, exitCode } = await runCommand(['buy', 'SOL', '1']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Buy failed');
  });

  it('parses amount as float', async () => {
    fns.buyFn.mockResolvedValue({
      id: 'PT-1', type: 'buy', symbol: 'BTC', amount: 0.5, price: 80000, total: 40000, timestamp: '',
    });

    const { exitCode } = await runCommand(['buy', 'BTC', '0.5']);
    expect(exitCode).toBe(0);
    expect(fns.buyFn).toHaveBeenCalledWith('BTC', 0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// sell command
// ═══════════════════════════════════════════════════════════════════════

describe('sell command', () => {
  beforeEach(() => resetMocks());

  it('sells successfully and shows P&L', async () => {
    fns.sellFn.mockResolvedValue({
      id: 'PT-1', type: 'sell', symbol: 'SOL', amount: 5, price: 155, total: 775, pnl: 25, timestamp: '',
    });

    const { output, exitCode } = await runCommand(['sell', 'SOL', '5']);
    expect(exitCode).toBe(0);
    expect(fns.sellFn).toHaveBeenCalledWith('SOL', 5);
    expect(fns.saveFn).toHaveBeenCalledWith(true);
    expect(output).toContain('SOLD');
    expect(output).toContain('SOL');
    expect(output).toContain('+$25');
  });

  it('handles negative P&L correctly', async () => {
    fns.sellFn.mockResolvedValue({
      id: 'PT-2', type: 'sell', symbol: 'SOL', amount: 5, price: 140, total: 700, pnl: -50, timestamp: '',
    });

    const { output, exitCode } = await runCommand(['sell', 'SOL', '5']);
    expect(exitCode).toBe(0);
    expect(output).toContain('-$50');
  });

  it('handles null P&L gracefully', async () => {
    fns.sellFn.mockResolvedValue({
      id: 'PT-3', type: 'sell', symbol: 'SOL', amount: 1, price: 150, total: 150, pnl: undefined, timestamp: '',
    });

    const { output, exitCode } = await runCommand(['sell', 'SOL', '1']);
    expect(exitCode).toBe(0);
    expect(output).toContain('N/A');
  });

  it('rejects sell with no holdings and exits 1', async () => {
    fns.sellFn.mockResolvedValue(null);

    const { output, exitCode } = await runCommand(['sell', 'BTC', '1']);
    expect(exitCode).toBe(1);
    expect(output).toContain('No holdings');
  });

  it('sells all when amount is "all"', async () => {
    fns.sellFn.mockResolvedValue({
      id: 'PT-4', type: 'sell', symbol: 'SOL', amount: 10, price: 150, total: 1500, pnl: 500, timestamp: '',
    });

    const { output, exitCode } = await runCommand(['sell', 'SOL', 'all']);
    expect(exitCode).toBe(0);
    expect(fns.sellFn).toHaveBeenCalledWith('SOL', -1);
    expect(output).toContain('SOLD');
    expect(output).toContain('10');
  });

  it('handles API failure during sell', async () => {
    fns.sellFn.mockRejectedValue(new Error('Sell failed'));

    const { output, exitCode } = await runCommand(['sell', 'SOL', '1']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Sell failed');
  });

  it('passes --profile override and calls save(false)', async () => {
    fns.sellFn.mockResolvedValue({
      id: 'PT-5', type: 'sell', symbol: 'ETH', amount: 0.5, price: 3000, total: 1500, pnl: 200, timestamp: '',
    });

    const { exitCode } = await runCommand(['sell', 'ETH', '0.5', '--profile', 'alt']);
    expect(exitCode).toBe(0);
    expect(fns.saveFn).toHaveBeenCalledWith(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// portfolio command
// ═══════════════════════════════════════════════════════════════════════

describe('portfolio command', () => {
  beforeEach(() => resetMocks());

  it('displays portfolio with holdings', async () => {
    fns.getPortfolioFn.mockResolvedValue({
      cash: 5000,
      holdings: [
        {
          symbol: 'SOL', amount: 10, avgEntryPrice: 140, currentPrice: 150,
          value: 1500, unrealizedPnl: 100, unrealizedPnlPercent: 7.14,
          tokenId: 'solana',
        },
        {
          symbol: 'BTC', amount: 0.1, avgEntryPrice: 60000, currentPrice: 65000,
          value: 6500, unrealizedPnl: 500, unrealizedPnlPercent: 8.33,
          tokenId: 'bitcoin',
        },
      ],
      totalHoldingsValue: 8000,
      totalEquity: 13000,
    });
    m.startBalance = 10000;

    const { output, exitCode } = await runCommand(['portfolio']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Paper Trading Portfolio');
    expect(output).toContain('5000.00');
    expect(output).toContain('8000.00');
    expect(output).toContain('13000.00');
    expect(output).toContain('+$3000');
    expect(output).toContain('+30.00%');
    expect(output).toContain('SOL');
    expect(output).toContain('BTC');
  });

  it('displays empty holdings message when no holdings', async () => {
    fns.getPortfolioFn.mockResolvedValue({
      cash: 10000,
      holdings: [],
      totalHoldingsValue: 0,
      totalEquity: 10000,
    });
    m.startBalance = 10000;

    const { output, exitCode } = await runCommand(['portfolio']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No holdings');
    expect(output).toContain('paper-trade buy');
  });

  it('handles error with exit 1', async () => {
    fns.getPortfolioFn.mockRejectedValue(new Error('Portfolio error'));

    const { output, exitCode } = await runCommand(['portfolio']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Portfolio failed');
  });

  it('handles negative return', async () => {
    fns.getPortfolioFn.mockResolvedValue({
      cash: 3000,
      holdings: [{ symbol: 'BTC', amount: 0.1, avgEntryPrice: 80000, currentPrice: 70000, value: 7000, unrealizedPnl: -1000, unrealizedPnlPercent: -12.5, tokenId: 'bitcoin' }],
      totalHoldingsValue: 7000,
      totalEquity: 10000,
    });
    m.startBalance = 12000;

    const { output, exitCode } = await runCommand(['portfolio']);
    expect(exitCode).toBe(0);
    expect(output).toContain('-');
  });

  it('supports --profile flag', async () => {
    fns.getPortfolioFn.mockResolvedValue({
      cash: 5000, holdings: [], totalHoldingsValue: 0, totalEquity: 5000,
    });

    const { exitCode } = await runCommand(['portfolio', '--profile', 'alt']);
    expect(exitCode).toBe(0);
  });

  it('works with "p" alias', async () => {
    fns.getPortfolioFn.mockResolvedValue({
      cash: 10000, holdings: [], totalHoldingsValue: 0, totalEquity: 10000,
    });

    const { output, exitCode } = await runCommand(['p']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Paper Trading Portfolio');
  });

  it('works with "holdings" alias', async () => {
    fns.getPortfolioFn.mockResolvedValue({
      cash: 10000, holdings: [], totalHoldingsValue: 0, totalEquity: 10000,
    });

    const { output, exitCode } = await runCommand(['holdings']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Paper Trading Portfolio');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// report command
// ═══════════════════════════════════════════════════════════════════════

describe('report command', () => {
  beforeEach(() => resetMocks());

  const sampleReport = {
    startBalance: 10000,
    currentCash: 5000,
    holdingsValue: 6000,
    totalEquity: 11000,
    totalReturn: 1000,
    totalReturnPercent: 10,
    totalTrades: 5,
    wins: 3,
    losses: 2,
    winRate: 0.6,
    bestTrade: { id: 'PT-1', type: 'buy', symbol: 'SOL', amount: 10, price: 140, total: 1400, pnl: 300, timestamp: '2025-01-01T00:00:00.000Z' },
    worstTrade: { id: 'PT-2', type: 'sell', symbol: 'BTC', amount: 0.1, price: 50000, total: 5000, pnl: -200, timestamp: '2025-01-02T00:00:00.000Z' },
    sharpeRatio: 1.5,
    perToken: [
      { symbol: 'SOL', tokenId: 'solana', tokenName: 'Solana', amount: 10, avgEntry: 140, currentPrice: 150, value: 1500, unrealizedPnl: 100, unrealizedPnlPercent: 7.14, realizedPnl: 200, totalPnl: 300, trades: 2 },
    ],
  };

  it('displays full report', async () => {
    fns.getReportFn.mockResolvedValue(sampleReport);

    const { output, exitCode } = await runCommand(['report']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Performance Report');
    expect(output).toContain('10000.00');
    expect(output).toContain('6000.00');
    expect(output).toContain('11000.00');
    expect(output).toContain('+$');
    expect(output).toContain('1000.00');
    expect(output).toContain('60.0%');
    expect(output).toContain('1.50');
    expect(output).toContain('Best Trade');
    expect(output).toContain('Worst Trade');
    expect(output).toContain('Per-Token');
  });

  it('handles report with no trades', async () => {
    fns.getReportFn.mockResolvedValue({
      startBalance: 10000, currentCash: 10000, holdingsValue: 0, totalEquity: 10000,
      totalReturn: 0, totalReturnPercent: 0, totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      bestTrade: null, worstTrade: null, sharpeRatio: 0, perToken: [],
    });

    const { output, exitCode } = await runCommand(['report']);
    expect(exitCode).toBe(0);
    expect(output).toContain('0');
  });

  it('handles error with exit 1', async () => {
    fns.getReportFn.mockRejectedValue(new Error('Report error'));

    const { output, exitCode } = await runCommand(['report']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Report failed');
  });

  it('works with "r" alias', async () => {
    fns.getReportFn.mockResolvedValue({
      startBalance: 10000, currentCash: 10000, holdingsValue: 0, totalEquity: 10000,
      totalReturn: 0, totalReturnPercent: 0, totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      bestTrade: null, worstTrade: null, sharpeRatio: 0, perToken: [],
    });

    const { output, exitCode } = await runCommand(['r']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Performance Report');
  });

  it('works with "performance" alias', async () => {
    fns.getReportFn.mockResolvedValue({
      startBalance: 10000, currentCash: 10000, holdingsValue: 0, totalEquity: 10000,
      totalReturn: 0, totalReturnPercent: 0, totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      bestTrade: null, worstTrade: null, sharpeRatio: 0, perToken: [],
    });

    const { output, exitCode } = await runCommand(['performance']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Performance Report');
  });

  it('supports --profile flag', async () => {
    fns.getReportFn.mockResolvedValue({
      startBalance: 10000, currentCash: 10000, holdingsValue: 0, totalEquity: 10000,
      totalReturn: 0, totalReturnPercent: 0, totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      bestTrade: null, worstTrade: null, sharpeRatio: 0, perToken: [],
    });

    const { exitCode } = await runCommand(['report', '--profile', 'alt']);
    expect(exitCode).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// signals command
// ═══════════════════════════════════════════════════════════════════════

describe('signals command', () => {
  beforeEach(() => resetMocks());

  it('displays available signals sorted by action then confidence', async () => {
    fns.getSignalRecommendationsFn.mockResolvedValue([
      { symbol: 'SOL', tokenId: 'solana', tokenName: 'Solana', action: 'buy', confidence: 0.85, reason: 'Strong momentum', currentPrice: 150, compositeScore: 85, direction: 'bullish' },
      { symbol: 'ETH', tokenId: 'ethereum', tokenName: 'Ethereum', action: 'sell', confidence: 0.7, reason: 'Overbought', currentPrice: 3000, compositeScore: 70, direction: 'bearish' },
      { symbol: 'BTC', tokenId: 'bitcoin', tokenName: 'Bitcoin', action: 'hold', confidence: 0.5, reason: 'Neutral', currentPrice: 60000, compositeScore: 50, direction: 'neutral' },
    ]);

    const { output, exitCode } = await runCommand(['signals']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Market Signals');
    expect(output).toContain('SOL');
    expect(output).toContain('ETH');
    expect(output).toContain('BTC');
    expect(output).toContain('85%');
    expect(output).toContain('70%');
    expect(output).toContain('BUY');
    expect(output).toContain('SELL');
    expect(output).toContain('HOLD');
  });

  it('shows no signals message when empty', async () => {
    fns.getSignalRecommendationsFn.mockResolvedValue([]);

    const { output, exitCode } = await runCommand(['signals']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No signals available');
  });

  it('handles error with exit 1', async () => {
    fns.getSignalRecommendationsFn.mockRejectedValue(new Error('Signal error'));

    const { output, exitCode } = await runCommand(['signals']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Signals failed');
  });

  it('works with "s" alias', async () => {
    fns.getSignalRecommendationsFn.mockResolvedValue([]);

    const { output, exitCode } = await runCommand(['s']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No signals available');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// history command
// ═══════════════════════════════════════════════════════════════════════

describe('history command', () => {
  beforeEach(() => resetMocks());

  it('displays trade history with trades', async () => {
    m.trades = [
      { id: 'PT-1', type: 'buy', symbol: 'SOL', amount: 10, price: 140, total: 1400, timestamp: '2025-01-01T12:00:00.000Z' },
      { id: 'PT-2', type: 'sell', symbol: 'SOL', amount: 5, price: 155, total: 775, pnl: 75, timestamp: '2025-01-02T12:00:00.000Z' },
    ];

    const { output, exitCode } = await runCommand(['history']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Trade History');
    expect(output).toContain('2 trades');
    expect(output).toContain('PT-1');
    expect(output).toContain('PT-2');
    expect(output).toContain('BUY');
    expect(output).toContain('SELL');
    expect(output).toContain('SOL');
    expect(output).toContain('+$75');
  });

  it('shows no trades message when empty', async () => {
    m.trades = [];

    const { output, exitCode } = await runCommand(['history']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No trades yet');
  });

  it('works with "h" alias', async () => {
    m.trades = [];

    const { output, exitCode } = await runCommand(['h']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No trades yet');
  });

  it('works with "ledger" alias', async () => {
    m.trades = [];

    const { output, exitCode } = await runCommand(['ledger']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No trades yet');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// agent command
// ═══════════════════════════════════════════════════════════════════════

describe('agent command', () => {
  beforeEach(() => resetMocks());

  it('executes trades from signal recommendations', async () => {
    fns.getSignalRecommendationsFn.mockResolvedValue([
      { symbol: 'SOL', tokenId: 'solana', tokenName: 'Solana', action: 'sell', confidence: 0.8, reason: 'Overbought', currentPrice: 150, compositeScore: 80, direction: 'bearish' },
      { symbol: 'BTC', tokenId: 'bitcoin', tokenName: 'Bitcoin', action: 'buy', confidence: 0.9, reason: 'Strong buy', currentPrice: 60000, compositeScore: 90, direction: 'bullish' },
    ]);

    fns.agentPlayFn
      .mockResolvedValueOnce([
        { id: 'PT-1', type: 'sell', symbol: 'SOL', amount: 5, price: 150, total: 750, pnl: 50, timestamp: '' },
      ])
      .mockResolvedValueOnce([
        { id: 'PT-2', type: 'buy', symbol: 'BTC', amount: 0.01, price: 60000, total: 600, timestamp: '' },
      ]);

    fns.getPortfolioFn.mockResolvedValue({
      cash: 9100,
      holdings: [{ symbol: 'SOL', amount: 5, avgEntryPrice: 140, currentPrice: 150, value: 750, unrealizedPnl: 50, unrealizedPnlPercent: 7.14, tokenId: 'solana' }],
      totalHoldingsValue: 750,
      totalEquity: 9850,
    });

    const { output, exitCode } = await runCommand(['agent']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Agent Trading Mode');
    expect(output).toContain('2 trades');
    expect(output).toContain('SELL');
    expect(output).toContain('BUY');
    expect(output).toContain('SOL');
    expect(output).toContain('BTC');
    expect(output).toContain('Cash');
    expect(fns.saveFn).toHaveBeenCalled();
  });

  it('respects maxPerTrade argument', async () => {
    fns.getSignalRecommendationsFn.mockResolvedValue([
      { symbol: 'BTC', tokenId: 'bitcoin', tokenName: 'Bitcoin', action: 'buy', confidence: 0.9, reason: 'Strong', currentPrice: 60000, compositeScore: 90, direction: 'bullish' },
    ]);
    fns.agentPlayFn.mockResolvedValue([
      { id: 'PT-1', type: 'buy', symbol: 'BTC', amount: 0.01, price: 60000, total: 600, timestamp: '' },
    ]);
    fns.getPortfolioFn.mockResolvedValue({
      cash: 9000, holdings: [], totalHoldingsValue: 0, totalEquity: 9000,
    });

    const { exitCode } = await runCommand(['agent', '1000']);
    expect(exitCode).toBe(0);
  });

  it('respects --min-confidence threshold (filters all)', async () => {
    fns.getSignalRecommendationsFn.mockResolvedValue([
      { symbol: 'BTC', tokenId: 'bitcoin', tokenName: 'Bitcoin', action: 'buy', confidence: 0.5, reason: 'Medium', currentPrice: 60000, compositeScore: 50, direction: 'bullish' },
    ]);
    fns.agentPlayFn.mockResolvedValue([]);

    const { output, exitCode } = await runCommand(['agent', '500', '--min-confidence', '0.8']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No trades executed');
  });

  it('respects --max-trades limit', async () => {
    fns.getSignalRecommendationsFn.mockResolvedValue([
      { symbol: 'SOL', tokenId: 'solana', tokenName: 'Solana', action: 'sell', confidence: 0.8, reason: 'Overbought', currentPrice: 150, compositeScore: 80, direction: 'bearish' },
      { symbol: 'BTC', tokenId: 'bitcoin', tokenName: 'Bitcoin', action: 'buy', confidence: 0.9, reason: 'Strong', currentPrice: 60000, compositeScore: 90, direction: 'bullish' },
    ]);

    fns.agentPlayFn
      .mockResolvedValueOnce([
        { id: 'PT-1', type: 'sell', symbol: 'SOL', amount: 5, price: 150, total: 750, pnl: 50, timestamp: '' },
      ])
      .mockResolvedValueOnce([]);
    fns.getPortfolioFn.mockResolvedValue({
      cash: 10000, holdings: [], totalHoldingsValue: 0, totalEquity: 10000,
    });

    const { exitCode } = await runCommand(['agent', '500', '--max-trades', '1']);
    expect(exitCode).toBe(0);
  });

  it('shows no trades message when no recommendations', async () => {
    fns.getSignalRecommendationsFn.mockResolvedValue([]);

    const { output, exitCode } = await runCommand(['agent']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No trade recommendations');
  });

  it('handles error with exit 1', async () => {
    fns.getSignalRecommendationsFn.mockRejectedValue(new Error('Agent error'));

    const { output, exitCode } = await runCommand(['agent']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Agent trade failed');
  });

  it('works with "auto" alias', async () => {
    fns.getSignalRecommendationsFn.mockResolvedValue([]);

    const { output, exitCode } = await runCommand(['auto']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No trade recommendations');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// reset command
// ═══════════════════════════════════════════════════════════════════════

describe('reset command', () => {
  beforeEach(() => resetMocks());

  it('refuses to reset without --force and exits 0 (message on stderr)', async () => {
    const { output, exitCode } = await runCommand(['reset']);
    expect(exitCode).toBe(0);
    expect(output).toContain('delete all trading');
    expect(output).toContain('--force');
  });

  it('resets with --force', async () => {
    const { output, exitCode } = await runCommand(['reset', '--force']);
    expect(exitCode).toBe(0);
    expect(fns.resetFn).toHaveBeenCalled();
    expect(fns.saveFn).toHaveBeenCalledWith(true);
    expect(output).toContain('reset to $10,000');
  });

  it('resets with --force --profile override', async () => {
    const { output, exitCode } = await runCommand(['reset', '--force', '--profile', 'alt']);
    expect(exitCode).toBe(0);
    expect(fns.resetFn).toHaveBeenCalled();
    expect(fns.saveFn).toHaveBeenCalledWith(false);
    expect(output).toContain('reset to $10,000');
  });

  it('handles error on reset with exit 1', async () => {
    fns.resetFn.mockImplementation(() => { throw new Error('Reset error'); });

    const { output, exitCode } = await runCommand(['reset', '--force']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Reset failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// config command
// ═══════════════════════════════════════════════════════════════════════

describe('config command', () => {
  beforeEach(() => resetMocks());

  it('displays trader configuration', async () => {
    const { output, exitCode } = await runCommand(['config']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Paper Trader Configuration');
    expect(output).toContain('10000.00');
    expect(output).toContain('0');
  });

  it('shows current cash and holdings count', async () => {
    m.cash = 5500;
    m.tradeCount = 3;
    m.holdings = [{ symbol: 'SOL', amount: 10, avgEntryPrice: 140, tokenId: 'solana' }];

    const { output, exitCode } = await runCommand(['config']);
    expect(exitCode).toBe(0);
    expect(output).toContain('5500.00');
    expect(output).toContain('3');
    expect(output).toContain('1');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// profile create sub-command
// ═══════════════════════════════════════════════════════════════════════

describe('profile create', () => {
  beforeEach(() => resetMocks());

  it('creates a new profile with valid name', async () => {
    fns.loadFn.mockResolvedValue(false);
    fns.saveFn.mockReset();
    fns.saveFn.mockResolvedValue(undefined);

    const { output, exitCode } = await runCommand(['profile', 'create', 'mytrader']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Created profile');
    expect(output).toContain('mytrader');
    expect(output).toContain('$10,000');
  });

  it('rejects invalid profile name with exit 1', async () => {
    const { output, exitCode } = await runCommand(['profile', 'create', 'bad name!']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Invalid profile name');
  });

  it('rejects reserved name "last-profile" with exit 1', async () => {
    const { output, exitCode } = await runCommand(['profile', 'create', 'last-profile']);
    expect(exitCode).toBe(1);
    expect(output).toContain('reserved name');
  });

  it('rejects already existing profile with exit 1', async () => {
    fns.loadFn.mockResolvedValue(true);

    const { output, exitCode } = await runCommand(['profile', 'create', 'existing']);
    expect(exitCode).toBe(1);
    expect(output).toContain('already exists');
  });

  it('handles unexpected error with exit 1', async () => {
    fns.loadFn.mockRejectedValue(new Error('Disk error'));

    const { output, exitCode } = await runCommand(['profile', 'create', 'broken']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Disk error');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// profile list sub-command
// ═══════════════════════════════════════════════════════════════════════

describe('profile list', () => {
  beforeEach(() => resetMocks());

  it('lists profiles with active marker', async () => {
    (getActiveProfileName as ReturnType<typeof vi.fn>).mockReturnValue('trader1');
    (listProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { profileName: 'trader1', cash: 10000, tradeCount: 5, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-10T00:00:00.000Z' },
      { profileName: 'mytrader', cash: 5000, tradeCount: 2, createdAt: '2025-01-05T00:00:00.000Z', updatedAt: '2025-01-08T00:00:00.000Z' },
    ]);

    const { output, exitCode } = await runCommand(['profile', 'list']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Paper Trading Profiles');
    expect(output).toContain('trader1');
    expect(output).toContain('mytrader');
    expect(output).toContain('← active');
    expect(output).toContain('10000.00');
    expect(output).toContain('5000.00');
  });

  it('shows no profiles message when empty', async () => {
    (listProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { output, exitCode } = await runCommand(['profile', 'list']);
    expect(exitCode).toBe(0);
    expect(output).toContain('No profiles found');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// profile switch sub-command
// ═══════════════════════════════════════════════════════════════════════

describe('profile switch', () => {
  beforeEach(() => resetMocks());

  it('switches to an existing profile', async () => {
    (getActiveProfileName as ReturnType<typeof vi.fn>).mockReturnValue('trader1');
    fns.loadFn.mockResolvedValue(true);

    const { output, exitCode } = await runCommand(['profile', 'switch', 'mytrader']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Switched to profile');
    expect(output).toContain('mytrader');
  });

  it('rejects invalid profile name with exit 1', async () => {
    const { output, exitCode } = await runCommand(['profile', 'switch', 'bad name!']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Invalid profile name');
  });

  it('shows info when already on the same profile', async () => {
    (getActiveProfileName as ReturnType<typeof vi.fn>).mockReturnValue('trader1');

    const { output, exitCode } = await runCommand(['profile', 'switch', 'trader1']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Already on profile');
  });

  it('rejects non-existent profile with exit 1', async () => {
    (getActiveProfileName as ReturnType<typeof vi.fn>).mockReturnValue('trader1');
    fns.loadFn.mockResolvedValue(false);

    const { output, exitCode } = await runCommand(['profile', 'switch', 'ghost']);
    expect(exitCode).toBe(1);
    expect(output).toContain('not found');
    expect(output).toContain('profile create');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// profile delete sub-command
// ═══════════════════════════════════════════════════════════════════════

describe('profile delete', () => {
  beforeEach(() => resetMocks());

  it('deletes a non-active profile successfully', async () => {
    (getActiveProfileName as ReturnType<typeof vi.fn>).mockReturnValue('trader1');
    (listProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { profileName: 'trader1', cash: 10000, tradeCount: 0, createdAt: '', updatedAt: '' },
      { profileName: 'mytrader', cash: 5000, tradeCount: 2, createdAt: '', updatedAt: '' },
    ]);

    const { output, exitCode } = await runCommand(['profile', 'delete', 'mytrader']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Deleted profile');
    expect(output).toContain('mytrader');
  });

  it('rejects deleting the active profile with exit 1', async () => {
    (getActiveProfileName as ReturnType<typeof vi.fn>).mockReturnValue('mytrader');

    const { output, exitCode } = await runCommand(['profile', 'delete', 'mytrader']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Cannot delete active profile');
  });

  it('rejects profile not found with exit 1', async () => {
    (getActiveProfileName as ReturnType<typeof vi.fn>).mockReturnValue('trader1');
    (listProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { profileName: 'trader1', cash: 10000, tradeCount: 0, createdAt: '', updatedAt: '' },
    ]);
    // Override existsSync to return false for this test
    const fs = await import('node:fs');
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { output, exitCode } = await runCommand(['profile', 'delete', 'ghost']);
    expect(exitCode).toBe(1);
    expect(output).toContain('not found');
  });

  it('rejects invalid profile name with exit 1', async () => {
    const { output, exitCode } = await runCommand(['profile', 'delete', 'bad name!']);
    expect(exitCode).toBe(1);
    expect(output).toContain('Invalid profile name');
  });

  it('auto-creates trader1 when last profile deleted', async () => {
    (getActiveProfileName as ReturnType<typeof vi.fn>).mockReturnValue('trader1');
    (listProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { profileName: 'other', cash: 5000, tradeCount: 3, createdAt: '', updatedAt: '' },
    ]);
    const result = await runCommand(['profile', 'delete', 'other']);
    // Check output first to see actual error
    expect(result.output).toContain('Last profile deleted');
    expect(result.exitCode).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// profile current sub-command
// ═══════════════════════════════════════════════════════════════════════

describe('profile current', () => {
  beforeEach(() => resetMocks());

  it('displays the active profile name', async () => {
    (getActiveProfileName as ReturnType<typeof vi.fn>).mockReturnValue('mytrader');

    const { output, exitCode } = await runCommand(['profile', 'current']);
    expect(exitCode).toBe(0);
    expect(output.trim()).toBe('mytrader');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// runPaperTradeCli function (export verification)
// ═══════════════════════════════════════════════════════════════════════

describe('runPaperTradeCli', () => {
  it('is exported as a function', async () => {
    const mod = await import('./paper-trade-cli.js');
    expect(typeof mod.runPaperTradeCli).toBe('function');
  });
});
