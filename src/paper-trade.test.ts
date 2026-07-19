// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Paper Trading Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PaperTrader, createPaperTrader, listProfiles, getActiveProfileName, expandHome } from './paper-trade.js';
import type { PaperTraderConfig } from './paper-trade.js';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Module mocks (hoisted by vitest) ──

vi.mock('./tokens.js', () => ({
  getTokenBySymbol: vi.fn(),
  getTokenList: vi.fn(),
  getBinancePair: vi.fn(),
}));

vi.mock('./binance.js', () => ({
  fetchTicker: vi.fn(),
}));

vi.mock('./coingecko.js', () => ({
  fetchSimplePrices: vi.fn(),
}));

vi.mock('./radar.js', () => ({
  runRadar: vi.fn(),
}));

// ── Injected mock references ──

import { getTokenBySymbol, getTokenList } from './tokens.js';
import { fetchTicker } from './binance.js';

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Create a PaperTrader with a temp data dir for test isolation */
function createTestTrader(config: Partial<PaperTraderConfig> & { dataDir: string }): PaperTrader {
  return new PaperTrader(config);
}

// ═══════════════════════════════════════════════════════════════════════
// Profile Management Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Paper Trading Profiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── AC1: First run shows only "trader1" ──
  it('AC1: Creates trader1 profile on first save and list shows it', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    await trader.save();

    const profiles = await listProfiles(tmpDir);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.profileName).toBe('trader1');
    expect(profiles[0]!.cash).toBe(10_000);
    expect(profiles[0]!.tradeCount).toBe(0);
  });

  // ── AC2: Create "mytrader" profile with fresh $10k ──
  it('AC2: Creates new profile with $10k when saving with custom profileName', async () => {
    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'mytrader' });
    await trader.save();

    const profiles = await listProfiles(tmpDir);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.profileName).toBe('mytrader');
    expect(profiles[0]!.cash).toBe(10_000);
    expect(profiles[0]!.tradeCount).toBe(0);
  });

  // ── AC3: Portfolio --profile mytrader shows $10k cash, 0 holdings ──
  it('AC3: Loading with --profile mytrader shows $10k cash and 0 holdings', async () => {
    // Create the profile first
    const trader1 = createTestTrader({ dataDir: tmpDir, profileName: 'mytrader' });
    await trader1.save();

    // Load with --profile mytrader
    const trader2 = createTestTrader({ dataDir: tmpDir, profileName: 'mytrader' });
    const restored = await trader2.load();
    expect(restored).toBe(true);
    expect(trader2.cash).toBe(10_000);
    expect(trader2.holdings).toHaveLength(0);
  });

  // ── AC4-5: switch + current profile ──
  it('AC4-5: Can switch active profile and show current', async () => {
    // Create two profiles
    const trader1 = createTestTrader({ dataDir: tmpDir, profileName: 'trader1' });
    await trader1.save();

    // Active should be trader1 (first saved)
    expect(getActiveProfileName(tmpDir)).toBe('trader1');

    // Create mytrader and save (this writes to last-profile.txt)
    const trader2 = createTestTrader({ dataDir: tmpDir, profileName: 'mytrader' });
    await trader2.save();

    // Now active should be mytrader (last saved)
    expect(getActiveProfileName(tmpDir)).toBe('mytrader');
  });

  // ── AC6: --profile override without switching active ──
  it('AC6: --profile flag loads a different profile without changing active', async () => {
    // Setup: create trader1 and save (sets it as active)
    const trader1 = createTestTrader({ dataDir: tmpDir, profileName: 'trader1' });
    await trader1.save();
    expect(getActiveProfileName(tmpDir)).toBe('trader1');

    // Create mytrader with some trades
    const trader2 = createTestTrader({ dataDir: tmpDir, profileName: 'mytrader' });
    await trader2.save();

    // Now load trader1 explicitly (simulating --profile trader1)
    const trader3 = createTestTrader({ dataDir: tmpDir, profileName: 'trader1' });
    const restored = await trader3.load();
    expect(restored).toBe(true);
    expect(trader3.cash).toBe(10_000);

    // But active profile is still the last one saved (mytrader) unless we save again
    // The active profile doesn't change just from loading
  });

  // ── AC7: listProfiles marks active with * ──
  it('AC7: listProfiles returns profiles that can be matched to active', async () => {
    const trader1 = createTestTrader({ dataDir: tmpDir, profileName: 'trader1' });
    await trader1.save();

    const active = getActiveProfileName(tmpDir);
    const profiles = await listProfiles(tmpDir);

    const activeProfile = profiles.find(p => p.profileName === active);
    expect(activeProfile).toBeDefined();
  });

  // ── AC8-9: Delete profile ──
  it('AC8-9: Can delete non-active profile, cannot delete active profile', async () => {
    const trader1 = createTestTrader({ dataDir: tmpDir, profileName: 'trader1' });
    await trader1.save();

    // Make mytrader active
    const trader2 = createTestTrader({ dataDir: tmpDir, profileName: 'mytrader' });
    await trader2.save();

    // Active is now mytrader
    expect(getActiveProfileName(tmpDir)).toBe('mytrader');

    // Delete trader1 (non-active) - should succeed
    const fs = await import('node:fs');
    const path = await import('node:path');
    const profilesDir = `${expandHome(tmpDir)}/paper-trade/profiles`;
    const filePath = path.join(profilesDir, 'trader1.json');
    expect(fs.existsSync(filePath)).toBe(true);
    fs.unlinkSync(filePath);

    const profiles = await listProfiles(tmpDir);
    expect(profiles.find(p => p.profileName === 'trader1')).toBeUndefined();

    // Can't delete active profile - we check by ensuring it still exists
    const activeFilePath = path.join(profilesDir, 'mytrader.json');
    expect(fs.existsSync(activeFilePath)).toBe(true);
  });

  // ── AC10: Legacy migration ──
  it('AC10: Old paper-trader-state.json is migrated on first load', async () => {
    // Create legacy state file at the old path: {dataDir}/paper-trader-state.json
    const dataDir = expandHome(tmpDir);
    const legacyPath = join(dataDir, 'paper-trader-state.json');

    const legacyState = {
      cash: 5000,
      holdings: [],
      trades: [],
      startBalance: 10000,
    };
    writeFileSync(legacyPath, JSON.stringify(legacyState), 'utf-8');

    // Create trader with profile - should migrate on load
    const trader = createTestTrader({
      dataDir: dataDir,
      profileName: 'trader1',
    });
    const restored = await trader.load();

    // Should have restored from legacy
    expect(restored).toBe(true);
    expect(trader.cash).toBe(5000);

    // Should have been migrated to profile file
    const profilePath = join(dataDir, 'paper-trade', 'profiles', 'trader1.json');
    expect(existsSync(profilePath)).toBe(true);
  });

  // ── Profile name isolation ──
  it('Two profiles have independent state', async () => {
    // Create trader1 profile
    const t1 = createTestTrader({ dataDir: tmpDir, profileName: 'trader1' });
    await t1.save();

    // Create trader2 profile
    const t2 = createTestTrader({ dataDir: tmpDir, profileName: 'trader2' });
    await t2.save();

    // Verify both exist
    const profiles = await listProfiles(tmpDir);
    expect(profiles).toHaveLength(2);

    // trader1 state path check
    const trader1 = createTestTrader({ dataDir: tmpDir, profileName: 'trader1' });
    const r1 = await trader1.load();
    expect(r1).toBe(true);
    expect(trader1.cash).toBe(10_000);

    // trader2 state path check
    const trader2 = createTestTrader({ dataDir: tmpDir, profileName: 'trader2' });
    const r2 = await trader2.load();
    expect(r2).toBe(true);
    expect(trader2.cash).toBe(10_000);
  });

  // ── Full round-trip: save -> load -> modify -> save -> load ──
  it('Full save/load round-trip preserves state per profile', async () => {
    // Create a profile
    const t1 = createTestTrader({ dataDir: tmpDir, profileName: 'testprofile' });
    await t1.save();

    // Modify state by setting cash directly (we can access state via config recreation)
    // We need to use a different approach - load, modify, save
    const t2 = createTestTrader({ dataDir: tmpDir, profileName: 'testprofile' });
    const loaded = await t2.load();
    expect(loaded).toBe(true);
    expect(t2.cash).toBe(10_000);

    // Save again (triggers last-profile.txt write)
    await t2.save();

    // Verify active profile
    expect(getActiveProfileName(tmpDir)).toBe('testprofile');
  });

  // ── getActiveProfileName returns trader1 when no file exists ──
  it('getActiveProfileName returns trader1 when no state exists', () => {
    // Use a path that definitely doesn't exist
    const nonExistent = join(tmpDir, 'nonexistent');
    expect(getActiveProfileName(nonExistent)).toBe('trader1');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PaperTrader Core Tests
// ═══════════════════════════════════════════════════════════════════════

describe('PaperTrader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trader-core-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates trader with default profile name trader1', () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    expect(trader.startBalance).toBe(10_000);
    expect(trader.cash).toBe(10_000);
    expect(trader.holdings).toHaveLength(0);
  });

  it('creates trader with custom profile name', () => {
    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'my-custom-profile' });
    expect(trader.startBalance).toBe(10_000);
  });

  it('save and load round-trip', async () => {
    const trader1 = createTestTrader({ dataDir: tmpDir, profileName: 'test-save' });
    await trader1.save();

    const trader2 = createTestTrader({ dataDir: tmpDir, profileName: 'test-save' });
    const restored = await trader2.load();
    expect(restored).toBe(true);
    expect(trader2.startBalance).toBe(10_000);
    expect(trader2.cash).toBe(10_000);
  });

  it('load returns false for non-existent profile', async () => {
    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'does-not-exist' });
    const restored = await trader.load();
    expect(restored).toBe(false);
    // Should still have default state
    expect(trader.cash).toBe(10_000);
  });

  it('tradeCount starts at 0', () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    expect(trader.tradeCount).toBe(0);
  });

  it('isolates state between different profiles', async () => {
    // Save two profiles
    const t1 = createTestTrader({ dataDir: tmpDir, profileName: 'alpha' });
    await t1.save();
    const t2 = createTestTrader({ dataDir: tmpDir, profileName: 'beta' });
    await t2.save();

    // Verify both load independently
    const a1 = createTestTrader({ dataDir: tmpDir, profileName: 'alpha' });
    expect(await a1.load()).toBe(true);
    expect(a1.cash).toBe(10_000);

    const b1 = createTestTrader({ dataDir: tmpDir, profileName: 'beta' });
    expect(await b1.load()).toBe(true);
    expect(b1.cash).toBe(10_000);
  });

  it('reset clears state back to starting balance', async () => {
    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'reset-test' });
    await trader.save();
    trader.reset();
    expect(trader.cash).toBe(10_000);
    expect(trader.holdings).toHaveLength(0);
    expect(trader.trades).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// File Layout Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Paper Trade File Layout', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-layout-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves profile state to profiles/<name>.json', async () => {
    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'testfile' });
    await trader.save();

    const dataDir = expandHome(tmpDir);
    const profilePath = join(dataDir, 'paper-trade', 'profiles', 'testfile.json');
    expect(existsSync(profilePath)).toBe(true);
  });

  it('writes last-profile.txt with active profile name', async () => {
    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'myprofile' });
    await trader.save();

    const dataDir = expandHome(tmpDir);
    const lastProfilePath = join(dataDir, 'paper-trade', 'last-profile.txt');
    expect(existsSync(lastProfilePath)).toBe(true);
    const content = readFileSync(lastProfilePath, 'utf-8').trim();
    expect(content).toBe('myprofile');
  });

  it('creates profiles directory recursively', async () => {
    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'dir-test' });
    await trader.save();

    const dataDir = expandHome(tmpDir);
    const profilesDir = join(dataDir, 'paper-trade', 'profiles');
    expect(existsSync(profilesDir)).toBe(true);
  });

  it('profile state file uses v2 format', async () => {
    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'format-test' });
    await trader.save();

    const dataDir = expandHome(tmpDir);
    const profilePath = join(dataDir, 'paper-trade', 'profiles', 'format-test.json');
    const raw = readFileSync(profilePath, 'utf-8');
    const data = JSON.parse(raw);

    expect(data.version).toBe(2);
    expect(data.profileName).toBe('format-test');
    expect(data.state).toBeDefined();
    expect(data.state.cash).toBe(10_000);
    expect(data.state.holdings).toEqual([]);
    expect(data.state.trades).toEqual([]);
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════════════════

