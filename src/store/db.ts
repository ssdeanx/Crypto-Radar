import { DatabaseSync } from "node:sqlite";
import type { StatementSync, SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { BigQuery } from "@google-cloud/bigquery";
import { SCHEMA_DDL } from "./schema.js";
import { DataError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import { isCloudMode } from "../core/config.js";
import { getGlobalCache } from "../core/cache.js";
import type {
  KlineRow,
  TickerRow,
  SignalRow,
  NewsRow,
  PaperTradeRow,
  UserRow,
  FundingRow,
  OIRow,
  LsRatioRow,
  LiquidationRow,
  FearGreedRow,
  OrderBookRow,
  CrossAssetRow,
  PredictionRow,
} from "../types.js";
import type { EnrichedTicker, NewsMatch, TokenSignal, TokenTraceRow, TaskPayload } from "../types.js";

const log = logger.child({ module: "store" });

type Stmt = StatementSync;

// BigQuery Table Schemas
interface BQSchemaField {
  name: string;
  type: string;
  mode?: string;
}

const BQ_SCHEMAS: Record<string, BQSchemaField[]> = {
  klines: [
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "interval", type: "STRING", mode: "REQUIRED" },
    { name: "open_time", type: "INTEGER", mode: "REQUIRED" },
    { name: "open", type: "FLOAT" },
    { name: "high", type: "FLOAT" },
    { name: "low", type: "FLOAT" },
    { name: "close", type: "FLOAT" },
    { name: "volume", type: "FLOAT" },
    { name: "quote_volume", type: "FLOAT" },
    { name: "taker_buy_vol", type: "FLOAT" },
    { name: "taker_buy_quote_vol", type: "FLOAT" },
  ],
  ticker_history: [
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "ts_utc", type: "STRING", mode: "REQUIRED" },
    { name: "price", type: "FLOAT" },
    { name: "price_change_pct", type: "FLOAT" },
    { name: "volume", type: "FLOAT" },
    { name: "quote_volume", type: "FLOAT" },
    { name: "rsi", type: "FLOAT" },
    { name: "macd_hist", type: "FLOAT" },
    { name: "bb_width", type: "FLOAT" },
    { name: "atr_pct", type: "FLOAT" },
    { name: "adx", type: "FLOAT" },
    { name: "regime", type: "STRING" },
    { name: "composite_score", type: "FLOAT" },
  ],
  signal_history: [
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "ts_utc", type: "STRING", mode: "REQUIRED" },
    { name: "composite_score", type: "FLOAT" },
    { name: "direction", type: "STRING" },
    { name: "momentum_score", type: "FLOAT" },
    { name: "mean_reversion_score", type: "FLOAT" },
    { name: "trend_following_score", type: "FLOAT" },
    { name: "regime", type: "STRING" },
    { name: "adx", type: "FLOAT" },
  ],
  news: [
    { name: "id", type: "STRING", mode: "REQUIRED" },
    { name: "symbol", type: "STRING" },
    { name: "headline", type: "STRING" },
    { name: "description", type: "STRING" },
    { name: "source", type: "STRING" },
    { name: "domain", type: "STRING" },
    { name: "relevance", type: "FLOAT" },
    { name: "pub_date", type: "STRING" },
  ],
  paper_trades: [
    { name: "id", type: "STRING", mode: "REQUIRED" },
    { name: "profile", type: "STRING", mode: "REQUIRED" },
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "side", type: "STRING", mode: "REQUIRED" },
    { name: "entry_price", type: "FLOAT" },
    { name: "entry_time", type: "STRING" },
    { name: "quantity", type: "FLOAT" },
    { name: "exit_price", type: "FLOAT" },
    { name: "exit_time", type: "STRING" },
    { name: "pnl", type: "FLOAT" },
    { name: "fees", type: "FLOAT" },
    { name: "status", type: "STRING" },
  ],
  futures_funding: [
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "ts", type: "INTEGER", mode: "REQUIRED" },
    { name: "rate", type: "FLOAT" },
  ],
  futures_oi: [
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "ts", type: "INTEGER", mode: "REQUIRED" },
    { name: "open_interest", type: "FLOAT" },
  ],
  futures_ls_ratio: [
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "ts", type: "INTEGER", mode: "REQUIRED" },
    { name: "long_account", type: "FLOAT" },
    { name: "short_account", type: "FLOAT" },
    { name: "long_position", type: "FLOAT" },
    { name: "short_position", type: "FLOAT" },
  ],
  liquidations: [
    { name: "id", type: "STRING", mode: "REQUIRED" },
    { name: "symbol", type: "STRING" },
    { name: "ts", type: "INTEGER" },
    { name: "side", type: "STRING" },
    { name: "price", type: "FLOAT" },
    { name: "qty", type: "FLOAT" },
    { name: "usd", type: "FLOAT" },
  ],
  fear_greed: [
    { name: "ts", type: "INTEGER", mode: "REQUIRED" },
    { name: "value", type: "INTEGER" },
    { name: "classification", type: "STRING" },
  ],
  orderbook: [
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "ts", type: "INTEGER", mode: "REQUIRED" },
    { name: "spread_pct", type: "FLOAT" },
    { name: "imbalance", type: "FLOAT" },
    { name: "bids", type: "STRING" },
    { name: "asks", type: "STRING" },
  ],
  cross_asset: [
    { name: "ts", type: "INTEGER", mode: "REQUIRED" },
    { name: "btc_dominance", type: "FLOAT" },
    { name: "eth_dominance", type: "FLOAT" },
    { name: "total_mcap", type: "FLOAT" },
    { name: "total_mcap_change_24h", type: "FLOAT" },
    { name: "market_cap_percentage_json", type: "STRING" },
  ],
  predictions: [
    { name: "id", type: "STRING", mode: "REQUIRED" },
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "ts", type: "STRING", mode: "REQUIRED" },
    { name: "direction", type: "STRING", mode: "REQUIRED" },
    { name: "confidence", type: "FLOAT", mode: "REQUIRED" },
    { name: "model_id", type: "STRING", mode: "REQUIRED" },
    { name: "horizon", type: "INTEGER", mode: "REQUIRED" },
    { name: "ml_score", type: "FLOAT" },
    { name: "features_hash", type: "STRING" },
    { name: "reasoning", type: "STRING" },
    { name: "outcome", type: "FLOAT" },
    { name: "outcome_classification", type: "STRING" },
  ],
  drift_events: [
    { name: "id", type: "STRING", mode: "REQUIRED" },
    { name: "ts", type: "STRING", mode: "REQUIRED" },
    { name: "model_id", type: "STRING", mode: "REQUIRED" },
    { name: "detector", type: "STRING", mode: "REQUIRED" },
    { name: "index", type: "INTEGER", mode: "REQUIRED" },
    { name: "symbol", type: "STRING" },
    { name: "confidence", type: "FLOAT" },
    { name: "message", type: "STRING", mode: "REQUIRED" },
  ],
  users: [
    { name: "id", type: "STRING", mode: "REQUIRED" },
    { name: "email", type: "STRING", mode: "REQUIRED" },
    { name: "password_hash", type: "STRING", mode: "REQUIRED" },
    { name: "name", type: "STRING" },
    { name: "role", type: "STRING" },
    { name: "created_at", type: "STRING" },
    { name: "updated_at", type: "STRING" },
  ],
  token_traces: [
    { name: "trace_id", type: "STRING", mode: "REQUIRED" },
    { name: "run_id", type: "STRING", mode: "REQUIRED" },
    { name: "symbol", type: "STRING", mode: "REQUIRED" },
    { name: "token_id", type: "STRING", mode: "REQUIRED" },
    { name: "observed_at", type: "STRING", mode: "REQUIRED" },
    { name: "outcome_at", type: "STRING" },
    { name: "last_price", type: "FLOAT" },
    { name: "price_change_pct", type: "FLOAT" },
    { name: "volume", type: "FLOAT" },
    { name: "spread_pct", type: "FLOAT" },
    { name: "market_cap", type: "FLOAT" },
    { name: "composite_score", type: "FLOAT" },
    { name: "direction", type: "STRING" },
    { name: "regime", type: "STRING" },
    { name: "rsi", type: "FLOAT" },
    { name: "macd_histogram", type: "FLOAT" },
    { name: "bb_width", type: "FLOAT" },
    { name: "atr_pct", type: "FLOAT" },
    { name: "adx", type: "FLOAT" },
    { name: "analysis_text", type: "STRING" },
    { name: "prediction_direction", type: "STRING" },
    { name: "prediction_confidence", type: "FLOAT" },
    { name: "gemini_raw", type: "STRING" },
    { name: "needs_analysis", type: "INTEGER" },
    { name: "analyzed_at", type: "STRING" },
    { name: "outcome_price", type: "FLOAT" },
    { name: "outcome_change_pct", type: "FLOAT" },
    { name: "outcome_high", type: "FLOAT" },
    { name: "outcome_low", type: "FLOAT" },
    { name: "outcome_volume", type: "FLOAT" },
    { name: "outcome_is_rugpull", type: "INTEGER" },
    { name: "outcome_pnl_pct", type: "FLOAT" },
    { name: "outcome_classification", type: "STRING" },
    { name: "outcome_evaluated", type: "INTEGER" },
    { name: "outcome_evaluated_at", type: "STRING" },
    { name: "created_at", type: "STRING", mode: "REQUIRED" },
    { name: "updated_at", type: "STRING", mode: "REQUIRED" },
  ],
  schema_meta: [
    { name: "key", type: "STRING", mode: "REQUIRED" },
    { name: "value", type: "STRING" },
  ],
};

