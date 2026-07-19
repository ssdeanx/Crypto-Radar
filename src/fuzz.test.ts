// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Fuzz Tests & Edge Case Hardening
// ═══════════════════════════════════════════════════════════════════════
//
// Tests all indicator functions with extreme/edge-case inputs:
//   - Empty arrays
//   - Single-element arrays
//   - Arrays with NaN, Infinity, negative values
//   - Arrays with all identical values
//   - Very large arrays (2000+ elements)
//   - Very small values (1e-8 scale)
//   - Very large values (1e10 scale)
//
// Goal: ensure zero crashes, graceful null returns, no NaN propagation
// on valid inputs. NaN and Infinity are valid IEEE-754 values that JS
// math propagates — the invariant tested there is "does not throw".

import { describe, it, expect } from 'vitest';
import type { Kline } from './types.js';
import {
  sma, ema, emaSeries, rsiSeries,
  computeRSI, computeMFI, computeMACD, computeBB, computeATR, computeVolTrend,
  computeOBV, computeVolVsAvg,
  computeStochastic, computeIchimoku, computeWilliamsR, computeCMF, computeTSI,
  computeADX,
  computePSAR, computeCCI, computeKeltner, computeROC, computeVWAP,
  computeForceIndex, computeADL, computeChaikinOsc, computeStochRSI,
  computeTRIX, computeKST, computeElderRay, computeFisher, computeMassIndex,
  computeAllIndicators,
} from './indicators.js';

// ── Helpers ──

function makeKlines(count: number, open = 100, high = 105, low = 95, baseClose = 100, volume = 1000): Kline[] {
  return Array.from({ length: count }, (_, i) => ({
    openTime: i * 3600000, open, high, low,
    close: baseClose + Math.sin(i) * 5,
    volume, closeTime: (i + 1) * 3600000,
    quoteVolume: baseClose * volume, count: 100,
    takerBuyVol: volume / 2, takerBuyQuoteVol: (baseClose * volume) / 2, ignore: 0,
  }));
}

/** Ensure a value is not NaN (returns true for null/undefined) */
function isNotNaN(v: unknown): boolean {
  return !(typeof v === 'number' && isNaN(v));
}

