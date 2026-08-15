# Institutional Signal Quality, ML Precision & Visual Output Brief

This Ultragoal executes comprehensive quality upgrades across Trading Strategies, Machine Learning Model Predictions, and Report/Visual Display Outputs.

## Objectives
1. **Institutional Signal Engine (`src/analysis/strategies.ts` & `src/analysis/engine.ts`)**: Enhance momentum, mean-reversion, and trend-following strategies with ADX trend-strength filtering, RSI divergence detection, volume profile POC confirmation, and multi-timeframe agreement weighting.
2. **High-Precision ML Inference & Calibration (`ml/model.py` & `src/ml/predict.ts`)**: Upgrade CatBoost classification with probability calibration, dynamic volatility-adjusted confidence bounds, and feature importance attribution.
3. **Visual Output & Rich Terminal Formatting (`src/display.ts` & `src/reports/`)**: Elevate Markdown, ASCII chart, and terminal table reports with colorized direction indicators, risk management parameters (SL/TP/R:R), and pattern recognition highlights.
4. **Backtesting & Accuracy Analytics (`src/backtest.ts`)**: Quantify strategy accuracy, Sharpe ratio, Sortino ratio, max drawdown, and expectancy across historical market data.
5. **Full System Verification**: Verify end-to-end pipeline with `npm run validate` and `npm run backtest`.