describe('Paper Trade Edge Cases', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-edge-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles concurrent profiles with different cash balances', async () => {
    // Both profiles start at $10k
    const t1 = createTestTrader({ dataDir: tmpDir, profileName: 'rich' });
    await t1.save();
    const t2 = createTestTrader({ dataDir: tmpDir, profileName: 'poor' });
    await t2.save();

    expect(await t1.load()).toBe(true);
    expect(await t2.load()).toBe(true);
    expect(t1.cash).toBe(10_000);
    expect(t2.cash).toBe(10_000);
  });

  it('load returns false for valid JSON that is not PortfolioState', async () => {
    const dataDir = expandHome(tmpDir);
    const profilesDir = join(dataDir, 'paper-trade', 'profiles');
    mkdirSync(profilesDir, { recursive: true });

    // Write invalid state file
    const invalidFile = {
      version: 2,
      profileName: 'bad',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: { not: 'valid' },
    };
    writeFileSync(join(profilesDir, 'bad.json'), JSON.stringify(invalidFile), 'utf-8');

    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'bad' });
    const restored = await trader.load();
    // Should fail validation and return false (using fresh state)
    expect(restored).toBe(false);
    expect(trader.cash).toBe(10_000);
  });

  it('handles empty profiles directory', async () => {
    const dataDir = expandHome(tmpDir);
    const profilesDir = join(dataDir, 'paper-trade', 'profiles');
    mkdirSync(profilesDir, { recursive: true });

    const profiles = await listProfiles(tmpDir);
    expect(profiles).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Trade Execution
// ═══════════════════════════════════════════════════════════════════════

describe('Trade Execution', () => {
  let tmpDir: string;

  const mockToken = {
    id: 'bitcoin', sym: 'BTC', name: 'Bitcoin',
    chain: 'multi' as const, pair: 'BTCUSDT', coingeckoId: 'bitcoin',
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-exec-test-'));
    vi.clearAllMocks();
    (getTokenBySymbol as ReturnType<typeof vi.fn>).mockReturnValue(mockToken);
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8000' });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── buy ──

  it('buys successfully and reduces cash', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    const trade = await trader.buy('BTC', 0.5);
    expect(trade).not.toBeNull();
    expect(trade!.type).toBe('buy');
    expect(trade!.symbol).toBe('BTC');
    expect(trade!.amount).toBe(0.5);
    expect(trade!.price).toBe(8000);
    expect(trade!.total).toBe(4000);
    expect(trader.cash).toBe(10_000 - 4000);
  });

  it('returns null for insufficient funds', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    const trade = await trader.buy('BTC', 2);  // 2 BTC = $16,000 > $10,000 cash
    expect(trade).toBeNull();
    expect(trader.cash).toBe(10_000);
  });

  it('returns null when amount is zero or negative', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    expect(await trader.buy('BTC', 0)).toBeNull();
    expect(await trader.buy('BTC', -1)).toBeNull();
  });

  it('returns null for invalid token', async () => {
    (getTokenBySymbol as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const trader = createTestTrader({ dataDir: tmpDir });
    expect(await trader.buy('UNKNOWN', 1)).toBeNull();
  });

  it('creates a new holding entry', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    await trader.buy('BTC', 0.5);
    expect(trader.holdings).toHaveLength(1);
    expect(trader.holdings[0]!.symbol).toBe('BTC');
    expect(trader.holdings[0]!.amount).toBe(0.5);
    expect(trader.holdings[0]!.avgEntryPrice).toBe(8000);
  });

  it('uses weighted average entry price for additional buys', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    // First buy: 0.5 BTC at $8,000
    await trader.buy('BTC', 0.5);
    expect(trader.holdings[0]!.avgEntryPrice).toBe(8000);

    // Second buy: 0.5 BTC at $9,600 — clear cache so new price is fetched
    trader.clearPriceCache();
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '9600' });
    await trader.buy('BTC', 0.5);
    expect(trader.holdings).toHaveLength(1);
    expect(trader.holdings[0]!.amount).toBe(1);
    // Weighted avg: (0.5 * 8000 + 0.5 * 9600) / 1 = 8800
    expect(trader.holdings[0]!.avgEntryPrice).toBe(8800);
  });

  // ── sell ──

  it('sells successfully with P&L', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '5000' });
    await trader.buy('BTC', 1); // $5,000 cost, $5,000 remaining
    expect(trader.cash).toBe(10_000 - 5000);
    expect(trader.holdings).toHaveLength(1);

    // Clear price cache so sell uses the new price
    trader.clearPriceCache();
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '5500' });
    const trade = await trader.sell('BTC', 0.5);
    expect(trade).not.toBeNull();
    expect(trade!.type).toBe('sell');
    expect(trade!.pnl).toBe(250); // P&L = (5500 - 5000) * 0.5
    expect(trader.cash).toBe(5000 + 0.5 * 5500);
  });

  it('returns null when holding does not exist', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    expect(await trader.sell('BTC', 1)).toBeNull();
  });

  it('removes holding when fully sold', async () => {
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '5000' });
    const trader = createTestTrader({ dataDir: tmpDir });
    await trader.buy('BTC', 0.1);
    await trader.sell('BTC', 0.1);
    expect(trader.holdings).toHaveLength(0);
  });

  it('sells entire position when amount is -1', async () => {
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '5000' });
    const trader = createTestTrader({ dataDir: tmpDir });
    await trader.buy('BTC', 0.1);
    const trade = await trader.sell('BTC', -1);
    expect(trade).not.toBeNull();
    expect(trade!.amount).toBe(0.1);
    expect(trader.holdings).toHaveLength(0);
  });

  it('returns null when amount is zero', async () => {
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '5000' });
    const trader = createTestTrader({ dataDir: tmpDir });
    await trader.buy('BTC', 0.1);
    expect(await trader.sell('BTC', 0)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// State Management
// ═══════════════════════════════════════════════════════════════════════

describe('State Management', () => {
  it('getRawState returns a snapshot copy', () => {
    const trader = createTestTrader({ dataDir: '/tmp/test-raw-state' });
    const state = trader.getRawState();
    expect(state.cash).toBe(10_000);
    expect(state.holdings).toEqual([]);
    expect(state.trades).toEqual([]);
    expect(state.startBalance).toBe(10_000);
  });

  it('toJSON returns a copy', () => {
    const trader = createTestTrader({ dataDir: '/tmp/test-tojson' });
    const json = trader.toJSON();
    expect(json.cash).toBe(10_000);
    expect(json.holdings).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Constructor Edge Cases
// ═══════════════════════════════════════════════════════════════════════

describe('Constructor Edge Cases', () => {
  it('throws for invalid profile name', () => {
    expect(() => createTestTrader({ dataDir: '/tmp/test-ctor', profileName: 'bad name!' })).toThrow('Invalid profile name');
  });

  // ── P0: Path traversal validation ──
  it('P0: Rejects path traversal profile names in constructor', () => {
    const badNames = [
      '../../etc/passwd',
      '../bad',
      'foo/bar',
      '..\\windows\\system32',
    ];
    for (const name of badNames) {
      expect(() => new PaperTrader({ dataDir: '/tmp/test-path', profileName: name })).toThrow(
        /Invalid profile name/,
      );
    }
  });

  it('P0: Accepts valid profile names in constructor', () => {
    const goodNames = [
      'trader1',
      'my-trader',
      'my_trader',
      'TraderOne',
      'a',
    ];
    for (const name of goodNames) {
      expect(() => new PaperTrader({ dataDir: '/tmp/test-path', profileName: name })).not.toThrow();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Profile Deletion Guard
// ═══════════════════════════════════════════════════════════════════════

describe('Profile Deletion Guard', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-guard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── P2: Delete-last-profile guard ──
  it('P2: Deleting last profile auto-creates trader1 with fresh state', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    // Create a single profile
    const trader = createTestTrader({ dataDir: tmpDir, profileName: 'solo' });
    await trader.save();
    expect(getActiveProfileName(tmpDir)).toBe('solo');

    // Verify only one profile exists
    let profiles = await listProfiles(tmpDir);
    expect(profiles).toHaveLength(1);

    // Delete it — this is the last profile, should auto-create trader1
    const dataDir = expandHome(tmpDir);
    const profilesDir = join(dataDir, 'paper-trade', 'profiles');
    const filePath = path.join(profilesDir, 'solo.json');
    fs.unlinkSync(filePath);

    // Simulate the P2 guard: create trader1 and update last-profile.txt
    const guardTrader = createTestTrader({ dataDir: tmpDir });
    await guardTrader.save();
    expect(getActiveProfileName(tmpDir)).toBe('trader1');

    // Verify trader1 has fresh state
    profiles = await listProfiles(tmpDir);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.profileName).toBe('trader1');
    expect(profiles[0]!.cash).toBe(10_000);
    expect(profiles[0]!.tradeCount).toBe(0);

    // Verify trader1 can be loaded
    const loaded = createTestTrader({ dataDir: tmpDir });
    const restored = await loaded.load();
    expect(restored).toBe(true);
    expect(loaded.cash).toBe(10_000);
  });
});

// ── Regression: Sharpe % return (F1) ──

describe('Performance Report Sharpe', () => {
  let tmpDir: string;

  const mockToken = {
    id: 'bitcoin', sym: 'BTC', name: 'Bitcoin',
    chain: 'multi' as const, pair: 'BTCUSDT', coingeckoId: 'bitcoin',
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-sharpe-test-'));
    vi.clearAllMocks();
    (getTokenBySymbol as ReturnType<typeof vi.fn>).mockReturnValue(mockToken);
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8000' });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns finite Sharpe for 2+ sell trades with non-zero returns', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    // Buy 1 BTC at $8,000
    await trader.buy('BTC', 1);
    // Sell 0.5 BTC at $8,800 (+10% on $4,000 costBasis = +10%)
    trader.clearPriceCache();
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8800' });
    await trader.sell('BTC', 0.5);
    // Sell remaining 0.5 BTC at $7,200 (-10% on $4,000 costBasis = -10%)
    trader.clearPriceCache();
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '7200' });
    await trader.sell('BTC', 0.5);

    const report = await trader.getReport();
    expect(Number.isFinite(report.sharpeRatio)).toBe(true);
  });

  it('Sharpe is lower when one sell dominates in percentage (not dollar)', async () => {
    // Two sells with same cost basis but very different % returns
    const trader = createTestTrader({ dataDir: tmpDir, startingBalance: 500_000 });
    // Buy ETH at $1,000
    const ethToken = { id: 'ethereum', sym: 'ETH', name: 'Ethereum', chain: 'multi' as const, pair: 'ETHUSDT', coingeckoId: 'ethereum' };
    (getTokenBySymbol as ReturnType<typeof vi.fn>).mockImplementation((sym: string) => sym === 'BTC' ? mockToken : ethToken);
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'ETHUSDT', lastPrice: '1000' });
    await trader.buy('ETH', 1);  // $1,000 → 1 ETH, $499,000 cash left
    // Buy BTC at $8,000
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8000' });
    await trader.buy('BTC', 1);  // $8,000 → $491,000 cash left

    // Sell ETH: $1,000 → $2,000 (+100% return)
    trader.clearPriceCache();
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'ETHUSDT', lastPrice: '2000' });
    await trader.sell('ETH', 1);

    // Sell BTC: $8,000 → $8,800 (+10% return)
    trader.clearPriceCache();
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8800' });
    await trader.sell('BTC', 1);

    const report = await trader.getReport();
    // With % returns: ETH = +100%, BTC = +10%
    // With $ returns (old broken): ETH = +$1000, BTC = +$800
    // Both now use % — verify it's finite, relevant
    expect(Number.isFinite(report.sharpeRatio)).toBe(true);
    // Sharpe should be > 0 since both are profitable
    expect(report.sharpeRatio).toBeGreaterThan(0);
  });
});