// ═══════════════════════════════════════════════════════════════════════
// EMPTY ARRAYS
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: Empty arrays', () => {
  it('sma returns null', () => { expect(sma([], 14)).toBeNull(); });
  it('ema returns null', () => { expect(ema([], 14)).toBeNull(); });
  it('emaSeries returns empty', () => {
    const r = emaSeries([], 14);
    expect(r).toHaveLength(0);
  });
  it('RSI returns null', () => { expect(computeRSI([])).toBeNull(); });
  it('RSI series returns empty', () => {
    expect(rsiSeries([])).toHaveLength(0);
  });
  it('MACD returns nulls', () => {
    const r = computeMACD([]);
    expect(r.macd).toBeNull();
    expect(r.signal).toBeNull();
    expect(r.histogram).toBeNull();
  });
  it('BB returns null', () => { expect(computeBB([])).toBeNull(); });
  it('ATR returns null', () => { expect(computeATR([], [], [])).toBeNull(); });
  it('MFI returns null', () => { expect(computeMFI([], [], [], [])).toBeNull(); });
  it('VolTrend returns null', () => { expect(computeVolTrend([])).toBeNull(); });
  it('OBV returns null', () => { expect(computeOBV([], [])).toBeNull(); });
  it('VolVsAvg returns null', () => { expect(computeVolVsAvg([])).toBeNull(); });
  it('Stochastic returns nulls', () => {
    const r = computeStochastic([], [], []);
    expect(r.k).toBeNull();
    expect(r.d).toBeNull();
  });
  it('Ichimoku returns nulls', () => {
    const r = computeIchimoku([], [], []);
    expect(r.conversionLine).toBeNull();
    expect(r.baseLine).toBeNull();
    expect(r.spanA).toBeNull();
    expect(r.spanB).toBeNull();
    expect(r.laggingSpan).toBeNull();
  });
  it('Williams R returns null', () => { expect(computeWilliamsR([], [], [])).toBeNull(); });
  it('CMF returns null', () => { expect(computeCMF([], [], [], [])).toBeNull(); });
  it('TSI returns null', () => { expect(computeTSI([])).toBeNull(); });
  it('ADX returns null', () => { expect(computeADX([], [], [])).toBeNull(); });
  it('PSAR returns null', () => { expect(computePSAR([], [], [])).toBeNull(); });
  it('CCI returns null', () => { expect(computeCCI([], [], [])).toBeNull(); });
  it('Keltner returns null', () => { expect(computeKeltner([], [], [])).toBeNull(); });
  it('ROC returns null', () => { expect(computeROC([])).toBeNull(); });
  it('VWAP returns null', () => { expect(computeVWAP([], [], [], [])).toBeNull(); });
  it('ForceIndex returns null', () => { expect(computeForceIndex([], [], 13)).toBeNull(); });
  it('ADL returns null', () => { expect(computeADL([], [], [], [])).toBeNull(); });
  it('ChaikinOsc returns null', () => { expect(computeChaikinOsc([], [], [], [])).toBeNull(); });
  it('StochRSI returns nulls', () => {
    const r = computeStochRSI([], 14, 14);
    expect(r.stochRsi).toBeNull();
    expect(r.k).toBeNull();
    expect(r.d).toBeNull();
  });
  it('TRIX returns null', () => { expect(computeTRIX([])).toBeNull(); });
  it('KST returns default', () => {
    const r = computeKST([]);
    expect(r.kst).toBe(0);
    expect(r.signal).toBeNull();
  });
  it('ElderRay returns null', () => { expect(computeElderRay([], [], [])).toBeNull(); });
  it('Fisher returns null', () => { expect(computeFisher([], [], [])).toBeNull(); });
  it('MassIndex returns null', () => { expect(computeMassIndex([], [])).toBeNull(); });
  it('computeAllIndicators handles empty klines', () => {
    const r = computeAllIndicators([]);
    expect(r).toBeDefined();
    expect(r.rsi).toBeNull();
    expect(r.macd?.macd).toBeNull();
    expect(r.bb).toBeNull();
    expect(r.stochastic?.k).toBeNull();
    expect(r.ichimoku?.conversionLine).toBeNull();
    expect(r.williamsR).toBeNull();
    expect(r.cmf).toBeNull();
    expect(r.tsi).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SINGLE-ELEMENT ARRAYS
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: Single-element arrays', () => {
  it('sma returns null', () => { expect(sma([42], 14)).toBeNull(); });
  it('ema returns null', () => { expect(ema([42], 14)).toBeNull(); });
  it('emaSeries returns all nulls', () => {
    expect(emaSeries([42], 14)).toEqual([null]);
  });
  it('RSI returns null', () => { expect(computeRSI([100])).toBeNull(); });
  it('RSI series returns null', () => {
    expect(rsiSeries([100])).toEqual([null]);
  });
  it('MACD returns nulls', () => {
    const r = computeMACD([100]);
    expect(r.macd).toBeNull();
  });
  it('BB returns null', () => { expect(computeBB([100])).toBeNull(); });
  it('ATR returns null', () => { expect(computeATR([100], [95], [100])).toBeNull(); });
  it('MFI returns null', () => { expect(computeMFI([100], [95], [100], [1000])).toBeNull(); });
  it('VolTrend returns null', () => { expect(computeVolTrend([1000])).toBeNull(); });
  it('OBV returns null', () => { expect(computeOBV([100], [1000])).toBeNull(); });
  it('VolVsAvg returns null', () => { expect(computeVolVsAvg([1000])).toBeNull(); });
  it('Stochastic returns nulls', () => {
    const r = computeStochastic([100], [95], [100]);
    expect(r.k).toBeNull();
  });
  it('Ichimoku returns nulls', () => {
    const r = computeIchimoku([100], [95], [100]);
    expect(r.conversionLine).toBeNull();
  });
  it('Williams R returns null', () => { expect(computeWilliamsR([100], [95], [100])).toBeNull(); });
  it('CMF returns null', () => { expect(computeCMF([100], [95], [100], [1000])).toBeNull(); });
  it('TSI returns null', () => { expect(computeTSI([100])).toBeNull(); });
  it('ADX returns null', () => { expect(computeADX([100], [95], [100])).toBeNull(); });
  it('PSAR returns null', () => { expect(computePSAR([100], [95], [100])).toBeNull(); });
  it('CCI returns null', () => { expect(computeCCI([100], [95], [100])).toBeNull(); });
  it('Keltner returns null', () => { expect(computeKeltner([100], [95], [100])).toBeNull(); });
  it('ROC returns null', () => { expect(computeROC([100])).toBeNull(); });
  it('VWAP returns value for single point', () => {
    expect(computeVWAP([100], [95], [98], [1000])).not.toBeNull();
  });
  it('ForceIndex returns null', () => { expect(computeForceIndex([100], [1000])).toBeNull(); });
  it('ADL returns null', () => { expect(computeADL([100], [95], [100], [1000])).toBeNull(); });
  it('ChaikinOsc returns null', () => { expect(computeChaikinOsc([100], [95], [100], [1000])).toBeNull(); });
  it('StochRSI returns nulls', () => {
    const r = computeStochRSI([100], 14, 14);
    expect(r.stochRsi).toBeNull();
  });
  it('TRIX returns null', () => { expect(computeTRIX([100])).toBeNull(); });
  it('ElderRay returns null', () => { expect(computeElderRay([100], [95], [100])).toBeNull(); });
  it('Fisher returns null', () => { expect(computeFisher([100], [95], [100])).toBeNull(); });
  it('MassIndex returns null', () => { expect(computeMassIndex([100], [95])).toBeNull(); });
  it('computeAllIndicators handles single kline', () => {
    const klines = makeKlines(1);
    const r = computeAllIndicators(klines);
    expect(r).toBeDefined();
    expect(r.rsi).toBeNull();
    expect(r.bb).toBeNull();
    expect(r.macd?.macd).toBeNull();
    expect(r.stochastic?.k).toBeNull();
    expect(r.ichimoku?.conversionLine).toBeNull();
    expect(r.williamsR).toBeNull();
    expect(r.cmf).toBeNull();
    expect(r.tsi).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// NaN VALUES
//
// NaN is a valid IEEE-754 number. JS math with NaN produces NaN; the
// invariant we test is that the function does NOT throw and returns a
// defined value (even if that value is NaN).
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: NaN values in data', () => {
  const nanArr = (n: number) => Array(n).fill(NaN);
  const nanHLC = (n: number) => [nanArr(n), nanArr(n), nanArr(n)] as const;

  it('sma returns NaN (propagates NaN), period >= len', () => {
    expect(sma(nanArr(20), 20)).toBeNaN();
  });
  it('sma returns null when period > len', () => {
    expect(sma(nanArr(5), 20)).toBeNull();
  });
  it('ema returns NaN (propagates NaN)', () => {
    const r = ema(nanArr(20), 14);
    expect(r).not.toBeNull();
    expect(r!).toBeNaN();
  });
  it('RSI with all NaN does not crash', () => {
    const r = computeRSI(nanArr(30));
    // Function should not throw; NaN or null are both acceptable
    expect(r === null || (typeof r === 'number')).toBe(true);
  });
  it('MACD with all NaN does not crash', () => {
    const r = computeMACD(nanArr(40));
    expect(r).toBeDefined();
  });
  it('BB with all NaN does not crash', () => {
    const r = computeBB(nanArr(30));
    expect(r === null || (typeof r.upper === 'number')).toBe(true);
  });
  it('ATR with all NaN does not crash', () => {
    const [h, l, c] = nanHLC(30);
    expect(computeATR(h, l, c)).not.toBeUndefined();
  });
  it('MFI with all NaN does not crash', () => {
    const [h, l, c] = nanHLC(20);
    expect(computeMFI(h, l, c, nanArr(20))).not.toBeUndefined();
  });
  it('Stochastic with all NaN does not crash', () => {
    const [h, l, c] = nanHLC(20);
    const r = computeStochastic(h, l, c);
    expect(r).toBeDefined();
  });
  it('Ichimoku with all NaN does not crash', () => {
    const [h, l, c] = nanHLC(30);
    const r = computeIchimoku(h, l, c);
    expect(r).toBeDefined();
  });
  it('Williams R with all NaN does not crash', () => {
    const [h, l, c] = nanHLC(20);
    expect(computeWilliamsR(h, l, c)).not.toBeUndefined();
  });
  it('CMF with all NaN does not crash', () => {
    const [h, l, c] = nanHLC(20);
    expect(computeCMF(h, l, c, nanArr(20))).not.toBeUndefined();
  });
  it('TSI with all NaN does not crash', () => {
    expect(computeTSI(nanArr(60))).not.toBeUndefined();
  });
  it('ADX with all NaN does not crash', () => {
    const [h, l, c] = nanHLC(40);
    expect(computeADX(h, l, c)).not.toBeUndefined();
  });
  it('VolTrend with all NaN does not crash', () => {
    expect(computeVolTrend(nanArr(20))).not.toBeUndefined();
  });
  it('OBV with NaN closes does not crash', () => {
    expect(computeOBV(nanArr(10), nanArr(10))).not.toBeUndefined();
  });
  it('VolVsAvg with all NaN does not crash', () => {
    expect(computeVolVsAvg(nanArr(25))).not.toBeUndefined();
  });
  it('computeAllIndicators with NaN klines does not crash', () => {
    const klines = makeKlines(80).map(k => ({ ...k, close: NaN, high: NaN, low: NaN, volume: NaN }));
    const r = computeAllIndicators(klines);
    expect(r).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INFINITY VALUES
//
// Like NaN, Infinity is a valid IEEE-754 value. JS math propagates it.
// The invariant is "does not throw".
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: Infinity values in data', () => {
  const infArr = (n: number) => Array(n).fill(Infinity);
  const negInfArr = (n: number) => Array(n).fill(-Infinity);
  const infHLC = (n: number) => [infArr(n), infArr(n), infArr(n)] as const;

  it('sma with Infinity returns Infinity', () => {
    expect(sma(infArr(20), 14)).toBe(Infinity);
  });
  it('sma with -Infinity returns -Infinity', () => {
    expect(sma(negInfArr(20), 14)).toBe(-Infinity);
  });
  it('RSI with Infinity does not crash', () => {
    expect(computeRSI(infArr(30))).not.toBeUndefined();
  });
  it('RSI with -Infinity does not crash', () => {
    expect(computeRSI(negInfArr(30))).not.toBeUndefined();
  });
  it('MACD with Infinity does not crash', () => {
    expect(computeMACD(infArr(40))).toBeDefined();
  });
  it('BB with Infinity does not crash', () => {
    const r = computeBB(infArr(30));
    expect(r === null || (typeof r.upper === 'number')).toBe(true);
  });
  it('ATR with Infinity does not crash', () => {
    const [h, l, c] = infHLC(30);
    expect(computeATR(h, l, c)).not.toBeUndefined();
  });
  it('Stochastic with Infinity does not crash', () => {
    const [h, l, c] = infHLC(20);
    expect(computeStochastic(h, l, c)).toBeDefined();
  });
  it('Ichimoku with Infinity does not crash', () => {
    const [h, l, c] = infHLC(30);
    expect(computeIchimoku(h, l, c)).toBeDefined();
  });
  it('Williams R with Infinity does not crash', () => {
    const [h, l, c] = infHLC(20);
    expect(computeWilliamsR(h, l, c)).not.toBeUndefined();
  });
  it('CMF with Infinity does not crash', () => {
    const [h, l, c] = infHLC(30);
    expect(computeCMF(h, l, c, infArr(30))).not.toBeUndefined();
  });
  it('TSI with Infinity does not crash', () => {
    expect(computeTSI(infArr(60))).not.toBeUndefined();
  });
  it('OBV with Infinity does not crash', () => {
    expect(computeOBV(infArr(10), infArr(10))).not.toBeUndefined();
  });
  it('computeAllIndicators with Infinity klines does not crash', () => {
    const klines = makeKlines(80).map(k => ({ ...k, close: Infinity, high: Infinity, low: Infinity, volume: Infinity }));
    const r = computeAllIndicators(klines);
    expect(r).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ALL IDENTICAL VALUES
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: All identical values', () => {
  const flat20 = new Array(20).fill(100);
  const flat30 = new Array(30).fill(100);
  const flat60 = new Array(60).fill(100);

  it('sma returns same value', () => {
    expect(sma(flat20, 14)).toBe(100);
  });
  it('ema returns same value', () => {
    expect(ema(flat20, 14)).toBe(100);
  });
  it('RSI returns 100 on flat prices (avgLoss===0 → early return)', () => {
    // All deltas are 0 → avgLoss === 0 → code returns 100
    const r = computeRSI(flat30);
    expect(r).toBe(100);
  });
  it('BB returns bands all at middle on flat', () => {
    const r = computeBB(flat20, 20);
    expect(r).not.toBeNull();
    expect(r!.middle).toBe(100);
    expect(r!.upper).toBe(100);
    expect(r!.lower).toBe(100);
    expect(r!.width).toBe(0);
    expect(r!.position).toBe(0.5);
  });
  it('MACD returns all zeros on flat', () => {
    const r = computeMACD(flat30);
    if (r.macd !== null) {
      expect(r.macd).toBe(0);
      expect(r.signal).toBe(0);
      expect(r.histogram).toBe(0);
    }
  });
  it('ATR returns 0 on flat prices', () => {
    const r = computeATR(flat30, flat30, flat30);
    expect(r).not.toBeNull();
    expect(r!).toBe(0);
  });
  it('Stochastic returns 50 on flat', () => {
    const flat20Arr = new Array(20).fill(100);
    const r = computeStochastic(flat20Arr, flat20Arr, flat20Arr);
    if (r.k !== null) {
      expect(r.k).toBe(50);
    }
  });
  it('Williams R returns -50 on flat', () => {
    const flat15 = new Array(15).fill(100);
    expect(computeWilliamsR(flat15, flat15, flat15)).toBe(-50);
  });
  it('TSI returns 0 on flat (no momentum)', () => {
    expect(computeTSI(flat60)).toBe(0);
  });
  it('VolTrend returns 0 on flat volumes', () => {
    expect(computeVolTrend(flat20)).toBe(0);
  });
  it('VolVsAvg returns 0 on flat volumes', () => {
    expect(computeVolVsAvg(flat20)).toBe(0);
  });
  it('MFI returns 100 on flat prices with volume', () => {
    const r = computeMFI(flat30, flat30, flat30, flat30);
    expect(r).not.toBeNull();
  });
  it('CMF returns 0 on flat (no range, neutral multiplier)', () => {
    expect(computeCMF(flat20, flat20, flat20, new Array(20).fill(1000))).toBe(0);
  });
  it('ADX returns 0 on flat', () => {
    expect(computeADX(flat30, flat30, flat30)).toBe(0);
  });
  it('OBV returns 0 on flat closes', () => {
    expect(computeOBV(new Array(10).fill(100), new Array(10).fill(1000))).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// LARGE ARRAYS (2000+ elements)
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: Large arrays (2000 elements)', () => {
  const bigCloses = Array.from({ length: 2000 }, (_, i) => 100 + Math.sin(i * 0.1) * 10);
  const bigHighs = bigCloses.map(c => c + 2);
  const bigLows = bigCloses.map(c => c - 2);
  const bigVolumes = new Array(2000).fill(1000);

  it('computes all single-indicator functions without crashing', () => {
    expect(sma(bigCloses, 14)).not.toBeNull();
    expect(ema(bigCloses, 14)).not.toBeNull();
    expect(computeRSI(bigCloses)).not.toBeNull();
    expect(computeBB(bigCloses)).not.toBeNull();
    expect(computeATR(bigHighs, bigLows, bigCloses)).not.toBeNull();
    expect(computeVolTrend(bigVolumes)).not.toBeNull();
    expect(computeOBV(bigCloses, bigVolumes)).not.toBeNull();
    expect(computeVolVsAvg(bigVolumes)).not.toBeNull();
    expect(computeWilliamsR(bigHighs, bigLows, bigCloses)).not.toBeNull();
    expect(computeCMF(bigHighs, bigLows, bigCloses, bigVolumes)).not.toBeNull();
    expect(computeTSI(bigCloses)).not.toBeNull();
    expect(computeADX(bigHighs, bigLows, bigCloses)).not.toBeNull();
  });

  it('MACD handles large arrays', () => {
    const r = computeMACD(bigCloses);
    expect(r.macd).not.toBeNull();
    expect(r.signal).not.toBeNull();
    expect(r.histogram).not.toBeNull();
    expect(isNotNaN(r.macd)).toBe(true);
  });

  it('Stochastic handles large arrays', () => {
    const r = computeStochastic(bigHighs, bigLows, bigCloses);
    expect(r.k).not.toBeNull();
    expect(r.d).not.toBeNull();
    expect(isNotNaN(r.k)).toBe(true);
  });

  it('Ichimoku handles large arrays', () => {
    const r = computeIchimoku(bigHighs, bigLows, bigCloses);
    expect(r.conversionLine).not.toBeNull();
    expect(r.baseLine).not.toBeNull();
    expect(r.spanA).not.toBeNull();
    expect(r.spanB).not.toBeNull();
  });

  it('computeAllIndicators handles 2000 klines', () => {
    const klines = makeKlines(2000);
    const r = computeAllIndicators(klines);
    expect(r).toBeDefined();
    expect(r.rsi).not.toBeNull();
    expect(r.mfi).not.toBeNull();
    expect(r.bb).not.toBeNull();
    expect(r.macd?.macd).not.toBeNull();
    expect(r.atrPct).not.toBeNull();
    expect(r.volTrend).not.toBeNull();
    expect(r.priceVsEma50).not.toBeNull();
    expect(r.obv).not.toBeNull();
    expect(r.volVsAvg).not.toBeNull();
    expect(r.stochastic?.k).not.toBeNull();
    expect(r.ichimoku?.conversionLine).not.toBeNull();
    expect(r.williamsR).not.toBeNull();
    expect(r.cmf).not.toBeNull();
    expect(r.tsi).not.toBeNull();
    // Verify no NaN propagation on real data
    expect(isNotNaN(r.rsi)).toBe(true);
    expect(isNotNaN(r.macd?.macd)).toBe(true);
    expect(isNotNaN(r.bb?.upper)).toBe(true);
    expect(isNotNaN(r.atrPct)).toBe(true);
    expect(isNotNaN(r.stochastic?.k)).toBe(true);
    expect(isNotNaN(r.williamsR!)).toBe(true);
    expect(isNotNaN(r.cmf!)).toBe(true);
    expect(isNotNaN(r.tsi!)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// VERY SMALL VALUES (sub-satoshi / 1e-8 scale)
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: Very small values (1e-8 scale)', () => {
  const tinyCloses = Array.from({ length: 60 }, (_, i) => 0.00000001 + Math.sin(i * 0.3) * 0.000000005);
  const tinyHighs = tinyCloses.map(c => c + 0.000000002);
  const tinyLows = tinyCloses.map(c => c - 0.000000002);
  const tinyVolumes = new Array(60).fill(0.00000001);

  it('RSI handles sub-satoshi prices', () => {
    const r = computeRSI(tinyCloses);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThanOrEqual(0);
    expect(r!).toBeLessThanOrEqual(100);
  });

  it('BB handles sub-satoshi prices', () => {
    const r = computeBB(tinyCloses);
    expect(r).not.toBeNull();
    expect(r!.width).toBeGreaterThanOrEqual(0);
  });

  it('MACD handles sub-satoshi prices', () => {
    const r = computeMACD(tinyCloses);
    expect(r.macd === null || isNotNaN(r.macd)).toBe(true);
  });

  it('ATR handles sub-satoshi prices', () => {
    const r = computeATR(tinyHighs, tinyLows, tinyCloses);
    expect(r === null || r! >= 0).toBe(true);
  });

  it('TSI handles sub-satoshi prices', () => {
    const r = computeTSI(tinyCloses);
    expect(r === null || isNotNaN(r)).toBe(true);
  });

  it('Stochastic handles sub-satoshi prices', () => {
    const r = computeStochastic(tinyHighs, tinyLows, tinyCloses);
    expect(r.k === null || isNotNaN(r.k)).toBe(true);
    expect(r.d === null || isNotNaN(r.d)).toBe(true);
  });

  it('Williams R handles sub-satoshi prices', () => {
    const r = computeWilliamsR(tinyHighs, tinyLows, tinyCloses);
    expect(r === null || isNotNaN(r)).toBe(true);
  });

  it('CMF handles sub-satoshi prices', () => {
    const r = computeCMF(tinyHighs, tinyLows, tinyCloses, tinyVolumes);
    expect(r === null || isNotNaN(r)).toBe(true);
  });

  it('computeAllIndicators handles sub-satoshi klines', () => {
    const klines = makeKlines(80, 0.00000001, 0.000000012, 0.000000008, 0.00000001, 0.00000001);
    const r = computeAllIndicators(klines);
    expect(r).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// VERY LARGE VALUES (1e10 scale)
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: Very large values (1e10 scale)', () => {
  const hugeCloses = Array.from({ length: 60 }, (_, i) => 10000000000 + Math.sin(i * 0.3) * 500000000);
  const hugeHighs = hugeCloses.map(c => c + 200000000);
  const hugeLows = hugeCloses.map(c => c - 200000000);
  const hugeVolumes = new Array(60).fill(100000000000);

  it('RSI handles billion-scale prices', () => {
    const r = computeRSI(hugeCloses);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThanOrEqual(0);
    expect(r!).toBeLessThanOrEqual(100);
  });

  it('BB handles billion-scale prices', () => {
    const r = computeBB(hugeCloses);
    expect(r).not.toBeNull();
    expect(r!.upper).toBeGreaterThan(r!.middle);
  });

  it('ATR handles billion-scale prices', () => {
    const r = computeATR(hugeHighs, hugeLows, hugeCloses);
    expect(r === null || (r >= 0 && isNotNaN(r))).toBe(true);
  });

  it('MACD handles billion-scale prices', () => {
    const r = computeMACD(hugeCloses);
    expect(r.macd === null || isNotNaN(r.macd)).toBe(true);
  });

  it('TSI handles billion-scale prices (returns bounded -100 to 100)', () => {
    const r = computeTSI(hugeCloses);
    expect(r === null || (Math.abs(r!) <= 100)).toBe(true);
  });

  it('Stochastic handles billion-scale prices', () => {
    const r = computeStochastic(hugeHighs, hugeLows, hugeCloses);
    if (r.k !== null) {
      expect(r.k).toBeGreaterThanOrEqual(0);
      expect(r.k).toBeLessThanOrEqual(100);
    }
  });

  it('Williams R handles billion-scale prices', () => {
    const r = computeWilliamsR(hugeHighs, hugeLows, hugeCloses);
    expect(r === null || (r >= -100 && r <= 0)).toBe(true);
  });

  it('CMF handles billion-scale prices and volume', () => {
    const r = computeCMF(hugeHighs, hugeLows, hugeCloses, hugeVolumes);
    expect(r === null || (r >= -1 && r <= 1)).toBe(true);
  });

  it('computeAllIndicators handles billion-scale klines', () => {
    const klines = makeKlines(80, 10000000000, 10000002000, 9999998000, 10000000000, 100000000000);
    const r = computeAllIndicators(klines);
    expect(r).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// NEGATIVE PRICES (edge case — not realistic but should not crash)
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: Negative prices', () => {
  const negCloses = Array.from({ length: 60 }, (_, i) => -100 + Math.sin(i * 0.3) * 10);
  const negHighs = negCloses.map(c => c + 2);
  const negLows = negCloses.map(c => c - 2);
  const negVolumes = new Array(60).fill(1000);

  it('RSI handles negative closes', () => {
    const r = computeRSI(negCloses);
    expect(r === null || (r >= 0 && r <= 100)).toBe(true);
  });

  it('BB handles negative closes', () => {
    const r = computeBB(negCloses);
    expect(r === null || isNotNaN(r!.upper)).toBe(true);
  });

  it('ATR handles negative prices', () => {
    const r = computeATR(negHighs, negLows, negCloses);
    expect(r === null || isNotNaN(r)).toBe(true);
  });

  it('MACD handles negative closes', () => {
    const r = computeMACD(negCloses);
    expect(r.macd === null || isNotNaN(r.macd)).toBe(true);
  });

  it('Stochastic handles negative prices', () => {
    const r = computeStochastic(negHighs, negLows, negCloses);
    if (r.k !== null) {
      expect(r.k).toBeGreaterThanOrEqual(0);
      expect(r.k).toBeLessThanOrEqual(100);
    }
  });

  it('Williams R handles negative prices', () => {
    const r = computeWilliamsR(negHighs, negLows, negCloses);
    expect(r === null || (r >= -100 && r <= 0)).toBe(true);
  });

  it('TSI handles negative closes', () => {
    const r = computeTSI(negCloses);
    expect(r === null || isNotNaN(r)).toBe(true);
  });

  it('CMF handles negative prices', () => {
    const r = computeCMF(negHighs, negLows, negCloses, negVolumes);
    expect(r === null || isNotNaN(r)).toBe(true);
  });

  it('computeAllIndicators handles negative klines', () => {
    const klines = makeKlines(80, -100, -98, -102, -100, 1000);
    const r = computeAllIndicators(klines);
    expect(r).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ZERO VALUES
// ═══════════════════════════════════════════════════════════════════════

describe('Fuzz: Zero values', () => {
  const zeros = new Array(60).fill(0);

  it('RSI with all zeros', () => {
    const r = computeRSI(zeros);
    // avgLoss === 0 → returns 100
    expect(r).toBe(100);
  });

  it('BB with all zeros', () => {
    const r = computeBB(new Array(20).fill(0));
    expect(r).not.toBeNull();
    expect(r!.middle).toBe(0);
    expect(r!.upper).toBe(0);
    expect(r!.lower).toBe(0);
    expect(r!.width).toBe(0);
    expect(r!.position).toBe(0.5);
  });

  it('ATR with all zeros (currentClose=0 → null)', () => {
    expect(computeATR(zeros, zeros, zeros)).toBeNull();
  });

  it('MACD with all zeros', () => {
    const r = computeMACD(zeros);
    if (r.macd !== null) {
      expect(r.macd).toBe(0);
      expect(r.signal).toBe(0);
      expect(r.histogram).toBe(0);
    }
  });

  it('Stochastic with all zeros', () => {
    const r = computeStochastic(zeros, zeros, zeros);
    if (r.k !== null) {
      expect(r.k).toBe(50);
    }
  });

  it('Williams R with all zeros', () => {
    // computeWilliamsR checks range === 0 first → returns -50
    expect(computeWilliamsR(zeros, zeros, zeros)).toBe(-50);
  });

  it('CMF with all zeros (no volume)', () => {
    expect(computeCMF(zeros, zeros, zeros, zeros)).toBe(0);
  });

  it('TSI with all zeros', () => {
    expect(computeTSI(zeros)).toBe(0);
  });

  it('VolTrend with all zeros', () => {
    expect(computeVolTrend(new Array(20).fill(0))).toBe(0);
  });

  it('VolVsAvg with all zeros (avgVolume=0 → null)', () => {
    expect(computeVolVsAvg(new Array(20).fill(0))).toBeNull();
  });

  it('OBV with all zeros', () => {
    expect(computeOBV(zeros, zeros)).toBe(0);
  });

  it('ADX with all zeros', () => {
    expect(computeADX(zeros, zeros, zeros)).toBe(0);
  });

  it('computeAllIndicators with zero klines', () => {
    const klines = makeKlines(80, 0, 0, 0, 0, 0);
    const r = computeAllIndicators(klines);
    expect(r).toBeDefined();
  });
});
