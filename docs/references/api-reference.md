# Crypto-Radar — Complete REST API Reference (Fastify / Cloud Run)

This reference documents all REST endpoints exposed by the Crypto-Radar Fastify server running on **Google Cloud Run**.

---

## Server & Infrastructure Overview

- **Deployment Platform**: Google Cloud Run (Containerized Linux/amd64 Node.js 22 runtime)
- **Local Dev Server**: `http://localhost:8080`
- **Cloud Run Production URL**: `https://<service-name>-<hash>-uc.a.run.app`
- **Interactive Swagger Documentation**: `http://localhost:8080/docs`
- **OpenAPI Schema Definition**: `http://localhost:8080/docs/json`
- **Authentication**:
  - `POST /api/collect`: Bearer token in `Authorization` header matching `RADAR_API_TOKEN`.
  - `POST /api/cron/*`: Verified by `x-api-key` header matching `CRON_SECRET` or GCP OIDC Token.
  - `/api/portfolio/*`: Optional authentication hook (`app.authenticate`).

---

## 1. Market Data Endpoints

### `GET /api/tickers`

Returns 24-hour ticker statistics across all 149 tracked tokens.

**Query Parameters:**

- `symbol` (optional string): Filter by token symbol (e.g. `SOL`).
- `chain` (optional string): Filter by blockchain network (e.g. `solana`, `ethereum`).
- `limit` (optional number, default `200`): Maximum results.

**Response Schema (`200 OK`):**

```json
[
  {
    "symbol": "SOL",
    "pair": "SOLUSDT",
    "chain": "solana",
    "price": 154.20,
    "change_24h": 4.12,
    "high_24h": 158.40,
    "low_24h": 149.80,
    "volume_24h": 85402100.50,
    "timestamp": 1723731600000
  }
]
```

---

### `GET /api/tickers/:symbol`

Returns latest ticker for a single symbol.

---

### `GET /api/klines/:symbol`

Fetches historical OHLCV candlestick series for a given token.

**URL Parameters:**

- `symbol` (required string): Token symbol (e.g. `SOL`).

**Query Parameters:**

- `interval` (optional enum: `15m` | `1h` | `4h` | `1d`, default `1h`).
- `from` (optional number): Start timestamp (epoch ms).
- `to` (optional number): End timestamp (epoch ms).
- `limit` (optional number, default `500`): Max candlestick bars.

**Response Schema (`200 OK`):**

```json
[
  {
    "open_time": 1723728000000,
    "open": 152.10,
    "high": 154.80,
    "low": 151.90,
    "close": 154.20,
    "volume": 45210.8,
    "quote_volume": 6971505.36,
    "taker_buy_vol": 22100.4,
    "taker_buy_quote_vol": 3407881.68
  }
]
```

---

### `GET /api/futures/:symbol`

Returns derivatives market data for the given token.

**URL Parameters:**

- `symbol` (required string): Token symbol (e.g. `BTC`).

**Query Parameters:**

- `type` (optional enum: `funding` | `oi` | `lsratio` | `liquidations`, default `funding`).
- `limit` (optional number, default `50`).

---

### `GET /api/orderbook/:symbol`

Returns order book depth (bids and asks).

**Query Parameters:**

- `limit` (optional number, default `50`).

---

### `GET /api/tokens`

Lists all 149 registered tokens across 50+ chains.

**Response Schema (`200 OK`):**

```json
[
  {
    "symbol": "SOL",
    "name": "Solana",
    "chain": "solana",
    "pair": "SOLUSDT",
    "id": "solana"
  }
]
```

---

## 2. Strategy Signals & Technical Indicators

### `GET /api/signals`

Retrieves algorithmic trading signals from the 4-strategy composite engine.

**Query Parameters:**

- `symbol` (optional string): Filter by symbol.
- `minScore` (optional number: 0–100): Minimum composite score.
- `direction` (optional enum: `buy` | `sell` | `neutral`).
- `limit` (optional number, default `200`).

**Response Schema (`200 OK`):**

```json
[
  {
    "symbol": "SOL",
    "chain": "solana",
    "price": 154.20,
    "direction": "buy",
    "compositeScore": 76.5,
    "confidence": 0.82,
    "momentumScore": 82.0,
    "meanReversionScore": 65.0,
    "trendFollowingScore": 78.5,
    "divergenceScore": 85.0,
    "adx": 28.5,
    "rsi": 62.4,
    "stopLoss": 145.96,
    "takeProfit": 170.68,
    "riskRewardRatio": 2.0
  }
]
```

---

### `GET /api/regime/:symbol`

Computes market regime classification (Trending, Ranging, High Volatility) using ADX, Bollinger Band width, and ATR%.

---

### `GET /api/fear-greed`