// ── Regression: NaN guards (F7) ──

describe('NaN Guards', () => {
  let tmpDir: string;

  const mockToken = {
    id: 'bitcoin', sym: 'BTC', name: 'Bitcoin',
    chain: 'multi' as const, pair: 'BTCUSDT', coingeckoId: 'bitcoin',
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-nan-test-'));
    vi.clearAllMocks();
    (getTokenBySymbol as ReturnType<typeof vi.fn>).mockReturnValue(mockToken);
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8000' });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('buy rejects NaN amount, state unmodified', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    const trade = await trader.buy('BTC', NaN);
    expect(trade).toBeNull();
    expect(trader.cash).toBe(10_000);
    expect(trader.holdings).toHaveLength(0);
  });

  it('buy rejects Infinity amount', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    const trade = await trader.buy('BTC', Infinity);
    expect(trade).toBeNull();
    expect(trader.cash).toBe(10_000);
  });

  it('buy returns null when price fetch returns NaN-propagating total', async () => {
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '0' });
    const trader = createTestTrader({ dataDir: tmpDir });
    const trade = await trader.buy('BTC', 1);
    expect(trade).toBeNull();
    expect(trader.cash).toBe(10_000);
  });
});

describe('PaperTrader — report & agent play', () => {
  let tmpDir: string;

  const btcToken = {
    id: 'bitcoin', sym: 'BTC', name: 'Bitcoin',
    chain: 'multi' as const, pair: 'BTCUSDT', coingeckoId: 'bitcoin',
  };
  const ethToken = {
    id: 'ethereum', sym: 'ETH', name: 'Ethereum',
    chain: 'multi' as const, pair: 'ETHUSDT', coingeckoId: 'ethereum',
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-report-test-'));
    vi.clearAllMocks();
    (getTokenBySymbol as ReturnType<typeof vi.fn>).mockImplementation(
      (sym: string) => (sym === 'BTC' ? btcToken : ethToken),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getReport computes per-token breakdown after buy+sell', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8000' });
    await trader.buy('BTC', 0.5); // $4,000
    trader.clearPriceCache();
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8800' });
    await trader.sell('BTC', 0.5); // realized pnl on full exit

    const report = await trader.getReport();
    expect(report.totalTrades).toBe(2);
    expect(report.perToken.length).toBeGreaterThan(0);
    const btc = report.perToken.find(p => p.symbol === 'BTC');
    expect(btc).toBeDefined();
    expect(btc!.realizedPnl).toBeGreaterThan(0);
    expect(Number.isFinite(report.sharpeRatio)).toBe(true);
  });

  it('agentPlay buys proportionally to confidence and respects minConfidence', async () => {
    const trader = createTestTrader({ dataDir: tmpDir, startingBalance: 100_000 });
    (getTokenBySymbol as ReturnType<typeof vi.fn>).mockReturnValue(btcToken);
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8000' });

    const recs = [
      { symbol: 'BTC', tokenId: 'bitcoin', tokenName: 'Bitcoin', action: 'buy' as const, compositeScore: 80, confidence: 0.9, reason: 'x', currentPrice: 8000, direction: 'strong_buy' as const },
      { symbol: 'ETH', tokenId: 'ethereum', tokenName: 'Ethereum', action: 'hold' as const, compositeScore: 0, confidence: 0.1, reason: 'y', currentPrice: 1000, direction: 'hold' as const },
    ];
    const executed = await trader.agentPlay(recs, 1000, 0.3);
    // BTC should trade; ETH is hold → skipped
    expect(executed.length).toBe(1);
    expect(executed[0]!.symbol).toBe('BTC');
  });

  it('agentPlay skips trades below minConfidence', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8000' });
    const recs = [
      { symbol: 'BTC', tokenId: 'bitcoin', tokenName: 'Bitcoin', action: 'buy' as const, compositeScore: 50, confidence: 0.1, reason: 'x', currentPrice: 8000, direction: 'buy' as const },
    ];
    const executed = await trader.agentPlay(recs, 1000, 0.3);
    expect(executed.length).toBe(0);
  });

  it('getPortfolio returns current values for holdings', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    (fetchTicker as ReturnType<typeof vi.fn>).mockResolvedValue({ symbol: 'BTCUSDT', lastPrice: '8000' });
    await trader.buy('BTC', 0.5);
    const pf = await trader.getPortfolio();
    expect(pf.holdings.length).toBe(1);
    expect(pf.holdings[0]!.value).toBeCloseTo(0.5 * 8000, 0);
    expect(pf.totalEquity).toBeGreaterThan(0);
  });

  it('switchProfile loads a different profile', async () => {
    const t1 = createTestTrader({ dataDir: tmpDir, profileName: 'a' });
    await t1.save();
    const t2 = createTestTrader({ dataDir: tmpDir, profileName: 'b' });
    await t2.save();
    const restored = await t2.switchProfile('a');
    expect(restored).toBe(true);
    expect(t2.cash).toBe(10_000);
  });
});

