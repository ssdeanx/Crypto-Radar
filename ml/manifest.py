"""
Hermes Crypto Radar — Model MANIFEST Management

Handles the MANIFEST.json model registry: reading, updating, and model
comparison for production promotion decisions.
"""

import json
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)


def update_manifest(
    output_dir: Path,
    model_path: str,
    joblib_path: str,
    metrics_path: str,
    metrics: dict,
    training_config: dict,
) -> None:
    """Update the model MANIFEST.json in the output directory.

    Reads the existing manifest (if any), appends the new model entry,
    and promotes it to active if it outperforms the current active model
    (or if no active model exists).

    Args:
        output_dir: Directory where MANIFEST.json lives.
        model_path: Path to the .cbm model file.
        joblib_path: Path to the .joblib model file.
        metrics_path: Path to the metrics JSON file.
        metrics: Dict of evaluation metrics (accuracy, f1_weighted, etc.).
        training_config: Dict of training args snapshot.
    """
    manifest_path = output_dir / "MANIFEST.json"

    # Build the new model entry
    new_entry: dict = {
        "path": Path(model_path).name,
        "joblib_path": Path(joblib_path).name,
        "metrics_path": Path(metrics_path).name,
        "training_timestamp": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "accuracy": metrics.get("accuracy"),
        "f1_weighted": metrics.get("f1_weighted"),
        "f1_macro": metrics.get("f1_macro"),
        "features": metrics.get("features"),
        "training_config": training_config,
    }

    # Load existing manifest or create new one
    manifest: dict = {"active_model": None, "models": [], "retired_models": []}
    if manifest_path.exists():
        try:
            with open(manifest_path) as f:
                existing = json.load(f)
                if isinstance(existing, dict):
                    manifest = existing
        except Exception as e:
            logger.warning("Failed to parse existing MANIFEST.json: %s", e)

    # Determine if this model should be production
    current_active = None
    for m in manifest.get("models", []):
        if m.get("is_production"):
            current_active = m
            break

    if current_active is not None:
        current_f1 = current_active.get("f1_weighted") or 0
        new_f1 = new_entry.get("f1_weighted") or 0
        # Only promote if new model outperforms by >= 1% F1 weighted
        if new_f1 >= current_f1 + 0.01:
            current_active["is_production"] = False
            new_entry["is_production"] = True
            logger.info(
                "New model promoted to production (F1=%.4f vs current %.4f)",
                new_f1, current_f1,
            )
        else:
            new_entry["is_production"] = False
            logger.info(
                "New model kept as candidate (F1=%.4f < current %.4f + 0.01)",
                new_f1, current_f1,
            )
    else:
        # No active model — this one becomes production
        new_entry["is_production"] = True
        logger.info("First model — set as production")

    # Append new model entry
    manifest.setdefault("models", []).append(new_entry)
    manifest["active_model"] = (
        new_entry["path"] if new_entry.get("is_production")
        else current_active["path"] if current_active
        else new_entry["path"]
    )

    # Write updated manifest
    try:
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2, default=str)
        logger.info("MANIFEST updated: %s", manifest_path)
    except Exception as e:
        logger.warning("Failed to write MANIFEST.json: %s", e)
