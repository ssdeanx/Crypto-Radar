"""Tests for ml/indicators.py — Technical Indicator Feature Engineering."""

from __future__ import annotations

import sys
from unittest.mock import MagicMock, PropertyMock, patch

import numpy as np
import pandas as pd
import pytest

from indicators import (
    _add_ta_features,
    _derive_cadence,
    _feature_correlation_filter,
)


# ── _derive_cadence ─────────────────────────────────────────────────────────


class TestDeriveCadence:
    def test_hourly_cadence(self) -> None:
        """Timestamps ~1 hour apart yield a ~1h Timedelta."""
        base = 1_700_000_000_000  # epoch ms
        # Every hour on the hour, 10 entries
        timestamps = pd.Series([base + i * 3_600_000 for i in range(10)])
        result = _derive_cadence(timestamps)
        assert result == pd.Timedelta(hours=1)

    def test_daily_cadence(self) -> None:
        """Timestamps ~1 day apart yield a ~1 day Timedelta."""
        base = 1_700_000_000_000
        timestamps = pd.Series([base + i * 86_400_000 for i in range(5)])
        result = _derive_cadence(timestamps)
        assert result == pd.Timedelta(days=1)

    def test_irregular_cadence_median(self) -> None:
        """Mixed offsets resolve to the median spacing."""
        base = 1_700_000_000_000
        # Offsets: mostly 1h but some 2h gaps
        offsets = [0, 3_600_000, 7_200_000, 14_400_000, 18_000_000]  # 1h, 1h, 2h, 1h
        # Median of [1h, 1h, 2h, 1h] = 1h
        timestamps = pd.Series([base + off for off in offsets])
        result = _derive_cadence(timestamps)
        assert result == pd.Timedelta(hours=1)

    def test_empty_series(self) -> None:
        """An empty series returns a default of 1 day."""
        timestamps = pd.Series([], dtype="int64")
        result = _derive_cadence(timestamps)
        assert result == pd.Timedelta(days=1)

    def test_single_value(self) -> None:
        """A single timestamp — no diffs — returns default of 1 day."""
        timestamps = pd.Series([1_700_000_000_000])
        result = _derive_cadence(timestamps)
        assert result == pd.Timedelta(days=1)

    def test_all_same_timestamp(self) -> None:
        """All identical timestamps produce median=0 → default 1 day."""
        timestamps = pd.Series([1_700_000_000_000] * 10)
        result = _derive_cadence(timestamps)
        assert result == pd.Timedelta(days=1)

    def test_minute_cadence(self) -> None:
        """Timestamps ~5 min apart yield a ~5 min Timedelta."""
        base = 1_700_000_000_000
        timestamps = pd.Series([base + i * 300_000 for i in range(10)])  # 5 min
        result = _derive_cadence(timestamps)
        assert result == pd.Timedelta(minutes=5)


# ── _feature_correlation_filter ─────────────────────────────────────────────


