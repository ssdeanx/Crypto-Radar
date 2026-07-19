# ADR-003: Signal Engine Design — Multi-Strategy Weighted Voting

## Status
Accepted

## Context
Trading signals require combining multiple perspectives (momentum, mean reversion, trend following) into a single actionable signal. Simple averaging loses nuance.

## Decision
Use a **weighted voting architecture**:
1. Each strategy independently evaluates market context and returns a direction + confidence score
2. Strategies are weighted (Momentum 40%, Mean Reversion 20%, Trend Following 40%)
3. Multi-timeframe evaluation (15m, 1h, 4h, 1d) with its own weight distribution
4. Composite signal = weighted vote across all strategies × timeframes
5. On-chain metrics boost confidence 0-15% based on protocol TVL strength
6. Backtesting engine can optimize weights automatically

## Consequences
+ Strategies can be added/removed independently
+ Weight optimization via backtesting improves over time
+ More interpretable than black-box ML approaches
- Requires historical data for weight optimization
