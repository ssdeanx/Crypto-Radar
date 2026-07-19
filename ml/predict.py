#!/usr/bin/env python3
"""
Hermes Crypto Radar — Batch Prediction via Python Subprocess

Reads CSV feature rows from stdin, loads a trained CatBoost model,
and writes JSON predictions to stdout.

Usage (via Node subprocess):
    echo "rsi,macd_hist,bb_width,..." | python3 ml/predict.py \\
        --model ml/models/model.cbm \\
        --norm-stats data/ml/dataset_norm_abc123.json

F3: Accepts multiple feature rows in a single CSV block (batch inference),
    returns a JSON array of predictions matching the input rows.

F5: NaN values are filled using the training-set median's z-score
    (provided via --norm-stats), or 0 as a fallback.

Exit codes:
    0 — success (including empty input → "[]")
    1 — fatal error (model not found, corrupt model, bad CSV)
    2 — stdin read timeout (SIGALRM)
"""

import argparse
import io
import json
import logging
import sys
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ── Logging ──


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] predict: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


# ── CLI ──


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Batch prediction (CatBoost)")
    parser.add_argument(
        "--model",
        required=True,
        help="Path to model file (.cbm or .joblib, both CatBoost)",
    )
    parser.add_argument(
        "--model-type",
        choices=["auto", "catboost"],
        default="auto",
        help="Model type. auto=detect from file extension (.cbm → catboost, .joblib → catboost)",
    )
    parser.add_argument(
        "--norm-stats",
        default=None,
        help="Path to normalization_stats JSON (enables median-based NaN fill)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.0,
        help="Minimum confidence threshold (0 = no filter — all predictions returned)",
    )
    parser.add_argument(
        "--explain",
        action="store_true",
        help="Compute SHAP feature attribution for each prediction (slower, requires shap)",
    )
    parser.add_argument("--verbose", action="store_true", help="Debug logging")
    return parser.parse_args(argv)


# ── Helpers ──


def _load_norm_stats(path: str | None) -> dict | None:
    """Load normalization statistics JSON; return None if unavailable."""
    if path is None:
        return None
    p = Path(path)
    if not p.exists():
        logger.warning(
            "norm-stats file not found at %s — falling back to fillna(0)", path
        )
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except Exception as e:
        logger.warning("Failed to parse norm-stats: %s — falling back to fillna(0)", e)
        return None


def _build_fill_values(
    feature_cols: list[str],
    norm_stats: dict | None,
) -> dict[str, float]:
    """
    Build per-column fill values for NaN cells.

    When norm_stats are available, the fill is the z-score of the training
    median: (median - mean) / std.  This preserves the "no signal" state
    that the model saw during training (where NaN rows were dropped).

    Fallback: 0 (the mean in z-score space).
    """
    if norm_stats is None:
        return {}  # caller will use fillna(0)

    medians: dict = norm_stats.get("medians", {})
    means: dict = norm_stats.get("means", {})
    stds: dict = norm_stats.get("stds", {})
    feature_names: list = norm_stats.get("featureNames", [])

    known = set(feature_names)
    fills: dict[str, float] = {}
    for col in feature_cols:
        if col in known:
            med = float(medians.get(col, 0))
            mu = float(means.get(col, 0))
            sigma = float(stds.get(col, 1))
            fills[col] = (med - mu) / sigma if sigma != 0 else 0.0
        else:
            # Feature not seen during training — safe neutral fill
            fills[col] = 0.0
    return fills


def load_model(model_path: str, model_type: str = "auto"):
    """Load a CatBoost model (.cbm or .joblib).

    Args:
        model_path: Path to the serialized model file.
        model_type: One of "auto", "catboost".
            "auto" infers from the file extension:
              .cbm -> catboost, .joblib -> catboost (training is CatBoost-only).

    Returns:
        Loaded model object with .predict() and .predict_proba() methods.
    """
    path = Path(model_path)
    if not path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    # Auto-detect from extension — training is CatBoost-only, so both
    # .cbm and .joblib are CatBoost models.
    resolved = "catboost" if model_type == "auto" else model_type

    if resolved == "catboost":
        from catboost import CatBoostClassifier

        model = CatBoostClassifier()
        model.load_model(str(path))
    else:
        import joblib

        model = joblib.load(str(path))

    logger.info(
        "Model loaded: %s (type=%s, classes=%s)", model_path, resolved, model.classes_
    )
    return model


# ── Main ──


