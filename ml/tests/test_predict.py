"""Tests for ml/predict.py — batch prediction via CatBoost subprocess."""

import io
import json
import sys
import argparse
from pathlib import Path
from unittest.mock import MagicMock, PropertyMock, patch

import numpy as np
import pandas as pd
import pytest

from predict import (
    _load_norm_stats,
    _build_fill_values,
    load_model,
    parse_args,
    predict,
)


# ── _load_norm_stats ─────────────────────────────────────────────────────


class TestLoadNormStats:
    """_load_norm_stats() loads and parses normalization statistics JSON."""

    def test_valid_json_returns_dict(self, tmp_path):
        """A well-formed JSON file is parsed and returned as a dict."""
        stats = {"means": {"rsi": 0.5}, "stds": {"rsi": 0.1}, "medians": {"rsi": 0.52},
                 "featureNames": ["rsi"]}
        p = tmp_path / "norm.json"
        p.write_text(json.dumps(stats))
        result = _load_norm_stats(str(p))
        assert result == stats

    def test_none_path_returns_none(self):
        """Passing None returns None (no norm-stats configured)."""
        assert _load_norm_stats(None) is None

    def test_missing_file_returns_none(self, tmp_path):
        """A non-existent file path returns None (warning logged)."""
        result = _load_norm_stats(str(tmp_path / "nonexistent.json"))
        assert result is None

    def test_bad_json_returns_none(self, tmp_path):
        """Malformed JSON content returns None (warning logged)."""
        p = tmp_path / "bad.json"
        p.write_text("this is not json")
        result = _load_norm_stats(str(p))
        assert result is None

    def test_empty_file_returns_none(self, tmp_path):
        """Empty file returns None."""
        p = tmp_path / "empty.json"
        p.write_text("")
        result = _load_norm_stats(str(p))
        assert result is None


# ── _build_fill_values ──────────────────────────────────────────────────


class TestBuildFillValues:
    """_build_fill_values() computes per-column NaN fill values."""

    def test_no_norm_stats_returns_empty(self):
        """When norm_stats is None, return {} (caller falls back to fillna(0))."""
        assert _build_fill_values(["rsi"], None) == {}

    def test_known_features_compute_zscore(self):
        """Known features get (median - mean) / std."""
        stats = {
            "means": {"rsi": 0.5},
            "stds": {"rsi": 0.2},
            "medians": {"rsi": 0.52},
            "featureNames": ["rsi"],
        }
        fills = _build_fill_values(["rsi"], stats)
        expected = (0.52 - 0.5) / 0.2
        assert fills["rsi"] == pytest.approx(expected)

    def test_unknown_features_get_zero(self):
        """Features not seen during training get fill value 0.0."""
        stats = {
            "means": {"rsi": 0.5},
            "stds": {"rsi": 0.2},
            "medians": {"rsi": 0.52},
            "featureNames": ["rsi"],  # only rsi is known
        }
        fills = _build_fill_values(["rsi", "unknown_feat"], stats)
        assert fills["rsi"] != 0.0
        assert fills["unknown_feat"] == 0.0

    def test_zero_std_returns_zero(self):
        """When std is 0, fill value is 0.0 to avoid division by zero."""
        stats = {
            "means": {"rsi": 0.5},
            "stds": {"rsi": 0.0},
            "medians": {"rsi": 0.52},
            "featureNames": ["rsi"],
        }
        fills = _build_fill_values(["rsi"], stats)
        assert fills["rsi"] == 0.0


# ── load_model ──────────────────────────────────────────────────────────


