"""
Hermes Crypto Radar — Paper Trading AI Agent Training Pipeline

Trains machine learning models (CatBoost / LightGBM / Scikit-Learn) directly on
exported paper trading telemetry datasets to learn optimal signal weighting,
win probability, and expected trade payoff.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def load_dataset(file_path: str) -> pd.DataFrame:
    """Load paper trading telemetry dataset from JSONL or CSV file."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Dataset file not found: {file_path}")

    if path.suffix == ".csv":
        df = pd.read_csv(file_path)
    else:
        records = []
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        df = pd.DataFrame(records)

    if df.empty:
        raise ValueError("Dataset is empty.")

    logger.info("Loaded %d rows from %s", len(df), file_path)
    return df


def prepare_features_and_targets(
    df: pd.DataFrame, target_col: str = "win"
) -> tuple[pd.DataFrame, pd.Series, list[str]]:
    """Extract numeric feature matrix X and target y."""
    ignore_cols = {
        "tradeId",
        "profile",
        "symbol",
        "tokenId",
        "type",
        "orderType",
        "timestamp",
        "reason",
        "win",
        "pnlUsd",
        "pnlPercent",
        "exitPrice",
    }

    # All candidate feature columns
    feature_cols = [c for c in df.columns if c not in ignore_cols]

    # Fill NaN and convert numeric
    X = pd.DataFrame()
    for col in feature_cols:
        series = pd.to_numeric(df[col], errors="coerce")
        if series.notna().sum() > 0:
            median_val = series.median()
            X[col] = series.fillna(median_val if np.isfinite(median_val) else 0.0)

    if X.empty:
        # Fallback dummy feature if no feat_* columns present
        X["placeholder"] = np.ones(len(df))
        feature_cols = ["placeholder"]

    y = pd.to_numeric(df[target_col], errors="coerce").fillna(0)
    return X, y, list(X.columns)


def train_model(
    X: pd.DataFrame,
    y: pd.Series,
    model_type: str = "catboost",
    test_size: float = 0.2,
) -> dict[str, Any]:
    """Train classification model on features X and target y."""
    split_idx = int(len(X) * (1 - test_size))
    if split_idx <= 0 or split_idx >= len(X):
        split_idx = max(1, len(X) - 1)

    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

    try:
        from catboost import CatBoostClassifier

        model = CatBoostClassifier(
            iterations=150,
            learning_rate=0.05,
            depth=4,
            verbose=False,
            random_seed=42,
        )
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        proba = model.predict_proba(X_test)[:, 1] if len(X_test) > 0 else np.array([])
        feature_importances = dict(zip(X.columns, model.get_feature_importance()))
    except Exception as e:
        logger.warning("CatBoost unavailable or failed (%s), falling back to simple heuristic", e)
        # Fallback rule-based predictor
        preds = (X_test.mean(axis=1) > 0).astype(int).values if len(X_test) > 0 else np.array([])
        proba = np.ones(len(X_test)) * 0.5
        feature_importances = {col: 1.0 / len(X.columns) for col in X.columns}

    # Compute evaluation metrics
    acc = float(np.mean(preds == y_test)) if len(y_test) > 0 else 0.0

    return {
        "train_samples": len(X_train),
        "test_samples": len(X_test),
        "test_accuracy": round(acc, 4),
        "feature_importances": sorted(
            feature_importances.items(), key=lambda x: x[1], reverse=True
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train AI Agent on Paper Trading Telemetry")
    parser.add_argument("--data", required=True, help="Path to exported telemetry JSONL or CSV file")
    parser.add_argument("--out-dir", default="./data/ml/models", help="Output directory for model artifacts")
    parser.add_argument("--target", default="win", choices=["win", "pnlPercent"], help="Target column")
    args = parser.parse_args()

    df = load_dataset(args.data)
    X, y, feature_names = prepare_features_and_targets(df, target_col=args.target)
    logger.info("Extracted %d features: %s", len(feature_names), feature_names)

    results = train_model(X, y)
    logger.info("Training complete. Results: %s", json.dumps(results, indent=2))

    os.makedirs(args.out_dir, exist_ok=True)
    report_path = Path(args.out_dir) / "paper_agent_eval.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    logger.info("Saved evaluation report to %s", report_path)


if __name__ == "__main__":
    main()
