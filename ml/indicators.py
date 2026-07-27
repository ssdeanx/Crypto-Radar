"""
Hermes Crypto Radar — Technical Indicator Feature Engineering

Extracted from train.py for modular reuse. Provides:
- pandas-ta-classic feature augmentation (_add_ta_features)
- Feature correlation filtering (_feature_correlation_filter)
- Data cadence detection (_derive_cadence)

All functions are self-contained with lazy imports for optional dependencies.
"""

import json
import logging
import sys

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ── Correlation filter ─────────────────────────────────────────────────────


def _feature_correlation_filter(
    df: pd.DataFrame,
    feature_cols: list[str],
    threshold: float = 0.98,
) -> list[str]:
    """Drop highly-correlated features (> threshold) to reduce redundancy."""
    if threshold <= 0 or len(feature_cols) < 2:
        return feature_cols

    sub = pd.DataFrame(df[feature_cols])

    # Drop constant (zero-variance) features to avoid NaN correlations
    variances = sub.var()
    constant_cols = variances[variances == 0].index.tolist()
    if constant_cols:
        logger.info(
            "Removing %d constant features: %s", len(constant_cols), constant_cols
        )
        feature_cols = [c for c in feature_cols if c not in constant_cols]
        if len(feature_cols) < 2:
            return feature_cols
        sub = pd.DataFrame(df[feature_cols])

    corr: pd.DataFrame = sub.corr()
    mask = pd.DataFrame(np.triu(np.ones(corr.shape, dtype=bool), k=1), index=corr.index, columns=corr.columns, dtype=bool)
    upper = corr.where(mask)
    to_drop = {col for col in upper.columns if (upper[col] > threshold).any()}
    if to_drop:
        logger.info(
            "Dropping %d highly-correlated features (>%.2f): %s",
            len(to_drop),
            threshold,
            sorted(to_drop),
        )
    return [c for c in feature_cols if c not in to_drop]


# ── Cadence ────────────────────────────────────────────────────────────────


def _derive_cadence(open_time: pd.Series) -> pd.Timedelta:
    """Derive the data cadence (median spacing) from open_time values (ms epoch)."""
    ts = pd.to_datetime(open_time, unit="ms")
    diffs = ts.diff().dropna()
    if len(diffs) == 0:
        return pd.Timedelta(days=1)
    median = diffs.median()
    if median is None or pd.isna(median) or median == pd.Timedelta(0):
        return pd.Timedelta(days=1)
    return median


# ── TA feature augmentation ────────────────────────────────────────────────


