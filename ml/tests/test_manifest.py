"""Tests for ml/manifest.py — Model MANIFEST Management."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from manifest import update_manifest


def _read_manifest(output_dir: Path) -> dict:
    """Helper: read the MANIFEST.json from output_dir."""
    manifest_path = output_dir / "MANIFEST.json"
    assert manifest_path.exists(), "MANIFEST.json was not created"
    with open(manifest_path) as f:
        return json.load(f)


# ── First model ─────────────────────────────────────────────────────────────


def test_first_model_becomes_production(
    manifest_tmp_dir: Path,
    sample_metrics_good: dict,
    base_training_config: dict,
) -> None:
    """When no manifest exists, the first model entry becomes production."""
    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v1.cbm",
        joblib_path="model_v1.joblib",
        metrics_path="metrics_v1.json",
        metrics=sample_metrics_good,
        training_config=base_training_config,
    )

    manifest = _read_manifest(manifest_tmp_dir)
    assert manifest["active_model"] == "model_v1.cbm"
    assert len(manifest["models"]) == 1
    assert manifest["models"][0]["is_production"] is True
    assert manifest["models"][0]["path"] == "model_v1.cbm"
    assert manifest["models"][0]["accuracy"] == 0.85
    assert manifest["models"][0]["f1_weighted"] == 0.83


# ── Second model — Better ───────────────────────────────────────────────────


def test_better_model_promoted(
    manifest_tmp_dir: Path,
    sample_metrics_good: dict,
    sample_metrics_better: dict,
    base_training_config: dict,
) -> None:
    """A second model with clearly better F1 (>0.01 higher) is promoted; first is demoted."""
    # Add first model
    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v1.cbm",
        joblib_path="model_v1.joblib",
        metrics_path="metrics_v1.json",
        metrics=sample_metrics_good,
        training_config=base_training_config,
    )

    # Add second model with better F1 (0.87 vs 0.83 → +0.04, above +0.01 threshold)
    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v2.cbm",
        joblib_path="model_v2.joblib",
        metrics_path="metrics_v2.json",
        metrics=sample_metrics_better,
        training_config=base_training_config,
    )

    manifest = _read_manifest(manifest_tmp_dir)
    assert len(manifest["models"]) == 2

    # v2 should be production, v1 should not
    m1 = manifest["models"][0]
    m2 = manifest["models"][1]

    assert m1["path"] == "model_v1.cbm"
    assert m1["is_production"] is False

    assert m2["path"] == "model_v2.cbm"
    assert m2["is_production"] is True

    # active_model should point to the production model
    assert manifest["active_model"] == "model_v2.cbm"


# ── Second model — Worse ────────────────────────────────────────────────────


def test_worse_model_not_promoted(
    manifest_tmp_dir: Path,
    sample_metrics_good: dict,
    sample_metrics_worse: dict,
    base_training_config: dict,
) -> None:
    """A second model with worse F1 is NOT promoted — first stays production."""
    # Add first model
    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v1.cbm",
        joblib_path="model_v1.joblib",
        metrics_path="metrics_v1.json",
        metrics=sample_metrics_good,
        training_config=base_training_config,
    )

    # Add second model with worse F1 (0.78 vs 0.83)
    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v2.cbm",
        joblib_path="model_v2.joblib",
        metrics_path="metrics_v2.json",
        metrics=sample_metrics_worse,
        training_config=base_training_config,
    )

    manifest = _read_manifest(manifest_tmp_dir)
    assert len(manifest["models"]) == 2

    m1 = manifest["models"][0]
    m2 = manifest["models"][1]

    # v1 stays production
    assert m1["path"] == "model_v1.cbm"
    assert m1["is_production"] is True

    # v2 is NOT production
    assert m2["path"] == "model_v2.cbm"
    assert m2["is_production"] is False

    # active_model should still point to v1
    assert manifest["active_model"] == "model_v1.cbm"


# ── Second model — Marginal improvement (below threshold) ───────────────────


def test_marginal_improvement_not_promoted(
    manifest_tmp_dir: Path,
    base_training_config: dict,
) -> None:
    """A second model with F1 improvement below 0.01 threshold is not promoted."""
    metrics_v1 = {"accuracy": 0.85, "f1_weighted": 0.83, "f1_macro": 0.81, "features": 12}
    metrics_v2 = {"accuracy": 0.86, "f1_weighted": 0.835, "f1_macro": 0.82, "features": 13}

    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v1.cbm",
        joblib_path="model_v1.joblib",
        metrics_path="metrics_v1.json",
        metrics=metrics_v1,
        training_config=base_training_config,
    )

    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v2.cbm",
        joblib_path="model_v2.joblib",
        metrics_path="metrics_v2.json",
        metrics=metrics_v2,
        training_config=base_training_config,
    )

    manifest = _read_manifest(manifest_tmp_dir)
    # v2 improvement (0.835 - 0.83 = 0.005) < 0.01 threshold
    assert manifest["models"][0]["is_production"] is True  # v1 stays
    assert manifest["models"][1]["is_production"] is False  # v2 not promoted
    assert manifest["active_model"] == "model_v1.cbm"


# ── Corrupt manifest ────────────────────────────────────────────────────────


def test_corrupt_manifest_overwritten(
    manifest_tmp_dir: Path,
    sample_metrics_good: dict,
    base_training_config: dict,
) -> None:
    """A corrupt existing MANIFEST.json is gracefully overwritten."""
    # Write invalid JSON to simulate corruption
    manifest_path = manifest_tmp_dir / "MANIFEST.json"
    manifest_path.write_text("this is not valid json {")

    # This should succeed without error
    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v1.cbm",
        joblib_path="model_v1.joblib",
        metrics_path="metrics_v1.json",
        metrics=sample_metrics_good,
        training_config=base_training_config,
    )

    manifest = _read_manifest(manifest_tmp_dir)
    assert manifest["active_model"] == "model_v1.cbm"
    assert len(manifest["models"]) == 1
    assert manifest["models"][0]["is_production"] is True


def test_corrupt_manifest_not_dict(
    manifest_tmp_dir: Path,
    sample_metrics_good: dict,
    base_training_config: dict,
) -> None:
    """If existing manifest is valid JSON but not a dict (e.g., a list), it is overwritten."""
    manifest_path = manifest_tmp_dir / "MANIFEST.json"
    manifest_path.write_text(json.dumps(["not", "a", "dict"]))

    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v1.cbm",
        joblib_path="model_v1.joblib",
        metrics_path="metrics_v1.json",
        metrics=sample_metrics_good,
        training_config=base_training_config,
    )

    manifest = _read_manifest(manifest_tmp_dir)
    assert manifest["active_model"] == "model_v1.cbm"
    assert len(manifest["models"]) == 1


# ── Edge cases ──────────────────────────────────────────────────────────────


def test_missing_f1_handled(
    manifest_tmp_dir: Path,
    base_training_config: dict,
) -> None:
    """When f1_weighted is missing from metrics, it is treated as 0 (no promotion)."""
    metrics_no_f1 = {"accuracy": 0.85, "features": 12}
    metrics_with_f1 = {"accuracy": 0.86, "f1_weighted": 0.1, "features": 13}

    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v1.cbm",
        joblib_path="model_v1.joblib",
        metrics_path="metrics_v1.json",
        metrics=metrics_no_f1,
        training_config=base_training_config,
    )

    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v2.cbm",
        joblib_path="model_v2.joblib",
        metrics_path="metrics_v2.json",
        metrics=metrics_with_f1,
        training_config=base_training_config,
    )

    manifest = _read_manifest(manifest_tmp_dir)
    # v1 had no f1_weighted (treated as 0), v2 has 0.1 → +0.1 > 0.01 → promoted
    assert manifest["models"][0]["is_production"] is False
    assert manifest["models"][1]["is_production"] is True


def test_manifest_structure(
    manifest_tmp_dir: Path,
    sample_metrics_good: dict,
    base_training_config: dict,
) -> None:
    """Verify the manifest structure has all expected keys."""
    update_manifest(
        output_dir=manifest_tmp_dir,
        model_path="model_v1.cbm",
        joblib_path="model_v1.joblib",
        metrics_path="metrics_v1.json",
        metrics=sample_metrics_good,
        training_config=base_training_config,
    )

    manifest = _read_manifest(manifest_tmp_dir)

    # Top-level keys
    assert "active_model" in manifest
    assert "models" in manifest
    assert "retired_models" in manifest

    # Model entry keys
    entry = manifest["models"][0]
    assert entry["path"] == "model_v1.cbm"
    assert entry["joblib_path"] == "model_v1.joblib"
    assert entry["metrics_path"] == "metrics_v1.json"
    assert "training_timestamp" in entry
    assert entry["accuracy"] == 0.85
    assert entry["f1_weighted"] == 0.83
    assert entry["f1_macro"] == 0.81
    assert entry["features"] == 12
    assert "training_config" in entry
    assert entry["training_config"] == base_training_config
    assert entry["is_production"] is True
