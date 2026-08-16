# Paper Trading & Agent Telemetry Reference — Crypto-Radar

Crypto-Radar includes an institutional paper trading simulation engine with realistic slippage, fee deduction, multi-profile portfolio management, and telemetry dataset export.

---

## 1. Simulation Mechanics (`src/paper-trade.ts`)

### Account State Model

- **Starting Cash**: Configurable (default: $10,000 fake USD).
- **Holdings**: Token-by-token average entry price, total units, current market value, and unrealized P&L.
- **Trade History**: Full audit trail of buy/sell timestamps, executed amounts, prices, fees, slippage, and rationale tags.

### Execution Slippage & Fee Models

- **Taker Fee**: Configurable fixed or percentage fee (default: $0.1\%$ / $0.001$).
- **Slippage Model**: Proportional to trade size and market volatility:
  $$\text{EffectivePrice}_{\text{buy}} = P_{\text{market}} \times (1 + \text{SlippageRate})$$
  $$\text{EffectivePrice}_{\text{sell}} = P_{\text{market}} \times (1 - \text{SlippageRate})$$

### Position Sizing

Integrated with `src/math/risk.ts` to support:

- **Fractional Kelly Criterion**: $f^* = \frac{p(b+1)-1}{b} \times \text{fraction}$
- **Fixed Dollar Risk per ATR**: Size calculated such that stop-loss hit loses exactly $X\%$ of account balance.

---

## 2. Agent Evaluation Scorecards (`src/analysis/agent-eval.ts`)

Computes comprehensive performance scorecards:

- **Profit Factor**: Gross Profit / Gross Loss
- **Expectancy ($/trade)**: Average dollar gain per completed trade
- **Sharpe, Sortino & Calmar Ratios**: Risk-adjusted returns
- **Brier Score & Expected Calibration Error (ECE)**: Probability accuracy of trading decisions
- **MFE / MAE Ratio**: Maximum Favorable Excursion vs. Maximum Adverse Excursion efficiency
- **Regime Scorecard**: Win rate and P&L segmented by Bull, Bear, and Choppy market regimes

---

## 3. Dataset Export & Machine Learning Feedback

Export simulated trades to JSONL or CSV:

```bash
crypto-radar paper export --format jsonl --output data/paper_trades.jsonl
```

The exported dataset is consumed by `ml/train_paper_agent.py` to train supervised predictive models that learn which signal combinations produce winning trades.