def _add_ta_features(df: pd.DataFrame, feature_cols: list[str]) -> list[str]:
    """Append pandas-ta indicators for OHLC-like columns; return extended feature_cols.

    Adds up to 12 additional feature columns per OHLC-like base column:
    RSI(14), MACD(12,26,9), BBANDS(20,2), STOCH(14,3), ATR(14), OBV,
    WILLIAMS %R(14), CCI(20), ROC(12), EMA cross signals, CMF(20), MFI(14).
    """
    try:
        import pandas_ta_classic as ta  # type: ignore
    except Exception as e:
        logger.error("pandas-ta requested (--add-ta) but not installed: %s", e)
        print(json.dumps({"error": f"pandas-ta not available: {e}"}))
        sys.exit(1)

    # Identify OHLC-like columns by name (case-insensitive substring match)
    ohlc_keys = ("open", "high", "low", "close", "volume")
    ta_cols: list[str] = []
    # Collect OHLCV column names for multi-column indicators
    col_map: dict[str, str] = {}
    for base in feature_cols:
        low = base.lower()
        for key in ohlc_keys:
            if key in low:
                col_map[key] = base
                break

    # Helper: wrap a single indicator call with try/except
    def _add(name: str, result) -> None:
        if result is None:
            return
        if isinstance(result, pd.Series):
            df[name] = result
            ta_cols.append(name)
        elif isinstance(result, pd.DataFrame):
            for c in result.columns:
                full = f"{name}_{c}"
                df[full] = result[c]
                ta_cols.append(full)

    for base in feature_cols:
        low = base.lower()
        if not any(k in low for k in ohlc_keys):
            continue
        series = df[base]

        # 1. RSI(14)
        try:
            _add(f"{base}_rsi_14", ta.rsi(series, length=14))
        except Exception as e:
            logger.warning("TA RSI failed for %s: %s", base, e)

        # 2. MACD(12,26,9)
        try:
            _add(f"{base}_macd", ta.macd(series, fast=12, slow=26, signal=9))
        except Exception as e:
            logger.warning("TA MACD failed for %s: %s", base, e)

        # 3. Bollinger Bands(20,2)
        try:
            _add(f"{base}_bb", ta.bbands(series, length=20, std=2))
        except Exception as e:
            logger.warning("TA BBANDS failed for %s: %s", base, e)

        # 4. Williams %R(14) — needs high/low when available
        try:
            high_col = col_map.get("high")
            low_col = col_map.get("low")
            if high_col and low_col and low == "close":
                _add(f"{base}_willr_14", ta.willr(df[high_col], df[low_col], series, length=14))
        except Exception as e:
            logger.warning("TA WILLR failed for %s: %s", base, e)

        # 5. CCI(20)
        try:
            high_col = col_map.get("high")
            low_col = col_map.get("low")
            if high_col and low_col and low == "close":
                _add(f"{base}_cci_20", ta.cci(df[high_col], df[low_col], series, length=20))
        except Exception as e:
            logger.warning("TA CCI failed for %s: %s", base, e)

        # 6. ROC(12)
        try:
            _add(f"{base}_roc_12", ta.roc(series, length=12))
        except Exception as e:
            logger.warning("TA ROC failed for %s: %s", base, e)

        # 7. EMA cross signals (12/26)
        try:
            ema12 = ta.ema(series, length=12)
            ema26 = ta.ema(series, length=26)
            if ema12 is not None and ema26 is not None:
                cross_name = f"{base}_ema_12_26_cross"
                ema_cross = pd.Series(
                    0,
                    index=series.index,
                    name=cross_name,
                    dtype=int,
                )
                ema_cross[ema12 > ema26] = 1
                ema_cross[ema12 < ema26] = -1
                df[cross_name] = ema_cross
                ta_cols.append(cross_name)
                diff_name = f"{base}_ema_12_26_diff"
                df[diff_name] = (ema12 - ema26) / series.replace(0, np.nan)
                ta_cols.append(diff_name)
        except Exception as e:
            logger.warning("TA EMA cross failed for %s: %s", base, e)

        # 8. Stochastic %K (14,3) — needs high/low mapping if 'close' is the series
        try:
            if "close" in col_map and low == "close":
                high_col = col_map.get("high")
                low_col = col_map.get("low")
                if high_col and low_col:
                    stoch = ta.stoch(df[high_col], df[low_col], series, k=14, d=3)
                    _add(f"{base}_stoch", stoch)
        except Exception as e:
            logger.warning("TA STOCH failed: %s", e)

        # 9. KAMA(10) — Kaufman's Adaptive Moving Average
        try:
            _add(f"{base}_kama_10", ta.kama(series, length=10, fast=2, slow=30))
        except Exception as e:
            logger.warning("TA KAMA failed for %s: %s", base, e)

        # 10. ALMA(9) — Arnaud Legoux Moving Average
        try:
            _add(f"{base}_alma_9", ta.alma(series, length=9, sigma=6, distribution_offset=0.85))
        except Exception as e:
            logger.warning("TA ALMA failed for %s: %s", base, e)

        # 11. HMA(9) — Hull Moving Average
        try:
            _add(f"{base}_hma_9", ta.hma(series, length=9))
        except Exception as e:
            logger.warning("TA HMA failed for %s: %s", base, e)

        # 12. Z-Score(21) — volatility-normalized price position
        try:
            _add(f"{base}_zscore_21", ta.zscore(series, length=21))
        except Exception as e:
            logger.warning("TA Z-Score failed for %s: %s", base, e)

    # 9–12. Multi-column indicators (run once, not per-base-column)
    has_ohlc = all(k in col_map for k in ("open", "high", "low", "close"))
    if has_ohlc:
        open_c = col_map["open"]
        high_c = col_map["high"]
        low_c = col_map["low"]
        close_c = col_map["close"]
        vol_c = col_map.get("volume")

        # 9. ATR(14)
        try:
            atr = ta.atr(df[high_c], df[low_c], df[close_c], length=14)
            _add("atr_14", atr)
        except Exception as e:
            logger.warning("TA ATR failed: %s", e)

        # 10. OBV — needs close + volume
        if vol_c:
            try:
                _add("obv", ta.obv(df[close_c], df[vol_c]))
            except Exception as e:
                logger.warning("TA OBV failed: %s", e)

            # 11. Chaikin Money Flow(20)
            try:
                _add("cmf_20", ta.cmf(
                    df[high_c], df[low_c], df[close_c], df[vol_c], length=20,
                ))
            except Exception as e:
                logger.warning("TA CMF failed: %s", e)

            # 12. Money Flow Index(14)
            try:
                _add("mfi_14", ta.mfi(
                    df[high_c], df[low_c], df[close_c], df[vol_c], length=14,
                ))
            except Exception as e:
                logger.warning("TA MFI failed: %s", e)

        # 13–16. Additional multi-column indicators
        # 13. SuperTrend(10,3)
        try:
            _add("supertrend_10_3", ta.supertrend(df[high_c], df[low_c], df[close_c], length=10, multiplier=3))
        except Exception as e:
            logger.warning("TA SuperTrend failed: %s", e)

        # 14. SSL Channel(10) — custom (not in pandas_ta_classic)
        try:
            ssl_sma = df[close_c].rolling(window=10).mean()
            ssl_h = df[high_c].rolling(window=10).mean()
            ssl_l = df[low_c].rolling(window=10).mean()
            ssl_dir = pd.Series(0, index=df.index, dtype=int)
            ssl_dir[df[close_c] > ssl_sma] = 1
            ssl_dir[df[close_c] < ssl_sma] = -1
            df["ssl_channel_10"] = (ssl_h + ssl_l) / 2
            ta_cols.append("ssl_channel_10")
            df["ssl_direction_10"] = ssl_dir
            ta_cols.append("ssl_direction_10")
        except Exception as e:
            logger.warning("TA SSL failed: %s", e)

        # 15. Donchian Channel(20)
        try:
            _add("dc_20", ta.donchian(df[high_c], df[low_c], lower_length=20, upper_length=20))
        except Exception as e:
            logger.warning("TA Donchian failed: %s", e)

        # 16. Pivot Points(2,2) — custom (not in pandas_ta_classic)
        try:
            pp_window = 2 + 2 + 1  # left + right + center
            high_window = df[high_c].rolling(window=pp_window, center=True).max()
            low_window = df[low_c].rolling(window=pp_window, center=True).min()
            pivot_h = df[high_c][df[high_c] == high_window].reindex(df.index)
            pivot_l = df[low_c][df[low_c] == low_window].reindex(df.index)
            df["pivot_high_2_2"] = pivot_h
            ta_cols.append("pivot_high_2_2")
            df["pivot_low_2_2"] = pivot_l
            ta_cols.append("pivot_low_2_2")
        except Exception as e:
            logger.warning("TA Pivot failed: %s", e)

    logger.info("Added %d pandas-ta indicator columns", len(ta_cols))
    return feature_cols + [c for c in ta_cols if c not in feature_cols]


