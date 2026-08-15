"""Tests for ml/model.py — CatBoost Model Factory."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import MagicMock, PropertyMock, patch

import pytest

if TYPE_CHECKING:
    from collections.abc import Generator

from model import build_catboost, check_gpu, num_leaves_to_depth, resolve_class_weight


# ── check_gpu ───────────────────────────────────────────────────────────────


def test_check_gpu_success() -> None:
    """check_gpu returns True when CatBoostClassifier fits without error."""
    # Mock CatBoostClassifier so that .fit() succeeds
    mock_model = MagicMock()
    mock_model.fit.return_value = None

    with patch("model.CatBoostClassifier", return_value=mock_model):
        result = check_gpu()

    assert result is True
    # Verify fit was called
    mock_model.fit.assert_called_once()


def test_check_gpu_failure() -> None:
    """check_gpu returns False when CatBoostClassifier raises during construction."""
    with patch("model.CatBoostClassifier", side_effect=RuntimeError("No GPU")):
        result = check_gpu()

    assert result is False


def test_check_gpu_failure_during_fit() -> None:
    """check_gpu returns False when .fit() raises."""
    mock_model = MagicMock()
    mock_model.fit.side_effect = RuntimeError("GPU OOM")

    with patch("model.CatBoostClassifier", return_value=mock_model):
        result = check_gpu()

    assert result is False


# ── resolve_class_weight ────────────────────────────────────────────────────


class TestResolveClassWeight:
    @pytest.mark.parametrize(
        ("cli_value", "expected"),
        [
            ("balanced", "Balanced"),
            ("None", None),
            ("custom", None),
            ("unknown", None),
        ],
    )
    def test_resolve_class_weight(self, cli_value: str, expected: str | None) -> None:
        assert resolve_class_weight(cli_value) is expected


# ── num_leaves_to_depth ─────────────────────────────────────────────────────


class TestNumLeavesToDepth:
    @pytest.mark.parametrize(
        ("num_leaves", "expected_depth"),
        [
            (1, 6),
            (2, 2),
            (3, 2),  # round(log2 3) = round(1.58) = 2
            (4, 2),
            (5, 2),  # round(log2 5) = round(2.32) = 2
            (8, 3),
            (15, 4),  # round(log2 15) = round(3.91) = 4
            (16, 4),
            (31, 5),  # round(log2 31) = round(4.95) = 5
            (32, 5),
            (64, 6),
        ],
    )
    def test_num_leaves_to_depth(self, num_leaves: int, expected_depth: int) -> None:
        assert num_leaves_to_depth(num_leaves) == expected_depth


# ── build_catboost ──────────────────────────────────────────────────────────


class TestBuildCatboost:
    """Tests for build_catboost — all mock catboost to avoid real GPU checks."""

    def test_basic_params(self) -> None:
        """Default params are passed to CatBoostClassifier."""
        with patch("model.check_gpu", return_value=False):
            with patch("model.CatBoostClassifier") as mock_cls:
                model = build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="balanced",
                    early_stopping=50,
                    gpu=False,
                    add_ta=False,
                    verbose=False,
                )

        mock_cls.assert_called_once()
        _, kwargs = mock_cls.call_args

        assert kwargs["iterations"] == 500
        assert kwargs["learning_rate"] == 0.1
        assert kwargs["depth"] == 5  # log2(32) = 5
        assert kwargs["l2_leaf_reg"] == 3
        assert kwargs["auto_class_weights"] == "Balanced"
        assert kwargs["random_seed"] == 42
        assert kwargs["early_stopping_rounds"] == 50
        assert kwargs["task_type"] == "CPU"
        assert kwargs["rsm"] is None
        assert kwargs["verbose"] is False
        assert kwargs["model_size_reg"] == 0.5

    def test_gpu_enabled(self) -> None:
        """When gpu=True and check_gpu() returns True, task_type=GPU."""
        with patch("model.check_gpu", return_value=True):
            with patch("model.CatBoostClassifier") as mock_cls:
                build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="balanced",
                    early_stopping=50,
                    gpu=True,
                    add_ta=False,
                    verbose=False,
                )

        _, kwargs = mock_cls.call_args
        assert kwargs["task_type"] == "GPU"

    def test_gpu_unavailable_fallback(self) -> None:
        """When gpu=True but check_gpu() returns False, task_type falls back to CPU."""
        with patch("model.check_gpu", return_value=False):
            with patch("model.CatBoostClassifier") as mock_cls:
                build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="balanced",
                    early_stopping=50,
                    gpu=True,
                    add_ta=False,
                    verbose=False,
                )

        _, kwargs = mock_cls.call_args
        assert kwargs["task_type"] == "CPU"

    def test_add_ta_sets_rsm(self) -> None:
        """When add_ta=True, rsm should be 0.8 for feature subsampling."""
        with patch("model.check_gpu", return_value=False):
            with patch("model.CatBoostClassifier") as mock_cls:
                build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="balanced",
                    early_stopping=50,
                    gpu=False,
                    add_ta=True,
                    verbose=False,
                )

        _, kwargs = mock_cls.call_args
        assert kwargs["rsm"] == 0.8

    def test_early_stopping_disabled(self) -> None:
        """When early_stopping=0, early_stopping_rounds should be None."""
        with patch("model.check_gpu", return_value=False):
            with patch("model.CatBoostClassifier") as mock_cls:
                build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="balanced",
                    early_stopping=0,
                    gpu=False,
                    add_ta=False,
                    verbose=False,
                )

        _, kwargs = mock_cls.call_args
        assert kwargs["early_stopping_rounds"] is None

    def test_no_class_weight(self) -> None:
        """When class_weight='None', auto_class_weights should be None."""
        with patch("model.check_gpu", return_value=False):
            with patch("model.CatBoostClassifier") as mock_cls:
                build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="None",
                    early_stopping=50,
                    gpu=False,
                    add_ta=False,
                    verbose=False,
                )

        _, kwargs = mock_cls.call_args
        assert kwargs["auto_class_weights"] is None

    def test_custom_class_weight(self) -> None:
        """When class_weight='custom', auto_class_weights should be None."""
        with patch("model.check_gpu", return_value=False):
            with patch("model.CatBoostClassifier") as mock_cls:
                build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="custom",
                    early_stopping=50,
                    gpu=False,
                    add_ta=False,
                    verbose=False,
                )

        _, kwargs = mock_cls.call_args
        assert kwargs["auto_class_weights"] is None

    def test_params_override(self) -> None:
        """When params dict is provided, learning_rate/depth/l2_leaf_reg are overridden."""
        with patch("model.check_gpu", return_value=False):
            with patch("model.CatBoostClassifier") as mock_cls:
                build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="balanced",
                    early_stopping=50,
                    gpu=False,
                    add_ta=False,
                    verbose=False,
                    params={
                        "learning_rate": 0.01,
                        "depth": 8,
                        "l2_leaf_reg": 5,
                    },
                )

        _, kwargs = mock_cls.call_args
        assert kwargs["learning_rate"] == 0.01
        assert kwargs["depth"] == 8
        assert kwargs["l2_leaf_reg"] == 5

    def test_params_partial_override(self) -> None:
        """When params dict has only some keys, the rest keep defaults."""
        with patch("model.check_gpu", return_value=False):
            with patch("model.CatBoostClassifier") as mock_cls:
                build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="balanced",
                    early_stopping=50,
                    gpu=False,
                    add_ta=False,
                    verbose=False,
                    params={"learning_rate": 0.05},
                )

        _, kwargs = mock_cls.call_args
        assert kwargs["learning_rate"] == 0.05
        # depth should remain the computed default (5 for 32 leaves)
        assert kwargs["depth"] == 5
        # l2_leaf_reg should remain the default (3)
        assert kwargs["l2_leaf_reg"] == 3

    def test_verbose_passthrough(self) -> None:
        """Verbose is passed directly to CatBoostClassifier."""
        with patch("model.check_gpu", return_value=False):
            with patch("model.CatBoostClassifier") as mock_cls:
                build_catboost(
                    learning_rate=0.1,
                    num_leaves=32,
                    n_estimators=500,
                    seed=42,
                    class_weight="balanced",
                    early_stopping=50,
                    gpu=False,
                    add_ta=False,
                    verbose=True,
                )

        _, kwargs = mock_cls.call_args
        assert kwargs["verbose"] is True
