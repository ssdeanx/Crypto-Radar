// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Token Registry
// ═══════════════════════════════════════════════════════════════════════

import type { TokenDef, Chain } from './types.js';
import { loadConfig } from './core/config.js';
import { fetchAllUsdtTickers } from './binance.js';

/**
 * Master token registry.
 *
 * Keyed by CoinGecko ID (canonical). `sym` is the Binance trading symbol
 * (without USDT suffix). `chain` is the primary trading chain; `multi`
 * tokens have a `chains` array for actual chains.
 */
const TOKENS: Record<string, TokenDef> = {
  // ── Polygon / DeFi ──
  'polygon-ecosystem-token':   { id: 'polygon-ecosystem-token',   sym: 'POL',   name: 'Polygon (ex-MATIC)',  chain: 'polygon', coingeckoId: 'polygon-ecosystem-token' },
  'sushi':                     { id: 'sushi',                     sym: 'SUSHI', name: 'SushiSwap',            chain: 'polygon', coingeckoId: 'sushi' },
  'uniswap':                   { id: 'uniswap',                   sym: 'UNI',   name: 'Uniswap',              chain: 'polygon', coingeckoId: 'uniswap' },
  'aave':                      { id: 'aave',                      sym: 'AAVE',  name: 'Aave',                 chain: 'polygon', coingeckoId: 'aave' },
  'curve-dao-token':           { id: 'curve-dao-token',           sym: 'CRV',   name: 'Curve DAO',            chain: 'polygon', coingeckoId: 'curve-dao-token' },
  'chainlink':                 { id: 'chainlink',                 sym: 'LINK',  name: 'Chainlink',            chain: 'polygon', coingeckoId: 'chainlink' },
  'quick':                     { id: 'quick',                     sym: 'QUICK', name: 'Quickswap',            chain: 'polygon', coingeckoId: 'quick' },
  'balancer':                  { id: 'balancer',                  sym: 'BAL',   name: 'Balancer',             chain: 'polygon', coingeckoId: 'balancer' },
  'lido-dao':                  { id: 'lido-dao',                  sym: 'LDO',   name: 'Lido DAO',             chain: 'polygon', coingeckoId: 'lido-dao' },
  'basic-attention-token':     { id: 'basic-attention-token',     sym: 'BAT',   name: 'Basic Attention Token', chain: 'polygon', coingeckoId: 'basic-attention-token' },
  'compound-governance-token': { id: 'compound-governance-token', sym: 'COMP',  name: 'Compound',             chain: 'polygon', coingeckoId: 'compound-governance-token' },
  'layerzero':                 { id: 'layerzero',                 sym: 'ZRO',   name: 'LayerZero',            chain: 'polygon', coingeckoId: 'layerzero' },
  'the-graph':                 { id: 'the-graph',                 sym: 'GRT',   name: 'The Graph',            chain: 'polygon', coingeckoId: 'the-graph' },

  // ── Solana Ecosystem ──
  'solana':     { id: 'solana',     sym: 'SOL',    name: 'Solana',       chain: 'solana', coingeckoId: 'solana' },
  'jupiter':    { id: 'jupiter',    sym: 'JUP',    name: 'Jupiter',      chain: 'solana', coingeckoId: 'jupiter' },
  'jito':       { id: 'jito',       sym: 'JTO',    name: 'Jito',         chain: 'solana', coingeckoId: 'jito' },
  'raydium':    { id: 'raydium',    sym: 'RAY',    name: 'Raydium',      chain: 'solana', coingeckoId: 'raydium' },
  'pyth-network': { id: 'pyth-network', sym: 'PYTH', name: 'Pyth Network', chain: 'solana', coingeckoId: 'pyth-network' },
  'bonk':       { id: 'bonk',       sym: 'BONK',   name: 'Bonk',         chain: 'solana', coingeckoId: 'bonk' },
  'kamino':     { id: 'kamino',     sym: 'KMNO',   name: 'Kamino',       chain: 'solana', coingeckoId: 'kamino' },
  'pump-fun':   { id: 'pump-fun',   sym: 'PUMP',   name: 'Pump.fun',     chain: 'solana', coingeckoId: 'pump-fun' },
  'render-token': { id: 'render-token', sym: 'RENDER', name: 'Render',   chain: 'solana', coingeckoId: 'render-token' },
  'orca':       { id: 'orca',       sym: 'ORCA',   name: 'Orca',         chain: 'solana', coingeckoId: 'orca' },
  'bonfida':    { id: 'bonfida',    sym: 'FIDA',   name: 'Bonfida',      chain: 'solana', coingeckoId: 'bonfida' },
  'dogwifcoin': { id: 'dogwifcoin', sym: 'WIF',    name: 'dogwifcoin',   chain: 'solana', coingeckoId: 'dogwifcoin' },
  'book-of-meme': { id: 'book-of-meme', sym: 'BOME', name: 'Book of Meme', chain: 'solana', coingeckoId: 'book-of-meme' },
  'audius':     { id: 'audius',     sym: 'AUDIO',  name: 'Audius',       chain: 'solana', coingeckoId: 'audius' },

  // ── Multi-chain (broad market) ──
  'binancecoin': { id: 'binancecoin', sym: 'BNB',  name: 'Binance Coin', chain: 'multi', chains: ['bnb'],      coingeckoId: 'binancecoin' },
  'bitcoin':     { id: 'bitcoin',     sym: 'BTC',  name: 'Bitcoin',      chain: 'multi', chains: ['bitcoin'],  coingeckoId: 'bitcoin' },
  'ethereum':    { id: 'ethereum',    sym: 'ETH',  name: 'Ethereum',     chain: 'multi', chains: ['ethereum'], coingeckoId: 'ethereum' },
  'dogecoin':    { id: 'dogecoin',    sym: 'DOGE', name: 'Dogecoin',     chain: 'multi', chains: ['dogecoin'], coingeckoId: 'dogecoin' },
  'xrp':         { id: 'xrp',         sym: 'XRP',  name: 'XRP',          chain: 'multi', chains: ['xrp'],      coingeckoId: 'ripple' },
  'cardano':     { id: 'cardano',     sym: 'ADA',  name: 'Cardano',      chain: 'multi', chains: ['cardano'],  coingeckoId: 'cardano' },

  // ── Layer-1 & Cross-chain (Phase C) ──
  'sui':                 { id: 'sui',                 sym: 'SUI',  name: 'Sui',            chain: 'multi', chains: ['sui'],        coingeckoId: 'sui' },
  'aptos':               { id: 'aptos',               sym: 'APT',  name: 'Aptos',          chain: 'multi', chains: ['aptos'],      coingeckoId: 'aptos' },
  'sei-network':         { id: 'sei-network',         sym: 'SEI',  name: 'Sei',            chain: 'multi', chains: ['sei'],        coingeckoId: 'sei-network' },
  'celestia':            { id: 'celestia',            sym: 'TIA',  name: 'Celestia',       chain: 'multi', chains: ['celestia'],   coingeckoId: 'celestia' },
  'injective-protocol':  { id: 'injective-protocol',  sym: 'INJ',  name: 'Injective',      chain: 'multi', chains: ['injective'],  coingeckoId: 'injective-protocol' },
  'thorchain':           { id: 'thorchain',           sym: 'RUNE', name: 'THORChain',      chain: 'multi', chains: ['thorchain'],  coingeckoId: 'thorchain' },
  'cosmos':              { id: 'cosmos',              sym: 'ATOM', name: 'Cosmos',         chain: 'multi', chains: ['cosmos'],     coingeckoId: 'cosmos' },

  // ── Layer-1 & Broader Market (Phase D — Binance top-50 coverage) ──
  'near-protocol':     { id: 'near-protocol',     sym: 'NEAR',  name: 'NEAR Protocol',       chain: 'multi', chains: ['near'],       coingeckoId: 'near' },
  'tron':              { id: 'tron',              sym: 'TRX',   name: 'TRON',                chain: 'multi', chains: ['tron'],       coingeckoId: 'tron' },
  'stellar':           { id: 'stellar',           sym: 'XLM',   name: 'Stellar',             chain: 'multi', chains: ['stellar'],    coingeckoId: 'stellar' },
  'avalanche-2':       { id: 'avalanche-2',       sym: 'AVAX',  name: 'Avalanche',           chain: 'multi', chains: ['avalanche'],  coingeckoId: 'avalanche-2' },
  'litecoin':          { id: 'litecoin',          sym: 'LTC',   name: 'Litecoin',            chain: 'multi', chains: ['litecoin'],   coingeckoId: 'litecoin' },
  'bitcoin-cash':      { id: 'bitcoin-cash',      sym: 'BCH',   name: 'Bitcoin Cash',        chain: 'multi', chains: ['bitcoin-cash'], coingeckoId: 'bitcoin-cash' },
  'hedera-hashgraph':  { id: 'hedera-hashgraph',  sym: 'HBAR',  name: 'Hedera',              chain: 'multi', chains: ['hedera'],     coingeckoId: 'hedera-hashgraph' },
  'bittensor':         { id: 'bittensor',         sym: 'TAO',   name: 'Bittensor',           chain: 'multi', chains: ['bittensor'],  coingeckoId: 'bittensor' },
  'polkadot':          { id: 'polkadot',          sym: 'DOT',   name: 'Polkadot',            chain: 'multi', chains: ['polkadot'],   coingeckoId: 'polkadot' },
  'filecoin':          { id: 'filecoin',          sym: 'FIL',   name: 'Filecoin',            chain: 'multi', chains: ['filecoin'],   coingeckoId: 'filecoin' },
  'zcash':             { id: 'zcash',             sym: 'ZEC',   name: 'Zcash',               chain: 'multi', chains: ['zcash'],      coingeckoId: 'zcash' },

  // ── Ethereum Ecosystem (DeFi / Meme / L2) ──
  'pepe':              { id: 'pepe',              sym: 'PEPE',  name: 'Pepe',                chain: 'ethereum',                     coingeckoId: 'pepe' },
  'worldcoin-wld':     { id: 'worldcoin-wld',     sym: 'WLD',   name: 'Worldcoin',           chain: 'ethereum',                     coingeckoId: 'worldcoin-wld' },
  'ethena':            { id: 'ethena',            sym: 'ENA',   name: 'Ethena',              chain: 'ethereum',                     coingeckoId: 'ethena' },
  'fetch-ai':          { id: 'fetch-ai',          sym: 'FET',   name: 'Fetch.ai (ASI)',      chain: 'ethereum',                     coingeckoId: 'fetch-ai' },
  'optimism':          { id: 'optimism',          sym: 'OP',    name: 'Optimism',            chain: 'ethereum',                     coingeckoId: 'optimism' },
  'arbitrum':          { id: 'arbitrum',          sym: 'ARB',   name: 'Arbitrum',            chain: 'ethereum',                     coingeckoId: 'arbitrum' },

  // ── Solana Ecosystem (additional) ──
  'official-trump':    { id: 'official-trump',    sym: 'TRUMP', name: 'Official Trump',      chain: 'solana',                       coingeckoId: 'official-trump' },

  // ── Monero ──
  'monero':            { id: 'monero',            sym: 'XMR',   name: 'Monero',              chain: 'monero',                       coingeckoId: 'monero' },

  // ── Algorand ──
  'algorand':          { id: 'algorand',          sym: 'ALGO',  name: 'Algorand',            chain: 'algorand',                     coingeckoId: 'algorand' },

  // ── DeFi / BNB Ecosystem ──
  'pancakeswap-token': { id: 'pancakeswap-token', sym: 'CAKE',  name: 'PancakeSwap',         chain: 'bnb',                          coingeckoId: 'pancakeswap-token' },

  // ── TRON Ecosystem ──
  'just':              { id: 'just',              sym: 'JST',   name: 'JUST',                chain: 'tron',                         coingeckoId: 'just' },

  // ── Tezos ──
  'tezos':             { id: 'tezos',             sym: 'XTZ',   name: 'Tezos',               chain: 'tezos',                        coingeckoId: 'tezos' },

  // ── Theta Network ──
  'theta-token':       { id: 'theta-token',       sym: 'THETA', name: 'Theta Network',       chain: 'theta',                        coingeckoId: 'theta-token' },

  // ── Ethereum Ecosystem (Gaming / DeFi / Infrastructure) ──
  'axie-infinity':     { id: 'axie-infinity',     sym: 'AXS',   name: 'Axie Infinity',       chain: 'ethereum',                     coingeckoId: 'axie-infinity' },
  'jasmycoin':         { id: 'jasmycoin',         sym: 'JASMY', name: 'JasmyCoin',           chain: 'ethereum',                     coingeckoId: 'jasmycoin' },
  'convex-finance':    { id: 'convex-finance',    sym: 'CVX',   name: 'Convex Finance',      chain: 'ethereum',                     coingeckoId: 'convex-finance' },
  '1inch':             { id: '1inch',             sym: '1INCH', name: '1inch',               chain: 'ethereum',                     coingeckoId: '1inch' },

  // ── Research additions: top missing tokens by volume ──
  'ondo-finance':      { id: 'ondo-finance',      sym: 'ONDO',   name: 'Ondo Finance',      chain: 'ethereum',                       coingeckoId: 'ondo-finance' },
  'ecash':             { id: 'ecash',             sym: 'XEC',    name: 'eCash',             chain: 'bitcoin-cash',                   coingeckoId: 'ecash' },
  'mantra':            { id: 'mantra',            sym: 'OM',     name: 'MANTRA',            chain: 'ethereum',                       coingeckoId: 'mantra' },
  'aerodrome-finance': { id: 'aerodrome-finance', sym: 'AERO',   name: 'Aerodrome',          chain: 'ethereum',                       coingeckoId: 'aerodrome-finance' },
  'dash':              { id: 'dash',              sym: 'DASH',   name: 'Dash',              chain: 'dash',                           coingeckoId: 'dash' },
  'pudgy-penguins':    { id: 'pudgy-penguins',    sym: 'PENGU',  name: 'Pudgy Penguins',    chain: 'ethereum',                       coingeckoId: 'pudgy-penguins' },
  'ordinals':          { id: 'ordinals',          sym: 'ORDI',   name: 'Ordinals',          chain: 'bitcoin',                        coingeckoId: 'ordinals' },
  'chiliz':            { id: 'chiliz',            sym: 'CHZ',    name: 'Chiliz',            chain: 'ethereum',                       coingeckoId: 'chiliz' },
  'virtual-protocol':  { id: 'virtual-protocol',  sym: 'VIRTUAL',name: 'Virtual Protocol',  chain: 'ethereum',                       coingeckoId: 'virtual-protocol' },
  'neo':               { id: 'neo',               sym: 'NEO',    name: 'NEO',               chain: 'neo',                            coingeckoId: 'neo' },
  'eigenlayer':        { id: 'eigenlayer',        sym: 'EIGEN',  name: 'EigenLayer',        chain: 'ethereum',                       coingeckoId: 'eigenlayer' },
  'pendle':            { id: 'pendle',            sym: 'PENDLE', name: 'Pendle',            chain: 'ethereum',                       coingeckoId: 'pendle' },
  'internet-computer': { id: 'internet-computer', sym: 'ICP',    name: 'Internet Computer', chain: 'multi', chains: ['icp'],         coingeckoId: 'internet-computer' },
  'shiba-inu':         { id: 'shiba-inu',         sym: 'SHIB',   name: 'Shiba Inu',         chain: 'ethereum',                       coingeckoId: 'shiba-inu' },
  'ethereum-classic':  { id: 'ethereum-classic',  sym: 'ETC',    name: 'Ethereum Classic',  chain: 'ethereum-classic',               coingeckoId: 'ethereum-classic' },
  'skale':             { id: 'skale',             sym: 'SKL',    name: 'SKALE',             chain: 'ethereum',                       coingeckoId: 'skale' },
  'kaito':             { id: 'kaito',             sym: 'KAITO',  name: 'Kaito',             chain: 'ethereum',                       coingeckoId: 'kaito' },
};