class TestFeatureCorrelationFilter:
    def test_drops_highly_correlated_features(self, sample_feature_df: pd.DataFrame) -> None:
        """Features with correlation > 0.98 threshold are dropped."""
        feature_cols = ["feat_a", "feat_b", "feat_c", "feat_d"]
        result = _feature_correlation_filter(sample_feature_df, feature_cols, threshold=0.98)

        # feat_a, feat_b, feat_d are all strongly correlated (|r| ~ 1.0)
        # feat_c is independent
        # The function keeps the first in each correlated group and drops the rest
        # feat_a and feat_d are on the same line (base) — they'll be correlated
        # We should keep at least feat_c and likely one of a/b/d
        assert "feat_c" in result
        # At least one of the correlated set should be kept
        assert any(f in result for f in ["feat_a", "feat_b", "feat_d"])
        # Not all correlated features should remain
        assert len(result) < len(feature_cols)

    def test_low_threshold_drops_more(self, sample_feature_df: pd.DataFrame) -> None:
        """A lower threshold drops the most highly-correlated features."""
        feature_cols = ["feat_a", "feat_b", "feat_c"]
        # feat_a and feat_b are very strongly correlated (both derived from same base)
        result = _feature_correlation_filter(sample_feature_df, feature_cols, threshold=0.5)
        # feat_b should be dropped (correlated with feat_a), feat_c stays (independent)
        assert "feat_b" not in result
        assert "feat_a" in result
        assert "feat_c" in result
        assert len(result) == 2

    def test_threshold_zero_returns_all(self, sample_feature_df: pd.DataFrame) -> None:
        """threshold <= 0 returns feature_cols unchanged."""
        feature_cols = ["feat_a", "feat_b", "feat_c"]
        result = _feature_correlation_filter(sample_feature_df, feature_cols, threshold=0)
        assert result == feature_cols

    def test_negative_threshold_returns_all(self, sample_feature_df: pd.DataFrame) -> None:
        """Negative threshold returns feature_cols unchanged."""
        feature_cols = ["feat_a", "feat_b"]
        result = _feature_correlation_filter(sample_feature_df, feature_cols, threshold=-0.5)
        assert result == feature_cols

    def test_less_than_two_features(self, sample_feature_df: pd.DataFrame) -> None:
        """Fewer than 2 features returns them unchanged."""
        result = _feature_correlation_filter(sample_feature_df, ["feat_a"], threshold=0.98)
        assert result == ["feat_a"]

    def test_empty_feature_list(self, sample_feature_df: pd.DataFrame) -> None:
        """Empty feature list returns empty list."""
        result = _feature_correlation_filter(sample_feature_df, [], threshold=0.98)
        assert result == []

    def test_constant_features_dropped(self, sample_feature_df: pd.DataFrame) -> None:
        """Constant (zero-variance) features are silently dropped."""
        feature_cols = ["feat_a", "feat_c", "feat_const"]
        result = _feature_correlation_filter(sample_feature_df, feature_cols, threshold=0.98)
        # feat_const should be dropped, feat_a and feat_c should remain
        assert "feat_const" not in result
        assert "feat_a" in result
        assert "feat_c" in result

    def test_only_constant_features(self) -> None:
        """When all features are constant, return them all (len < 2 after dropping)."""
        df = pd.DataFrame({"a": [1.0] * 10, "b": [2.0] * 10})
        result = _feature_correlation_filter(df, ["a", "b"], threshold=0.98)
        # After dropping constants, < 2 features remain → return early
        assert result == ["a", "b"] or len(result) < 2


# ── _add_ta_features ────────────────────────────────────────────────────────


