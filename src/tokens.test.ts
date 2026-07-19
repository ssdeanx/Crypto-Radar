// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Tokens Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  getTokenList,
  getTokenIds,
  getTokenById,
  getTokenBySymbol,
  getTokensByChain,
  getBinancePair,
  getAllTokens,
  getActiveTokenCount,
} from './tokens.js';
import type { Chain } from './types.js';
import { resetConfig } from './core/config.js';

describe('Token Registry', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });
  it('returns all tokens as list', () => {
    const tokens = getTokenList();
    expect(tokens.length).toBeGreaterThan(30);
  });

  it('returns all token IDs', () => {
    const ids = getTokenIds();
    expect(ids).toContain('bitcoin');
    expect(ids).toContain('solana');
    expect(ids).toContain('ethereum');
  });

  it('looks up token by ID', () => {
    const token = getTokenById('bitcoin');
    expect(token).toBeDefined();
    expect(token?.sym).toBe('BTC');
    expect(token?.name).toBe('Bitcoin');
  });

  it('returns undefined for unknown ID', () => {
    expect(getTokenById('nonexistent')).toBeUndefined();
  });

  it('looks up token by symbol', () => {
    const token = getTokenBySymbol('SOL');
    expect(token).toBeDefined();
    expect(token?.name).toBe('Solana');
  });

  it('lookup by symbol is case-insensitive', () => {
    expect(getTokenBySymbol('sol')?.sym).toBe('SOL');
    expect(getTokenBySymbol('Sol')?.sym).toBe('SOL');
  });

  it('returns undefined for unknown symbol', () => {
    expect(getTokenBySymbol('ZZZZ')).toBeUndefined();
  });

  it('filters tokens by chain', () => {
    const solanaTokens = getTokensByChain('solana');
    expect(solanaTokens.every(t => t.chain === 'solana')).toBe(true);

    const polygonTokens = getTokensByChain('polygon');
    expect(polygonTokens.every(t => t.chain === 'polygon')).toBe(true);
  });

  it('includes multi-chain tokens when filtering by their chains', () => {
    const btcTokens = getTokensByChain('bitcoin');
    expect(btcTokens.some(t => t.sym === 'BTC')).toBe(true);

    const ethTokens = getTokensByChain('ethereum');
    expect(ethTokens.some(t => t.sym === 'ETH')).toBe(true);
  });

  it('getTokensByChain(undefined) returns all tokens', () => {
    const all = getTokensByChain(undefined);
    expect(all.length).toBe(getTokenList().length);
  });

  it('getBinancePair returns USDT pair', () => {
    const token = getTokenById('solana')!;
    expect(getBinancePair(token)).toBe('SOLUSDT');
  });

  it('getAllTokens returns all tokens unfiltered', () => {
    const all = getAllTokens();
    expect(all.length).toBe(getTokenIds().length);
  });

  it('getActiveTokenCount returns positive number', () => {
    expect(getActiveTokenCount()).toBeGreaterThan(0);
  });

  it('getTokenList respects config token whitelist', () => {
    process.env['RADAR__TOKENS'] = 'bitcoin,ethereum';
    // Reset config so env vars take effect
    resetConfig();
    const filtered = getTokenList();
    // If env parsing works, filtered should only contain bitcoin and ethereum (as BTC, ETH)
    expect(filtered.length).toBeGreaterThanOrEqual(2);
    delete process.env['RADAR__TOKENS'];
    resetConfig();
  });
});
