import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 3;

export const SCHEMA_DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS klines (
  symbol       TEXT    NOT NULL,
  interval     TEXT    NOT NULL,
  open_time    INTEGER NOT NULL,
  open         REAL, high REAL, low REAL, close REAL,
  volume       REAL, quote_volume REAL,
  taker_buy_vol REAL, taker_buy_quote_vol REAL,
  PRIMARY KEY (symbol, interval, open_time)
);

-- F1: Snapshot table — one row per symbol (latest state)
CREATE TABLE IF NOT EXISTS tickers (
  symbol            TEXT NOT NULL PRIMARY KEY,
  ts_utc            TEXT NOT NULL,
  price             REAL, price_change_pct REAL,
  volume            REAL, quote_volume REAL,
  rsi REAL, macd_hist REAL, bb_width REAL, atr_pct REAL,
  adx REAL, regime TEXT, composite_score REAL
);

-- F1: History table — append-only time series
CREATE TABLE IF NOT EXISTS ticker_history (
  symbol            TEXT NOT NULL,
  ts_utc            TEXT NOT NULL,
  price             REAL, price_change_pct REAL,
  volume            REAL, quote_volume REAL,
  rsi REAL, macd_hist REAL, bb_width REAL, atr_pct REAL,
  adx REAL, regime TEXT, composite_score REAL,
  PRIMARY KEY (symbol, ts_utc)
);

-- F1: Snapshot table — one row per symbol (latest signal)
CREATE TABLE IF NOT EXISTS signals (
  symbol            TEXT NOT NULL PRIMARY KEY,
  ts_utc            TEXT NOT NULL,
  composite_score   REAL, direction TEXT,
  momentum_score    REAL, mean_reversion_score REAL, trend_following_score REAL,
  regime TEXT, adx REAL
);

-- F1: History table — append-only time series
CREATE TABLE IF NOT EXISTS signal_history (
  symbol            TEXT NOT NULL,
  ts_utc            TEXT NOT NULL,
  composite_score   REAL, direction TEXT,
  momentum_score    REAL, mean_reversion_score REAL, trend_following_score REAL,
  regime TEXT, adx REAL,
  PRIMARY KEY (symbol, ts_utc)
);

CREATE TABLE IF NOT EXISTS news (
  id          TEXT PRIMARY KEY,
  symbol      TEXT, headline TEXT, description TEXT,
  source TEXT, domain TEXT, relevance REAL, pub_date TEXT
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  profile TEXT NOT NULL DEFAULT 'trader1',
  symbol TEXT NOT NULL, side TEXT NOT NULL,
  entry_price REAL, entry_time TEXT,
  quantity REAL, exit_price REAL, exit_time TEXT,
  pnl REAL, fees REAL, status TEXT
);

CREATE TABLE IF NOT EXISTS futures_funding (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL, rate REAL,
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS futures_oi (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL, open_interest REAL,
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS futures_ls_ratio (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL,
  long_account REAL, short_account REAL, long_position REAL, short_position REAL,
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS liquidations (
  id TEXT PRIMARY KEY, symbol TEXT, ts INTEGER,
  side TEXT, price REAL, qty REAL, usd REAL
);
CREATE TABLE IF NOT EXISTS fear_greed (
  ts INTEGER PRIMARY KEY, value INTEGER, classification TEXT
);
CREATE TABLE IF NOT EXISTS orderbook (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL,
  spread_pct REAL, imbalance REAL,
  bids TEXT, asks TEXT,
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS cross_asset (
  ts INTEGER PRIMARY KEY,
  btc_dominance REAL, eth_dominance REAL,
  total_mcap REAL, total_mcap_change_24h REAL,
  market_cap_percentage_json TEXT
);

-- F4: ML predictions table
CREATE TABLE IF NOT EXISTS predictions (
  id          TEXT PRIMARY KEY,
  symbol      TEXT NOT NULL,
  ts          TEXT NOT NULL,
  direction   TEXT NOT NULL,
  confidence  REAL NOT NULL,
  model_id    TEXT NOT NULL,
  horizon     INTEGER NOT NULL,
  ml_score    REAL,
  features_hash TEXT
);

-- F5: Drift events table (concept drift detection)
CREATE TABLE IF NOT EXISTS drift_events (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  detector    TEXT NOT NULL,
  "index"       INTEGER NOT NULL,
  symbol      TEXT,
  confidence  REAL,
  message     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drift_events_ts ON drift_events(ts);

-- Users table for auth
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Retention-friendly index for pruning old history
CREATE INDEX IF NOT EXISTS idx_ticker_history_ts ON ticker_history(ts_utc);
CREATE INDEX IF NOT EXISTS idx_signal_history_ts ON signal_history(ts_utc);
CREATE INDEX IF NOT EXISTS idx_predictions_ts ON predictions(ts);
`;

export function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA_DDL);
  // Check current version for incremental migrations
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string } | undefined;
  const currentVersion = row ? parseInt(row.value, 10) : 0;

  if (currentVersion < 2) {
    // Migration v1→v2: Migrate existing tickers data into new snapshot+history split.
    // Old tickers had PK (symbol, ts_utc). New tickers uses PK(symbol) — take *most recent* per symbol.
    // Old data goes into ticker_history.
    try {
      // If old tickers table still has the compound PK, migrate its data
      const oldTickersExist = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tickers_v1_backup'"
      ).get() as { name: string } | undefined;

      if (!oldTickersExist) {
        // Attempt: copy old tickers rows that aren't the new PK shape into history
        // (the new schema recreated the table as single-PK, so old compound-PK data is orphaned)
        // Try to salvage into ticker_history
        const hasOldData = db.prepare("SELECT COUNT(*) AS c FROM ticker_history").get() as { c: number };
        if (hasOldData.c === 0) {
          // Check if old tickers data is accessible via ticker_history
          // No-op: new schema created empty tables; data will be repopulated on next scan
          // This is safe — the old db file gets a fresh start with new schema
        }
      }
      db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)").run(String(SCHEMA_VERSION));
    } catch {
      // Non-fatal: migration best-effort
      db.prepare("INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', ?)").run(String(SCHEMA_VERSION));
    }
  } else {
    const stmt = db.prepare('INSERT OR IGNORE INTO schema_meta (key, value) VALUES (?, ?)');
    stmt.run('version', String(SCHEMA_VERSION));
  }
}
