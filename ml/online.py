"""
Hermes Crypto Radar — Online Learning Layer (River)

Provides an incrementally-updating online learning model that runs between
full CatBoost retrains. Uses river's logistic regression with adaptive
normalization to catch slow concept drift in real-time without costly
retraining.

Architecture:
  - OnlineModel wraps a river LogisticRegression with AdaptiveStandardScaler
  - partial_fit(features, label) updates incrementally on new data
  - predict_proba(features) returns streaming predictions
  - get_metrics() reports streaming accuracy, precision, recall from river metrics

Usage (from TypeScript via subprocess):
  python3 ml/online.py --action train --features <json> --label <n>
  python3 ml/online.py --action predict --features <json>
  python3 ml/online.py --action metrics
  python3 ml/online.py --action save --path <file.joblib>
  python3 ml/online.py --action load --path <file.joblib>
"""

import argparse
import json
import logging
import pickle
import sys
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Bump when OnlineModel's pickle layout changes incompatibly.
_MODEL_VERSION: int = 1

# Lazy river import — gives a clear error if river is not installed
# rather than crashing at module import time.
_river = None


def _get_river():
    global _river
    if _river is None:
        try:
            import river.drift as d
            import river.linear_model as lm
            import river.metrics as m
            import river.preprocessing as pp
            _river = {"drift": d, "linear_model": lm, "metrics": m, "preprocessing": pp}
        except ImportError:
            raise ImportError(
                "river is not installed. Run: npm run setup:ml"
            )
    return _river



class OnlineModel:
    """Incremental online learning model using river.

    Wraps river's AdaptiveStandardScaler + LogisticRegression with
    streaming accuracy tracking. Persisted as pickle between daemon cycles.
    """

    def __init__(self, seed: int = 42) -> None:
        rv = _get_river()
        self.scaler = rv["preprocessing"].AdaptiveStandardScaler()
        self.model = rv["linear_model"].LogisticRegression(l2=0.01)
        self.metric_accuracy = rv["metrics"].Accuracy()
        self._total_updates: int = 0
        self._class_counts: dict[int, int] = {-1: 0, 0: 0, 1: 0}
        self._drift_detector = rv["drift"].ADWIN(delta=0.01, clock=10)
        self._concept_drift_events: int = 0
        self.seed = seed
        self._version: int = _MODEL_VERSION

    def partial_fit(self, features: dict[str, float], label: int) -> None:
        """Update the model with a single labeled example.

        Args:
            features: Dict of feature name -> value.
            label: True class label (-1, 0, or 1).
        """
        self.scaler.learn_one(features)
        X = self.scaler.transform_one(features)

        self.model.learn_one(X, label)
        self._total_updates += 1
        self._class_counts[label] = self._class_counts.get(label, 0) + 1

        y_pred = self.model.predict_one(X)
        if y_pred is not None:
            self.metric_accuracy.update(label, y_pred)

        error = 1.0 if y_pred != label else 0.0
        self._drift_detector.update(error)
        if self._drift_detector.drift_detected:
            self._concept_drift_events += 1
            logger.warning(
                "Online model concept drift event #%d at update %d (error=%.2f)",
                self._concept_drift_events,
                self._total_updates,
                error,
            )

    def predict_proba(self, features: dict[str, float]) -> dict[int, float]:
        """Return class probability dict for the given features.

        Returns {-1: prob, 0: prob, 1: prob} or uniform fallback.
        """
        X = self.scaler.transform_one(features)

        try:
            proba = self.model.predict_proba_one(X)
            return {
                -1: float(proba.get(-1, 0.0)),
                0: float(proba.get(0, 0.0)),
                1: float(proba.get(1, 0.0)),
            }
        except Exception:
            return {-1: 1.0 / 3, 0: 1.0 / 3, 1: 1.0 / 3}

    def predict(self, features: dict[str, float]) -> int | None:
        """Return the predicted class label."""
        X = self.scaler.transform_one(features)
        return self.model.predict_one(X)

    def get_metrics(self) -> dict[str, Any]:
        """Return streaming performance metrics."""
        return {
            "total_updates": self._total_updates,
            "class_distribution": dict(self._class_counts),
            "accuracy": self.metric_accuracy.get(),
            "concept_drift_events": self._concept_drift_events,
        }

    def save(self, path: str) -> None:
        """Serialize the model to a pickle file (atomic write via tmp+rename)."""
        tmp_path = path + ".tmp"
        try:
            with open(tmp_path, "wb") as f:
                pickle.dump(self, f, protocol=pickle.HIGHEST_PROTOCOL)
            Path(tmp_path).rename(path)
            logger.info("Online model saved to %s (%d updates)", path, self._total_updates)
        except Exception as e:
            # Best-effort cleanup so stale .tmp files don't accumulate.
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except OSError:
                pass
            logger.error("Failed to save online model to %s: %s", path, e)
            raise

    @staticmethod
    def load(path: str) -> "OnlineModel":
        """Deserialize a model from a pickle file.

        Raises:
            pickle.UnpicklingError: File exists but is corrupt or unreadable.
            TypeError: File contains an incompatible or wrong object type.
            ValueError: Saved model version is incompatible with this code.
        """
        try:
            with open(path, "rb") as f:
                obj = pickle.load(f)
        except pickle.UnpicklingError as e:
            msg = f"Online model file is corrupt and cannot be loaded: {path} — {e}"
            logger.error(msg)
            raise pickle.UnpicklingError(msg) from e
        except Exception as e:
            logger.error("Failed to load online model from %s: %s", path, e)
            raise

        if not isinstance(obj, OnlineModel):
            raise TypeError(
                f"Expected OnlineModel but got {type(obj).__name__} in {path}. "
                "Delete the file and retrain to recover."
            )
        saved_ver = getattr(obj, "_version", 0)
        if saved_ver != _MODEL_VERSION:
            raise ValueError(
                f"Model version mismatch: file has v{saved_ver}, code expects v{_MODEL_VERSION}. "
                "Delete the model file and retrain."
            )
        logger.info("Online model loaded from %s (v%d, %d updates)", path, saved_ver, obj._total_updates)
        return obj


