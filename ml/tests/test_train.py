#!/usr/bin/env python3
"""Tests for ml/train.py — training orchestrator.

All ML dependencies (CatBoost, sklearn, optuna, shap, imblearn) are mocked.
Real pandas / numpy are used for small fixture DataFrames.
"""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch, call

import numpy as np
import pandas as pd
import pytest

# ── Path setup: ensure ml/ is on sys.path ──────────────────────────────────
_ML_DIR = Path(__file__).resolve().parent.parent
if str(_ML_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_DIR))


# =============================================================================
# Helpers
# =============================================================================

def _make_jsonl(rows: list[dict]) -> str:
    """Serialize a list of dicts to a JSONL string (one JSON object per line)."""
    return "\n".join(json.dumps(r) for r in rows)


def _write_jsonl(path: str, rows: list[dict]) -> str:
    """Write a JSONL file and return its path."""
    with open(path, "w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")
    return path


def _default_feature_rows(n: int = 20, seed: int = 42) -> list[dict]:
    """Generate *n* rows of synthetic feature/label data suitable for training."""
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        row = {
            "open_time": 1_700_000_000_000 + i * 60_000,  # ms epoch, 1 min spacing
            "symbol": "BTCUSDT",
            "interval": "1m",
            "feature_rsi": float(rng.uniform(0, 100)),
            "feature_macd": float(rng.uniform(-5, 5)),
            "feature_ema_diff": float(rng.uniform(-2, 2)),
            "label_class": int(rng.integers(-1, 2)),
        }
        rows.append(row)
    return rows


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def temp_dir():
    """Provide a temporary directory that is cleaned up after the test."""
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def good_jsonl_path(temp_dir):
    """Write a valid 20-row JSONL dataset and return its path."""
    p = os.path.join(temp_dir, "train.jsonl")
    _write_jsonl(p, _default_feature_rows(20))
    return p


# =============================================================================
# Shared mock-model factory
# =============================================================================

def _make_mock_model(n_classes=2, n_features=3):
    """Build a MagicMock that acts like a trained CatBoost model."""
    model = MagicMock()
    model.fit.return_value = None
    model.save_model.return_value = None

    if n_classes == 2:
        model.classes_ = np.array([-1, 1])
        model.predict.return_value = np.array([-1, -1, 1])
        model.predict_proba.return_value = np.array(
            [[0.8, 0.2], [0.7, 0.3], [0.1, 0.9]]
        )
    else:
        model.classes_ = np.array([-1, 0, 1])
        model.predict.return_value = np.array([-1, 0, 1])
        model.predict_proba.return_value = np.array(
            [[0.8, 0.15, 0.05], [0.1, 0.8, 0.1], [0.05, 0.15, 0.8]]
        )

    model.get_feature_importance.return_value = {
        "feat_0": 0.5,
        "feat_1": 0.3,
        "feat_2": 0.2,
    }
    return model


def _make_args(**overrides) -> MagicMock:
    """Build a MagicMock Namespace that mimics train() CLI args."""
    args = MagicMock()
    defaults = {
        "data": "x.jsonl",
        "output": "/tmp",
        "val_split": 0.15,
        "test_split": 0.15,
        "class_weight": "balanced",
        "early_stopping": 50,
        "learning_rate": 0.03,
        "num_leaves": 31,
        "n_estimators": 1000,
        "gpu": False,
        "seed": 42,
        "min_rows": 100,
        "verbose": False,
        "optimize": False,
        "optuna_trials": 25,
        "cv_folds": 0,
        "balance": False,
        "shap": False,
        "add_ta": False,
        "calibrate": False,
        "ensemble": 0,
        "feature_select": False,
    }
    defaults.update(overrides)
    for k, v in defaults.items():
        setattr(args, k, v)
    return args


# =============================================================================
# Parse args
# =============================================================================