# ── Additional TA feature names (for test verification) ────────────────────


ADDITIONAL_TA_NAMES: list[str] = [
    "kama",
    "alma",
    "hma",
    "zscore",
    "supertrend",
    "ssl",
    "donchian",
    "pivot",
]


def compute_latest_indicators(df: pd.DataFrame) -> dict:
    """Compute all technical indicators for the latest row to serve to the Node.js frontend."""
    try:
        import pandas_ta_classic as ta
    except Exception:
        return {}

    def val(s):
        if s is None: return None
        v = s.iloc[-1]
        return None if pd.isna(v) or not np.isfinite(v) else float(v)

    out: dict = {
        'rsi': None,
        'mfi': None,
        'bb': None,
        'macd': { 'macd': None, 'histogram': None, 'signal': None },
        'atrPct': None,
        'volTrend': None,
        'priceVsEma50': None,
        'obv': None,
        'volVsAvg': None,
        'stochastic': { 'k': None, 'd': None },
        'ichimoku': { 'conversionLine': None, 'baseLine': None, 'spanA': None, 'spanB': None, 'laggingSpan': None },
        'williamsR': None,
        'cmf': None,
        'tsi': None,
        'adx': None,
        'psar': { 'sar': None, 'acceleration': 0.02, 'isReversal': False },
        'cci': None,
        'keltner': { 'lower': None, 'middle': None, 'upper': None },
        'roc': None,
        'vwap': None,
        'forceIndex': None,
        'adl': None,
        'chaikinOsc': None,
        'stochRsi': { 'k': None, 'd': None },
        'trix': None,
        'kst': { 'kst': None, 'signal': None },
        'elderRay': { 'bullPower': None, 'bearPower': None },
        'fisher': None,
        'massIndex': None,
        'rangePosWindow': 0.5
    }
    if len(df) < 5:
        return out
    
    # F5: pandas-ta has a bug with 15-40 row DataFrames causing 'iloc cannot enlarge'
    # Skip pandas-ta for small windows; TS-side indicators are already sufficient
    if len(df) < 50:
        # Still compute VWAP and basic info from raw data
        if 'close' in df.columns and 'volume' in df.columns:
            c_small = df['close']
            v_small = df['volume']
            out['obv'] = float((c_small.diff() > 0).astype(int).replace(0, -1).mul(v_small).sum()) if len(v_small) > 1 else None
        return out

    c = df['close']
    h = df['high']
    l = df['low']
    o = df['open']
    v = df['volume']

    # RSI
    rsi = ta.rsi(c, length=14)
    out['rsi'] = val(rsi) if rsi is not None else None

    # MFI
    mfi = ta.mfi(h, l, c, v, length=14)
    out['mfi'] = val(mfi) if mfi is not None else None

    # BBands
    bb = ta.bbands(c, length=20, std=2)
    if bb is not None and len(bb.columns) >= 5:
        out['bb'] = {
            'lower': val(bb.iloc[:, 0]),
            'middle': val(bb.iloc[:, 1]),
            'upper': val(bb.iloc[:, 2]),
            'width': val(bb.iloc[:, 3]),
            'position': val(bb.iloc[:, 4])
        }
    else:
        out['bb'] = None

    # MACD
    macd = ta.macd(c, fast=12, slow=26, signal=9)
    if macd is not None and len(macd.columns) >= 3:
        out['macd'] = {
            'macd': val(macd.iloc[:, 0]),
            'histogram': val(macd.iloc[:, 1]),
            'signal': val(macd.iloc[:, 2])
        }
    else:
        out['macd'] = { 'macd': None, 'histogram': None, 'signal': None }

    # ATR
    atr = ta.atr(h, l, c, length=14)
    atr_val = val(atr) if atr is not None else None
    close_val = val(c)
    out['atrPct'] = (atr_val / close_val * 100) if atr_val and close_val else None

    # Vol Trend
    if len(v) >= 14:
        recent = v.iloc[-7:].mean()
        older = v.iloc[-14:-7].mean()
        out['volTrend'] = (recent / older) - 1 if older > 0 else 0.0
    else: out['volTrend'] = None

    # Price vs EMA50
    ema50 = ta.ema(c, length=50)
    ema50_val = val(ema50) if ema50 is not None else None
    out['priceVsEma50'] = ((close_val - ema50_val) / ema50_val * 100) if close_val and ema50_val else None

    # OBV
    obv = ta.obv(c, v)
    out['obv'] = val(obv) if obv is not None else None

    # Vol vs Avg
    if len(v) >= 20:
        avg_vol = v.iloc[:-1].mean()
        cur_vol = val(v)
        out['volVsAvg'] = (cur_vol / avg_vol) - 1 if avg_vol > 0 and cur_vol is not None else None
    else: out['volVsAvg'] = None

    # Stochastic
    stoch = ta.stoch(h, l, c, k=14, d=3, smooth_k=3)
    if stoch is not None and len(stoch.columns) >= 2:
        out['stochastic'] = {
            'k': val(stoch.iloc[:, 0]),
            'd': val(stoch.iloc[:, 1])
        }
    else:
        out['stochastic'] = { 'k': None, 'd': None }

    # Ichimoku
    ichi, _ = ta.ichimoku(h, l, c)
    if ichi is not None and len(ichi.columns) >= 5:
        out['ichimoku'] = {
            'conversionLine': val(ichi.iloc[:, 0]),
            'baseLine': val(ichi.iloc[:, 1]),
            'spanA': val(ichi.iloc[:, 2]),
            'spanB': val(ichi.iloc[:, 3]),
            'laggingSpan': val(ichi.iloc[:, 4])
        }
    else:
        out['ichimoku'] = { 'conversionLine': None, 'baseLine': None, 'spanA': None, 'spanB': None, 'laggingSpan': None }

    # Williams R
    willr = ta.willr(h, l, c, length=14)
    out['williamsR'] = val(willr) if willr is not None else None

    # CMF
    cmf = ta.cmf(h, l, c, v, length=20)
    out['cmf'] = val(cmf) if cmf is not None else None

    # TSI
    tsi = ta.tsi(c, fast=13, slow=25)
    out['tsi'] = val(tsi.iloc[:, 0]) if tsi is not None else None

    # ADX
    adx = ta.adx(h, l, c, length=14)
    out['adx'] = val(adx.iloc[:, 0]) if adx is not None and len(adx.columns) > 0 else None

    # PSAR
    psar = ta.psar(h, l, c)
    if psar is not None and len(psar.columns) >= 4:
        # psar columns: PSAR, PSAR_AF, PSAR_UP, PSAR_DOWN
        af = val(psar.iloc[:, 1])
        rev = False
        if len(psar) >= 2:
            # Check for reversal if it flipped from UP to DOWN or vice versa
            up_curr = not pd.isna(psar.iloc[-1, 2])
            up_prev = not pd.isna(psar.iloc[-2, 2])
            rev = (up_curr != up_prev)
        out['psar'] = {
            'sar': val(psar.iloc[:, 0]),
            'acceleration': af if af is not None else 0.02,
            'isReversal': rev
        }
    else:
        out['psar'] = { 'sar': None, 'acceleration': 0.02, 'isReversal': False }

    # CCI
    cci = ta.cci(h, l, c, length=20)
    out['cci'] = val(cci) if cci is not None else None

    # Keltner Channels
    kc = ta.kc(h, l, c, length=20, scalar=2)
    if kc is not None and len(kc.columns) >= 3:
        out['keltner'] = {
            'lower': val(kc.iloc[:, 0]),
            'middle': val(kc.iloc[:, 1]),
            'upper': val(kc.iloc[:, 2])
        }
    else:
        out['keltner'] = { 'lower': None, 'middle': None, 'upper': None }

    # ROC
    roc = ta.roc(c, length=12)
    out['roc'] = val(roc) if roc is not None else None

    # VWAP
    vwap = ta.vwap(h, l, c, v)
    out['vwap'] = val(vwap) if vwap is not None else None

    # Force Index
    efi = ta.efi(c, v, length=13)
    out['forceIndex'] = val(efi) if efi is not None else None

    # ADL
    ad = ta.ad(h, l, c, v)
    out['adl'] = val(ad) if ad is not None else None

    # Chaikin Osc
    adosc = ta.adosc(h, l, c, v)
    out['chaikinOsc'] = val(adosc) if adosc is not None else None

    # StochRSI
    stochrsi = ta.stochrsi(c)
    if stochrsi is not None and len(stochrsi.columns) >= 2:
        out['stochRsi'] = {
            'k': val(stochrsi.iloc[:, 0]),
            'd': val(stochrsi.iloc[:, 1])
        }
    else:
        out['stochRsi'] = { 'k': None, 'd': None }

    # TRIX
    trix = ta.trix(c, length=15)
    out['trix'] = val(trix.iloc[:, 0]) if trix is not None else None

    # KST
    kst = ta.kst(c)
    if kst is not None and len(kst.columns) >= 2:
        out['kst'] = {
            'kst': val(kst.iloc[:, 0]),
            'signal': val(kst.iloc[:, 1])
        }
    else:
        out['kst'] = { 'kst': None, 'signal': None }

    # Elder Ray
    eri = ta.eri(h, l, c, length=13)
    if eri is not None and len(eri.columns) >= 2:
        out['elderRay'] = {
            'bullPower': val(eri.iloc[:, 0]),
            'bearPower': val(eri.iloc[:, 1])
        }
    else:
        out['elderRay'] = { 'bullPower': None, 'bearPower': None }

    # Fisher
    fisher = ta.fisher(h, l, length=9)
    out['fisher'] = val(fisher.iloc[:, 0]) if fisher is not None else None

    # Mass Index
    massi = ta.massi(h, l)
    out['massIndex'] = val(massi) if massi is not None else None

    # Range Pos Window
    period_h = h.max()
    period_l = l.max()
    rng = period_h - period_l
    if rng > 0 and close_val is not None:
        out['rangePosWindow'] = (close_val - period_l) / rng
    else:
        out['rangePosWindow'] = 0.5

    return out

