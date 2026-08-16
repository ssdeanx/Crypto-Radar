# Machine Learning Pipeline Reference — Crypto-Radar

Crypto-Radar integrates a dual-layer machine learning architecture combining offline gradient boosting classifiers with streaming online learning.

---

## Architecture Overview

```
ml/
├── train.py                # CatBoost / LightGBM batch training pipeline
├── train_paper_agent.py    # Paper trading telemetry training pipeline
├── predict.py              # Subprocess batch inference engine
├── online.py               # River streaming online learning
├── detect_drift.py         # ADWIN, Page-Hinkley & KSWIN drift detection
├── indicators.py           # Python 42-indicator vectorized engine
├── manifest.py             # MANIFEST.json model registry & versioning
├── daemon.py               # Warm Python ML prediction worker
└── tests/                  # PyTest suite (214 tests, 87% coverage)
```

---

## 1. Batch Training Pipeline (`ml/train.py`)

### Feature Engineering
- **80+ vector features**: RSI, MACD, Bollinger Bands, ATR, ADX, Ichimoku, Stochastic, CMF, TSI, VWAP, On-Chain TVL changes, Order Book Imbalance, Funding Rates.
- **Labels**: Forward return classification with dynamic volatility threshold:
  $$y_t = \begin{cases} 1 & \text{if } r_{t+H} > \theta \times \sigma_t \\ 0 & \text{otherwise} \end{cases}$$

### Cross-Validation & Purged K-Fold
To prevent lookahead bias in financial time series:
- **Purge Window**: Drops $k$ bars before test partition.
- **Embargo Window**: Drops $m$ bars after test partition to eliminate auto-correlation leakage.

### Hyperparameter Optimization (Optuna)
- Automatic Tree-structured Parzen Estimator (TPE) tuning of `depth`, `learning_rate`, `l2_leaf_reg`, `iterations`, and `border_count`.

### Probability Calibration
- Isotonic regression and Platt scaling to calibrate raw tree probabilities against historical outcomes.

---

## 2. Paper Trading Agent ML Training (`ml/train_paper_agent.py`)

Trains supervised models directly on exported paper trading execution datasets (`crypto-radar paper export --format jsonl`):
- **Features**: Strategy confidence scores, market regime, RSI, MACD, volatility, distance to stop loss.
- **Target**: Realized trade win ($1$) or loss ($0$).
- **Output Model**: Deployed to `data/ml/paper_agent_model.cbm` for adaptive execution sizing.

---

## 3. Streaming Online Learning (`ml/online.py`)

- Uses **River** (`river.linear_model.LogisticRegression` with `river.preprocessing.AdaptiveStandardScaler`).
- Incrementally updates model weights candle-by-candle without expensive full retraining.
- Tracks rolling accuracy, ROC-AUC, and log-loss in real-time.

---

## 4. Concept Drift Detection (`ml/detect_drift.py`)

Monitors prediction error streams for structural market regime shifts:
- **ADWIN** (Adaptive Windowing): Detects mean error rate changes.
- **Page-Hinkley**: Detects cumulative upward drift in model loss.
- **KSWIN** (Kolmogorov-Smirnov Windowing): Statistical distribution divergence test.
- **Auto-Retrain Trigger**: Automatically calls `POST /api/cron/retrain` when drift exceeds critical thresholds.