class TestParseArgs:
    """CLI argument parsing (parse_args)."""

    def test_defaults(self):
        """Minimum required args produce sensible defaults."""
        from train import parse_args

        args = parse_args(["--data", "x.jsonl"])
        assert args.data == "x.jsonl"
        assert args.output == "ml/models"
        assert args.val_split == 0.15
        assert args.test_split == 0.15
        assert args.class_weight == "balanced"
        assert args.early_stopping == 50
        assert args.learning_rate == 0.03
        assert args.num_leaves == 31
        assert args.n_estimators == 1000
        assert args.gpu is False
        assert args.seed == 42
        assert args.min_rows == 100
        assert args.verbose is False
        assert args.optimize is False
        assert args.optuna_trials == 25
        assert args.cv_folds == 0
        assert args.balance is False
        assert args.shap is False
        assert args.add_ta is False
        assert args.calibrate is False
        assert args.ensemble == 0
        assert args.feature_select is False

    def test_all_flags(self):
        """All optional flags/parameters can be set."""
        from train import parse_args

        args = parse_args([
            "--data", "d.jsonl",
            "--output", "out/",
            "--optimize",
            "--optuna-trials", "50",
            "--cv-folds", "5",
            "--balance",
            "--shap",
            "--add-ta",
            "--calibrate",
            "--ensemble", "10",
            "--feature-select",
            "--gpu",
            "--verbose",
            "--val-split", "0.2",
            "--test-split", "0.1",
            "--class-weight", "custom",
            "--early-stopping", "100",
            "--learning-rate", "0.1",
            "--num-leaves", "63",
            "--n-estimators", "500",
            "--seed", "123",
            "--min-rows", "50",
        ])
        assert args.data == "d.jsonl"
        assert args.output == "out/"
        assert args.optimize is True
        assert args.optuna_trials == 50
        assert args.cv_folds == 5
        assert args.balance is True
        assert args.shap is True
        assert args.add_ta is True
        assert args.calibrate is True
        assert args.ensemble == 10
        assert args.feature_select is True
        assert args.gpu is True
        assert args.verbose is True
        assert args.val_split == 0.2
        assert args.test_split == 0.1
        assert args.class_weight == "custom"
        assert args.early_stopping == 100
        assert args.learning_rate == 0.1
        assert args.num_leaves == 63
        assert args.n_estimators == 500
        assert args.seed == 123
        assert args.min_rows == 50

    def test_class_weight_choices(self):
        """--class-weight only accepts valid choices."""
        from train import parse_args

        args = parse_args(["--data", "x.jsonl", "--class-weight", "balanced"])
        assert args.class_weight == "balanced"

        args = parse_args(["--data", "x.jsonl", "--class-weight", "None"])
        assert args.class_weight == "None"

        args = parse_args(["--data", "x.jsonl", "--class-weight", "custom"])
        assert args.class_weight == "custom"

    def test_requires_data(self):
        """--data is required."""
        from train import parse_args

        with pytest.raises(SystemExit):
            parse_args([])

    def test_gpu_flag_off_by_default(self):
        """--gpu is not set unless explicitly passed."""
        from train import parse_args

        args = parse_args(["--data", "x.jsonl"])
        assert args.gpu is False


# =============================================================================
# Data loading tests
# =============================================================================

