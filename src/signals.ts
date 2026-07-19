// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Signal Generator
// ═══════════════════════════════════════════════════════════════════════
//
// Feature set:
//   - Composite scoring (momentum 40%, technical 40%, news 20%)
//   - ADX trend strength filter with dynamic confidence adjustment
//   - Divergence detection (price vs RSI)
//   - Confidence calibration (conflict penalties, agreement bonuses)
//   - Volatility-adjusted position sizing (ATR-based)
//   - Graduated volume confirmation (0.5x–3x range)
//   - Context-aware on-chain boost with TVL trend direction
//   - Alert priority levels (critical/high/medium/low)
//   - Signal metadata (ADX, divergence, volatility)
//   - Market regime detection
//   - Alert deduplication (1-hour sliding window)
// ═══════════════════════════════════════════════════════════════════════

import type {
  EnrichedTicker, TokenSignal, TechnicalIndicators,
  NewsMatch, Chain, SignalBreakdown,
} from './types.js';
import type { OnChainMetrics } from './onchain.js';
import { PROTOCOL_MAP } from './onchain.js';
import { getTokenById } from './tokens.js';

// ═══════════════════════════════════════════════════════════════════════
// Alert deduplication
// ═══════════════════════════════════════════════════════════════════════
//
// Tracks recent alert keys (symbol + alert text) to avoid repeating the
// same message in consecutive scans. Cache is shared across all calls
// and cleared after ALERT_DEDUP_WINDOW_MS of inactivity.

const ALERT_DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const recentlySentAlerts = new Map<string, number>(); // key → timestamp

/**
 * Check if an alert is fresh (not seen within the dedup window).
 * Returns true if the alert should be shown, false if it's a duplicate.
 */
function isAlertUnique(key: string): boolean {
  const now = Date.now();
  const lastSent = recentlySentAlerts.get(key);
  if (lastSent !== undefined && (now - lastSent) < ALERT_DEDUP_WINDOW_MS) {
    return false; // still within the dedup window
  }
  recentlySentAlerts.set(key, now);
  return true;
}

/**
 * Clear the alert dedup cache (exposed for testing / manual reset).
 */
export function clearAlertCache(): void {
  recentlySentAlerts.clear();
}

/**
 * Evict stale entries from the alert cache to prevent unbounded growth.
 */
