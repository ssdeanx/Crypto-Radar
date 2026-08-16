# Strategy & Signal Engine Reference — Crypto-Radar

The Crypto-Radar Signal Engine combines 4 distinct strategy paradigms, multi-timeframe weighted voting, divergence detection, candlestick pattern recognition, and quantitative risk management.

---

## 1. Multi-Strategy Architecture

The composite score $S \in [0, 100]$ is computed as a weighted sum of 4 independent strategy modules:

| Strategy | Default Weight | Target Market Condition | Key Indicators |
| :--- | :--- | :--- | :--- |
| **Momentum** | 35% | Trending / Breakouts | RSI, ROC, MACD Histogram, TSI |
| **Mean Reversion** | 20% | Oversold / Overbought Ranging | Bollinger Bands, Stochastic, Williams %R |
| **Trend Following** | 30% | Macro Continuations | EMA (12/26/50/200), Parabolic SAR, Ichimoku |
| **Divergence** | 15% | Major Reversals | Regular & Hidden RSI/MACD Divergence |

### Regime-Adaptive Dynamic Weighting

Weights dynamically adapt based on the detected market regime:

- **Trending Regime** ($ADX \ge 25$): Momentum 45%, Trend Following 45%, Mean Reversion 10%.
- **Ranging / Choppy Regime** ($ADX < 20$): Mean Reversion 60%, Divergence 25%, Trend 15%.
- **High Volatility Regime** (ATR Band Expansions): Balanced 30/35/35 risk distribution.

---

## 2. Multi-Timeframe (MTF) Aggregation

Parallel kline evaluation across 4 timeframe intervals:

| Timeframe | Weight | Description |
| :--- | :--- | :--- |
| **15m** | 0.10 | Tactical micro-structure entry |
| **1h** | 0.25 | Short-term momentum confirmation |
| **4h** | 0.30 | Intermediate trend backbone |
| **1d** | 0.35 | Macro structural bias |

$$\text{FinalScore} = \sum_{t \in \{15m, 1h, 4h, 1d\}} w_t \times S_t$$

---

## 3. Divergence Detection (`src/analysis/divergence.ts`)

Scans for classic and hidden divergences between price action and momentum oscillators:

- **Regular Bullish Divergence**: Price makes Lower Low (LL) while RSI/MACD makes Higher Low (HL) $\to$ Strong reversal buy signal.
- **Regular Bearish Divergence**: Price makes Higher High (HH) while RSI/MACD makes Lower High (LH) $\to$ Strong reversal sell signal.
- **Hidden Bullish Divergence**: Price makes Higher Low (HL) while RSI makes Lower Low (LL) $\to$ Trend continuation buy signal.

---

## 4. Quantitative Risk Bounds

Every generated signal includes automated institutional risk bounds:

- **Stop Loss ($SL$)**: Set at $Entry \pm (2.0 \times ATR_{14})$.
- **Take Profit ($TP$)**: Calculated for a minimum $1:2.0$ Risk-to-Reward ratio ($R:R$).
- **Kelly Sizing ($f^*$)**: Fractional Half-Kelly stake recommendation capped at max portfolio allocation.