/** All token IDs */
export function getTokenIds(): string[] {
  return Object.keys(TOKENS);
}

/** All tokens as an array, optionally filtered by config token whitelist */
export function getTokenList(): TokenDef[] {
  const all = Object.values(TOKENS);
  try {
    const config = loadConfig();
    if (config.tokens && config.tokens.length > 0) {
      return all.filter(t => config.tokens!.includes(t.id));
    }
  } catch {
    // If config hasn't been loaded yet, return unfiltered
  }
  return all;
}

/** Full unfiltered token list (ignores config token whitelist) */
export function getAllTokens(): TokenDef[] {
  return Object.values(TOKENS);
}

/** Count of currently active (config-filtered) tokens */
export function getActiveTokenCount(): number {
  return getTokenList().length;
}

/** Reset token config cache — forces next getTokenList() to re-read config */
export function resetTokenConfig(): void {
  // getTokenList() calls loadConfig() which already has instance caching.
  // This function exists for daemon compatibility; next getTokenList() call
  // will re-query loadConfig() automatically since the singleton cache
  // persists across calls.
}

/** Reload token configuration (alias for resetTokenConfig) */
export function reloadTokenConfig(): void {
  resetTokenConfig();
}

/** Lookup a token by ID */
export function getTokenById(id: string): TokenDef | undefined {
  return TOKENS[id];
}