function evictStaleAlerts(): void {
  const cutoff = Date.now() - ALERT_DEDUP_WINDOW_MS;
  for (const [key, ts] of recentlySentAlerts.entries()) {
    if (ts < cutoff) recentlySentAlerts.delete(key);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ADX Trend Strength Filter
// ═══════════════════════════════════════════════════════════════════════

/**
 * Categorize ADX value and return a confidence multiplier for trend
 * strength adjustment of the composite score.
 *
 *   ADX  0–15  → Very weak/choppy market → 0.6× (reduce confidence 40%)
 *   ADX 15–20  → Weak trend             → 0.75×
 *   ADX 20–25  → Transition zone        → 0.9×
 *   ADX 25–40  → Trending               → 1.0× (neutral)
 *   ADX 40–60  → Strong trend           → 1.05× (+5%)
 *   ADX 60+    → Extremely strong       → 1.1× (capped)
 *
 * Reference: Wilder (1978). ADX < 20 = non-trending, > 25 = trending.
 */
function computeAdxAdjustment(adx: number | null | undefined): {
  category: string;
  multiplier: number;
} {
  if (adx == null) return { category: 'unknown', multiplier: 1.0 };
  if (adx < 15) return { category: 'very-weak', multiplier: 0.6 };
  if (adx < 20) return { category: 'weak', multiplier: 0.75 };
  if (adx < 25) return { category: 'transition', multiplier: 0.9 };
  if (adx < 40) return { category: 'trending', multiplier: 1.0 };
  if (adx < 60) return { category: 'strong', multiplier: 1.05 };
  return { category: 'very-strong', multiplier: 1.1 }; // ADX >= 60
}

// ═══════════════════════════════════════════════════════════════════════
// Divergence Detection
// ═══════════════════════════════════════════════════════════════════════

interface DivergenceResult {
  type: 'bullish-regular' | 'bearish-regular' | 'bullish-hidden' | 'bearish-hidden' | 'none';
  strength: number; // 0–1
  description: string;
}

/**
 * Detect regular and hidden divergences between price action and RSI
 * using the enriched ticker's 24h range position and RSI value.
 *
 * Regular divergence (trend reversal signal):
 *   - Bullish: price at 24h low but RSI NOT confirming (moderate/neutral)
 *   - Bearish: price at 24h high but RSI NOT confirming (moderate/neutral)
 *
 * Hidden divergence (trend continuation signal):
 *   - Bullish: price holding mid-range while RSI oversold
 *   - Bearish: price stalling while RSI elevated
 *
 * These relationships are proven predictors of reversals and continuations
 * (Murphy, J. J. "Technical Analysis of the Financial Markets").
 */
function detectDivergence(
  t: EnrichedTicker,
  tech: TechnicalIndicators | undefined,
): DivergenceResult {
  if (!tech || tech.rsi == null) {
    return { type: 'none', strength: 0, description: 'Insufficient data' };
  }

  const { rsi } = tech;
  // SAME-WINDOW range position, not the 24h ticker rangePosPct (finding #2).
  // Divergence requires price extremes and the oscillator measured over one
  // window; mixing the 24h ticker position with the 1h RSI produced phantom
  // "regular/bullish" divergences on misaligned data.
  const rangePos = tech.rangePosWindow == null || !Number.isFinite(tech.rangePosWindow)
    ? 0.5
    : tech.rangePosWindow;
  const priceChange = t.priceChangePercent;

  // ── Regular divergence (trend exhaustion / reversal) ──
  // Price near window low but RSI not confirming weakness (RSI > 40)
  if (rangePos < 0.15 && rsi > 40 && priceChange < 0) {
    return {
      type: 'bullish-regular',
      strength: clamp((0.15 - rangePos) / 0.15 * (rsi - 40) / 60, 0, 1),
      description: `Price at window low (range ${(rangePos * 100).toFixed(0)}%) but RSI ${rsi.toFixed(0)} not confirming weakness — regular bullish divergence`,
    };
  }
  // Price near window high but RSI not confirming strength (RSI < 60)
  if (rangePos > 0.85 && rsi < 60 && priceChange > 0) {
    return {
      type: 'bearish-regular',
      strength: clamp((rangePos - 0.85) / 0.15 * (60 - rsi) / 60, 0, 1),
      description: `Price at window high (range ${(rangePos * 100).toFixed(0)}%) but RSI ${rsi.toFixed(0)} not confirming strength — regular bearish divergence`,
    };
  }

  // ── Hidden divergence (trend continuation) ──
  // Price holding mid-range while RSI oversold
  if (rangePos > 0.35 && rangePos < 0.50 && rsi < 35 && priceChange > 0) {
    return {
      type: 'bullish-hidden',
      strength: clamp((0.50 - rangePos) / 0.15 * (35 - rsi) / 35, 0, 1),
      description: `Price holding mid-range (${(rangePos * 100).toFixed(0)}%) while RSI ${rsi.toFixed(0)} oversold — hidden bullish divergence`,
    };
  }
  // Price stalling while RSI elevated
  if (rangePos > 0.50 && rangePos < 0.65 && rsi > 65 && priceChange < 0) {
    return {
      type: 'bearish-hidden',
      strength: clamp((rangePos - 0.50) / 0.15 * (rsi - 65) / 35, 0, 1),
      description: `Price stalling at mid-range (${(rangePos * 100).toFixed(0)}%) while RSI ${rsi.toFixed(0)} elevated — hidden bearish divergence`,
    };
  }

  // ── Subtle divergence (lower conviction) ──
  if (rangePos < 0.25 && rsi < 50 && rsi > 35) {
    return {
      type: rsi > 45 ? 'bullish-regular' : 'bullish-hidden',
      strength: 0.3,
      description: `Subtle divergence — price low (${(rangePos * 100).toFixed(0)}%), RSI ${rsi.toFixed(0)}`,
    };
  }
  if (rangePos > 0.75 && rsi > 50 && rsi < 65) {
    return {
      type: rsi < 55 ? 'bearish-regular' : 'bearish-hidden',
      strength: 0.3,
      description: `Subtle divergence — price high (${(rangePos * 100).toFixed(0)}%), RSI ${rsi.toFixed(0)}`,
    };
  }

  return { type: 'none', strength: 0, description: 'No divergence detected' };
}

// ═══════════════════════════════════════════════════════════════════════
// Volatility Factor (ATR-based position sizing)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute a volatility factor (0–1) for position sizing guidance based on
 * Average True Range as a percentage of price.
 *
 *   ATR% < 1%   → low volatility   → factor 1.0  (full position)
 *   ATR% 1–2%   → normal           → factor 0.9
 *   ATR% 2–4%   → elevated         → factor 0.7
 *   ATR% 4–6%   → high             → factor 0.5
 *   ATR% 6–10%  → very high        → factor 0.3
 *   ATR% > 10%  → extreme          → factor 0.15
 *
 * Principle: higher volatility → wider stop-losses needed →
 * reduce position size proportionally to maintain constant
 * dollar risk (Van Tharp, "Trade Your Way to Financial Freedom").
 *
 * @param atrPct ATR as percentage of price (e.g. 2.5)
 * @returns Position size multiplier (0–1)
 */
function computeVolatilityFactor(atrPct: number | null | undefined): number {
  if (atrPct == null || atrPct <= 0) return 1.0;
  if (atrPct < 1) return 1.0;
  if (atrPct < 2) return 0.9;
  if (atrPct < 4) return 0.7;
  if (atrPct < 6) return 0.5;
  if (atrPct < 10) return 0.3;
  return 0.15;
}

// ═══════════════════════════════════════════════════════════════════════
// On-chain boost (context-aware)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute an on-chain confidence boost (0–15 percentage points) based on
 * protocol TVL for a given token, now with trend awareness.
 *
 * Rules:
 *   - TVL >$1B AND trending up  → +15%
 *   - TVL >$1B AND flat         → +10%
 *   - TVL >$1B AND dropping     →  no boost (even if TVL is still high)
 *   - TVL $100M–$1B             → +5–10% (same as before, unaffected by trend)
 *   - TVL <$100M                → +0–5%
 *
 * @param symbol Token symbol (e.g. 'SOLUSDT')
 * @param tokenId Internal token id (e.g. 'solana')
 * @param onchain Fetched on-chain metrics (may be null)
 * @returns Boost value in percentage points (0–15)
 */
export function computeOnchainBoost(
  symbol: string,
  tokenId: string,
  onchain: OnChainMetrics | null,
): number {
  if (!onchain || !onchain.protocols || onchain.protocols.length === 0) return 0;

  // Resolve token metadata to validate chain support for on-chain metrics
  const tokenMeta = getTokenById(tokenId);
  const chain: Chain | undefined = tokenMeta?.chain;
  if (chain && chain !== 'ethereum' && chain !== 'solana' && chain !== 'bnb') {
    // On-chain metrics only meaningful for EVM/Solana/BSC chains
    return 0;
  }

  // Look up the DeFiLlama protocol slug for this token
  const protocolSlug = PROTOCOL_MAP[tokenId];
  if (!protocolSlug) return 0;

  // Find matching protocol in the fetched metrics
  const protocol = onchain.protocols.find(p => p.name === protocolSlug);
  if (!protocol) return 0;

  const tvl = protocol.tvl;
  const trend = protocol.tvlTrend;

  // High TVL (>$1B) with trend awareness
  if (tvl > 1_000_000_000) {
    if (trend === 'up') return 15;
    if (trend === 'flat') return 10;
    return 0; // dropping → no boost
  }

  // Medium TVL ($100M–$1B) → +5–10% boost
  if (tvl > 100_000_000) {
    return 5 + ((tvl - 100_000_000) / 900_000_000) * 5;
  }

  // Low TVL (>0, <$100M) → +0–5% boost
  if (tvl > 0) {
    return (tvl / 100_000_000) * 5;
  }

  return 0;
}

// ═══════════════════════════════════════════════════════════════════════
// Direction helpers (used for confidence calibration & breakdown)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Determine momentum direction from ticker data.
 * Bullish = strong price rise + book buy pressure, Bearish = opposite.
 */
function getMomentumDirection(t: EnrichedTicker): string {
  const strongBullish =
    t.priceChangePercent >= 3 ||
    (t.priceChangePercent >= 1 && t.bookImbalance > 0.2 && t.rangePosPct > 0.7);
  const strongBearish =
    t.priceChangePercent <= -3 ||
    (t.priceChangePercent <= -1 && t.bookImbalance < -0.2 && t.rangePosPct < 0.3);

  if (strongBullish) return 'bullish';
  if (strongBearish) return 'bearish';
  return 'neutral';
}

/**
 * Determine mean-reversion direction from technical indicators.
 * Oversold (expect bounce) or Overbought (expect pullback).
 */
function getMeanReversionDirection(tech: TechnicalIndicators | undefined): string {
  if (!tech) return 'neutral';
  const oversold =
    tech.rsi != null && tech.rsi < 30 &&
    tech.bb != null && tech.bb.position <= 0.2;
  const overbought =
    tech.rsi != null && tech.rsi > 70 &&
    tech.bb != null && tech.bb.position >= 0.8;

  if (oversold) return 'oversold';   // expect bounce → buyside opportunity
  if (overbought) return 'overbought'; // expect drop → sellside opportunity
  return 'neutral';
}

/**
 * Determine trend-following direction from MACD, EMA50, and volume trend.
 */
function getTrendFollowingDirection(tech: TechnicalIndicators | undefined): string {
  if (!tech) return 'neutral';

  const macdBullish =
    tech.macd?.histogram != null && tech.macd.histogram > 0 &&
    tech.priceVsEma50 != null && tech.priceVsEma50 > 0;
  const macdBearish =
    tech.macd?.histogram != null && tech.macd.histogram < 0 &&
    tech.priceVsEma50 != null && tech.priceVsEma50 < 0;

  if (macdBullish) return 'bullish';
  if (macdBearish) return 'bearish';
  return 'neutral';
}

/**
 * Compute confidence level (0–100) for the momentum direction based on
 * how extreme the underlying data is.
 */
function momentumConfidence(t: EnrichedTicker): number {
  let conf = 50;
  conf += Math.abs(t.priceChangePercent) * 5;          // up to ±inf but clamped later
  conf += Math.abs(t.bookImbalance) * 30;              // up to ±30
  conf -= Math.min(t.spreadPct * 15, 20);               // wide spread reduces confidence
  return Math.round(clamp(conf, 0, 100));
}

/**
 * Compute confidence level (0–100) for the mean-reversion direction.
 */
function meanReversionConfidence(tech: TechnicalIndicators | undefined): number {
  if (!tech) return 0;
  const rsiDev = tech.rsi != null ? Math.abs(tech.rsi - 50) * 2 : 0;
  const bbDev = tech.bb != null ? Math.abs(tech.bb.position - 0.5) * 80 : 0;
  return Math.round(clamp(rsiDev * 0.5 + bbDev * 0.5, 0, 100));
}

/**
 * Compute confidence level (0–100) for the trend-following direction.
 */
function trendFollowingConfidence(tech: TechnicalIndicators | undefined): number {
  if (!tech) return 0;
  let conf = 50;
  if (tech.macd?.histogram != null) {
    conf += clamp(Math.abs(tech.macd.histogram / (tech.macd.macd || 1)) * 30, -30, 30);
  }
  if (tech.priceVsEma50 != null) {
    conf += clamp(Math.abs(tech.priceVsEma50) * 15, -15, 15);
  }
  return Math.round(clamp(conf, 0, 100));
}

// ═══════════════════════════════════════════════════════════════════════
// Confidence calibration
// ═══════════════════════════════════════════════════════════════════════
//
// Converts a set of directional signals into a confidence adjustment
// (penalty or bonus) applied to the composite score.

interface CalibrationResult {
  penalty: number;        // negative or positive percentage-point adjustment
  breakdown: SignalBreakdown;
}

/**
 * Calibrate confidence by comparing the three strategy directions.
 *
 * Rules:
 *   - Momentum disagrees with trend-following  → -15% penalty
 *   - Momentum & trend-following agree but
 *     mean-reversion disagrees                →  -5% penalty
 *   - All 3 strategies agree                  → +10% bonus
 *
 * ADX awareness:
 *   - ADX < 20 (weak/no trend) → conflict penalties ×1.3
 *     (in choppy markets, conflicting signals are more dangerous)
 *   - ADX > 25 (trending) → agreement bonus +5pp
 *     (in trending markets, aligned signals are more reliable)
 */
function calibrateConfidence(
  momentumDir: string,
  meanRevDir: string,
  trendFollowingDir: string,
  momentumConf: number,
  meanRevConf: number,
  trendConf: number,
  adx?: number | null,
): CalibrationResult {
  // Map directions to a buy/sell numeric scale for comparison
  const toSignal = (d: string): number => {
    if (d === 'bullish' || d === 'oversold') return 1;   // buy
    if (d === 'bearish' || d === 'overbought') return -1; // sell
    return 0; // neutral
  };

  const m = toSignal(momentumDir);
  const r = toSignal(meanRevDir);
  const t = toSignal(trendFollowingDir);

  let penalty = 0;

  // ADX-based adjustment factor
  let adxFactor = 1.0;
  if (adx != null) {
    if (adx < 20) adxFactor = 1.3;  // weak trend → conflicts more penalizing
    else if (adx > 25) adxFactor = 0.85; // trending → conflicts less concerning
  }

  // Momentum vs Trend-Following conflict
  if (m !== 0 && t !== 0 && m * t < 0) {
    penalty = -15 * adxFactor;
  }
  // Momentum and TF agree, but mean-reversion disagrees
  else if (m !== 0 && t !== 0 && m * t > 0 && r !== 0 && m * r < 0) {
    penalty = -5 * adxFactor;
  }
  // All three agree (all non-zero with same sign)
  else if (m !== 0 && t !== 0 && r !== 0 && m === t && t === r) {
    penalty = 10;
    // Boost agreement bonus in trending markets
    if (adx != null && adx > 25) penalty += 5;
  }

  return {
    penalty: Math.round(penalty * 10) / 10,
    breakdown: {
      momentum: { direction: momentumDir, confidence: momentumConf },
      meanReversion: { direction: meanRevDir, confidence: meanRevConf },
      trendFollowing: { direction: trendFollowingDir, confidence: trendConf },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Volume confirmation (graduated scale)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute volume-based confidence adjustment using a graduated scale.
 *
 * Replaces the old binary ±5% with a finer grid:
 *   volVsAvg > 3.0  → +8  (exceptional volume — strong confirmation)
 *   volVsAvg > 2.0  → +5  (high volume — good confirmation)
 *   volVsAvg > 1.5  → +3  (above average — mild confirmation)
 *   volVsAvg > 0.8  →  0  (normal — neutral)
 *   volVsAvg > 0.5  → -3  (below average — mild concern)
 *   volVsAvg <= 0.5 → -6  (very low — weak signal, suspect)
 *
 * The graduated approach better captures the continuous nature of
 * volume confirmation (Elder, "Come Into My Trading Room").
 */
function computeVolumeAdjustment(t: EnrichedTicker): number {
  if (t.volVsAvg == null) return 0;
  if (t.volVsAvg > 3.0) return 8;
  if (t.volVsAvg > 2.0) return 5;
  if (t.volVsAvg > 1.5) return 3;
  if (t.volVsAvg > 0.8) return 0;
  if (t.volVsAvg > 0.5) return -3;
  return -6;
}

// ═══════════════════════════════════════════════════════════════════════
// Alert priority tagging
// ═══════════════════════════════════════════════════════════════════════

/**
 * Assign a priority label to an alert based on its type and confirming
 * context. Returns the tagged alert string.
 *
 * Priority tiers:
 *   🔴 [CRITICAL]  — extreme price moves (>5%), strong divergence
 *   🟠 [HIGH]      — technical extremes confirmed by volume, ADX extremes
 *   🟡 [MEDIUM]    — standard technical alerts, standalone RSI extremes
 *   🔵 [LOW]       — informational (news count, minor changes)
 */
function tagAlertPriority(
  alertText: string,
  t: EnrichedTicker,
  tech: TechnicalIndicators | undefined,
): string {
  // Critical alerts
  if (alertText.includes('PUMP') || alertText.includes('DIP')) {
    // Tag as critical — these are always the most actionable
    return `🔴 [CRITICAL] ${alertText}`;
  }
  if (alertText.includes('Divergence') && !alertText.includes('Subtle')) {
    return `🟠 [HIGH] ${alertText}`;
  }

  // High alerts
  if ((alertText.includes('Overbought') || alertText.includes('Oversold')) &&
      t.volVsAvg != null && t.volVsAvg > 1.5) {
    return `🟠 [HIGH] ${alertText}`;
  }
  if (alertText.includes('Strong on-chain')) {
    return `🟠 [HIGH] ${alertText}`;
  }
  if (alertText.includes('Strong trend') || alertText.includes('Very weak trend')) {
    return `🟠 [HIGH] ${alertText}`;
  }

  // Use ADX from technicals to escalate trend-strength alerts
  if (tech && tech.adx != null && tech.adx > 40 &&
      (alertText.includes('trend') || alertText.includes('momentum'))) {
    return `🟠 [HIGH] ${alertText}`;
  }

  // Medium alerts
  if (alertText.includes('Overbought') || alertText.includes('Oversold') ||
      alertText.includes('BB upper') || alertText.includes('BB lower') ||
      alertText.includes('High volume') || alertText.includes('Wide spread') ||
      alertText.includes('High volatility') || alertText.includes('Extreme volatility')) {
    return `🟡 [MEDIUM] ${alertText}`;
  }

  // Low alerts — informational
  if (alertText.includes('News:')) {
    return `🔵 [LOW] ${alertText}`;
  }
  if (alertText.includes('Subtle divergence')) {
    return `🔵 [LOW] ${alertText}`;
  }

  return `🟡 [MEDIUM] ${alertText}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Market regime detection
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute a simple market regime based on aggregate signal directions
 * across all tokens in the current scan.
 */
function computeMarketRegime(signals: TokenSignal[]): string {
  if (signals.length === 0) return 'neutral';

  let bullishCount = 0;
  let bearishCount = 0;

  for (const s of signals) {
    if (s.signalBreakdown) {
      const mDir = s.signalBreakdown.momentum.direction;
      const tfDir = s.signalBreakdown.trendFollowing.direction;
      if (mDir === 'bullish' && tfDir === 'bullish') bullishCount++;
      if (mDir === 'bearish' && tfDir === 'bearish') bearishCount++;
    } else {
      // Fallback: if no breakdown, use score thresholds
      if (s.momentumScore > 60) bullishCount++;
      if (s.momentumScore < 40) bearishCount++;
    }
  }

  if (bullishCount > bearishCount * 2) return 'risk-on';
  if (bearishCount > bullishCount * 2) return 'risk-off';
  return 'neutral';
}

// ═══════════════════════════════════════════════════════════════════════
// Composite signal computation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute composite signal scores for all tickers.
 *
 * Scoring model:
 *   - Momentum (40%): price change, spread, book imbalance, range position
 *   - Technical (40%): RSI, MACD, BB position, volume trend, EMA50 distance
 *   - News (20%): recent relevant news volume and relevance
 *   - On-chain boost (trend-aware, up to +15% added)
 *   - Confidence calibration (±15% / -5% / -15%) with ADX awareness
 *   - Volume confirmation (graduated ±3–8%)
 *   - ADX trend strength filter (0.6×–1.1× final multiplier)
 *
 * Each token also receives:
 *   - `signalBreakdown`: per-strategy direction + confidence
 *   - `regime`: market-wide regime (risk-on/risk-off/neutral)
 *   - `adx`: ADX value from technical indicators
 *   - `adxStrength`: ADX category label
 *   - `divergence`: detected divergence data (when non-none)
 *   - `volatilityFactor`: ATR-based position sizing guidance (0–1)
 *
 * @param tickers Array of enriched tickers
 * @param technicals Map of symbol -> TechnicalIndicators
 * @param newsMatches Array of news matches
 * @param onchain Optional on-chain metrics for TVL-based boost
 * @returns Array of computed TokenSignal objects
 */
export function computeSignals(
  tickers: EnrichedTicker[],
  technicals: Map<string, TechnicalIndicators>,
  newsMatches: NewsMatch[],
  onchain?: OnChainMetrics | null,
): TokenSignal[] {
  // Evict stale alert entries before processing
  evictStaleAlerts();

  const newsBySymbol = new Map<string, NewsMatch[]>();
  for (const m of newsMatches) {
    const arr = newsBySymbol.get(m.symbol) ?? [];
    arr.push(m);
    newsBySymbol.set(m.symbol, arr);
  }

  // First pass: compute raw signals for every ticker
  const signals: TokenSignal[] = tickers.map(t => {
    const tech = technicals.get(t.symbol);
    const newsItems = newsBySymbol.get(t.symbol) ?? [];

    // ── Sub-scores (0–100) ─────────────────────────────────────────
    const momentumScore = computeMomentumScore(t);
    const technicalScore = tech ? computeTechnicalScore(tech) : 0;
    const newsScore = computeNewsScore(newsItems);
    // Composite share uses a neutral baseline for missing news (finding #1)
    const newsComposite = computeNewsCompositeShare(newsItems);

    // ── On-chain boost (0–15pp, trend-aware) ───────────────────────
    const onchainBoost = onchain
      ? computeOnchainBoost(t.symbol, t.tokenId, onchain)
      : 0;

    // ── ADX trend strength ─────────────────────────────────────────
    const adxValue = tech?.adx ?? null;
    const adxAdj = computeAdxAdjustment(adxValue);

    // ── Divergence detection ───────────────────────────────────────
    const divergence = detectDivergence(t, tech);

    // ── Volatility factor ──────────────────────────────────────────
    const volatilityFactor = computeVolatilityFactor(tech?.atrPct);

    // ── Signal directions for confidence calibration ───────────────
    const momentumDir = getMomentumDirection(t);
    const meanRevDir = getMeanReversionDirection(tech);
    const trendDir = getTrendFollowingDirection(tech);

    // ── Per-strategy confidence (0–100) ────────────────────────────
    const momConf = momentumConfidence(t);
    const mrConf = meanReversionConfidence(tech);
    const tfConf = trendFollowingConfidence(tech);

    // ── Confidence calibration (penalty or bonus with ADX awareness) ──
    const { penalty, breakdown } = calibrateConfidence(
      momentumDir, meanRevDir, trendDir,
      momConf, mrConf, tfConf,
      adxValue,
    );

    // ── Volume confirmation (graduated scale) ──────────────────────
    const volumeAdj = computeVolumeAdjustment(t);

    // ── Composite score ────────────────────────────────────────────
    // Weighted 0–100 sub-scores. News uses the neutral-baseline share so that
    // missing news does not structurally penalize a token (finding #1).
    let compositeScore =
      momentumScore * 0.40 +
      technicalScore * 0.40 +
      newsComposite * 0.20 +
      penalty +
      volumeAdj;

    // Apply the ADX trend-strength multiplier to the SCORE only — NOT to the
    // on-chain boost (finding #5). Previously the 0.6× chop multiplier also
    // scaled the on-chain boost, double-counting "uncertain in chop".
    compositeScore = compositeScore * adxAdj.multiplier;

    compositeScore = clamp(compositeScore, 0, 100);

    // ── Post-clamp multiplicative boost layer (finding #4) ──────────
    // Additive percentage-point boosts were silently eaten by the clamp for
    // any base >= 85 (a +15 on-chain boost could never lift a 100). Applying
    // boosts multiplicatively AFTER the clamp keeps them effective at the top
    // of the range while staying bounded to (0, 100]. Penalties still bite
    // before the clamp, so the engine penalizes freely but now also rewards.
    if (onchainBoost > 0) {
      const onchainMult = 1 + onchainBoost / 100; // +15pp → ×1.15
      compositeScore = clamp(compositeScore * onchainMult, 0, 100);
    }
    // Agreement bonus (penalty>=0 from calibrateConfidence) likewise rewarded
    // post-clamp so it is never truncated for already-strong tokens.
    if (penalty > 0) {
      compositeScore = clamp(compositeScore * (1 + penalty / 100), 0, 100);
    }

    // ── Alerts (deduplicated, with priority tags) ──────────────────
    const rawAlerts = buildAlerts(t, tech, newsItems, onchainBoost, adxAdj, divergence);
    const alerts = rawAlerts
      .map(a => tagAlertPriority(a, t, tech))
      .filter(a => isAlertUnique(`${t.symbol}:${a}`));

    return {
      symbol: t.symbol,
      tokenId: t.tokenId,
      tokenName: t.tokenName,
      chain: t.chain,
      lastPrice: t.lastPrice,
      priceChangePercent: t.priceChangePercent,
      momentumScore: Math.round(momentumScore * 10) / 10,
      technicalScore: Math.round(technicalScore * 10) / 10,
      newsScore: Math.round(newsScore * 10) / 10,
      compositeScore: Math.round(compositeScore * 10) / 10,
      alerts,
      timestamp: t.tsUtc,
      signalBreakdown: breakdown,
      adx: adxValue,
      adxStrength: adxAdj.category,
      divergence: divergence.type !== 'none' ? divergence : undefined,
      volatilityFactor: Math.round(volatilityFactor * 100) / 100,
      // regime filled in the second pass below
    };
  });

  // Second pass: compute market regime from aggregate signal data
  const regime = computeMarketRegime(signals);
  for (const s of signals) {
    s.regime = regime;
  }

  return signals;
}

// ═══════════════════════════════════════════════════════════════════════
// Alert builder
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build alert strings for a token without dedup filtering.
 * Includes ADX trend, divergence, and volatility-based alerts.
 */
function buildAlerts(
  t: EnrichedTicker,
  tech: TechnicalIndicators | undefined,
  newsItems: NewsMatch[],
  onchainBoost: number,
  adxAdj: { category: string; multiplier: number },
  divergence: DivergenceResult,
): string[] {
  const alerts: string[] = [];

  // Critical price alerts
  if (t.priceChangePercent <= -5) alerts.push('🔴 DIP (>5% drop)');
  if (t.priceChangePercent >= 5) alerts.push('🟢 PUMP (>5% gain)');

  // ADX-based trend strength alerts
  if (tech?.adx != null) {
    if (tech.adx < 15) {
      alerts.push(`Very weak trend (ADX ${tech.adx.toFixed(1)})`);
    } else if (tech.adx > 40) {
      alerts.push(`Strong trend (ADX ${tech.adx.toFixed(1)})`);
    }
  }

  // Divergence alerts (only when conviction is meaningful)
  if (divergence.type !== 'none' && divergence.strength > 0.3) {
    alerts.push(`Divergence: ${divergence.description}`);
  }

  // Technical alerts
  if (tech?.rsi != null && tech.rsi > 70) alerts.push('Overbought (RSI > 70)');
  if (tech?.rsi != null && tech.rsi < 30) alerts.push('Oversold (RSI < 30)');
  if (tech?.bb != null && tech.bb.position >= 0.95) alerts.push('BB upper touch');
  if (tech?.bb != null && tech.bb.position <= 0.05) alerts.push('BB lower touch');

  // Volume and spread alerts
  if (t.quoteVolume >= 10e6) alerts.push('High volume');
  if (t.spreadPct >= 1) alerts.push('Wide spread');

  // Volatility alerts (ATR-based)
  if (tech?.atrPct != null) {
    if (tech.atrPct > 6) {
      alerts.push(`Extreme volatility (ATR ${tech.atrPct.toFixed(1)}%)`);
    } else if (tech.atrPct > 4) {
      alerts.push(`High volatility (ATR ${tech.atrPct.toFixed(1)}%)`);
    }
  }

  // News and on-chain alerts
  if (newsItems.length >= 2) alerts.push(`News: ${newsItems.length} articles`);
  if (onchainBoost >= 10) alerts.push('Strong on-chain TVL');

  return alerts;
}

// ═══════════════════════════════════════════════════════════════════════
// Score computation functions
// ═══════════════════════════════════════════════════════════════════════

/** Momentum score from market data (0–100) */
function computeMomentumScore(t: EnrichedTicker): number {
  let score = 50; // neutral baseline

  // Price change contribution (up to ±30)
  score += t.priceChangePercent * 3;

  // Spread penalty (wide spread = less momentum)
  if (t.spreadPct > 1) score -= 10;
  if (t.spreadPct > 0.5) score -= 5;

  // Volume boost
  if (t.quoteVolume > 10e6) score += 10;
  if (t.quoteVolume > 50e6) score += 5;

  // Book imbalance (strong buy/sell pressure)
  if (t.bookImbalance > 0.3) score += 8;
  if (t.bookImbalance < -0.3) score -= 8;

  // Range position
  if (t.rangePosPct > 0.9) score += 5;  // near high
  if (t.rangePosPct < 0.1) score -= 5;  // near low

  return clamp(score, 0, 100);
}

/** Technical score from indicators (0–100) */
function computeTechnicalScore(t: TechnicalIndicators): number {
  let score = 50;

  // RSI
  if (t.rsi != null) {
    if (t.rsi > 70) score -= 10;  // overbought
    else if (t.rsi < 30) score += 10;  // oversold (potential bounce)
    else if (t.rsi > 60) score += 5;  // bullish momentum
    else if (t.rsi < 40) score -= 5;  // bearish
  }

  // MACD
  if (t.macd?.histogram != null) {
    if (t.macd.histogram > 0) score += 8;
    else score -= 8;
  }

  // BB position
  if (t.bb != null) {
    if (t.bb.position > 0.8) score -= 5;  // stretched high
    if (t.bb.position < 0.2) score += 5;  // stretched low
  }

  // Volume trend
  if (t.volTrend != null) {
    score += clamp(t.volTrend * 10, -10, 10);
  }

  // Price vs EMA50
  if (t.priceVsEma50 != null) {
    score += clamp(t.priceVsEma50, -10, 10);
  }

  return clamp(score, 0, 100);
}

/**
 * News score (0–100).
 *
 * This is the *reported* news sub-score and MUST remain 0 when there are no
 * articles (the contract in signals.test.ts pins `compositeScore`/newsScore
 * semantics for callers and exporters).
 */
function computeNewsScore(newsItems: NewsMatch[]): number {
  if (newsItems.length === 0) return 0;
  let score = 0;
  for (const item of newsItems) {
    score += item.relevance * 20;
  }
  return clamp(score, 0, 100);
}

/**
 * News contribution to the COMPOSITE score (0–100), using a neutral baseline.
 *
 * Fixes finding #1: the previous composite treated "no news" as a hard 0,
 * structurally penalizing every low-news-coverage token by a full 20 points
 * (0.20 weight × 0) before any price/technical factor. Absence of news is
 * not negative evidence, so a token with no coverage contributes the neutral
 * baseline (50) to the weighted average rather than 0.
 *
 * Reported `newsScore` stays 0 (see computeNewsScore) — only the composite
 * blend is neutralized.
 */
function computeNewsCompositeShare(newsItems: NewsMatch[]): number {
  if (newsItems.length === 0) return 50; // neutral baseline, not penalized
  let score = 0;
  for (const item of newsItems) {
    score += item.relevance * 20;
  }
  return clamp(score, 0, 100);
}

/**
 * Clamp a value between min and max.
 *
 * Defensive: a non-finite input (NaN / ±Infinity) — which can arise from a
 * malformed upstream feed field that slipped past parsing — resolves to the
 * neutral midpoint rather than propagating NaN into the composite score.
 * This is the last line of defense against finding #3 (single bad field
 * poisons the whole score + downstream sort).
 */
function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return (min + max) / 2;
  return Math.max(min, Math.min(max, v));
}