class TestAddTaFeatures:
    """Tests for _add_ta_features — all mock pandas_ta_classic."""

    def _make_mock_ta(self) -> MagicMock:
        """Create a mock pandas_ta_classic module with sensible defaults."""
        ta = MagicMock()

        # Functions that return a Series
        ta.rsi.return_value = pd.Series([0.5] * 100, name="RSI")
        ta.macd.return_value = pd.DataFrame(
            {"MACD_12_26_9": [0.1] * 100, "MACDs_12_26_9": [0.05] * 100, "MACDh_12_26_9": [0.01] * 100}
        )
        ta.bbands.return_value = pd.DataFrame(
            {"BBL_20_2": [98.0] * 100, "BBM_20_2": [100.0] * 100, "BBU_20_2": [102.0] * 100,
             "BBB_20_2": [0.5] * 100, "BBP_20_2": [0.5] * 100}
        )
        ta.ema.return_value = pd.Series([100.0] * 100, name="EMA")
        ta.roc.return_value = pd.Series([0.01] * 100, name="ROC")
        ta.willr.return_value = pd.Series([-30.0] * 100, name="WILLR")
        ta.cci.return_value = pd.Series([0.0] * 100, name="CCI")
        ta.stoch.return_value = pd.DataFrame({"STOCHk_14_3": [50.0] * 100, "STOCHd_14_3": [48.0] * 100})
        ta.atr.return_value = pd.Series([2.0] * 100, name="ATR")
        ta.obv.return_value = pd.Series([1_000_000] * 100, name="OBV")
        ta.cmf.return_value = pd.Series([0.1] * 100, name="CMF")
        ta.mfi.return_value = pd.Series([50.0] * 100, name="MFI")
        return ta

    def test_adds_ohlcv_ta_features(self, sample_ohlcv_df: pd.DataFrame) -> None:
        """When pandas_ta_classic is available, feature columns are added for OHLCV columns."""
        ta_mock = self._make_mock_ta()
        feature_cols = ["open", "high", "low", "close", "volume"]

        with patch.dict("sys.modules", {"pandas_ta_classic": ta_mock}):
            result = _add_ta_features(sample_ohlcv_df, feature_cols)

        # Should return more columns than original
        assert len(result) > len(feature_cols)
        # Original feature columns should still be present
        for col in feature_cols:
            assert col in result
        # TA indicator columns should have been added to the DataFrame
        expected_some_cols = [
            "close_rsi_14",
            "close_macd_MACD_12_26_9",
            "close_bb_BBL_20_2",
            "close_roc_12",
            "close_ema_12_26_cross",
            "close_stoch_STOCHk_14_3",
            "atr_14",
            "obv",
            "cmf_20",
            "mfi_14",
        ]
        for col in expected_some_cols:
            assert col in sample_ohlcv_df.columns, f"Expected column {col} to exist"
            assert col in result, f"Expected column {col} in returned feature list"

    def test_non_ohlcv_features_untouched(self) -> None:
        """Non-OHLCV features are passed through without TA augmentation."""
        ta_mock = self._make_mock_ta()
        # Only non-OHLCV columns
        df = pd.DataFrame({"feature_a": [1.0, 2.0, 3.0], "feature_b": [4.0, 5.0, 6.0]})
        feature_cols = ["feature_a", "feature_b"]

        with patch.dict("sys.modules", {"pandas_ta_classic": ta_mock}):
            result = _add_ta_features(df, feature_cols)

        # Should return unchanged feature list
        assert result == ["feature_a", "feature_b"]
        # No TA columns added to DataFrame
        assert len(df.columns) == 2

    def test_missing_pandas_ta_exits(self) -> None:
        """When pandas_ta_classic is not installed, sys.exit(1) is called."""
        df = pd.DataFrame({"close": [1.0, 2.0, 3.0]})
        feature_cols = ["close"]

        # Ensure pandas_ta_classic is NOT in sys.modules
        with patch.dict("sys.modules", {"pandas_ta_classic": None}):
            with pytest.raises(SystemExit) as exc_info:
                _add_ta_features(df, feature_cols)
            assert exc_info.value.code == 1

    def test_ta_indicator_failure_handled(self, sample_ohlcv_df: pd.DataFrame) -> None:
        """When an individual TA indicator fails, it is warned and skipped (not fatal)."""
        ta_mock = self._make_mock_ta()
        # Make RSI raise an exception
        ta_mock.rsi.side_effect = ValueError("RSI computation failed")

        with patch.dict("sys.modules", {"pandas_ta_classic": ta_mock}):
            result = _add_ta_features(sample_ohlcv_df, ["close"])

        # Should succeed without the RSI column but with other TA columns
        assert "close_rsi_14" not in sample_ohlcv_df.columns
        # Other TA columns should still be added
        assert "close_roc_12" in sample_ohlcv_df.columns

    def test_no_duplicate_features_in_return(self, sample_ohlcv_df: pd.DataFrame) -> None:
        """Returned feature list has no duplicates — original columns not repeated."""
        ta_mock = self._make_mock_ta()

        with patch.dict("sys.modules", {"pandas_ta_classic": ta_mock}):
            result = _add_ta_features(sample_ohlcv_df, ["close"])

        # Check for duplicates
        assert len(result) == len(set(result))
