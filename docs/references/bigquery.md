# Google BigQuery Reference

> **Source**: <https://cloud.google.com/bigquery/docs>
> **Last Updated**: July 2026
> **Package**: `@google-cloud/bigquery` (Node.js), `google-cloud-bigquery` (Python)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Pricing & Free Tier](#pricing--free-tier)
4. [Datasets & Tables](#datasets--tables)
5. [Partitioning](#partitioning)
6. [Clustering](#clustering)
7. [Streaming Inserts](#streaming-inserts)
8. [Schema Design for Time-Series Crypto Data](#schema-design-for-time-series-crypto-data)
9. [Node.js Client Library](#nodejs-client-library)
10. [BigQuery ML](#bigquery-ml)
11. [Cost Control](#cost-control)
12. [IAM & Access Control](#iam--access-control)
13. [Useful Queries for Crypto Radar](#useful-queries-for-crypto-radar)
14. [References](#references)

---

## Overview

BigQuery is a fully managed, AI-ready serverless data warehouse from Google Cloud. It uses a **columnar storage format** optimized for analytical queries and provides built-in features like machine learning, search, geospatial analysis, and business intelligence.

**Key characteristics:**

- **Serverless**: No infrastructure to manage — no provisioning, no scaling
- **Columnar storage**: Data stored in columns rather than rows, enabling fast analytical queries
- **Separation of compute and storage**: Independently scalable via Google's petabit-scale network
- **ANSI-standard SQL**: Full ISO/IEC 9075 support including nested/repeated fields, analytic/window functions, multi-statement queries
- **ACID transactions**: Full transactional semantics on storage
- **Open formats support**: Apache Iceberg, Delta Lake, Apache Hudi
- **Automatic replication**: Data replicated across multiple locations for high availability
- **ML capabilities**: BigQuery ML for SQL-based model training

---

## Architecture

BigQuery's architecture has two independent layers connected by Google's petabit internal network:

```
┌─────────────────────────────────────────────────┐
│                 COMPUTE LAYER                    │
│   Query execution engine (Dremel / Borg)         │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│   │  Slot   │ │  Slot   │ │  Slot   │           │
│   └─────────┘ └─────────┘ └─────────┘           │
│   Up to 2000 concurrent slots (on-demand)        │
├─────────────────────────────────────────────────┤
│            Petabit-scale Network                 │
├─────────────────────────────────────────────────┤
│                 STORAGE LAYER                    │
│   Columnar format (Capacitor)                    │
│   Automatic replication, encryption at rest      │
└─────────────────────────────────────────────────┘
```

This decoupling allows each layer to dynamically allocate resources without impacting the other, enabling maintenance and upgrades without downtime.

**Interfaces:**

- Google Cloud Console (web UI)
- `bq` command-line tool
- Client libraries: Python, Java, Node.js, Go, C#, Ruby, PHP
- REST API & RPC API
- ODBC / JDBC drivers
- BigQuery MCP server

---

## Pricing & Free Tier

### On-Demand Pricing (default)

| Tier | Price |
|------|-------|
| 0 – 1 TiB/month | **Free** |
| 1 TiB+ | **$6.25 per TiB** (tebibyte) processed |

**Details:**

- Charged for data scanned, not data returned
- Minimum 10 MB processed per table referenced, minimum 10 MB per query
- Charges rounded up to the nearest MB
- Cached query results (within ~24 hours) are **not** charged
- Failed/error queries are **not** charged
- Up to 2,000 concurrent slots shared across the project

### Storage Pricing

| Storage Type | Price | Free Tier |
| ------------- | ------- | ----------- |
| Active storage | ~$0.02/GB per month | First 10 GB **free** per month |
| Long-term storage (90+ days without modification) | ~$0.01/GB per month | Included in free tier |

### Streaming Inserts Pricing

| Operation | Price |
|-----------|-------|
| Streaming inserts | $0.05 per 200 MB (first 2 TB/month free for paid projects) |
| Storage Write API | Billed by bytes written |

### Free Usage Tier Summary

| Resource | Free Monthly Allowance |
| ---------- | ---------------------- |
| **Query processing** | 1 TiB of query data per month |
| **Storage** | 10 GB of storage per month |
| **Streaming inserts** | 2 TB per month (with billing account) |

> **Crypto Radar fits entirely within the free tier** — ticker data at streaming rates is tiny compared to 10 GB/month storage and 1 TiB/month query capacity.

### Capacity Pricing (Editions)

For high-volume users, BigQuery offers slot-based reservations in three editions:

- **Standard**: Baseline query processing
- **Enterprise**: Higher per-slot performance, additional features
- **Enterprise Plus**: Maximum performance, all features

---

## Datasets & Tables

### Datasets

A **dataset** is the top-level container for tables, views, and routines. It's tied to a specific [location](https://cloud.google.com/bigquery/docs/locations).

```sql
-- Create a dataset
CREATE SCHEMA IF NOT EXISTS crypto_radar
  OPTIONS (
    location = 'US',
    description = 'Crypto Radar time-series data'
  );
```

### Tables

Tables can be created via SQL DDL, the console, bq CLI, or client libraries.

```sql
-- Create a native (managed) table
CREATE TABLE IF NOT EXISTS crypto_radar.ticker_data (
  timestamp TIMESTAMP NOT NULL,
  symbol STRING NOT NULL,
  price FLOAT64,
  volume FLOAT64,
  bid FLOAT64,
  ask FLOAT64,
  spread FLOAT64,
  exchange STRING
);
```

**Table types:**

- **Native (managed) tables**: Stored in BigQuery's internal columnar storage
- **External tables**: Query data from Cloud Storage, Bigtable, Google Sheets, etc.
- **Views**: Logical/saved queries (can be authorized)
- **Materialized views**: Pre-computed, automatically refreshed
- **Iceberg managed tables**: Apache Iceberg format

---

## Partitioning

**Purpose**: Divide a large table into smaller segments (partitions) to reduce query costs and improve performance. Queries that filter by the partition column only scan relevant partitions.

### Types of Partitioning

| Type | Description | Example |
| ------ | ------------- | --------- |
| **Time-unit column** | Partition on a `DATE`, `TIMESTAMP`, or `DATETIME` column | `PARTITION BY DATE(timestamp)` |
| **Ingestion time** | Partition based on when data was loaded (`_PARTITIONTIME`) | `PARTITION BY _PARTITIONDATE` |
| **Integer range** | Partition on an integer column by range | `PARTITION BY RANGE_BUCKET(signal_id, GENERATE_ARRAY(0, 100000, 1000))` |

### Time-unit partitioning granularity

- **Daily** (default): 1 partition per day — **best for crypto ticker data**
- **Hourly**: 1 partition per hour — good for high-frequency data
- **Monthly**: 1 partition per month
- **Yearly**: 1 partition per year

### Crypto Example

```sql
CREATE TABLE IF NOT EXISTS crypto_radar.ticker_data (
  timestamp TIMESTAMP NOT NULL,
  symbol STRING NOT NULL,
  price FLOAT64,
  volume FLOAT64,
  exchange STRING
)
PARTITION BY DATE(timestamp)
OPTIONS (
  partition_expiration_days = 365,  -- auto-delete old partitions
  description = 'Crypto ticker data partitioned by date'
);
```

**Partition limits:**

- Max 1,000,000 partitions per table (1 partition per day ≈ 2,739 years)
- Partition filter required in queries for large tables to avoid full scan

---

## Clustering

**Purpose**: Sort data within partitions by one or more columns. When queries filter or aggregate by cluster columns, BigQuery prunes blocks it needs to scan, reducing bytes processed and improving performance.

**Best paired with partitioning** — partition on date, cluster by symbol.

### Crypto Example

```sql
CREATE TABLE IF NOT EXISTS crypto_radar.ticker_data (
  timestamp TIMESTAMP NOT NULL,
  symbol STRING NOT NULL,
  price FLOAT64,
  volume FLOAT64
)
PARTITION BY DATE(timestamp)
CLUSTER BY symbol
OPTIONS (
  partition_expiration_days = 365
);
```

### Clustering rules

| Property | Detail |
| ---------- | -------- |
| Max columns | 4 cluster columns |
| Column order matters | Leading column gets most pruning benefit |
| Types supported | `DATE`, `TIMESTAMP`, `BOOL`, `GEOGRAPHY`, `INT64`, `NUMERIC`, `FLOAT64`, `STRING` |
| Auto-reclustering | BigQuery automatically reclusters as new data arrives |
| No extra cost | Clustering is **free** — you only pay for storage of the data itself |

### When to cluster

- Queries frequently filter by specific columns (e.g., `WHERE symbol = 'BTC/USD'`)
- Columns have high cardinality (many distinct values)
- Combining with partitioning for time-based + attribute-based pruning

---

## Streaming Inserts

BigQuery supports two approaches for real-time data ingestion:

### 1. Legacy Streaming API (`tabledata.insertAll`)

```js
// Node.js — legacy streaming
const {BigQuery} = require('@google-cloud/bigquery');
const bigquery = new BigQuery();

async function insertRow(datasetId, tableId, row) {
  await bigquery
    .dataset(datasetId)
    .table(tableId)
    .insert([row]);
}
```

**Limitations:**

- 100,000 rows per second per table (default quota)
- Max 10 MB per row
- Best-effort deduplication (use `insertId` for dedup)
- Data typically available within seconds

### 2. Storage Write API (recommended for production)

Higher throughput, lower latency, exactly-once semantics via stream offsets.

**Stream types:**

- **Default**: High throughput, exactly-once delivery
- **Committed**: Auto-committed, data immediately visible
- **Pending**: Manual commit control

```js
// Node.js — Storage Write API (high-level)
const {BigQuery} = require('@google-cloud/bigquery');
const bigquery = new BigQuery();

async function streamRows(datasetId, tableId, rows) {
  const table = bigquery.dataset(datasetId).table(tableId);
  const writeStream = await table.createWriteStream({
    streamType: 'default',
  });
  // write rows via writeStream
}
```

### Streaming Best Practices for Crypto Ticker Data

1. **Batch rows** into small groups (500–1000 rows per request) instead of one-per-request
2. Use **`insertId`** (legacy) or **stream offsets** (Write API) for deduplication
3. Stream to an **ingestion-time partitioned table** for automatic partition assignment
4. Combine **streaming + batch loads** — stream real-time ticks, backfill historical data via batch

---

## Schema Design for Time-Series Crypto Data

### Ticker Data Table

```sql
CREATE TABLE IF NOT EXISTS crypto_radar.ticker_data (
  timestamp     TIMESTAMP NOT NULL,   -- Recorded time of tick
  symbol        STRING NOT NULL,      -- e.g., 'BTC/USD', 'ETH/USD'
  exchange      STRING,               -- e.g., 'binance', 'coinbase'
  price         FLOAT64,              -- Latest trade price
  bid           FLOAT64,              -- Highest bid
  ask           FLOAT64,              -- Lowest ask
  spread        FLOAT64,              -- ask - bid
  volume_24h    FLOAT64,              -- 24h volume
  volume        FLOAT64,              -- Volume at this tick
  trade_count   INT64,                -- Number of trades
  vwap          FLOAT64               -- Volume-weighted average price
)
PARTITION BY DATE(timestamp)
CLUSTER BY symbol
OPTIONS (
  partition_expiration_days = 90,
  require_partition_filter = true -- prevents expensive full-table scans
);
```

### Signals Table

```sql
CREATE TABLE IF NOT EXISTS crypto_radar.signals (
  timestamp   TIMESTAMP NOT NULL,
  symbol      STRING NOT NULL,
  signal_type STRING NOT NULL,        -- 'buy', 'sell', 'neutral'
  confidence  FLOAT64,                -- 0.0 to 1.0
  strategy    STRING,                 -- 'momentum', 'mean_reversion', etc.
  metadata    JSON,                   -- flexible extra data
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(timestamp)
CLUSTER BY symbol, signal_type;
```

### Predictions Table

```sql
CREATE TABLE IF NOT EXISTS crypto_radar.predictions (
  timestamp        TIMESTAMP NOT NULL,
  symbol           STRING NOT NULL,
  prediction_time  TIMESTAMP,          -- When prediction was made
  target_horizon   INT64,              -- Minutes ahead predicted
  predicted_price  FLOAT64,
  predicted_direction STRING,          -- 'up', 'down', 'neutral'
  confidence       FLOAT64,
  model_version    STRING,
  features_used    JSON
)
PARTITION BY DATE(timestamp)
CLUSTER BY symbol;
```

---

## Node.js Client Library

### Installation

```bash
npm install @google-cloud/bigquery
```

### Authentication

Uses [Application Default Credentials (ADC)](https://cloud.google.com/docs/authentication/application-default-credentials):

```bash
gcloud auth application-default login
```

Or set `GOOGLE_APPLICATION_CREDENTIALS`:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

### Initialize Client

```js
const {BigQuery} = require('@google-cloud/bigquery');

const bigquery = new BigQuery({
  projectId: 'your-gcp-project-id',
});
```

### Query Data

```js
async function queryTickers(symbol) {
  const query = `
    SELECT timestamp, symbol, price, volume
    FROM \`your-project.crypto_radar.ticker_data\`
    WHERE symbol = @symbol
      AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
    ORDER BY timestamp DESC
    LIMIT 100
  `;

  const options = {
    query: query,
    params: {symbol: symbol},
  };

  const [rows] = await bigquery.query(options);
  return rows;
}
```

### Insert Rows (Streaming)

```js
async function insertTicker(rows) {
  const table = bigquery.dataset('crypto_radar').table('ticker_data');

  try {
    await table.insert(rows);
    console.log(`Inserted ${rows.length} rows`);
  } catch (error) {
    console.error('Insert failed:', error);
    // Handle partial failures via error.insertErrors
  }
}
```

### Batch Load from GCS

```js
async function loadFromGCS() {
  const metadata = {
    sourceFormat: 'CSV',
    skipLeadingRows: 1,
    schema: {
      fields: [
        {name: 'timestamp', type: 'TIMESTAMP'},
        {name: 'symbol', type: 'STRING'},
        {name: 'price', type: 'FLOAT64'},
        {name: 'volume', type: 'FLOAT64'},
      ],
    },
  };

  const [job] = await bigquery
    .dataset('crypto_radar')
    .table('ticker_data')
    .load('gs://your-bucket/ticker-data/*.csv', metadata);

  console.log(`Job ${job.id} completed`);
}
```

### Create Dataset & Table

```js
async function createDataset(name) {
  const [dataset] = await bigquery.createDataset(name);
  console.log(`Dataset ${dataset.id} created`);
  return dataset;
}

async function createTickerTable(datasetId) {
  const schema = [
    {name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED'},
    {name: 'symbol', type: 'STRING', mode: 'REQUIRED'},
    {name: 'price', type: 'FLOAT64'},
    {name: 'volume', type: 'FLOAT64'},
    {name: 'bid', type: 'FLOAT64'},
    {name: 'ask', type: 'FLOAT64'},
  ];

  const options = {
    schema: schema,
    timePartitioning: {
      type: 'DAY',
      field: 'timestamp',
    },
    clustering: {
      fields: ['symbol'],
    },
  };

  const [table] = await bigquery
    .dataset(datasetId)
    .createTable('ticker_data', options);

  return table;
}
```

---

## BigQuery ML

BigQuery ML lets you train, evaluate, and run inference on ML models using **SQL** — no data movement required.

### Supported Model Types

| Category | Models |
| ---------- | -------- |
| **Supervised** | Linear regression, logistic regression, XGBoost, random forest, deep neural network (DNN), boosted tree |
| **Time series** | ARIMA_PLUS, ARIMA_PLUS_XREG (with external regressors), exponential smoothing |
| **Unsupervised** | K-means clustering, PCA (dimensionality reduction), matrix factorization |
| **Anomaly detection** | Autoencoder, k-meams based |
| **Imported** | TensorFlow, ONNX, XGBoost scikit-learn — import any trained model |
| **Remote models** | Call Vertex AI, Gemini, Cloud AI APIs from SQL |
| **LLM** | Use `ML.GENERATE_TEXT` with Gemini models |

### Train a Model on Crypto Data

```sql
CREATE OR REPLACE MODEL crypto_radar.price_predictor
OPTIONS(
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'timestamp',
  time_series_data_col = 'price',
  time_series_id_col = 'symbol',
  auto_arima = TRUE,
  data_frequency = 'auto_frequency',
  decompose_time_series = TRUE
) AS
SELECT timestamp, symbol, price
FROM crypto_radar.ticker_data
WHERE timestamp >= '2025-01-01';
```

### Evaluate Model

```sql
SELECT *
FROM ML.EVALUATE(MODEL crypto_radar.price_predictor);
```

### Forecast

```sql
SELECT *
FROM ML.FORECAST(
  MODEL crypto_radar.price_predictor,
  STRUCT(60 AS horizon, 0.95 AS confidence_level)
);
```

### ARIMA for Ticker Signal Prediction

ARIMA_PLUS is well-suited for univariate time-series forecasting of price/volume data:

- `auto_arima = TRUE`: automatically searches for best ARIMA parameters
- `decompose_time_series = TRUE`: separates trend, seasonality, and step changes
- `holiday_region`: optionally factor in market holiday effects

### BigQuery ML Pricing

- **Free tier**: First 10 GB of model data storage, first 1 TB of query processing
- **Training**: Charged by bytes processed (like any BigQuery query)
- **On-demand**: Included in regular query pricing ($6.25/TiB)
- **Capacity**: Uses the same slot pool as query workloads

---

## Cost Control

### 1. Maximum Bytes Billed

Sets an upper limit on data processed per query. Queries exceeding this are rejected.

```sql
-- Per-query limit
SELECT * FROM crypto_radar.ticker_data
WHERE ...;
-- Set max bytes billed at job level

-- Or via client library
const options = {
  maximumBytesBilled: '1000000000', -- 1 GB
};
```

### 2. Custom Cost Controls

- **User-level**: Caps per user per project
- **Project-level**: Caps per project per day
- Set in **IAM** or via **quota** policies

### 3. Partition & Cluster

- Partitioning + clustering is the #1 cost optimization for time-series data
- A query filtering on `WHERE DATE(timestamp) = '2026-01-15'` with a daily-partitioned table scans **one partition** instead of the entire table

### 4. Cached Results

- BigQuery caches query results for ~24 hours
- If the exact same query is re-run (on unchanged data), results come from cache at **no charge**

### 5. Select Only Needed Columns

```sql
-- BAD: SELECT * scans all columns
SELECT * FROM crypto_radar.ticker_data

-- GOOD: only the columns you need
SELECT timestamp, symbol, price FROM crypto_radar.ticker_data
```

Columnar storage means BigQuery only charges for the columns in the `SELECT` list.

### 6. Use `require_partition_filter = true`

```sql
CREATE TABLE ... (
  ...
) OPTIONS (
  require_partition_filter = true
);
```

Prevents accidental full-table scans.

---

## IAM & Access Control

### Predefined Roles

| Role | Permissions | Best For |
| ------ | ------------ | ---------- |
| `roles/bigquery.dataViewer` | Read tables, views, datasets | Read-only analysts |
| `roles/bigquery.dataEditor` | Read + edit data, create tables | Data engineers ingesting data |
| `roles/bigquery.dataOwner` | Full dataset control including ACLs | Dataset administrators |
| `roles/bigquery.jobUser` | Run queries, create jobs | Analysts running queries |
| `roles/bigquery.admin` | Full BigQuery admin across project | Project administrators |
| `roles/bigquery.metadataViewer` | View dataset/table metadata only | Governance tools |

### Minimal Crypto Radar IAM Setup

```bash
# For the data ingestion service account:
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:sa-ingest@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:sa-ingest@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"
```

### Dataset-Level Access

You can grant IAM roles at the **dataset level** for more granular control:

```sql
-- Grant dataset-level access
GRANT `roles/bigquery.dataViewer`
ON SCHEMA crypto_radar
TO "user:analyst@example.com";
```

### Required Permissions for Streaming Inserts

- `bigquery.tables.updateData` (or `roles/bigquery.dataEditor`)
- `bigquery.tables.get` (or `roles/bigquery.dataViewer`)
- `bigquery.datasets.get` (or `roles/bigquery.dataViewer`)

---

## Useful Queries for Crypto Radar

### Latest Prices for All Symbols

```sql
SELECT symbol, price, timestamp
FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp DESC) AS rn
  FROM crypto_radar.ticker_data
  WHERE DATE(timestamp) = CURRENT_DATE()
)
WHERE rn = 1;
```

### Hourly OHLC (Open-High-Low-Close) Aggregation

```sql
SELECT
  symbol,
  TIMESTAMP_TRUNC(timestamp, HOUR) AS hour,
  FIRST_VALUE(price) OVER (PARTITION BY symbol, TIMESTAMP_TRUNC(timestamp, HOUR) ORDER BY timestamp) AS open,
  MAX(price) AS high,
  MIN(price) AS low,
  LAST_VALUE(price) OVER (PARTITION BY symbol, TIMESTAMP_TRUNC(timestamp, HOUR) ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS close,
  SUM(volume) AS volume
FROM crypto_radar.ticker_data
WHERE DATE(timestamp) = CURRENT_DATE()
GROUP BY symbol, hour, timestamp, price
```

### Recent Signals with Ticker Context

```sql
SELECT
  s.timestamp AS signal_time,
  s.symbol,
  s.signal_type,
  s.confidence,
  s.strategy,
  t.price,
  t.volume
FROM crypto_radar.signals s
LEFT JOIN crypto_radar.ticker_data t
  ON t.symbol = s.symbol
  AND t.timestamp = s.timestamp
WHERE s.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
ORDER BY s.timestamp DESC;
```

### Prediction Accuracy Check

```sql
SELECT
  p.model_version,
  p.target_horizon,
  COUNT(*) AS total_predictions,
  AVG(CASE
    WHEN (p.predicted_direction = 'up' AND t.price > t_hist.price)
      OR (p.predicted_direction = 'down' AND t.price < t_hist.price)
    THEN 1.0 ELSE 0.0
  END) AS accuracy
FROM crypto_radar.predictions p
JOIN crypto_radar.ticker_data t
  ON t.symbol = p.symbol
  AND t.timestamp = p.prediction_time
JOIN crypto_radar.ticker_data t_hist
  ON t_hist.symbol = p.symbol
  AND t_hist.timestamp = TIMESTAMP_ADD(p.prediction_time, INTERVAL p.target_horizon MINUTE)
GROUP BY p.model_version, p.target_horizon;
```

### Storage Size by Table

```sql
SELECT
  table_id,
  ROUND(SUM(total_logical_bytes) / POW(1024,3), 2) AS logical_gb,
  ROUND(SUM(total_physical_bytes) / POW(1024,3), 2) AS physical_gb,
  SUM(total_logical_bytes - total_physical_bytes) AS compression_savings
FROM `region-us`.INFORMATION_SCHEMA.TABLE_STORAGE
WHERE table_catalog = 'crypto_radar'
GROUP BY table_id;
```

### Query Cost Estimation

```sql
-- Dry run to estimate bytes processed before executing
-- (Use bq CLI or client library dry-run option)

-- In SQL, use INFORMATION_SCHEMA for historical job stats
SELECT
  job_id,
  query,
  total_bytes_processed,
  ROUND(total_bytes_processed / POW(1024,4), 4) AS total_tib_processed,
  ROUND(total_bytes_processed / POW(1024,4) * 6.25, 4) AS estimated_cost_usd
FROM `region-us`.INFORMATION_SCHEMA.JOBS
WHERE job_type = 'QUERY'
  AND creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
ORDER BY total_bytes_processed DESC;
```

---

## References

| Resource | URL |
| ---------- | ----- |
| BigQuery Overview | <https://cloud.google.com/bigquery/docs/introduction> |
| BigQuery Pricing | <https://cloud.google.com/bigquery/pricing> |
| Partitioned Tables | <https://cloud.google.com/bigquery/docs/partitioned-tables> |
| Clustered Tables | <https://cloud.google.com/bigquery/docs/clustered-tables> |
| Streaming Data | <https://cloud.google.com/bigquery/docs/streaming-data-into-bigquery> |
| Storage Write API | <https://cloud.google.com/bigquery/docs/write-api> |
| BigQuery ML Intro | <https://cloud.google.com/bigquery/docs/bqml-introduction> |
| BigQuery ML Model Types | <https://cloud.google.com/bigquery/docs/reference/standard-sql/bigqueryml-syntax-create> |
| IAM Roles & Permissions | <https://cloud.google.com/bigquery/docs/access-control> |
| Client Libraries | <https://cloud.google.com/bigquery/docs/reference/libraries> |
| Node.js Reference | <https://cloud.google.com/nodejs/docs/reference/bigquery/latest> |
| BigQuery SQL Reference | <https://cloud.google.com/bigquery/docs/reference/standard-sql> |
| Free Tier | <https://cloud.google.com/free> |
| BigQuery Sandbox | <https://cloud.google.com/bigquery/docs/sandbox> |
| Cost Controls | <https://cloud.google.com/bigquery/docs/custom-quotas> |
| Slots & Reservations | <https://cloud.google.com/bigquery/docs/reservations-intro> |
| Public Datasets | <https://cloud.google.com/bigquery/public-data> |