def predict(args: argparse.Namespace) -> None:
    setup_logging(args.verbose)

    # ── Load model ──
    try:
        model = load_model(str(args.model), args.model_type)
    except FileNotFoundError as e:
        logger.error("Model not found: %s", args.model)
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    except Exception as e:
        logger.error("Failed to load model: %s", e)
        print(json.dumps({"error": f"Model load failed: {e}"}))
        sys.exit(1)

    # ── Load normalization stats (optional, F5) ──
    norm_stats = _load_norm_stats(args.norm_stats)
    if norm_stats:
        logger.info(
            "Normalization stats loaded (%d features)",
            len(norm_stats.get("featureNames", [])),
        )

    # ── Stdin read with timeout: prevent hang if pipe not closed ──
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(sys.stdin.buffer.read)
            raw_data = future.result(timeout=60)
        df = pd.read_csv(io.BytesIO(raw_data))
    except TimeoutError:
        logger.error("stdin read timed out after 60s")
        sys.exit(2)
    except Exception as e:
        logger.error("Failed to parse CSV from stdin: %s", e)
        print(json.dumps({"error": f"CSV parse error: {e}"}))
        sys.exit(1)

    if df.empty:
        print("[]")
        return

    # ── Feature columns: all numeric columns ──
    feature_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    if len(feature_cols) == 0:
        logger.error("No numeric feature columns found in input")
        print(json.dumps({"error": "No numeric feature columns found"}))
        sys.exit(1)

    # ── F5: NaN fill ──
    # Data is typically already z-score normalized by the TS pipeline.
    # Any remaining NaN gets the training median's z-score when norm_stats
    # are available, or 0 as a safe fallback.
    nan_count = int(df[feature_cols].isna().to_numpy().sum())
    fill_values = _build_fill_values(feature_cols, norm_stats)
    if fill_values:
        X = df[feature_cols].fillna(value=fill_values).to_numpy(dtype=np.float64)
        if nan_count > 0:
            logger.warning(
                "Filled %d NaN value(s) using norm-stats median z-scores", nan_count
            )
    else:
        X = df[feature_cols].fillna(0).to_numpy(dtype=np.float64)
        if nan_count > 0:
            logger.warning(
                "Filled %d NaN value(s) with 0 (no norm-stats provided)", nan_count
            )

    # ── Sanity-check model classes ──
    if model.classes_ is None:
        logger.error("Model has no classes_ attribute — was it trained?")
        print(json.dumps({"error": "Model has no classes_ — model may not be trained"}))
        sys.exit(1)
    classes: list = list(model.classes_)

    # ── Pre-compute class→index mapping (avoids np.where per row) ──
    class_to_idx: dict[int, int] = {int(cls): idx for idx, cls in enumerate(classes)}

    # ── Predict ──
    try:
        predictions = model.predict(X)
        probabilities = model.predict_proba(X)
    except Exception as e:
        logger.error("Prediction failed: %s", e)
        print(json.dumps({"error": f"Prediction failed: {e}"}))
        sys.exit(1)

    # ── Optional: SHAP explanation ──
    shap_values: np.ndarray | None = None
    feature_names: list[str] = feature_cols
    if args.explain:
        try:
            import shap as shap_lib
            explainer = shap_lib.TreeExplainer(model)
            shap_vals = explainer.shap_values(X)
            # shap_vals shape depends on model type:
            # binary: (n_samples, n_features)
            # multiclass: (n_samples, n_features, n_classes) or list of arrays
            if isinstance(shap_vals, list):
                # List of per-class arrays → take absolute mean across classes
                shap_values = np.mean([np.abs(a) for a in shap_vals], axis=0)
            elif shap_vals.ndim == 3:
                # (n_samples, n_features, n_classes) → mean |SHAP| across classes
                shap_values = np.mean(np.abs(shap_vals), axis=2)
            else:
                shap_values = np.abs(shap_vals)
            logger.info("SHAP explanations computed for %d samples", len(X))
        except Exception as e:
            logger.warning("SHAP explanation failed — proceeding without: %s", e)
            shap_values = None

    # ── Build results ──
    results: list[dict] = []
    for i in range(len(predictions)):
        pred_class = int(predictions[i])

        # Confidence of the predicted class (from class_to_idx map)
        cls_idx = class_to_idx.get(pred_class)
        confidence = float(probabilities[i][cls_idx]) if cls_idx is not None else 0.0

        # Build ordered probability array: [-1, 0, 1]
        probs_map: dict[int, float] = {
            int(cls): round(float(probabilities[i][j]), 4)
            for j, cls in enumerate(classes)
        }
        ordered_probs = [probs_map.get(c, 0.0) for c in [-1, 0, 1]]

        result: dict = {
            "direction": pred_class,
            "confidence": round(confidence, 4),
            "probs": ordered_probs,
        }

        # Attach SHAP feature attribution if computed
        if shap_values is not None and i < shap_values.shape[0]:
            top_shap_idx = np.argsort(shap_values[i])[::-1][:5]  # top 5 features
            result["explanation"] = {
                feature_names[j]: round(float(shap_values[i][j]), 6)
                for j in top_shap_idx
                if float(shap_values[i][j]) > 0.001
            }

        results.append(result)

    print(json.dumps(results))


if __name__ == "__main__":
    args = parse_args()
    predict(args)
