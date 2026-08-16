# Promptfoo & AI Evaluation Suite Reference — Crypto-Radar

Crypto-Radar integrates **Promptfoo** and **Autoevals** for continuous evaluation, benchmarking, red-teaming, and factuality scoring of LLM market intelligence outputs.

---

## 1. Architecture Overview

```bash
Crypto-Radar Promptfoo Pipeline
├── promptfooconfig.yaml            # Schema-validated prompt & assertion matrix
├── src/analysis/promptfoo-provider.ts # Custom TypeScript LLM provider
├── src/analysis/ai-eval.ts         # Autoevals factuality & indicator consistency
└── package.json                    # eval:prompts and eval:view scripts
```

---

## 2. Configuration (`promptfooconfig.yaml`)

### Multi-Prompt Testing

Evaluates multiple prompt variations against real market scenarios:

- `structured-trade-signal`: Enforces strict JSON adherence (`symbol`, `action`, `confidence`, `keyDriver`, `riskFactor`, `recommendedStopLossUsdt`).
- `concise-market-rationale`: Evaluates concise, professional, 2-sentence market research summaries.

### Scenario Test Matrix

- **Scenario 1**: Bullish continuation structure on SOL ($154.20 USDT, RSI 65, positive MACD histogram).
- **Scenario 2**: Bearish breakdown on ETH ($2,420 USDT, RSI 28, negative MACD histogram).
- **Scenario 3**: High volatility squeeze on BTC ($64,500 USDT, RSI 51, flat MACD).
- **Scenario 4**: Adversarial prompt injection resistance (jailbreak defense, prompt override defense).

### Programmatic Assertions

- `type: is-json`: Validates strict JSON syntax.
- `type: javascript`: Validates indicator logic (e.g. ensuring stop loss is below entry price for BUY signals).
- `type: latency`: Ensures inference latency remains under 15,000ms.

---

## 3. Custom TypeScript Provider (`src/analysis/promptfoo-provider.ts`)

Connects Promptfoo directly to Crypto-Radar's configured LLM endpoint:

- Dynamically loads `RADAR__AI_BASE_URL`, `RADAR__AI_API_KEY`, and `RADAR__AI_MODEL` from environment.
- Performs token usage accounting (prompt, completion, total tokens).
- Provides offline simulated fallback responses during offline CI test runs.

---

## 4. Running Evaluations

```bash
# Run the complete evaluation matrix
npm run eval:prompts

# Launch visual interactive report dashboard in browser
npm run eval:view
```