if __name__ == '__main__':
    try:
        input_data = sys.stdin.read()
        if not input_data.strip():
            print("[]")
            sys.exit(0)

        data = json.loads(input_data)

        if isinstance(data, dict) and "batches" in data:
            results = {}
            for key, rows in data["batches"].items():
                if not rows:
                    results[key] = compute_latest_indicators(pd.DataFrame())
                    continue
                df = pd.DataFrame(rows)
                if 'open_time' in df.columns:
                    df['open_time'] = pd.to_numeric(df['open_time'], errors='coerce').astype('Int64')
                    df.index = pd.to_datetime(df['open_time'], unit='ms')
                elif 'openTime' in df.columns:
                    df['openTime'] = pd.to_numeric(df['openTime'], errors='coerce').astype('Int64')
                    df.index = pd.to_datetime(df['openTime'], unit='ms')
                for col in ['open', 'high', 'low', 'close', 'volume']:
                    if col in df.columns:
                        df[col] = pd.to_numeric(df[col], errors='coerce').astype(float)
                results[key] = compute_latest_indicators(df)
            print(json.dumps(results))
            sys.exit(0)

        # Expected structure: {"rows": [...]} or just a list of rows
        rows = data.get('rows', []) if isinstance(data, dict) else data

        if not rows:
            print("{}")
            sys.exit(0)

        df = pd.DataFrame(rows)
        # Type conversions to ensure correctness
        if 'open_time' in df.columns:
            df['open_time'] = pd.to_numeric(df['open_time'], errors='coerce').astype('Int64')
            df.index = pd.to_datetime(df['open_time'], unit='ms')
        elif 'openTime' in df.columns:
            df['openTime'] = pd.to_numeric(df['openTime'], errors='coerce').astype('Int64')
            df.index = pd.to_datetime(df['openTime'], unit='ms')
        for col in ['open', 'high', 'low', 'close', 'volume']:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').astype(float)

        indicators = compute_latest_indicators(df)
        print(json.dumps(indicators))
        sys.exit(0)
    except Exception as e:
        logger.error(f"Error computing indicators: {e}")
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