Returns Crypto Fear & Greed Index historical readings.

---

### `GET /api/cross-asset`

Returns cross-asset correlation and beta metrics (Crypto vs SPX, Gold, DXY).

---

## 3. Paper Trading Simulator API

### `GET /api/portfolio`

Returns current paper trading cash, active holdings, realized PnL, win rate, and trade counts.

**Query Parameters:**

- `profile` (optional string, default `trader1`).

**Response Schema (`200 OK`):**

```json
{
  "profile": "trader1",
  "cash": 85400.20,
  "holdings": [
    {
      "symbol": "SOL",
      "quantity": 15.2,
      "avgEntry": 150.00
    }
  ],
  "pnl": 5400.00,
  "winRate": 0.68,
  "totalTrades": 25,
  "startBalance": 100000
}
```

---

### `GET /api/portfolio/trades`

Returns list of paper trading transactions.

**Query Parameters:**

- `profile` (optional string, default `trader1`).
- `status` (optional enum: `open` | `closed`).

---

### `GET /api/portfolio/leaderboard`

Returns ranking of all active paper trading profiles sorted by total PnL.

---

### `POST /api/portfolio/trades`

Submits and executes a paper trade.

**Request Body:**

```json
{
  "symbol": "SOL",
  "side": "buy",
  "amount": 5.0,
  "profile": "trader1",
  "reason": "Bullish breakout above resistance"
}
```

**Response Schema (`200 OK`):**

```json
{
  "ok": true,
  "trade": {
    "id": "c1f7a8b2-4d3e-4b2a-9f1e-8a7b6c5d4e3f",
    "symbol": "SOL",
    "side": "buy",
    "quantity": 5.0,
    "entry_price": 154.20,
    "status": "open",
    "created_at": 1723731600000
  }
}
```

---

## 4. Machine Learning & Drift Detection

### `GET /api/ml/manifest`

Retrieves model registry metadata, active CatBoost/LightGBM versions, feature importances, and validation metrics.

### `POST /api/ml/predict`

Executes model batch inference for an array of feature vectors.

---

## 5. Cloud Scheduler Cron Ingestion Routes

Protected endpoints invoked by Google Cloud Scheduler:

| Endpoint | Schedule | Purpose |
| :--- | :--- | :--- |
| `POST /api/cron/scan` | `*/5 * * * *` | Ingests Binance tickers, calculates indicators, streams to BigQuery. |
| `POST /api/cron/signals` | `*/15 * * * *` | Generates 4-strategy composite signals and logs alert thresholds. |
| `POST /api/cron/news` | `*/30 * * * *` | Ingests 28 RSS feeds, performs sentiment analysis and deduplication. |
| `POST /api/cron/futures` | `0 * * * *` | Ingests funding rates, open interest, and liquidation statistics. |
| `POST /api/cron/fear-greed` | `0 0 * * *` | Ingests daily Fear & Greed index reading. |
| `POST /api/cron/cross-asset` | `0 0 * * *` | Ingests daily macro and cross-asset correlation benchmarks. |
| `POST /api/cron/retrain` | `0 0 * * *` | Triggers automated CatBoost/LightGBM model retraining and GCS sync. |
| `POST /api/cron/health` | `*/10 * * * *` | Runs deep database, memory, and service health checks. |

---

## 6. Matplotlib Visual Chart Endpoints

These endpoints generate institutional dark-themed financial visuals directly using **Matplotlib** and return binary PNG images (`image/png`) or base64 data URLs for frontend embedding.

### `GET /api/chart/:symbol`

Renders a 4-panel candlestick dashboard (Price + BB + EMAs, Volume, MACD, RSI).

**Query Parameters:**

- `interval` (optional enum: `15m` | `1h` | `4h` | `1d`, default `1h`).
- `limit` (optional number: 10–500, default `100`).
- `format` (optional enum: `png` | `base64`, default `png`).

---

### `GET /api/chart/frontier`

Renders the **Markowitz Efficient Frontier** Monte Carlo scatter plot, tangency portfolio marker, and optimal asset allocation donut chart.

**Query Parameters:**

- `symbols` (optional string): Comma-separated symbols (e.g. `BTC,ETH,SOL,AVAX`).
- `format` (optional enum: `png` | `base64`, default `png`).

---

### `GET /api/chart/correlation`

Renders the cross-asset return correlation heatmap matrix.

**Query Parameters:**

- `symbols` (optional string): Comma-separated symbols.
- `format` (optional enum: `png` | `base64`, default `png`).

---

### `GET /api/chart/portfolio`

Renders the paper trading account cumulative equity curve and underwater drawdown depth.

**Query Parameters:**

- `profile` (optional string, default `trader1`).
- `format` (optional enum: `png` | `base64`, default `png`).
