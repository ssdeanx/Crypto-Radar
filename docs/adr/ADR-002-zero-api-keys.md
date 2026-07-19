# ADR-002: Zero API Keys — All Data Sources Are Free and Public

## Status
Accepted

## Context
Security is critical for Hermes marketplace listing. API keys are a friction point for users and a security risk if leaked. We needed to provide comprehensive market data without requiring users to sign up for API keys.

## Decision
Use only free, public APIs that require NO authentication:
- **Binance** — public REST API (no key needed)
- **Jupiter** — Solana DEX aggregator (no key needed)
- **DeFiLlama** — on-chain metrics (no key needed)
- **CoinGecko** — price fallback (no key needed, no rate limit for basic usage)
- **RSS feeds** — 11 crypto news sources (no key needed)

## Consequences
+ Zero security risk from leaked credentials
+ Zero onboarding friction for new users
+ All data sources are replaceable if they go down
- Binance API has rate limits (handled via token-bucket rate limiter)
- Some Solana tokens require DEX data (Jupiter solves this)