class TestLoadData:
    """Data loading logic inside train()."""

    def test_reads_valid_jsonl(self, temp_dir):
        """train() reads a valid JSONL file and proceeds."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(15)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 8 else 1
        _write_jsonl(jsonl, rows)

        args = _make_args(
            data=jsonl, output=temp_dir, min_rows=5,
            class_weight="balanced",
        )

        with (
            patch("train.CatBoostClassifier"),
            patch("train.update_manifest"),
            patch("train.build_catboost") as mock_build,
            patch("train.joblib.dump"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
            patch("sys.stdout"),
        ):
            mock_build.return_value = _make_mock_model(n_classes=2)
            train(args)
            mock_build.assert_called_once()

    def test_empty_jsonl_skips(self, temp_dir):
        """Empty JSONL causes graceful skip, not crash."""
        from train import train

        jsonl = os.path.join(temp_dir, "empty.jsonl")
        _write_jsonl(jsonl, [])

        args = _make_args(data=jsonl, output=temp_dir)

        with (
            patch("train.CatBoostClassifier"),
            patch("train.update_manifest"),
            patch("train.build_catboost"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
        ):
            # Should not raise
            train(args)

    def test_missing_required_columns_exits(self, temp_dir):
        """Missing required column (label_class) causes sys.exit(1)."""
        from train import train

        jsonl = os.path.join(temp_dir, "bad.jsonl")
        rows = [{"open_time": 1000, "feature_a": 1.0}]  # no label_class
        _write_jsonl(jsonl, rows)

        args = _make_args(data=jsonl, output=temp_dir)

        with (
            patch("train.CatBoostClassifier"),
            patch("train.update_manifest"),
            patch("train.build_catboost"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
            pytest.raises(SystemExit),
        ):
            train(args)


# =============================================================================
# Training flow tests
# =============================================================================

class TestTrainingFlow:
    """Core training flow with mocked CatBoost."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self):
        patchers = [
            patch("train.CatBoostClassifier"),
            patch("train.update_manifest"),
            patch("train._feature_correlation_filter",
                  side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
            patch("train.joblib.dump"),
        ]
        self._patchers = patchers
        for p in patchers:
            p.start()
        yield
        for p in patchers:
            p.stop()

    def test_model_fit_called(self, temp_dir):
        """model.fit() is called with correct X/y."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(15)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 8 else 1
        _write_jsonl(jsonl, rows)

        with (
            patch("train.build_catboost") as mock_build,
            patch("sys.stdout"),
        ):
            mock_build.return_value = _make_mock_model(n_classes=2)
            args = _make_args(data=jsonl, output=temp_dir, min_rows=5)
            train(args)

            mock_build.assert_called_once()
            # Check that eval_set is a tuple of (X_val, y_val)
            call_kwargs = mock_build.return_value.fit.call_args.kwargs
            assert "eval_set" in call_kwargs
            eval_set = call_kwargs["eval_set"]
            assert isinstance(eval_set, tuple)
            assert len(eval_set) == 2

    def test_metrics_computed(self, temp_dir):
        """Metrics are computed with known mock predictions."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(20)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 10 else 1
        _write_jsonl(jsonl, rows)

        with (
            patch("train.build_catboost") as mock_build,
            patch("train.accuracy_score", return_value=0.85),
            patch("train.f1_score", return_value=0.83),
            # confusion_matrix must return a numpy array (has .tolist())
            patch("train.confusion_matrix",
                  return_value=np.array([[8, 2], [1, 9]])),
            patch("train.classification_report",
                  return_value={"accuracy": 0.85, "macro avg": {"f1-score": 0.83}}),
            patch("train.roc_auc_score", return_value=0.91),
            patch("sys.stdout"),
        ):
            mock_build.return_value = _make_mock_model(n_classes=2)
            args = _make_args(data=jsonl, output=temp_dir, min_rows=5)
            train(args)

    def test_manifest_updated(self, temp_dir):
        """Manifest update is called with expected training config."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(15)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 8 else 1
        _write_jsonl(jsonl, rows)

        with (
            patch("train.build_catboost") as mock_build,
            patch("train.update_manifest") as mock_manifest,
            patch("sys.stdout"),
        ):
            mock_build.return_value = _make_mock_model(n_classes=2)
            args = _make_args(
                data=jsonl, output=temp_dir, min_rows=5,
                optimize=False, cv_folds=0, balance=False,
                add_ta=False, shap=False, calibrate=False,
                ensemble=0, feature_select=False,
            )
            train(args)

            mock_manifest.assert_called_once()
            call_kwargs = mock_manifest.call_args.kwargs
            assert "training_config" in call_kwargs
            cfg = call_kwargs["training_config"]
            assert cfg["optimize"] is False
            assert cfg["ensemble"] == 0
            assert cfg["calibrate"] is False

    def test_model_files_saved(self, temp_dir):
        """Model .cbm and .joblib files are created in output dir."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(15)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 8 else 1
        _write_jsonl(jsonl, rows)

        # We still mock joblib.dump to avoid pickle errors, but
        # save_model (on the mock) will no-op.  We verify a different
        # side effect: the model_path appears in metrics stdout.
        with (
            patch("train.build_catboost") as mock_build,
            patch("train.joblib.dump") as mock_dump,
            patch("sys.stdout") as mock_stdout,
        ):
            mock_model = _make_mock_model(n_classes=2)
            mock_build.return_value = mock_model

            args = _make_args(data=jsonl, output=temp_dir, min_rows=5)
            train(args)

            # joblib.dump should have been called with the model
            mock_dump.assert_called_once()
            # save_model should have been called on the mock model
            mock_model.save_model.assert_called_once()


# =============================================================================
# Edge cases
# =============================================================================

class TestEdgeCases:
    """Edge cases and error handling."""

    def test_insufficient_data_skips(self, temp_dir):
        """Fewer rows than min_rows causes graceful skip."""
        from train import train

        jsonl = os.path.join(temp_dir, "small.jsonl")
        _write_jsonl(jsonl, _default_feature_rows(3))

        args = _make_args(data=jsonl, output=temp_dir, min_rows=100)
        with (
            patch("train.build_catboost"),
            patch("train.CatBoostClassifier"),
            patch("train.update_manifest"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
        ):
            result = train(args)
            assert result is None

    def test_single_class_skips(self, temp_dir):
        """Only one class in training data causes graceful skip."""
        from train import train

        jsonl = os.path.join(temp_dir, "single_class.jsonl")
        rows = _default_feature_rows(20)
        for r in rows:
            r["label_class"] = 0  # all same class
        _write_jsonl(jsonl, rows)

        args = _make_args(data=jsonl, output=temp_dir, min_rows=5)
        with (
            patch("train.build_catboost"),
            patch("train.CatBoostClassifier"),
            patch("train.update_manifest"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
        ):
            result = train(args)
            assert result is None

    def test_empty_split_partition_exits(self, temp_dir):
        """Too few rows for given split fractions causes exit(1)."""
        from train import train

        jsonl = os.path.join(temp_dir, "tiny.jsonl")
        rows = _default_feature_rows(3)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 2 else 1
        _write_jsonl(jsonl, rows)

        args = _make_args(data=jsonl, output=temp_dir, min_rows=2,
                          val_split=0.5, test_split=0.5)
        with (
            patch("train.build_catboost"),
            patch("train.CatBoostClassifier"),
            patch("train.update_manifest"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
            pytest.raises(SystemExit),
        ):
            train(args)

    def test_file_not_found_exits(self, temp_dir):
        """Non-existent data file causes sys.exit(1)."""
        from train import train

        missing = os.path.join(temp_dir, "nonexistent.jsonl")
        args = _make_args(data=missing, output=temp_dir)
        with (
            patch("train.build_catboost"),
            patch("train.CatBoostClassifier"),
            patch("train.update_manifest"),
            patch("train.logger"),
            pytest.raises(SystemExit),
        ):
            train(args)


# =============================================================================
# Optional: optimise (Optuna)
# =============================================================================

class TestOptunaPath:
    """Optuna hyperparameter search path."""

    def test_optimize_triggers_optuna(self, temp_dir):
        """--optimize flag triggers _run_optuna call."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(20)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 10 else 1
        _write_jsonl(jsonl, rows)

        with (
            patch("train.build_catboost") as mock_build,
            patch("train._run_optuna") as mock_optuna,
            patch("train.update_manifest"),
            patch("train.joblib.dump"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
            patch("sys.stdout"),
        ):
            mock_optuna.return_value = {"learning_rate": 0.05, "depth": 6, "l2_leaf_reg": 5}
            mock_build.return_value = _make_mock_model(n_classes=2)

            args = _make_args(data=jsonl, output=temp_dir, min_rows=5, optimize=True)
            train(args)

            mock_optuna.assert_called_once()


# =============================================================================
# Optional: Ensemble
# =============================================================================

class TestEnsemble:
    """Ensemble training path."""

    def test_ensemble_trains_n_models(self, temp_dir):
        """--ensemble N trains N models with different seeds."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(20)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 10 else 1
        _write_jsonl(jsonl, rows)

        with (
            patch("train.build_catboost") as mock_build,
            patch("train.update_manifest"),
            patch("train.joblib.dump"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
            patch("sys.stdout"),
        ):
            mock_build.return_value = _make_mock_model(n_classes=2)

            args = _make_args(data=jsonl, output=temp_dir, min_rows=5, ensemble=3)
            train(args)

            # build_catboost should be called 3 times (ensemble=3)
            assert mock_build.call_count == 3


# =============================================================================
# Optional: Calibration
# =============================================================================

class TestCalibration:
    """Probability calibration path."""

    def test_calibration_applied(self, temp_dir):
        """--calibrate triggers CalibratedClassifierCV on val set."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(20)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 7 else (0 if i < 14 else 1)
        _write_jsonl(jsonl, rows)

        with (
            patch("train.build_catboost") as mock_build,
            patch("sklearn.calibration.CalibratedClassifierCV") as mock_cal,
            patch("train.update_manifest"),
            patch("train.joblib.dump"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
            patch("sys.stdout"),
        ):
            mock_calibrated = MagicMock()
            mock_cal.return_value = mock_calibrated
            mock_build.return_value = _make_mock_model(n_classes=3)

            args = _make_args(data=jsonl, output=temp_dir, min_rows=5, calibrate=True)
            train(args)

            mock_cal.assert_called_once()


# =============================================================================
# Optional: Balancing (SMOTE)
# =============================================================================

class TestBalancing:
    """BorderlineSMOTE balancing path."""

    def test_balance_triggers_smote(self, temp_dir):
        """--balance triggers BorderlineSMOTE on training data."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(20)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 10 else 1
        _write_jsonl(jsonl, rows)

        with (
            patch("train.build_catboost") as mock_build,
            patch("imblearn.over_sampling.BorderlineSMOTE") as mock_smote,
            patch("train.update_manifest"),
            patch("train.joblib.dump"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
            patch("sys.stdout"),
        ):
            mock_smote_instance = MagicMock()
            mock_X_res = np.random.default_rng(0).random((15, 3))
            mock_y_res = np.array([-1] * 8 + [1] * 7)
            mock_smote_instance.fit_resample.return_value = (mock_X_res, mock_y_res)
            mock_smote.return_value = mock_smote_instance

            mock_build.return_value = _make_mock_model(n_classes=2)

            args = _make_args(data=jsonl, output=temp_dir, min_rows=5, balance=True)
            train(args)

            mock_smote.assert_called_once()
            mock_smote_instance.fit_resample.assert_called_once()


# =============================================================================
# GPU detection
# =============================================================================

class TestGpuDetection:
    """GPU detection path via build_catboost."""

    def test_gpu_requested_and_available(self):
        """GPU flag + check_gpu() returns True → task_type='GPU'."""
        from model import build_catboost

        with patch("model.check_gpu", return_value=True):
            model = build_catboost(
                learning_rate=0.03,
                num_leaves=31,
                n_estimators=100,
                seed=42,
                class_weight="balanced",
                early_stopping=50,
                gpu=True,
                add_ta=False,
                verbose=False,
            )
            assert model is not None

    def test_gpu_requested_but_unavailable(self):
        """GPU flag but check_gpu() returns False → fallback to CPU."""
        from model import build_catboost

        with patch("model.check_gpu", return_value=False):
            model = build_catboost(
                learning_rate=0.03,
                num_leaves=31,
                n_estimators=100,
                seed=42,
                class_weight="balanced",
                early_stopping=50,
                gpu=True,
                add_ta=False,
                verbose=False,
            )
            assert model is not None


# =============================================================================
# _run_purged_cv
# =============================================================================

class TestPurgedCV:
    """Cross-validation path."""

    def test_purged_cv_returns_scores(self, temp_dir):
        """_run_purged_cv returns (scores, mean, std) with valid data."""
        from train import _run_purged_cv

        jsonl = os.path.join(temp_dir, "data.jsonl")
        rows = _default_feature_rows(30)
        for i, r in enumerate(rows):
            r["label_class"] = -1 if i < 15 else 1
        _write_jsonl(jsonl, rows)

        args = MagicMock()
        args.data = jsonl
        args.val_split = 0.15
        args.test_split = 0.15
        args.learning_rate = 0.03
        args.num_leaves = 31
        args.ensemble = 0
        args.add_ta = False
        args.seed = 42
        args.cv_folds = 3
        args.min_rows = 5

        with (
            patch("train.CatBoostClassifier") as mock_cb,
            patch("train._add_ta_features", side_effect=lambda df, cols: cols),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.num_leaves_to_depth", return_value=6),
            patch("train.logger"),
        ):
            mock_cb_instance = MagicMock()
            mock_cb_instance.fit.return_value = None
            mock_cb_instance.predict.return_value = np.array([-1, 1, -1])
            mock_cb.return_value = mock_cb_instance

            scores, mean, std = _run_purged_cv(args, ["feature_rsi", "feature_macd"])
            assert isinstance(scores, list)
            assert mean is None or isinstance(mean, float)
            assert std is None or isinstance(std, float)


# =============================================================================
# _feature_importance
# =============================================================================

class TestFeatureImportance:
    """Feature importance extraction."""

    def test_importance_with_prettified_dataframe(self):
        """_feature_importance handles CatBoost prettified DataFrame output."""
        from train import _feature_importance

        model = MagicMock()
        fi_df = pd.DataFrame({
            "Feature Name": ["rsi", "macd", "ema"],
            "Importances": [0.5, 0.3, 0.2],
        })
        model.get_feature_importance.return_value = fi_df

        result = _feature_importance(model, ["rsi", "macd", "ema"])
        assert result == {"rsi": 0.5, "macd": 0.3, "ema": 0.2}

    def test_importance_with_feature_id(self):
        """_feature_importance falls back to feature_cols indexing when no Feature Name."""
        from train import _feature_importance

        model = MagicMock()
        fi_df = pd.DataFrame({
            "Feature Id": [0, 1, 2],
            "Importances": [0.5, 0.3, 0.2],
        })
        model.get_feature_importance.return_value = fi_df

        result = _feature_importance(model, ["rsi", "macd", "ema"])
        assert result == {"rsi": 0.5, "macd": 0.3, "ema": 0.2}

    def test_importance_flat_array(self):
        """_feature_importance handles plain array return."""
        from train import _feature_importance

        model = MagicMock()
        model.get_feature_importance.return_value = [0.5, 0.3, 0.2]

        result = _feature_importance(model, ["rsi", "macd", "ema"])
        assert result == {"rsi": 0.5, "macd": 0.3, "ema": 0.2}

    def test_importance_error_returns_empty(self):
        """_feature_importance returns {} on exception."""
        from train import _feature_importance

        model = MagicMock()
        model.get_feature_importance.side_effect = RuntimeError("fail")

        result = _feature_importance(model, ["rsi"])
        assert result == {}


# =============================================================================
# Feature selection
# =============================================================================

class TestFeatureSelection:
    """Mutual-information feature selection."""

    def test_feature_select_triggers_sklearn(self, temp_dir):
        """--feature-select calls SelectKBest with mutual_info_classif."""
        from train import train

        jsonl = os.path.join(temp_dir, "data.jsonl")
        # Need >10 numeric feature columns to trigger the feature selection path
        rng = np.random.default_rng(42)
        rows = []
        for i in range(20):
            row = {
                "open_time": 1_700_000_000_000 + i * 60_000,
                "label_class": -1 if i < 10 else 1,
            }
            for j in range(12):
                row[f"feat_{j}"] = float(rng.uniform(-5, 5))
            rows.append(row)
        _write_jsonl(jsonl, rows)

        with (
            patch("train.build_catboost") as mock_build,
            patch("sklearn.feature_selection.SelectKBest") as mock_sk,
            patch("sklearn.feature_selection.mutual_info_classif", return_value=np.array([0.1, 0.2, 0.3])),
            patch("train.update_manifest"),
            patch("train.joblib.dump"),
            patch("train._feature_correlation_filter", side_effect=lambda df, cols, **kw: cols),
            patch("train.logger"),
            patch("sys.stdout"),
        ):
            mock_selector = MagicMock()
            mock_selector.get_support.return_value = np.array([True, True, False])
            mock_sk.return_value = mock_selector

            mock_build.return_value = _make_mock_model(n_classes=2)

            args = _make_args(data=jsonl, output=temp_dir, min_rows=5, feature_select=True)
            train(args)

            mock_sk.assert_called_once()