# ═══════════════════════════════════════════════════════════════════════
# CLI subprocess interface (called from TypeScript)
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_ONLINE_MODEL_PATH = "ml/models/online_model.joblib"


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] online: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Online learning layer (river)"
    )
    parser.add_argument(
        "--action",
        required=True,
        choices=["train", "predict", "metrics", "save", "load", "reset"],
        help="Action to perform",
    )
    parser.add_argument(
        "--features",
        default=None,
        help="JSON object of feature name → value",
    )
    parser.add_argument(
        "--label",
        type=int,
        default=None,
        help="True class label for training (-1, 0, 1)",
    )
    parser.add_argument(
        "--path",
        default=DEFAULT_ONLINE_MODEL_PATH,
        help="Path to save/load the online model pickle",
    )
    parser.add_argument("--verbose", action="store_true", help="Debug logging")
    return parser.parse_args(argv)


def main(args: argparse.Namespace) -> None:
    setup_logging(args.verbose)

    # Load existing model or create new one
    model_path = Path(args.path)
    if args.action == "reset":
        # Delete existing model file
        if model_path.exists():
            model_path.unlink()
            print(json.dumps({"status": "reset", "message": "Online model deleted"}))
        else:
            print(json.dumps({"status": "reset", "message": "No model to delete"}))
        return

    if model_path.exists() and args.action != "reset":
        model = OnlineModel.load(str(model_path))
    else:
        model = OnlineModel(seed=42)
        logger.info("Created new online model")

    if args.action == "train":
        if args.features is None or args.label is None:
            print(json.dumps({"error": "Both --features and --label required for train"}))
            sys.exit(1)
        features = json.loads(args.features)
        if not isinstance(features, dict):
            print(json.dumps({"error": "--features must be a JSON object"}))
            sys.exit(1)
        model.partial_fit(features, args.label)
        model.save(str(model_path))
        print(json.dumps({"status": "trained", "total_updates": model._total_updates}))

    elif args.action == "predict":
        if args.features is None:
            print(json.dumps({"error": "--features required for predict"}))
            sys.exit(1)
        features = json.loads(args.features)
        if not isinstance(features, dict):
            print(json.dumps({"error": "--features must be a JSON object"}))
            sys.exit(1)
        prediction = model.predict(features)
        proba = model.predict_proba(features)
        confidence = proba.get(prediction, 0.0) if prediction is not None else 0.0
        print(json.dumps({
            "direction": prediction,
            "confidence": round(confidence, 4),
            "probs": proba,
        }))

    elif args.action == "metrics":
        print(json.dumps(model.get_metrics()))

    elif args.action == "save":
        model.save(str(model_path))
        print(json.dumps({"status": "saved", "path": str(model_path)}))

    elif args.action == "load":
        if not model_path.exists():
            print(json.dumps({"error": f"No model found at {model_path}"}))
            sys.exit(1)
        m = OnlineModel.load(str(model_path))
        print(json.dumps({"status": "loaded", "updates": m.get_metrics()["total_updates"]}))


if __name__ == "__main__":
    args = parse_args()
    main(args)