/** Lookup a token by Binance trading symbol */
export function getTokenBySymbol(sym: string): TokenDef | undefined {
  const key = sym.toUpperCase();
  return Object.values(TOKENS).find(t => t.sym === key);
}

/** Filter tokens by chain */
export function getTokensByChain(chain: Chain | undefined): TokenDef[] {
  if (!chain || chain === 'multi') return getTokenList();
  return Object.values(TOKENS).filter(t => {
    if (t.chain === chain) return true;
    if (t.chain === 'multi' && t.chains?.includes(chain)) return true;
    return false;
  });
}

/** Get Binance USDT pair for a token */
export function getBinancePair(token: TokenDef): string {
  return `${token.sym}USDT`;
}

/**
 * Get the top N tokens by 24h quote volume from all Binance USDT pairs.
 *
 * Two-pass approach:
 *   1. Match tickers against the hardcoded TOKENS registry (full metadata).
 *   2. If fewer than n registry matches are found, synthesize TokenDef
 *      entries for the remaining highest-volume tickers so the caller
 *      always gets the top n high-volume tokens (capped at total available).
 *
 * @param n Number of top tokens to return (default: 50)
 */
export async function getTopTokensByVolume(n: number = 50): Promise<TokenDef[]> {
  const tickers = await fetchAllUsdtTickers();
  const registryEntries: Array<{ token: TokenDef; quoteVolume: number }> = [];
  const unmatched: Array<{ sym: string; quoteVolume: number }> = [];

  // First pass: look up each ticker in the hardcoded token registry
  for (const [symbol, ticker] of tickers) {
    const sym = symbol.replace(/USDT$/, '');
    const token = getTokenBySymbol(sym);
    const qv = parseFloat(ticker.quoteVolume);
    if (token) {
      registryEntries.push({ token, quoteVolume: qv });
    } else {
      unmatched.push({ sym, quoteVolume: qv });
    }
  }

  // Sort registry entries descending by volume
  registryEntries.sort((a, b) => b.quoteVolume - a.quoteVolume);

  // If we have enough registry matches, return top n
  if (registryEntries.length >= n) {
    return registryEntries.slice(0, n).map(e => e.token);
  }

  // Second pass: not enough registry matches — synthesise TokenDefs for
  // the remaining highest-volume unmatched tickers
  unmatched.sort((a, b) => b.quoteVolume - a.quoteVolume);

  const result: TokenDef[] = registryEntries.map(e => e.token);

  for (const u of unmatched) {
    if (result.length >= n) break;
    result.push({
      id: u.sym.toLowerCase(),
      sym: u.sym,
      name: u.sym,
      chain: 'multi',
    });
  }

  return result;
}

/**
 * Validate all registry tokens against live Binance USDT pairs.
 * Curls live Binance API for every registry token and reports which are
 * tradeable (positive volume) vs dead/delisted (zero volume or missing pair).
 */
export async function validateTokenCoverage(): Promise<{ valid: string[]; dead: string[] }> {
  const tickers = await fetchAllUsdtTickers();
  const all = getAllTokens();
  const valid: string[] = [];
  const dead: string[] = [];
  for (const t of all) {
    const pair = getBinancePair(t);
    const ticker = tickers.get(pair);
    if (ticker && Number(ticker.quoteVolume) > 0) {
      valid.push(t.sym);
    } else {
      dead.push(`${t.sym} (${pair})`);
    }
  }
  return { valid, dead };
}

export type { TokenDef } from './types.js';