class TestLoadModel:
    """load_model() loads a CatBoost model from disk."""

    def test_file_not_found_raises(self):
        """Non-existent path raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            load_model("/nonexistent/path/model.cbm")

    @patch("catboost.CatBoostClassifier")
    def test_load_catboost_cbm(self, MockCatBoost, tmp_path):
        """Successfully load a .cbm CatBoost model."""
        model_path = tmp_path / "model.cbm"
        model_path.write_text("fake model data")

        instance = MockCatBoost.return_value
        instance.classes_ = np.array([-1, 0, 1])

        result = load_model(str(model_path), model_type="catboost")
        assert result is instance
        instance.load_model.assert_called_once_with(str(model_path))

    @patch("catboost.CatBoostClassifier")
    def test_load_catboost_auto_from_cbm(self, MockCatBoost, tmp_path):
        """auto model_type infers catboost from .cbm extension."""
        model_path = tmp_path / "model.cbm"
        model_path.write_text("fake")

        instance = MockCatBoost.return_value
        instance.classes_ = np.array([-1, 0, 1])

        result = load_model(str(model_path), model_type="auto")
        assert result is instance
        instance.load_model.assert_called_once_with(str(model_path))


# ── parse_args ──────────────────────────────────────────────────────────


class TestParseArgs:
    """CLI argument parsing for predict.py."""

    def test_model_required(self):
        """--model is required; omitting it should fail."""
        with pytest.raises(SystemExit):
            parse_args([])

    def test_model_and_norm_stats(self):
        """--model and --norm-stats are parsed correctly."""
        args = parse_args(["--model", "model.cbm", "--norm-stats", "stats.json"])
        assert args.model == "model.cbm"
        assert args.norm_stats == "stats.json"
        assert args.verbose is False

    def test_norm_stats_optional(self):
        """--norm-stats is optional."""
        args = parse_args(["--model", "model.cbm"])
        assert args.norm_stats is None

    def test_threshold_default(self):
        """--threshold defaults to 0.0."""
        args = parse_args(["--model", "model.cbm"])
        assert args.threshold == 0.0

    def test_verbose_flag(self):
        """--verbose sets verbose=True."""
        args = parse_args(["--model", "model.cbm", "--verbose"])
        assert args.verbose is True

    def test_explain_flag(self):
        """--explain sets explain=True."""
        args = parse_args(["--model", "model.cbm", "--explain"])
        assert args.explain is True

    def test_model_type_defaults_to_auto(self):
        """--model-type defaults to 'auto'."""
        args = parse_args(["--model", "model.cbm"])
        assert args.model_type == "auto"

    def test_model_type_choices(self):
        """--model-type accepts 'auto' and 'catboost'."""
        for mt in ("auto", "catboost"):
            args = parse_args(["--model", "x.cbm", "--model-type", mt])
            assert args.model_type == mt


# ── predict (main function) ─────────────────────────────────────────────


class TestPredict:
    """predict() end-to-end with mocked model and stdin."""

    JSONL_DATA = (
        b'{"rsi": 0.5, "macd_hist": 0.1}\n'
        b'{"rsi": 0.6, "macd_hist": 0.2}\n'
    )

    def _make_mock_model(self, classes=None):
        """Create a mock CatBoost model with predictable outputs."""
        model = MagicMock()
        model.classes_ = np.array(classes or [-1, 0, 1])
        # Two rows → two predictions
        model.predict.return_value = np.array([0, 1])
        model.predict_proba.return_value = np.array([
            [0.1, 0.7, 0.2],
            [0.2, 0.1, 0.7],
        ])
        return model

    def _make_args(self, **overrides):
        """Build a minimal argparse.Namespace for predict()."""
        kwargs = dict(
            model="mock_model.cbm",
            model_type="catboost",
            norm_stats=None,
            threshold=0.0,
            explain=False,
            verbose=False,
        )
        kwargs.update(overrides)
        return argparse.Namespace(**kwargs)

    def test_empty_stdin_prints_empty_array(self, mocker, capsys):
        """Empty input (no data) prints '[]'."""
        mocker.patch("predict.load_model", return_value=self._make_mock_model())
        mocker.patch("predict._load_norm_stats", return_value=None)
        mocker.patch.object(sys.stdin.buffer, "read", return_value=b"")

        args = self._make_args()
        predict(args)
        captured = capsys.readouterr()
        assert captured.out.strip() == "[]"

    def test_batch_prediction_returns_json_array(self, mocker, capsys):
        """Predicting multiple rows returns a JSON array of results."""
        mock_model = self._make_mock_model()
        mocker.patch("predict.load_model", return_value=mock_model)
        mocker.patch("predict._load_norm_stats", return_value=None)
        mocker.patch.object(sys.stdin.buffer, "read", return_value=self.JSONL_DATA)

        args = self._make_args()
        predict(args)
        captured = capsys.readouterr()

        results = json.loads(captured.out)
        assert isinstance(results, list)
        assert len(results) == 2

    def test_prediction_structure(self, mocker, capsys):
        """Each prediction has direction, confidence, and probs fields."""
        mock_model = self._make_mock_model()
        mocker.patch("predict.load_model", return_value=mock_model)
        mocker.patch("predict._load_norm_stats", return_value=None)
        mocker.patch.object(sys.stdin.buffer, "read", return_value=self.JSONL_DATA)

        args = self._make_args()
        predict(args)
        captured = capsys.readouterr()
        results = json.loads(captured.out)

        for r in results:
            assert "direction" in r
            assert "confidence" in r
            assert "probs" in r
            assert isinstance(r["probs"], list)
            assert len(r["probs"]) == 3  # -1, 0, 1

    def test_confidence_values(self, mocker, capsys):
        """Confidence matches the predicted class probability."""
        mock_model = self._make_mock_model()
        mocker.patch("predict.load_model", return_value=mock_model)
        mocker.patch("predict._load_norm_stats", return_value=None)
        mocker.patch.object(sys.stdin.buffer, "read", return_value=self.JSONL_DATA)

        args = self._make_args()
        predict(args)
        captured = capsys.readouterr()
        results = json.loads(captured.out)

        # Row 0: predict returns 0, probability for class 0 is 0.7
        assert results[0]["direction"] == 0
        assert results[0]["confidence"] == pytest.approx(0.7)
        # Row 1: predict returns 1, probability for class 1 is 0.7
        assert results[1]["direction"] == 1
        assert results[1]["confidence"] == pytest.approx(0.7)

    def test_model_file_not_found_exits(self, mocker, capsys):
        """When the model file doesn't exist, predict() exits with code 1."""
        # Don't mock load_model — let it raise FileNotFoundError naturally
        args = self._make_args(model="/definitely/not/a/file.cbm")
        with pytest.raises(SystemExit) as exc:
            predict(args)
        assert exc.value.code == 1
        captured = capsys.readouterr()
        err = json.loads(captured.out)
        assert "error" in err

    def test_model_has_no_classes_exits(self, mocker, capsys):
        """If model.classes_ is None, predict() exits with code 1."""
        mock_model = MagicMock()
        mock_model.classes_ = None
        mocker.patch("predict.load_model", return_value=mock_model)
        mocker.patch("predict._load_norm_stats", return_value=None)
        mocker.patch.object(sys.stdin.buffer, "read", return_value=self.JSONL_DATA)

        args = self._make_args()
        with pytest.raises(SystemExit) as exc:
            predict(args)
        assert exc.value.code == 1
        captured = capsys.readouterr()
        err = json.loads(captured.out)
        assert "error" in err
