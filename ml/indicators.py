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
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd

if TYPE_CHECKING:
    import pandas_ta_classic as ta # TODO: ta is not being used.  do not ever comment out warnings.

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
    upper = corr.where(np.triu(np.ones(corr.shape), k=1).astype(bool))
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
                    np.where(ema12 > ema26, 1, np.where(ema12 < ema26, -1, 0)),
                    index=series.index,
                    name=cross_name,
                )
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

    logger.info("Added %d pandas-ta indicator columns", len(ta_cols))
    return feature_cols + [c for c in ta_cols if c not in feature_cols]
