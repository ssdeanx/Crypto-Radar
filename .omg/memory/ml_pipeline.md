# ML Pipeline Memory

## Current Architecture Details
*   **Dependencies**: Uses CatBoost, River (online learning & drift), purgedcv (purged walk-forward CV), Optuna (Bayesian hyperparameter optimization), and pandas-ta-classic.
*   **Inference Loop**: Spawns Python interpreter per batch request. Disk I/O overhead from unpickling/repickling the River model (`online_model.joblib`) on every single tick close.
*   **Hyperparameter Search**: Optuna runs evaluation against a simple chronological validation split rather than purged walk-forward cross-validation folds, introducing high risk of data leakage.

## Optimization Decisions
*   **Dataset Format**: Switch from CSV to JSONL for training.
*   **Warm Daemon**: Transition predictions and online updates to a persistent Python daemon (`ml/daemon.py`) using standard Python libraries (built-in `http.server` or `socketserver` to keep it bloat-free), reducing tick execution latency to under 10ms.
*   **Leakage Elimination**: Move `purgedcv` inside the Optuna objective loop to compute cross-validated F1/AUC scores over purged folds.
