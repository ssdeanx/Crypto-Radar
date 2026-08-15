"""Tests for ml/train_paper_agent.py — Paper Trading AI Agent Training Pipeline."""

from __future__ import annotations

import json
from pathlib import Path
import pandas as pd
import pytest

from train_paper_agent import (
    load_dataset,
    prepare_features_and_targets,
    train_model,
)


@pytest.fixture
def sample_telemetry_jsonl(tmp_path: Path) -> Path:
    file_path = tmp_path / "sample_telemetry.jsonl"
    records = [
        {
            "tradeId": f"PT-{i}",
            "symbol": "SOL",
            "pnlPercent": 2.5 if i % 2 == 0 else -1.2,
            "win": 1 if i % 2 == 0 else 0,
            "feeUsd": 0.5,
            "slippagePercent": 0.05,
            "mfePercent": 3.0,
            "maePercent": 0.8,
            "holdingDurationMs": 180000,
            "feat_rsi": 45.0 + i,
            "feat_chop": 38.0 + (i % 5),
            "feat_supertrend_direction": 1 if i % 2 == 0 else -1,
        }
        for i in range(20)
    ]
    with open(file_path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    return file_path


def test_load_dataset(sample_telemetry_jsonl: Path) -> None:
    df = load_dataset(str(sample_telemetry_jsonl))
    assert len(df) == 20
    assert "feat_rsi" in df.columns
    assert "win" in df.columns


def test_prepare_features_and_targets(sample_telemetry_jsonl: Path) -> None:
    df = load_dataset(str(sample_telemetry_jsonl))
    X, y, feature_names = prepare_features_and_targets(df, target_col="win")
    assert len(X) == 20
    assert len(y) == 20
    assert "feat_rsi" in feature_names
    assert "win" not in feature_names
    assert "tradeId" not in feature_names


def test_train_model(sample_telemetry_jsonl: Path) -> None:
    df = load_dataset(str(sample_telemetry_jsonl))
    X, y, _ = prepare_features_and_targets(df, target_col="win")
    results = train_model(X, y)
    assert isinstance(results, dict)
    assert results["train_samples"] > 0
    assert results["test_samples"] > 0
    assert "test_accuracy" in results
    assert len(results["feature_importances"]) > 0
