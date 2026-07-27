"""pytest configuration for ml/ tests — sets up import path and shared fixtures."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

# Add ml/ directory to sys.path so tests can `from predict import ...` etc.
ML_DIR = Path(__file__).resolve().parent.parent
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))


@pytest.fixture
def sample_ohlcv_df() -> pd.DataFrame:
    """Return a small OHLCV DataFrame with 100 rows of synthetic price data."""
    n = 100
    rng = np.random.default_rng(42)
    # Start with a base close price
    closes = 100.0 * np.cumprod(1 + rng.normal(0, 0.005, n))
    opens = closes * (1 + rng.normal(0, 0.001, n))
    highs = np.maximum(opens, closes) * (1 + abs(rng.normal(0, 0.002, n)))
    lows = np.minimum(opens, closes) * (1 - abs(rng.normal(0, 0.002, n)))
    volumes = np.abs(rng.normal(1000, 200, n))

    return pd.DataFrame(
        {
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes,
        }
    )


@pytest.fixture
def sample_feature_df() -> pd.DataFrame:
    """Return a DataFrame with known correlated features for filter testing."""
    rng = np.random.default_rng(42)
    n = 50
    base = rng.normal(0, 1, n)
    # Create correlated columns
    a = base + rng.normal(0, 0.05, n)  # nearly identical to base
    b = base * 2 + rng.normal(0, 0.1, n)  # strongly correlated to a
    c = rng.normal(0, 1, n)  # independent
    d = base * -1 + rng.normal(0, 0.05, n)  # strongly negatively correlated
    const = np.zeros(n)  # constant (zero-variance)

    return pd.DataFrame(
        {
            "feat_a": a,
            "feat_b": b,
            "feat_c": c,
            "feat_d": d,
            "feat_const": const,
        }
    )


@pytest.fixture
def sample_timestamps() -> pd.Series:
    """Return a Series of epoch-ms timestamps spaced ~1h apart (100 rows)."""
    import pandas as pd

    base = 1_700_000_000_000  # ~2023-11-14
    # Spaced ~1 hour apart (3,600,000 ms) with slight jitter
    offsets = [i * 3_600_000 + (0 if i == 0 else int(np.random.default_rng(i).normal(0, 10_000))) for i in range(100)]
    return pd.Series([base + off for off in offsets])


@pytest.fixture
def manifest_tmp_dir(tmp_path: Path) -> Path:
    """Return a temporary directory for MANIFEST.json testing."""
    return tmp_path


@pytest.fixture
def sample_metrics_good() -> dict:
    """Return a metrics dict with high F1."""
    return {
        "accuracy": 0.85,
        "f1_weighted": 0.83,
        "f1_macro": 0.81,
        "features": 12,
    }


@pytest.fixture
def sample_metrics_better() -> dict:
    """Return a metrics dict with significantly better F1 (>= 0.01 higher)."""
    return {
        "accuracy": 0.90,
        "f1_weighted": 0.87,
        "f1_macro": 0.85,
        "features": 14,
    }


@pytest.fixture
def sample_metrics_worse() -> dict:
    """Return a metrics dict with worse F1."""
    return {
        "accuracy": 0.80,
        "f1_weighted": 0.78,
        "f1_macro": 0.75,
        "features": 10,
    }


@pytest.fixture
def base_training_config() -> dict:
    """Return a basic training config snapshot."""
    return {
        "learning_rate": 0.1,
        "num_leaves": 32,
        "n_estimators": 500,
        "seed": 42,
        "class_weight": "balanced",
    }