export class Store {
  private db: DatabaseSync | null = null;
  private dbPath: string = "";
  private stmts = new Map<string, Stmt>();
  private bq: BigQuery | null = null;
  private projectId: string = "";
  private datasetId: string = "";

  constructor(opts: { path: string; createIfMissing?: boolean }) {
    const isTest = process.env.NODE_ENV === "test";
    const useBq = !isTest && (!!process.env.BIGQUERY_PROJECT_ID || !!process.env.K_SERVICE || !!process.env.GOOGLE_APPLICATION_CREDENTIALS);

    if (useBq) {
      this.projectId = process.env.BIGQUERY_PROJECT_ID ?? "project-513b86da-a04a-494a-8e9";
      this.datasetId = process.env.BIGQUERY_DATASET ?? "crypto_radar";
      log.info(`Initializing BigQuery store for project=${this.projectId}, dataset=${this.datasetId}`);
      this.bq = new BigQuery({ projectId: this.projectId });
    } else {
      const dbPath = resolve(opts.path);
      this.dbPath = dbPath;
      log.info(`Initializing SQLite store at=${dbPath}`);
      if (!existsSync(dbPath) && opts.createIfMissing === false) {
        throw new DataError("store", `Database not found at ${dbPath}`);
      }
      const dir = dirname(dbPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this.db = new DatabaseSync(dbPath);
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.exec("PRAGMA busy_timeout = 5000");
    }
  }

  async syncFromBucket(): Promise<void> {
    const bucketName = process.env['RADAR__STORAGE_BUCKET'];
    if (!bucketName || !this.dbPath) return;
    try {
      const { Storage } = await import('@google-cloud/storage');
      const storage = new Storage();
      const bucket = storage.bucket(bucketName);
      const file = bucket.file('crypto-radar.db');
      const [exists] = await file.exists();
      if (exists) {
        log.info(`Downloading SQLite database from GCS bucket ${bucketName}...`);
        if (this.db) {
          this.stmts.clear();
          this.db = null;
        }
        await file.download({ destination: this.dbPath });
        log.info(`Successfully downloaded database to ${this.dbPath}`);
        this.db = new DatabaseSync(this.dbPath);
        this.db.exec("PRAGMA journal_mode = WAL");
        this.db.exec("PRAGMA foreign_keys = ON");
        this.db.exec("PRAGMA busy_timeout = 5000");
      }
    } catch (err) {
      log.error('Failed to sync database from GCS bucket', { error: String(err) });
    }
  }

  async syncToBucket(): Promise<void> {
    const bucketName = process.env['RADAR__STORAGE_BUCKET'];
    if (!bucketName || !this.dbPath) return;
    try {
      const { Storage } = await import('@google-cloud/storage');
      const storage = new Storage();
      const bucket = storage.bucket(bucketName);
      log.info(`Uploading SQLite database to GCS bucket ${bucketName}...`);
      await bucket.upload(this.dbPath, {
        destination: 'crypto-radar.db',
        metadata: {
          cacheControl: 'no-cache',
        },
      });
      log.info('Successfully uploaded database to GCS bucket');
    } catch (err) {
      log.error('Failed to sync database to GCS bucket', { error: String(err) });
    }
  }

  async syncModelsFromBucket(): Promise<void> {
    const bucketName = process.env['RADAR__STORAGE_BUCKET'];
    if (!bucketName) return;
    try {
      const { Storage } = await import('@google-cloud/storage');
      const storage = new Storage();
      const bucket = storage.bucket(bucketName);
      
      const [files] = await bucket.getFiles({ prefix: 'ml/' });
      log.info(`Syncing ${files.length} ML files from GCS bucket ${bucketName}...`);
      
      const dataDir = dirname(this.dbPath || 'data');
      for (const file of files) {
        const destPath = resolve(dataDir, file.name);
        const destDir = dirname(destPath);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        
        log.info(`Downloading GCS file ${file.name} to ${destPath}...`);
        await file.download({ destination: destPath });
      }
      log.info('Successfully synced ML files from GCS');
    } catch (err) {
      log.error('Failed to sync ML files from GCS bucket', { error: String(err) });
    }
  }

  async syncModelsToBucket(): Promise<void> {
    const bucketName = process.env['RADAR__STORAGE_BUCKET'];
    if (!bucketName) return;
    try {
      const { Storage } = await import('@google-cloud/storage');
      const storage = new Storage();
      const bucket = storage.bucket(bucketName);
      
      const dataDir = dirname(this.dbPath || 'data');
      const mlDir = resolve(dataDir, 'ml');
      
      if (!existsSync(mlDir)) return;
      
      const walk = (dir: string): string[] => {
        let results: string[] = [];
        const list = readdirSync(dir);
        for (const file of list) {
          const path = resolve(dir, file);
          const stat = statSync(path);
          if (stat && stat.isDirectory()) {
            results = results.concat(walk(path));
          } else {
            results.push(path);
          }
        }
        return results;
      };
      
      const files = walk(mlDir);
      log.info(`Syncing ${files.length} ML files to GCS bucket ${bucketName}...`);
      
      for (const file of files) {
        const relativePath = file.substring(dataDir.length + 1);
        log.info(`Uploading local file ${relativePath} to GCS...`);
        await bucket.upload(file, {
          destination: relativePath,
        });
      }
      log.info('Successfully synced ML files to GCS');
    } catch (err) {
      log.error('Failed to sync ML files to GCS bucket', { error: String(err) });
    }
  }

  static open(dataDir: string, fileName = "crypto-radar.db"): Store {
    return new Store({ path: resolve(dataDir, fileName) });
  }

  async migrate(): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      const [exists] = await dataset.exists();
      if (!exists) {
        await dataset.create({ location: "us-central1" });
        log.info(`Created BigQuery dataset: ${this.datasetId}`);
      }

      for (const [tableName, schema] of Object.entries(BQ_SCHEMAS)) {
        const table = dataset.table(tableName);
        const [tableExists] = await table.exists();
        if (!tableExists) {
          await table.create({ schema });
          log.info(`Created BigQuery table: ${tableName}`);
        }
      }
    } else if (this.db) {
      if (isCloudMode()) {
        await this.syncFromBucket();
      }
      log.debug("Using schema to migrate database", { ddlLength: SCHEMA_DDL.length });
      const { migrate: schemaMigrate } = await import('./schema.js');
      schemaMigrate(this.db);
      if (isCloudMode()) {
        await this.syncToBucket();
      }
    }
  }

  close(): void {
    if (this.db) {
      this.stmts.clear();
      this.db.close();
      this.db = null;
    }
  }

  private getTable(name: string): string {
    return `\`${this.projectId}.${this.datasetId}.${name}\``;
  }

  private prep(sql: string): Stmt {
    if (!this.db) throw new Error("SQLite not initialized");
    let stmt = this.stmts.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  private allRows<T>(stmt: Stmt, ...params: SQLInputValue[]): T[] {
    return stmt.all(...params) as unknown as T[];
  }

  private oneRow<T>(stmt: Stmt, ...params: SQLInputValue[]): T | undefined {
    return stmt.get(...params) as unknown as T | undefined;
  }

  // ── Klines ──

  async upsertKlines(rows: KlineRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      const table = dataset.table("klines");
      const insertRows = rows.map(r => ({
        insertId: `${r.symbol}-${r.interval}-${r.open_time}`,
        json: r,
      }));
      await table.insert(insertRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.db) {
      const sql = `INSERT OR IGNORE INTO klines (symbol, interval, open_time, open, high, low, close, volume, quote_volume, taker_buy_vol, taker_buy_quote_vol)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      let count = 0;
      const stmt = this.prep(sql);
      for (const r of rows) {
        const result = stmt.run(
          r.symbol,
          r.interval,
          r.open_time,
          r.open,
          r.high,
          r.low,
          r.close,
          r.volume,
          r.quote_volume,
          r.taker_buy_vol,
          r.taker_buy_quote_vol,
        );
        if (Number(result.changes) > 0) count++;
      }
      return count;
    }
    return 0;
  }

  async getKlines(
    symbol: string,
    interval: string,
    opts?: {
      from?: number;
      to?: number;
      limit?: number;
      order?: "asc" | "desc";
    },
  ): Promise<KlineRow[]> {
    const cacheKey = `klines:${symbol}:${interval}:${opts?.from ?? ""}:${opts?.to ?? ""}:${opts?.limit ?? ""}:${opts?.order ?? "asc"}`;
    const cached = getGlobalCache().get<KlineRow[]>(cacheKey);
    if (cached) return cached;

    let result: KlineRow[] = [];

    if (this.bq) {
      let sql = `SELECT * FROM ${this.getTable("klines")} WHERE symbol = @symbol AND interval = @interval`;
      const params: Record<string, unknown> = { symbol, interval };
      if (opts?.from !== undefined) {
        sql += " AND open_time >= @from";
        params.from = opts.from;
      }
      if (opts?.to !== undefined) {
        sql += " AND open_time <= @to";
        params.to = opts.to;
      }
      sql += ` ORDER BY open_time ${opts?.order === "desc" ? "DESC" : "ASC"}`;
      if (opts?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = opts.limit;
      }
      const [bqRows] = await this.bq.query({ query: sql, params });
      result = bqRows as KlineRow[];
    } else if (this.db) {
      let sql = "SELECT * FROM klines WHERE symbol = ? AND interval = ?";
      const params: SQLInputValue[] = [symbol, interval];
      if (opts?.from !== undefined) {
        sql += " AND open_time >= ?";
        params.push(opts.from);
      }
      if (opts?.to !== undefined) {
        sql += " AND open_time <= ?";
        params.push(opts.to);
      }
      sql += ` ORDER BY open_time ${opts?.order === "desc" ? "DESC" : "ASC"}`;
      if (opts?.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(opts.limit);
      }
      result = this.allRows<KlineRow>(this.prep(sql), ...params);
    }

    getGlobalCache().set(cacheKey, result, 60_000);
    return result;
  }

  async latestKlineTime(symbol: string, interval: string): Promise<number | null> {
    if (this.bq) {
      const sql = `SELECT MAX(open_time) AS t FROM ${this.getTable("klines")} WHERE symbol = @symbol AND interval = @interval`;
      const [rows] = await this.bq.query({ query: sql, params: { symbol, interval } });
      const val = rows[0]?.t;
      return val !== undefined && val !== null ? Number(val) : null;
    } else if (this.db) {
      const row = this.oneRow<{ t: number | null }>(
        this.prep("SELECT MAX(open_time) AS t FROM klines WHERE symbol = ? AND interval = ?"),
        symbol,
        interval,
      );
      return row?.t ?? null;
    }
    return null;
  }

  async klineCount(symbol?: string, interval?: string): Promise<number> {
    if (this.bq) {
      let sql = `SELECT COUNT(*) AS c FROM ${this.getTable("klines")}`;
      const params: Record<string, unknown> = {};
      const clauses: string[] = [];
      if (symbol) {
        clauses.push("symbol = @symbol");
        params.symbol = symbol;
      }
      if (interval) {
        clauses.push("interval = @interval");
        params.interval = interval;
      }
      if (clauses.length > 0) sql += " WHERE " + clauses.join(" AND ");
      const [rows] = await this.bq.query({ query: sql, params });
      return Number(rows[0]?.c ?? 0);
    } else if (this.db) {
      let sql = "SELECT COUNT(*) AS c FROM klines";
      const params: SQLInputValue[] = [];
      if (symbol) {
        sql += " WHERE symbol = ?";
        params.push(symbol);
      }
      if (interval) {
        sql += symbol ? " AND interval = ?" : " WHERE interval = ?";
        params.push(interval);
      }
      const row = this.oneRow<{ c: number }>(this.prep(sql), ...params);
      return row?.c ?? 0;
    }
    return 0;
  }

  // ── Scan archive ──

  async persistRun(result: {
    tickers: EnrichedTicker[];
    newsMatches: NewsMatch[];
    signals: TokenSignal[];
  }): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);

      if (result.tickers.length > 0) {
        const table = dataset.table("ticker_history");
        const bqRows = result.tickers.map(t => ({
          insertId: `${t.symbol}-${t.tsUtc}`,
          json: {
            symbol: t.symbol,
            ts_utc: t.tsUtc,
            price: t.lastPrice,
            price_change_pct: t.priceChangePercent,
            volume: t.volume,
            quote_volume: t.quoteVolume,
            rsi: t.rsi ?? null,
            macd_hist: t.macdHistogram ?? null,
            bb_width: t.bbWidth ?? null,
            atr_pct: t.atrPct ?? null,
            adx: t.adx ?? null,
            regime: t.regime ?? null,
            composite_score: t.compositeScore ?? null,
          },
        }));
        await table.insert(bqRows, { ignoreUnknownValues: true });

        // ── Populate token_traces in BigQuery ──
        const tracesTable = dataset.table("token_traces");
        const bqTraces = result.tickers.map(t => {
          const matchingSignal = result.signals.find(s => s.symbol === t.symbol);
          const traceId = sha1(`${t.symbol}-${t.tsUtc}-trace`);
          return {
            insertId: traceId,
            json: {
              trace_id: traceId,
              run_id: t.runId || `RADAR-${Date.now().toString(36).toUpperCase()}`,
              symbol: t.symbol,
              token_id: t.tokenId,
              observed_at: t.tsUtc,
              last_price: t.lastPrice,
              price_change_pct: t.priceChangePercent,
              volume: t.volume,
              spread_pct: t.spreadPct ?? null,
              market_cap: null,
              composite_score: t.compositeScore ?? null,
              direction: matchingSignal?.alerts?.[0] ?? null,
              regime: t.regime ?? null,
              rsi: t.rsi ?? null,
              macd_histogram: t.macdHistogram ?? null,
              bb_width: t.bbWidth ?? null,
              atr_pct: t.atrPct ?? null,
              adx: t.adx ?? null,
              needs_analysis: 1,
              outcome_evaluated: 0,
              outcome_is_rugpull: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          };
        });
        await tracesTable.insert(bqTraces, { ignoreUnknownValues: true });
      }

      if (result.signals.length > 0) {
        const table = dataset.table("signal_history");
        const bqRows = result.signals.map(s => ({
          insertId: `${s.symbol}-${s.timestamp}`,
          json: {
            symbol: s.symbol,
            ts_utc: s.timestamp,
            composite_score: s.compositeScore,
            direction: s.alerts?.[0] ?? null,
            momentum_score: s.momentumScore ?? null,
            mean_reversion_score: s.technicalScore ?? null,
            trend_following_score: s.newsScore ?? null,
            regime: s.regime ?? null,
            adx: s.adx ?? null,
          },
        }));
        await table.insert(bqRows, { ignoreUnknownValues: true });
      }

      if (result.newsMatches.length > 0) {
        const table = dataset.table("news");
        const bqRows = result.newsMatches.map(n => {
          const newsId = sha1(`${n.headline}|${n.source}|${n.tsUtc}`);
          return {
            insertId: newsId,
            json: {
              id: newsId,
              symbol: n.symbol,
              headline: n.headline,
              description: n.description,
              source: n.source,
              domain: n.domain,
              relevance: n.relevance,
              pub_date: n.tsUtc,
            },
          };
        });
        await table.insert(bqRows, { ignoreUnknownValues: true });
      }

      // ── Publish scan.complete event via Pub/Sub ──
      if (isCloudMode()) {
        try {
          const { PubSub } = await import('@google-cloud/pubsub');
          const pubsub = new PubSub();
          const topicName = process.env['RADAR__PUBSUB_TOPIC'] || 'crypto-radar-events';
          const topic = pubsub.topic(topicName);

          const runId = result.tickers[0]?.runId || `RADAR-${Date.now().toString(36).toUpperCase()}`;
          const tsUtc = result.tickers[0]?.tsUtc || new Date().toISOString();

          const messageData = {
            type: "scan.complete",
            runId,
            tsUtc,
            tokenCount: result.tickers.length,
            tickerSymbols: result.tickers.map(t => t.symbol),
            tickerIds: result.tickers.map(t => t.tokenId),
            signalCount: result.signals.length
          };

          const dataBuffer = Buffer.from(JSON.stringify(messageData));
          await topic.publishMessage({ data: dataBuffer });
          log.info('Published scan.complete event to Pub/Sub', { runId, topic: topicName });
        } catch (pubsubErr) {
          log.warn('Failed to publish scan.complete event to Pub/Sub', { error: String(pubsubErr) });
        }
      }
    } else if (this.db) {
      const tickerSnapshot = this.prep(`INSERT OR REPLACE INTO tickers
        (symbol, ts_utc, price, price_change_pct, volume, quote_volume,
         rsi, macd_hist, bb_width, atr_pct, adx, regime, composite_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const tickerHistory = this.prep(`INSERT OR IGNORE INTO ticker_history
        (symbol, ts_utc, price, price_change_pct, volume, quote_volume,
         rsi, macd_hist, bb_width, atr_pct, adx, regime, composite_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const t of result.tickers) {
        const matchingSignal = result.signals.find(s => s.symbol === t.symbol);
        const traceId = sha1(`${t.symbol}-${t.tsUtc}-trace`);
        
        // Populate token_traces in SQLite
        this.prep(
          `INSERT OR REPLACE INTO token_traces
          (trace_id, run_id, symbol, token_id, observed_at, last_price, price_change_pct, volume, spread_pct, market_cap,
           rsi, macd_histogram, bb_width, atr_pct, adx, regime, composite_score, direction, needs_analysis, outcome_evaluated, outcome_is_rugpull, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)`
        ).run(
          traceId,
          t.runId || `RADAR-${Date.now().toString(36).toUpperCase()}`,
          t.symbol,
          t.tokenId,
          t.tsUtc,
          t.lastPrice,
          t.priceChangePercent,
          t.volume,
          t.spreadPct ?? null,
          null,
          t.rsi ?? null,
          t.macdHistogram ?? null,
          t.bbWidth ?? null,
          t.atrPct ?? null,
          t.adx ?? null,
          t.regime ?? null,
          t.compositeScore ?? null,
          matchingSignal?.alerts?.[0] ?? null,
          new Date().toISOString(),
          new Date().toISOString()
        );

        const params: SQLInputValue[] = [
          t.symbol,
          t.tsUtc,
          t.lastPrice,
          t.priceChangePercent,
          t.volume,
          t.quoteVolume,
          t.rsi ?? null,
          t.macdHistogram ?? null,
          t.bbWidth ?? null,
          t.atrPct ?? null,
          t.adx ?? null,
          t.regime ?? null,
          t.compositeScore ?? null,
        ];
        tickerSnapshot.run(...params);
        tickerHistory.run(...params);
      }

      const signalSnapshot = this.prep(`INSERT OR REPLACE INTO signals
        (symbol, ts_utc, composite_score, direction, momentum_score, mean_reversion_score, trend_following_score, regime, adx)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const signalHistory = this.prep(`INSERT OR IGNORE INTO signal_history
        (symbol, ts_utc, composite_score, direction, momentum_score, mean_reversion_score, trend_following_score, regime, adx)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const s of result.signals) {
        const params: SQLInputValue[] = [
          s.symbol,
          s.timestamp,
          s.compositeScore,
          s.alerts?.[0] ?? null,
          s.momentumScore ?? null,
          s.technicalScore ?? null,
          s.newsScore ?? null,
          s.regime ?? null,
          s.adx ?? null,
        ];
        signalSnapshot.run(...params);
        signalHistory.run(...params);
      }

      const newsStmt = this.prep(`INSERT OR IGNORE INTO news
        (id, symbol, headline, description, source, domain, relevance, pub_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const n of result.newsMatches) {
        const newsId = sha1(`${n.headline}|${n.source}|${n.tsUtc}`);
        newsStmt.run(
          newsId,
          n.symbol,
          n.headline,
          n.description,
          n.source,
          n.domain,
          n.relevance,
          n.tsUtc,
        );
      }

      // Local fallback queue trigger for development
      if (!isCloudMode()) {
        const runId = result.tickers[0]?.runId || `RADAR-${Date.now().toString(36).toUpperCase()}`;
        const tsUtc = result.tickers[0]?.tsUtc || new Date().toISOString();
        const payload: TaskPayload = {
          runId,
          tsUtc,
          tickers: result.tickers.map(t => ({ symbol: t.symbol, tokenId: t.tokenId })),
          signals: result.signals.map(s => ({ symbol: s.symbol, compositeScore: s.compositeScore }))
        };

        import('../core/queue.js').then(({ enqueueTask }) => {
          enqueueTask('crypto-radar-gemini-analysis', payload).catch(() => {});
          enqueueTask('crypto-radar-paper-trade', payload).catch(() => {});
        }).catch(() => {});
      }
    }
  }

  async enforceRetention(days: number): Promise<void> {
    if (days <= 0) return;
    if (this.bq) {
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      const queries = [
        `DELETE FROM ${this.getTable("ticker_history")} WHERE ts_utc < @cutoff`,
        `DELETE FROM ${this.getTable("signal_history")} WHERE ts_utc < @cutoff`,
        `DELETE FROM ${this.getTable("predictions")} WHERE ts < @cutoff_ts`,
      ];
      const cutoffTs = String(Date.now() - days * 86400_000);
      await this.bq.query({ query: queries[0]!, params: { cutoff } });
      await this.bq.query({ query: queries[1]!, params: { cutoff } });
      await this.bq.query({ query: queries[2]!, params: { cutoff_ts: cutoffTs } });
      log.info(`Retention enforced on BigQuery: deleted rows older than ${days} days`);
    } else if (this.db) {
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      this.prep("DELETE FROM ticker_history WHERE ts_utc < ?").run(cutoff);
      this.prep("DELETE FROM signal_history WHERE ts_utc < ?").run(cutoff);
      const oldTs = Date.now() - days * 86400_000;
      this.prep("DELETE FROM predictions WHERE ts < ?").run(String(oldTs));
      log.info(`Retention enforced: deleted rows older than ${days} days`);
    }
  }

  async getLatestTickers(filter?: {
    symbol?: string;
    chain?: string;
    limit?: number;
  }): Promise<TickerRow[]> {
    if (this.bq) {
      let sql = `SELECT symbol, ts_utc, price, price_change_pct, volume, quote_volume, rsi, macd_hist, bb_width, atr_pct, adx, regime, composite_score
                 FROM (
                   SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ts_utc DESC) as rn
                   FROM ${this.getTable("ticker_history")}
                 )
                 WHERE rn = 1`;
      const params: Record<string, unknown> = {};
      if (filter?.symbol) {
        sql += " AND symbol = @symbol";
        params.symbol = filter.symbol;
      }
      sql += " ORDER BY symbol ASC";
      if (filter?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = filter.limit;
      } else {
        sql += " LIMIT 200";
        params.limit = 200;
      }
      const [rows] = await this.bq.query({ query: sql, params });
      return rows as TickerRow[];
    } else if (this.db) {
      let sql = "SELECT * FROM tickers";
      const params: SQLInputValue[] = [];
      if (filter?.symbol) {
        sql += " WHERE symbol = ?";
        params.push(filter.symbol);
      }
      sql += " ORDER BY symbol ASC";
      if (filter?.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(filter.limit);
      } else {
        sql += " LIMIT ?";
        params.push(200);
      }
      return this.allRows<TickerRow>(this.prep(sql), ...params);
    }
    return [];
  }

  async getSignals(filter?: {
    symbol?: string;
    minScore?: number;
    direction?: string;
    limit?: number;
  }): Promise<SignalRow[]> {
    if (this.bq) {
      let sql = `SELECT symbol, ts_utc, composite_score, direction, momentum_score, mean_reversion_score, trend_following_score, regime, adx
                 FROM (
                   SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ts_utc DESC) as rn
                   FROM ${this.getTable("signal_history")}
                 )
                 WHERE rn = 1`;
      const params: Record<string, unknown> = {};
      if (filter?.symbol) {
        sql += " AND symbol = @symbol";
        params.symbol = filter.symbol;
      }
      if (filter?.minScore !== undefined) {
        sql += " AND composite_score >= @minScore";
        params.minScore = filter.minScore;
      }
      if (filter?.direction) {
        sql += " AND direction = @direction";
        params.direction = filter.direction;
      }
      sql += " ORDER BY composite_score DESC";
      if (filter?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = filter.limit;
      } else {
        sql += " LIMIT 200";
        params.limit = 200;
      }
      const [rows] = await this.bq.query({ query: sql, params });
      return rows as SignalRow[];
    } else if (this.db) {
      let sql = "SELECT * FROM signals WHERE 1=1";
      const params: SQLInputValue[] = [];
      if (filter?.symbol) {
        sql += " AND symbol = ?";
        params.push(filter.symbol);
      }
      if (filter?.minScore !== undefined) {
        sql += " AND composite_score >= ?";
        params.push(filter.minScore);
      }
      if (filter?.direction) {
        sql += " AND direction = ?";
        params.push(filter.direction);
      }
      sql += " ORDER BY composite_score DESC";
      if (filter?.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(filter.limit);
      } else {
        sql += " LIMIT ?";
        params.push(200);
      }
      return this.allRows<SignalRow>(this.prep(sql), ...params);
    }
    return [];
  }

  async getSignalHistory(
    symbol: string,
    opts?: { from?: string; limit?: number; order?: "asc" | "desc" },
  ): Promise<SignalRow[]> {
    if (this.bq) {
      let sql = `SELECT * FROM ${this.getTable("signal_history")} WHERE symbol = @symbol`;
      const params: Record<string, unknown> = { symbol };
      if (opts?.from) {
        sql += " AND ts_utc >= @from";
        params.from = opts.from;
      }
      sql += ` ORDER BY ts_utc ${opts?.order === "asc" ? "ASC" : "DESC"}`;
      if (opts?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = opts.limit;
      }
      const [rows] = await this.bq.query({ query: sql, params });
      return rows as SignalRow[];
    } else if (this.db) {
      let sql = "SELECT * FROM signal_history WHERE symbol = ?";
      const params: SQLInputValue[] = [symbol];
      if (opts?.from) {
        sql += " AND ts_utc >= ?";
        params.push(opts.from);
      }
      sql += ` ORDER BY ts_utc ${opts?.order === "asc" ? "ASC" : "DESC"}`;
      if (opts?.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(opts.limit);
      }
      return this.allRows<SignalRow>(this.prep(sql), ...params);
    }
    return [];
  }

  async getTickerHistory(
    symbol: string,
    opts?: { from?: string; limit?: number; order?: "asc" | "desc" },
  ): Promise<TickerRow[]> {
    if (this.bq) {
      let sql = `SELECT * FROM ${this.getTable("ticker_history")} WHERE symbol = @symbol`;
      const params: Record<string, unknown> = { symbol };
      if (opts?.from) {
        sql += " AND ts_utc >= @from";
        params.from = opts.from;
      }
      sql += ` ORDER BY ts_utc ${opts?.order === "asc" ? "ASC" : "DESC"}`;
      if (opts?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = opts.limit;
      }
      const [rows] = await this.bq.query({ query: sql, params });
      return rows as TickerRow[];
    } else if (this.db) {
      let sql = "SELECT * FROM ticker_history WHERE symbol = ?";
      const params: SQLInputValue[] = [symbol];
      if (opts?.from) {
        sql += " AND ts_utc >= ?";
        params.push(opts.from);
      }
      sql += ` ORDER BY ts_utc ${opts?.order === "asc" ? "ASC" : "DESC"}`;
      if (opts?.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(opts.limit);
      }
      return this.allRows<TickerRow>(this.prep(sql), ...params);
    }
    return [];
  }

  async getNews(filter?: { symbol?: string; limit?: number }): Promise<NewsRow[]> {
    if (this.bq) {
      let sql = `SELECT * FROM ${this.getTable("news")}`;
      const params: Record<string, unknown> = {};
      if (filter?.symbol) {
        sql += " WHERE symbol = @symbol";
        params.symbol = filter.symbol;
      }
      sql += " ORDER BY pub_date DESC";
      if (filter?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = filter.limit;
      } else {
        sql += " LIMIT 50";
        params.limit = 50;
      }
      const [rows] = await this.bq.query({ query: sql, params });
      return rows as NewsRow[];
    } else if (this.db) {
      let sql = "SELECT * FROM news";
      const params: SQLInputValue[] = [];
      if (filter?.symbol) {
        sql += " WHERE symbol = ?";
        params.push(filter.symbol);
      }
      sql += " ORDER BY pub_date DESC";
      if (filter?.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(filter.limit);
      } else {
        sql += " LIMIT ?";
        params.push(50);
      }
      return this.allRows<NewsRow>(this.prep(sql), ...params);
    }
    return [];
  }

  // ── Paper trading ──

  async upsertPaperTrade(t: PaperTradeRow): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      const table = dataset.table("paper_trades");
      await table.insert([{
        insertId: t.id,
        json: t,
      }], { ignoreUnknownValues: true });
    } else if (this.db) {
      this.prep(
        `INSERT OR REPLACE INTO paper_trades
        (id, profile, symbol, side, entry_price, entry_time, quantity, exit_price, exit_time, pnl, fees, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        t.id,
        t.profile,
        t.symbol,
        t.side,
        t.entry_price,
        t.entry_time,
        t.quantity,
        t.exit_price,
        t.exit_time,
        t.pnl,
        t.fees,
        t.status,
      );
    }
  }

  async getPaperTrades(profile: string, status?: "open" | "closed"): Promise<PaperTradeRow[]> {
    if (this.bq) {
      let sql = `SELECT id, profile, symbol, side, entry_price, entry_time, quantity, exit_price, exit_time, pnl, fees, status
                 FROM (
                   SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(exit_time, entry_time) DESC) as rn
                   FROM ${this.getTable("paper_trades")}
                   WHERE profile = @profile
                 )
                 WHERE rn = 1`;
      const params: Record<string, unknown> = { profile };
      if (status) {
        sql += " AND status = @status";
        params.status = status;
      }
      const [rows] = await this.bq.query({ query: sql, params });
      return rows as PaperTradeRow[];
    } else if (this.db) {
      let sql = "SELECT * FROM paper_trades WHERE profile = ?";
      const params: SQLInputValue[] = [profile];
      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
      return this.allRows<PaperTradeRow>(this.prep(sql), ...params);
    }
    return [];
  }

  // ── Users / Auth ──

  async getUserByEmail(email: string): Promise<UserRow | undefined> {
    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("users")} WHERE email = @email LIMIT 1`;
      const [rows] = await this.bq.query({ query: sql, params: { email } });
      return rows[0] as UserRow | undefined;
    } else if (this.db) {
      return this.oneRow<UserRow>(
        this.prep("SELECT * FROM users WHERE email = ?"),
        email,
      );
    }
    return undefined;
  }

  async getUserById(id: string): Promise<UserRow | undefined> {
    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("users")} WHERE id = @id LIMIT 1`;
      const [rows] = await this.bq.query({ query: sql, params: { id } });
      return rows[0] as UserRow | undefined;
    } else if (this.db) {
      return this.oneRow<UserRow>(this.prep("SELECT * FROM users WHERE id = ?"), id);
    }
    return undefined;
  }

  async createUser(user: UserRow): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      await dataset.table("users").insert([{
        insertId: user.id,
        json: user,
      }]);
    } else if (this.db) {
      this.prep(
        "INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        user.id,
        user.email,
        user.password_hash,
        user.name,
        user.role,
        user.created_at,
        user.updated_at,
      );
    }
  }

  async updateUser(
    id: string,
    fields: Partial<Pick<UserRow, "name" | "role" | "password_hash">>,
  ): Promise<void> {
    if (this.bq) {
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      if (fields.name !== undefined) {
        sets.push("name = @name");
        params.name = fields.name;
      }
      if (fields.role !== undefined) {
        sets.push("role = @role");
        params.role = fields.role;
      }
      if (fields.password_hash !== undefined) {
        sets.push("password_hash = @password_hash");
        params.password_hash = fields.password_hash;
      }
      if (sets.length === 0) return;
      sets.push("updated_at = CURRENT_TIMESTAMP()");
      const sql = `UPDATE ${this.getTable("users")} SET ${sets.join(", ")} WHERE id = @id`;
      await this.bq.query({ query: sql, params });
    } else if (this.db) {
      const sets: string[] = [];
      const params: SQLInputValue[] = [];
      if (fields.name !== undefined) {
        sets.push("name = ?");
        params.push(fields.name);
      }
      if (fields.role !== undefined) {
        sets.push("role = ?");
        params.push(fields.role);
      }
      if (fields.password_hash !== undefined) {
        sets.push("password_hash = ?");
        params.push(fields.password_hash);
      }
      if (sets.length === 0) return;
      sets.push("updated_at = datetime('now')");
      this.prep(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(
        ...params,
        id,
      );
    }
  }

  // ── Futures sources ──

  async upsertFunding(rows: FundingRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      const bqRows = rows.map(r => ({
        insertId: `${r.symbol}-${r.ts}`,
        json: r,
      }));
      await dataset.table("futures_funding").insert(bqRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.db) {
      const sql =
        "INSERT OR IGNORE INTO futures_funding (symbol, ts, rate) VALUES (?, ?, ?)";
      let count = 0;
      const stmt = this.prep(sql);
      for (const r of rows) {
        if (Number(stmt.run(r.symbol, r.ts, r.rate).changes) > 0) count++;
      }
      return count;
    }
    return 0;
  }

  async upsertOpenInterest(rows: OIRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      const bqRows = rows.map(r => ({
        insertId: `${r.symbol}-${r.ts}`,
        json: r,
      }));
      await dataset.table("futures_oi").insert(bqRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.db) {
      const sql =
        "INSERT OR IGNORE INTO futures_oi (symbol, ts, open_interest) VALUES (?, ?, ?)";
      let count = 0;
      const stmt = this.prep(sql);
      for (const r of rows) {
        if (Number(stmt.run(r.symbol, r.ts, r.open_interest).changes) > 0)
          count++;
      }
      return count;
    }
    return 0;
  }

  async upsertLsRatio(rows: LsRatioRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      const bqRows = rows.map(r => ({
        insertId: `${r.symbol}-${r.ts}`,
        json: r,
      }));
      await dataset.table("futures_ls_ratio").insert(bqRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.db) {
      const sql =
        "INSERT OR IGNORE INTO futures_ls_ratio (symbol, ts, long_account, short_account, long_position, short_position) VALUES (?, ?, ?, ?, ?, ?)";
      let count = 0;
      const stmt = this.prep(sql);
      for (const r of rows) {
        if (
          Number(
            stmt.run(
              r.symbol,
              r.ts,
              r.long_account,
              r.short_account,
              r.long_position,
              r.short_position,
            ).changes,
          ) > 0
        )
          count++;
      }
      return count;
    }
    return 0;
  }

  async upsertLiquidations(rows: LiquidationRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      const bqRows = rows.map(r => ({
        insertId: r.id,
        json: r,
      }));
      await dataset.table("liquidations").insert(bqRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.db) {
      const sql =
        "INSERT OR IGNORE INTO liquidations (id, symbol, ts, side, price, qty, usd) VALUES (?, ?, ?, ?, ?, ?, ?)";
      let count = 0;
      const stmt = this.prep(sql);
      for (const r of rows) {
        if (
          Number(
            stmt.run(r.id, r.symbol, r.ts, r.side, r.price, r.qty, r.usd)
              .changes,
          ) > 0
        )
          count++;
      }
      return count;
    }
    return 0;
  }

  async getFunding(symbol: string, limit = 50): Promise<FundingRow[]> {
    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("futures_funding")} WHERE symbol = @symbol ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.bq.query({ query: sql, params: { symbol, limit } });
      return rows as FundingRow[];
    } else if (this.db) {
      return this.allRows<FundingRow>(
        this.prep(
          "SELECT * FROM futures_funding WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        ),
        symbol,
        limit,
      );
    }
    return [];
  }

  async getOpenInterest(symbol: string, limit = 50): Promise<OIRow[]> {
    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("futures_oi")} WHERE symbol = @symbol ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.bq.query({ query: sql, params: { symbol, limit } });
      return rows as OIRow[];
    } else if (this.db) {
      return this.allRows<OIRow>(
        this.prep(
          "SELECT * FROM futures_oi WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        ),
        symbol,
        limit,
      );
    }
    return [];
  }

  async getLsRatio(symbol: string, limit = 50): Promise<LsRatioRow[]> {
    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("futures_ls_ratio")} WHERE symbol = @symbol ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.bq.query({ query: sql, params: { symbol, limit } });
      return rows as LsRatioRow[];
    } else if (this.db) {
      return this.allRows<LsRatioRow>(
        this.prep(
          "SELECT * FROM futures_ls_ratio WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        ),
        symbol,
        limit,
      );
    }
    return [];
  }

  async getLiquidations(symbol?: string, limit = 50): Promise<LiquidationRow[]> {
    if (this.bq) {
      let sql = `SELECT * FROM ${this.getTable("liquidations")}`;
      const params: Record<string, unknown> = { limit };
      if (symbol) {
        sql += " WHERE symbol = @symbol";
        params.symbol = symbol;
      }
      sql += " ORDER BY ts DESC LIMIT @limit";
      const [rows] = await this.bq.query({ query: sql, params });
      return rows as LiquidationRow[];
    } else if (this.db) {
      if (symbol) {
        return this.allRows<LiquidationRow>(
          this.prep(
            "SELECT * FROM liquidations WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
          ),
          symbol,
          limit,
        );
      }
      return this.allRows<LiquidationRow>(
        this.prep("SELECT * FROM liquidations ORDER BY ts DESC LIMIT ?"),
        limit,
      );
    }
    return [];
  }

  // ── Fear & Greed ──

  async upsertFearGreed(row: FearGreedRow): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      await dataset.table("fear_greed").insert([{
        insertId: String(row.ts),
        json: row,
      }], { ignoreUnknownValues: true });
    } else if (this.db) {
      this.prep(
        "INSERT OR REPLACE INTO fear_greed (ts, value, classification) VALUES (?, ?, ?)",
      ).run(row.ts, row.value, row.classification);
    }
  }

  async getFearGreed(limit = 30): Promise<FearGreedRow[]> {
    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("fear_greed")} ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.bq.query({ query: sql, params: { limit } });
      return rows as FearGreedRow[];
    } else if (this.db) {
      return this.allRows<FearGreedRow>(
        this.prep("SELECT * FROM fear_greed ORDER BY ts DESC LIMIT ?"),
        limit,
      );
    }
    return [];
  }

  // ── Order Book ──

  async upsertOrderBook(row: OrderBookRow): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      await dataset.table("orderbook").insert([{
        insertId: `${row.symbol}-${row.ts}`,
        json: row,
      }], { ignoreUnknownValues: true });
    } else if (this.db) {
      this.prep(
        "INSERT OR REPLACE INTO orderbook (symbol, ts, spread_pct, imbalance, bids, asks) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        row.symbol,
        row.ts,
        row.spread_pct,
        row.imbalance,
        row.bids,
        row.asks,
      );
    }
  }

  async getOrderBook(symbol: string, limit = 50): Promise<OrderBookRow[]> {
    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("orderbook")} WHERE symbol = @symbol ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.bq.query({ query: sql, params: { symbol, limit } });
      return rows as OrderBookRow[];
    } else if (this.db) {
      return this.allRows<OrderBookRow>(
        this.prep(
          "SELECT * FROM orderbook WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        ),
        symbol,
        limit,
      );
    }
    return [];
  }

  // ── Cross Asset ──

  async upsertCrossAsset(row: CrossAssetRow): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      await dataset.table("cross_asset").insert([{
        insertId: String(row.ts),
        json: row,
      }], { ignoreUnknownValues: true });
    } else if (this.db) {
      this.prep(
        "INSERT OR REPLACE INTO cross_asset (ts, btc_dominance, eth_dominance, total_mcap, total_mcap_change_24h, market_cap_percentage_json) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        row.ts,
        row.btc_dominance,
        row.eth_dominance,
        row.total_mcap,
        row.total_mcap_change_24h,
        row.market_cap_percentage_json,
      );
    }
  }

  async getCrossAsset(limit = 50): Promise<CrossAssetRow[]> {
    const cacheKey = `cross_asset:${limit}`;
    const cached = getGlobalCache().get<CrossAssetRow[]>(cacheKey);
    if (cached) return cached;

    let result: CrossAssetRow[] = [];

    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("cross_asset")} ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.bq.query({ query: sql, params: { limit } });
      result = rows as CrossAssetRow[];
    } else if (this.db) {
      result = this.allRows<CrossAssetRow>(
        this.prep("SELECT * FROM cross_asset ORDER BY ts DESC LIMIT ?"),
        limit,
      );
    }

    getGlobalCache().set(cacheKey, result, 60_000);
    return result;
  }

  // ── Predictions ──

  async upsertPrediction(row: PredictionRow & { reasoning?: string; outcome?: number; outcome_classification?: string }): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      await dataset.table("predictions").insert([{
        insertId: row.id,
        json: {
          id: row.id,
          symbol: row.symbol,
          ts: row.ts,
          direction: row.direction,
          confidence: row.confidence,
          model_id: row.model_id,
          horizon: row.horizon,
          ml_score: row.ml_score ?? null,
          features_hash: row.features_hash ?? null,
          reasoning: row.reasoning ?? null,
          outcome: row.outcome ?? null,
          outcome_classification: row.outcome_classification ?? null,
        },
      }], { ignoreUnknownValues: true });
    } else if (this.db) {
      this.prep(
        `INSERT OR REPLACE INTO predictions
        (id, symbol, ts, direction, confidence, model_id, horizon, ml_score, features_hash, reasoning, outcome, outcome_classification)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.symbol,
        row.ts,
        row.direction,
        row.confidence,
        row.model_id,
        row.horizon,
        row.ml_score ?? null,
        row.features_hash ?? null,
        row.reasoning ?? null,
        row.outcome ?? null,
        row.outcome_classification ?? null,
      );
      if (isCloudMode()) {
        await this.syncToBucket();
      }
    }
  }

  async persistTrace(row: TokenTraceRow): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      await dataset.table("token_traces").insert([{
        insertId: row.trace_id,
        json: {
          trace_id: row.trace_id,
          run_id: row.run_id,
          symbol: row.symbol,
          token_id: row.token_id,
          observed_at: row.observed_at,
          outcome_at: row.outcome_at ?? null,
          last_price: row.last_price ?? null,
          price_change_pct: row.price_change_pct ?? null,
          volume: row.volume ?? null,
          spread_pct: row.spread_pct ?? null,
          market_cap: row.market_cap ?? null,
          composite_score: row.composite_score ?? null,
          direction: row.direction ?? null,
          regime: row.regime ?? null,
          rsi: row.rsi ?? null,
          macd_histogram: row.macd_histogram ?? null,
          bb_width: row.bb_width ?? null,
          atr_pct: row.atr_pct ?? null,
          adx: row.adx ?? null,
          analysis_text: row.analysis_text ?? null,
          prediction_direction: row.prediction_direction ?? null,
          prediction_confidence: row.prediction_confidence ?? null,
          gemini_raw: row.gemini_raw ?? null,
          needs_analysis: row.needs_analysis ?? 1,
          analyzed_at: row.analyzed_at ?? null,
          outcome_price: row.outcome_price ?? null,
          outcome_change_pct: row.outcome_change_pct ?? null,
          outcome_high: row.outcome_high ?? null,
          outcome_low: row.outcome_low ?? null,
          outcome_volume: row.outcome_volume ?? null,
          outcome_is_rugpull: row.outcome_is_rugpull ?? 0,
          outcome_pnl_pct: row.outcome_pnl_pct ?? null,
          outcome_classification: row.outcome_classification ?? null,
          outcome_evaluated: row.outcome_evaluated ?? 0,
          outcome_evaluated_at: row.outcome_evaluated_at ?? null,
          created_at: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || new Date().toISOString(),
        },
      }], { ignoreUnknownValues: true });
    } else if (this.db) {
      this.prep(
        `INSERT OR REPLACE INTO token_traces
        (trace_id, run_id, symbol, token_id, observed_at, outcome_at, last_price, price_change_pct, volume, spread_pct,
         market_cap, composite_score, direction, regime, rsi, macd_histogram, bb_width, atr_pct, adx,
         analysis_text, prediction_direction, prediction_confidence, gemini_raw, needs_analysis, analyzed_at,
         outcome_price, outcome_change_pct, outcome_high, outcome_low, outcome_volume, outcome_is_rugpull,
         outcome_pnl_pct, outcome_classification, outcome_evaluated, outcome_evaluated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.trace_id,
        row.run_id,
        row.symbol,
        row.token_id ?? null,
        row.observed_at,
        row.outcome_at ?? null,
        row.last_price ?? null,
        row.price_change_pct ?? null,
        row.volume ?? null,
        row.spread_pct ?? null,
        row.market_cap ?? null,
        row.composite_score ?? null,
        row.direction ?? null,
        row.regime ?? null,
        row.rsi ?? null,
        row.macd_histogram ?? null,
        row.bb_width ?? null,
        row.atr_pct ?? null,
        row.adx ?? null,
        row.analysis_text ?? null,
        row.prediction_direction ?? null,
        row.prediction_confidence ?? null,
        row.gemini_raw ?? null,
        row.needs_analysis ?? 1,
        row.analyzed_at ?? null,
        row.outcome_price ?? null,
        row.outcome_change_pct ?? null,
        row.outcome_high ?? null,
        row.outcome_low ?? null,
        row.outcome_volume ?? null,
        row.outcome_is_rugpull ?? 0,
        row.outcome_pnl_pct ?? null,
        row.outcome_classification ?? null,
        row.outcome_evaluated ?? 0,
        row.outcome_evaluated_at ?? null,
        row.created_at || new Date().toISOString(),
        row.updated_at || new Date().toISOString()
      );
      if (isCloudMode()) {
        await this.syncToBucket();
      }
    }
  }

  async updateTrace(traceId: string, updates: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(updates);
    if (keys.length === 0) return;
    
    updates.updated_at = new Date().toISOString();
    const updatedKeys = Object.keys(updates);

    if (this.bq) {
      const setClause = updatedKeys.map(k => `${k} = @${k}`).join(", ");
      const query = `UPDATE ${this.getTable("token_traces")} SET ${setClause} WHERE trace_id = @traceId`;
      await this.bq.query({
        query,
        params: { ...updates, traceId },
      });
    } else if (this.db) {
      const setClause = updatedKeys.map(k => `${k} = ?`).join(", ");
      const query = `UPDATE token_traces SET ${setClause} WHERE trace_id = ?`;
      const params = updatedKeys.map(k => updates[k] as SQLInputValue);
      params.push(traceId);
      this.prep(query).run(...params);
      if (isCloudMode()) {
        await this.syncToBucket();
      }
    }
  }

  // ── Token Trace Queries ──

  /**
   * Fetch token_traces rows where needs_analysis = 1 (pending LLM analysis).
   * Used by the /api/tasks/gemini-analyze task handler.
   */
  async getTracesNeedingAnalysis(limit = 50): Promise<TokenTraceRow[]> {
    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("token_traces")} WHERE needs_analysis = 1 ORDER BY observed_at ASC LIMIT @limit`;
      const [rows] = await this.bq.query({ query: sql, params: { limit } });
      return rows as TokenTraceRow[];
    } else if (this.db) {
      return this.queryAll<TokenTraceRow>(
        `SELECT * FROM token_traces WHERE needs_analysis = 1 ORDER BY observed_at ASC LIMIT ?`,
        [limit],
      );
    }
    return [];
  }

  /**
   * Fetch token_traces where outcome_evaluated = 0 and the 24h window has passed.
   * Used by the /api/tasks/evaluate-outcomes task handler.
   */
  async getTracesNeedingOutcome(limit = 100): Promise<TokenTraceRow[]> {
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000; // 24h ago
    const cutoffIso = new Date(cutoffMs).toISOString();
    if (this.bq) {
      const sql = `SELECT * FROM ${this.getTable("token_traces")} WHERE outcome_evaluated = 0 AND observed_at < @cutoff ORDER BY observed_at ASC LIMIT @limit`;
      const [rows] = await this.bq.query({ query: sql, params: { cutoff: cutoffIso, limit } });
      return rows as TokenTraceRow[];
    } else if (this.db) {
      return this.queryAll<TokenTraceRow>(
        `SELECT * FROM token_traces WHERE outcome_evaluated = 0 AND observed_at < ? ORDER BY observed_at ASC LIMIT ?`,
        [cutoffIso, limit],
      );
    }
    return [];
  }

  async getPredictions(filter?: {
    symbol?: string;
    model_id?: string;
    limit?: number;
    minConfidence?: number;
  }): Promise<PredictionRow[]> {
    if (this.bq) {
      let sql = `SELECT * FROM ${this.getTable("predictions")} WHERE 1=1`;
      const params: Record<string, unknown> = {};
      if (filter?.symbol) {
        sql += " AND symbol = @symbol";
        params.symbol = filter.symbol;
      }
      if (filter?.model_id) {
        sql += " AND model_id = @model_id";
        params.model_id = filter.model_id;
      }
      if (filter?.minConfidence !== undefined) {
        sql += " AND confidence >= @minConfidence";
        params.minConfidence = filter.minConfidence;
      }
      sql += " ORDER BY ts DESC";
      if (filter?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = filter.limit;
      } else {
        sql += " LIMIT 200";
        params.limit = 200;
      }
      const [rows] = await this.bq.query({ query: sql, params });
      return rows as PredictionRow[];
    } else if (this.db) {
      let sql = "SELECT * FROM predictions WHERE 1=1";
      const params: SQLInputValue[] = [];
      if (filter?.symbol) {
        sql += " AND symbol = ?";
        params.push(filter.symbol);
      }
      if (filter?.model_id) {
        sql += " AND model_id = ?";
        params.push(filter.model_id);
      }
      if (filter?.minConfidence !== undefined) {
        sql += " AND confidence >= ?";
        params.push(filter.minConfidence);
      }
      sql += " ORDER BY ts DESC";
      if (filter?.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(filter.limit);
      } else {
        sql += " LIMIT ?";
        params.push(200);
      }
      return this.queryAll<PredictionRow>(sql, params);
    }
    return [];
  }

  async prunePredictions(olderThanMs: number): Promise<number> {
    if (this.bq) {
      const cutoff = String(olderThanMs);
      const sql = `DELETE FROM ${this.getTable("predictions")} WHERE CAST(ts AS INT64) < @cutoff`;
      await this.bq.query({ query: sql, params: { cutoff } });
      return 1;
    } else if (this.db) {
      const cutoff = olderThanMs.toString();
      const result = this.prep(
        "DELETE FROM predictions WHERE CAST(ts AS INTEGER) < ?",
      ).run(cutoff);
      return Number(result.changes);
    }
    return 0;
  }

  // ── Drift Events ──

  async insertDriftEvent(event: {
    id: string;
    ts: string;
    model_id: string;
    detector: string;
    index: number;
    symbol?: string;
    confidence?: number;
    message: string;
  }): Promise<void> {
    if (this.bq) {
      const dataset = this.bq.dataset(this.datasetId);
      await dataset.table("drift_events").insert([{
        insertId: event.id,
        json: event,
      }], { ignoreUnknownValues: true });
    } else if (this.db) {
      this.prep(`
        INSERT INTO drift_events (id, ts, model_id, detector, "index", symbol, confidence, message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.ts,
        event.model_id,
        event.detector,
        event.index,
        event.symbol ?? null,
        event.confidence ?? null,
        event.message,
      );
    }
  }

  async getDriftEvents(filter?: { limit?: number }): Promise<Array<{
    id: string;
    ts: string;
    model_id: string;
    detector: string;
    symbol?: string;
    confidence?: number;
    message: string;
  }>> {
    if (this.bq) {
      let sql = `SELECT * FROM ${this.getTable("drift_events")} ORDER BY ts DESC`;
      const params: Record<string, unknown> = {};
      if (filter?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = filter.limit;
      } else {
        sql += " LIMIT 50";
        params.limit = 50;
      }
      const [rows] = await this.bq.query({ query: sql, params });
      return rows as Array<{
        id: string;
        ts: string;
        model_id: string;
        detector: string;
        symbol?: string;
        confidence?: number;
        message: string;
      }>;
    } else if (this.db) {
      let sql = "SELECT * FROM drift_events ORDER BY ts DESC";
      const params: SQLInputValue[] = [];
      if (filter?.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(filter.limit);
      } else {
        sql += " LIMIT ?";
        params.push(50);
      }
      return this.queryAll(sql, params);
    }
    return [];
  }

  // ── Meta ──

  async stats(): Promise<Record<string, number>> {
    if (!this.db && !this.bq) {
      throw new Error("Database not initialized or closed");
    }
    if (this.db && !this.db.open) {
      throw new Error("Database is closed");
    }

    const tables = [
      "klines",
      "ticker_history",
      "signal_history",
      "news",
      "paper_trades",
      "futures_funding",
      "futures_oi",
      "futures_ls_ratio",
      "liquidations",
      "fear_greed",
      "orderbook",
      "cross_asset",
      "predictions",
      "drift_events",
    ];
    const result: Record<string, number> = {};

    if (this.bq) {
      for (const t of tables) {
        try {
          const sql = `SELECT COUNT(*) AS c FROM ${this.getTable(t)}`;
          const [rows] = await this.bq.query({ query: sql });
          result[t] = Number(rows[0]?.c ?? 0);
        } catch {
          result[t] = 0;
        }
      }
      result["tickers"] = result["ticker_history"] ?? 0;
      result["signals"] = result["signal_history"] ?? 0;
    } else if (this.db) {
      for (const t of tables) {
        try {
          const row = this.oneRow<{ c: number }>(
            this.prep(`SELECT COUNT(*) AS c FROM ${t}`),
          );
          result[t] = row?.c ?? 0;
        } catch {
          result[t] = 0;
        }
      }
      try {
        result["tickers"] = this.oneRow<{ c: number }>(this.prep(`SELECT COUNT(*) AS c FROM tickers`))?.c ?? 0;
        result["signals"] = this.oneRow<{ c: number }>(this.prep(`SELECT COUNT(*) AS c FROM signals`))?.c ?? 0;
      } catch {
        result["tickers"] = 0;
        result["signals"] = 0;
      }
    }
    return result;
  }

  private queryAll<T>(sql: string, params: SQLInputValue[]): T[] {
    if (!this.db) throw new Error("SQLite not initialized");
    const paramIdx = { current: 0 };
    const built = sql.replace(/\?/g, () =>
      Store.esc(params[paramIdx.current++]),
    );
    return this.db.prepare(built).all() as unknown as T[];
  }

  private static esc(val: unknown): string {
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
    if (typeof val === "number" && Number.isFinite(val)) return String(val);
    if (typeof val === "boolean") return val ? "1" : "0";
    return `'${String(val)}'`;
  }
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}
