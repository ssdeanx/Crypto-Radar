import { DatabaseSync } from "node:sqlite";
import type { StatementSync, SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BigQuery } from "@google-cloud/bigquery";
import { SCHEMA_DDL } from "./schema.js";
import { DataError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import { isCloudMode } from "../core/config.js";
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
import type { EnrichedTicker, NewsMatch, TokenSignal, TokenTraceRow } from "../types.js";
import { KlineStore } from './klines.js';
import { TickerStore } from './tickers.js';
import { SignalStore } from './signals.js';
import { NewsStore } from './news.js';
import { PaperTradeStore } from './paper-trades.js';
import { AuthStore } from './auth.js';
import { FuturesStore } from './futures.js';
import { MarketStore } from './market.js';
import { PredictionStore } from './predictions.js';
import { ScanArchiveStore } from './scan-archive.js';
import { MetaStore } from './meta.js';

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

export interface DbHandle {
  db: DatabaseSync | null;
  bq: BigQuery | null;
  projectId: string;
  datasetId: string;
  prep(sql: string): Stmt;
  allRows<T>(stmt: Stmt, ...params: SQLInputValue[]): T[];
  oneRow<T>(stmt: Stmt, ...params: SQLInputValue[]): T | undefined;
  getTable(name: string): string;
  syncToBucket?: () => Promise<void>;
}

export class Store {
  private db: DatabaseSync | null = null;
  private dbPath: string = "";
  private stmts = new Map<string, Stmt>();
  private bq: BigQuery | null = null;
  private projectId: string = "";
  private datasetId: string = "";

  klines: KlineStore;
  tickers: TickerStore;
  signals: SignalStore;
  news: NewsStore;
  paperTrades: PaperTradeStore;
  auth: AuthStore;
  futures: FuturesStore;
  market: MarketStore;
  predictions: PredictionStore;
  scanArchive: ScanArchiveStore;
  meta: MetaStore;

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

    const h = this._handle();
    this.klines = new KlineStore(h);
    this.tickers = new TickerStore(h);
    this.signals = new SignalStore(h);
    this.news = new NewsStore(h);
    this.paperTrades = new PaperTradeStore(h);
    this.auth = new AuthStore(h);
    this.futures = new FuturesStore(h);
    this.market = new MarketStore(h);
    this.predictions = new PredictionStore(h);
    this.scanArchive = new ScanArchiveStore(h);
    this.meta = new MetaStore(h);
  }

  private _handle(): DbHandle {
    const self = this;
    return {
      get db() { return self.db; },
      get bq() { return self.bq; },
      projectId: this.projectId,
      datasetId: this.datasetId,
      prep: (sql) => this.prep(sql),
      allRows: (stmt, ...params) => this.allRows(stmt, ...params),
      oneRow: (stmt, ...params) => this.oneRow(stmt, ...params),
      getTable: (name) => this.getTable(name),
      syncToBucket: () => this.syncToBucket(),
    };
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

  // ── Delegation methods ──

  async upsertKlines(rows: KlineRow[]): Promise<number> { return this.klines.upsertKlines(rows); }
  async getKlines(symbol: string, interval: string, opts?: { from?: number; to?: number; limit?: number; order?: "asc" | "desc" }): Promise<KlineRow[]> { return this.klines.getKlines(symbol, interval, opts); }
  async latestKlineTime(symbol: string, interval: string): Promise<number | null> { return this.klines.latestKlineTime(symbol, interval); }
  async klineCount(symbol?: string, interval?: string): Promise<number> { return this.klines.klineCount(symbol, interval); }

  async getLatestTickers(filter?: { symbol?: string; chain?: string; limit?: number }): Promise<TickerRow[]> { return this.tickers.getLatestTickers(filter); }
  async getTickerHistory(symbol: string, opts?: { from?: string; limit?: number; order?: "asc" | "desc" }): Promise<TickerRow[]> { return this.tickers.getTickerHistory(symbol, opts); }

  async getSignals(filter?: { symbol?: string; minScore?: number; direction?: string; limit?: number }): Promise<SignalRow[]> { return this.signals.getSignals(filter); }
  async getSignalHistory(symbol: string, opts?: { from?: string; limit?: number; order?: "asc" | "desc" }): Promise<SignalRow[]> { return this.signals.getSignalHistory(symbol, opts); }

  async getNews(filter?: { symbol?: string; limit?: number }): Promise<NewsRow[]> { return this.news.getNews(filter); }

  async upsertPaperTrade(t: PaperTradeRow): Promise<void> { return this.paperTrades.upsertPaperTrade(t); }
  async getPaperTrades(profile: string, status?: "open" | "closed"): Promise<PaperTradeRow[]> { return this.paperTrades.getPaperTrades(profile, status); }

  async getUserByEmail(email: string): Promise<UserRow | undefined> { return this.auth.getUserByEmail(email); }
  async getUserById(id: string): Promise<UserRow | undefined> { return this.auth.getUserById(id); }
  async createUser(user: UserRow): Promise<void> { return this.auth.createUser(user); }
  async updateUser(id: string, fields: Partial<Pick<UserRow, "name" | "role" | "password_hash">>): Promise<void> { return this.auth.updateUser(id, fields); }

  async upsertFunding(rows: FundingRow[]): Promise<number> { return this.futures.upsertFunding(rows); }
  async upsertOpenInterest(rows: OIRow[]): Promise<number> { return this.futures.upsertOpenInterest(rows); }
  async upsertLsRatio(rows: LsRatioRow[]): Promise<number> { return this.futures.upsertLsRatio(rows); }
  async upsertLiquidations(rows: LiquidationRow[]): Promise<number> { return this.futures.upsertLiquidations(rows); }
  async getFunding(symbol: string, limit = 50): Promise<FundingRow[]> { return this.futures.getFunding(symbol, limit); }
  async getOpenInterest(symbol: string, limit = 50): Promise<OIRow[]> { return this.futures.getOpenInterest(symbol, limit); }
  async getLsRatio(symbol: string, limit = 50): Promise<LsRatioRow[]> { return this.futures.getLsRatio(symbol, limit); }
  async getLiquidations(symbol?: string, limit = 50): Promise<LiquidationRow[]> { return this.futures.getLiquidations(symbol, limit); }

  async upsertFearGreed(row: FearGreedRow): Promise<void> { return this.market.upsertFearGreed(row); }
  async getFearGreed(limit = 30): Promise<FearGreedRow[]> { return this.market.getFearGreed(limit); }
  async upsertOrderBook(row: OrderBookRow): Promise<void> { return this.market.upsertOrderBook(row); }
  async getOrderBook(symbol: string, limit = 50): Promise<OrderBookRow[]> { return this.market.getOrderBook(symbol, limit); }
  async upsertCrossAsset(row: CrossAssetRow): Promise<void> { return this.market.upsertCrossAsset(row); }
  async getCrossAsset(limit = 50): Promise<CrossAssetRow[]> { return this.market.getCrossAsset(limit); }

  async upsertPrediction(row: PredictionRow & { reasoning?: string; outcome?: number; outcome_classification?: string }): Promise<void> { return this.predictions.upsertPrediction(row); }
  async persistTrace(row: TokenTraceRow): Promise<void> { return this.predictions.persistTrace(row); }
  async updateTrace(traceId: string, updates: Record<string, unknown>): Promise<void> { return this.predictions.updateTrace(traceId, updates); }
  async getTracesNeedingAnalysis(limit = 50): Promise<TokenTraceRow[]> { return this.predictions.getTracesNeedingAnalysis(limit); }
  async getTracesNeedingOutcome(limit = 100): Promise<TokenTraceRow[]> { return this.predictions.getTracesNeedingOutcome(limit); }
  async getPredictions(filter?: { symbol?: string; model_id?: string; limit?: number; minConfidence?: number }): Promise<PredictionRow[]> { return this.predictions.getPredictions(filter); }
  async prunePredictions(olderThanMs: number): Promise<number> { return this.predictions.prunePredictions(olderThanMs); }
  async insertDriftEvent(event: { id: string; ts: string; model_id: string; detector: string; index: number; symbol?: string; confidence?: number; message: string }): Promise<void> { return this.predictions.insertDriftEvent(event); }
  async getDriftEvents(filter?: { limit?: number }): Promise<Array<{ id: string; ts: string; model_id: string; detector: string; symbol?: string; confidence?: number; message: string }>> { return this.predictions.getDriftEvents(filter); }

  async persistRun(result: { tickers: EnrichedTicker[]; newsMatches: NewsMatch[]; signals: TokenSignal[] }): Promise<void> { return this.scanArchive.persistRun(result); }
  async enforceRetention(days: number): Promise<void> { return this.scanArchive.enforceRetention(days); }

  async stats(): Promise<Record<string, number>> { return this.meta.stats(); }
}
