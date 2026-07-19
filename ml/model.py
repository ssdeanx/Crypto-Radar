"""
Hermes Crypto Radar — CatBoost Model Factory

Builds and configures CatBoostClassifier instances with proper defaults,
GPU detection, class weight resolution, and leaf-to-depth mapping.
"""

import logging
import math

import numpy as np
from catboost import CatBoostClassifier

logger = logging.getLogger(__name__)


def check_gpu() -> bool:
    """Return True if CatBoost GPU device is functional on this system."""
    try:
        probe = CatBoostClassifier(
            iterations=1,
            depth=2,
            learning_rate=0.1,
            task_type="GPU",
            verbose=False,
            random_seed=0,
        )
        rng = np.random.default_rng(0)
        probe.fit(
            rng.random((10, 2)),
            rng.integers(0, 2, 10),
        )
        return True
    except Exception:
        return False


def resolve_class_weight(cli_value: str) -> str | None:
    """Map the CLI --class-weight string to the CatBoost auto_class_weights value.

    "balanced" -> "Balanced" (CatBoost built-in balanced weighting)
    "None"     -> None (no weighting)
    "custom"   -> None here; per-sample weights are applied via fit(sample_weight)
    """
    if cli_value == "None":
        return None
    if cli_value == "balanced":
        return "Balanced"
    # "custom" — handled through sample_weight in train(), not auto_class_weights
    return None


def num_leaves_to_depth(num_leaves: int) -> int:
    """Map a leaf count to a CatBoost tree depth."""
    if num_leaves <= 1:
        return 6
    return max(2, int(round(math.log2(num_leaves))))


def build_catboost(
    learning_rate: float,
    num_leaves: int,
    n_estimators: int,
    seed: int,
    class_weight: str,
    early_stopping: int,
    gpu: bool,
    add_ta: bool,
    verbose: bool,
    params: dict | None = None,
) -> CatBoostClassifier:
    """Build and return a configured CatBoost classifier.

    Args:
        learning_rate: Base learning rate (overridden by params if provided).
        num_leaves: Leaf count, mapped to depth via log2.
        n_estimators: Number of boosting iterations.
        seed: Random seed.
        class_weight: Class weight strategy ('balanced', 'None', 'custom').
        early_stopping: Early stopping rounds (0 = disable).
        gpu: Whether to attempt GPU training.
        add_ta: Whether TA features are enabled (affects rsm).
        verbose: Enable verbose CatBoost logging.
        params: Optional dict overriding learning_rate / depth / l2_leaf_reg.

    Returns:
        Configured CatBoostClassifier instance (not yet trained).
    """
    lr = learning_rate
    depth = num_leaves_to_depth(num_leaves)
    l2 = 3

    if params:
        lr = params.get("learning_rate", lr)
        depth = params.get("depth", depth)
        l2 = params.get("l2_leaf_reg", l2)

    auto_class_weights = resolve_class_weight(class_weight)

    task_type = "CPU"
    if gpu:
        if check_gpu():
            task_type = "GPU"
            logger.info("GPU training enabled")
        else:
            logger.warning(
                "GPU training requested but not available — falling back to CPU"
            )

    # Feature subsampling when many features (rsm = colsample_bylevel)
    rsm_value = 0.8 if add_ta else None

    return CatBoostClassifier(
        iterations=n_estimators,
        learning_rate=lr,
        depth=depth,
        l2_leaf_reg=l2,
        model_size_reg=0.5,  # reduce model size, prevent overfitting
        rsm=rsm_value,  # feature subsampling when add-ta is enabled
        nan_mode="Min",  # CatBoost handles NaN natively
        auto_class_weights=auto_class_weights,
        random_seed=seed,
        early_stopping_rounds=early_stopping if early_stopping > 0 else None,
        task_type=task_type,
        verbose=verbose,
    )