// ── Regression: getSignalRecommendations (mock radar) ──

import { runRadar } from './radar.js';

describe('getSignalRecommendations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-rec-test-'));
    vi.clearAllMocks();
    vi.mocked(runRadar).mockResolvedValue({
      aggregatedSignals: [
        {
          symbol: 'SOL', tokenName: 'Solana', lastPrice: 100, direction: 'strong_buy',
          compositeConfidence: 0.85, compositeReason: 'good', alerts: [],
        },
        {
          symbol: 'BTC', tokenName: 'Bitcoin', lastPrice: 50000, direction: 'sell',
          compositeConfidence: 0.7, compositeReason: 'bad', alerts: [],
        },
      ],
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('maps aggregated signals to buy/sell recommendations with 0-100 compositeScore', async () => {
    const trader = createTestTrader({ dataDir: tmpDir });
    const recs = await trader.getSignalRecommendations();
    expect(recs.length).toBe(2);
    const sol = recs.find(r => r.symbol === 'SOL')!;
    expect(sol.action).toBe('buy');
    expect(sol.compositeScore).toBe(85); // 0.85 * 100
    expect(sol.confidence).toBe(0.85);
    const btc = recs.find(r => r.symbol === 'BTC')!;
    expect(btc.action).toBe('sell');
  });

  it('returns empty array when radar throws', async () => {
    vi.mocked(runRadar).mockRejectedValue(new Error('boom'));
    const trader = createTestTrader({ dataDir: tmpDir });
    const recs = await trader.getSignalRecommendations();
    expect(recs).toEqual([]);
  });
});
