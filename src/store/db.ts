import { DatabaseSync } from "node:sqlite";
import type { StatementSync, SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { migrate } from "./schema.js";
import { DataError } from "../core/errors.js";
import { logger } from "../core/logger.js";
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
import type { EnrichedTicker, NewsMatch, TokenSignal } from "../types.js";

const log = logger.child({ module: "store" });

type Stmt = StatementSync;

function allRows<T>(stmt: Stmt, ...params: SQLInputValue[]): T[] {
  return stmt.all(...params) as unknown as T[];
}

function oneRow<T>(stmt: Stmt, ...params: SQLInputValue[]): T | undefined {
  return stmt.get(...params) as unknown as T | undefined;
}

export class Store {
  private db: DatabaseSync;
  private stmts = new Map<string, Stmt>();
  private writeInProgress = false;
  private writeQueue: Array<() => void> = [];

  constructor(opts: { path: string; createIfMissing?: boolean }) {
    const dbPath = resolve(opts.path);
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

  static open(dataDir: string, fileName = "crypto-radar.db"): Store {
    return new Store({ path: resolve(dataDir, fileName) });
  }

  migrate(): void {
    migrate(this.db);
  }

  close(): void {
    this.stmts.clear();
    this.db.close();
  }

  private prep(sql: string): Stmt {
    let stmt = this.stmts.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  /** Escape a single-quoted string safely for inline SQL */
  private static esc(val: unknown): string {
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
    if (typeof val === "number" && Number.isFinite(val)) return String(val);
    if (typeof val === "boolean") return val ? "1" : "0";
    return `'${String(val)}'`;
  }

  /**
   * Build a SQL query string with inline-escaped values and execute it
   * via prepared statement (no binding — avoids node:sqlite ? binding bugs).
   * Values are escaped via Store.esc() (single-quote doubling for strings, direct for numbers).
   */
  private queryAll<T>(sql: string, params: SQLInputValue[]): T[] {
    const paramIdx = { current: 0 };
    const built = sql.replace(/\?/g, () =>
      Store.esc(params[paramIdx.current++]),
    );
    return this.db.prepare(built).all() as unknown as T[];
  }

  private async withWrite<T>(fn: () => T): Promise<T> {
    if (this.writeInProgress) {
      return new Promise((resolve, reject) => {
        this.writeQueue.push(() => {
          try {
            resolve(this.runInTransaction(fn));
          } catch (e) {
            reject(e);
          }
        });
      });
    }
    this.writeInProgress = true;
    try {
      const result = this.runInTransaction(fn);
      return result;
    } finally {
      this.writeInProgress = false;
      const next = this.writeQueue.shift();
      if (next) {
        this.writeInProgress = true;
        try {
          next();
        } finally {
          this.writeInProgress = false;
        }
      }
    }
  }

  // ── Klines ──

  async upsertKlines(rows: KlineRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const sql = `INSERT OR IGNORE INTO klines (symbol, interval, open_time, open, high, low, close, volume, quote_volume, taker_buy_vol, taker_buy_quote_vol)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return await this.withWrite(() => {
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
    });
  }

  getKlines(
    symbol: string,
    interval: string,
    opts?: {
      from?: number;
      to?: number;
      limit?: number;
      order?: "asc" | "desc";
    },
  ): KlineRow[] {
    // Use global cache for frequent reads (TTL: 60s, keyed on query params)
    const cacheKey = `klines:${symbol}:${interval}:${opts?.from ?? ""}:${opts?.to ?? ""}:${opts?.limit ?? ""}:${opts?.order ?? "asc"}`;
    const cached = getGlobalCache().get<KlineRow[]>(cacheKey);
    if (cached) return cached;

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
    const result = allRows<KlineRow>(this.prep(sql), ...params);
    getGlobalCache().set(cacheKey, result, 60_000);
    return result;
  }

  latestKlineTime(symbol: string, interval: string): number | null {
    const row = oneRow<{ t: number | null }>(
      this.prep(
        "SELECT MAX(open_time) AS t FROM klines WHERE symbol = ? AND interval = ?",
      ),
      symbol,
      interval,
    );
    return row?.t ?? null;
  }

  klineCount(symbol?: string, interval?: string): number {
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
    const row = oneRow<{ c: number }>(this.prep(sql), ...params);
    return row?.c ?? 0;
  }

  // ── Scan archive (F1: snapshot+history split) ──

  async persistRun(result: {
    tickers: EnrichedTicker[];
    newsMatches: NewsMatch[];
    signals: TokenSignal[];
  }): Promise<void> {
    await this.withWrite(() => {
      // F1: Snapshot upsert — one row per symbol (latest state)
      const tickerSnapshot = this.prep(`INSERT OR REPLACE INTO tickers
        (symbol, ts_utc, price, price_change_pct, volume, quote_volume,
         rsi, macd_hist, bb_width, atr_pct, adx, regime, composite_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      // F1: History insert — append-only time series
      const tickerHistory = this.prep(`INSERT OR IGNORE INTO ticker_history
        (symbol, ts_utc, price, price_change_pct, volume, quote_volume,
         rsi, macd_hist, bb_width, atr_pct, adx, regime, composite_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const t of result.tickers) {
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

      // F1: Signal snapshot upsert
      const signalSnapshot = this.prep(`INSERT OR REPLACE INTO signals
        (symbol, ts_utc, composite_score, direction, momentum_score, mean_reversion_score, trend_following_score, regime, adx)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      // F1: Signal history insert
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
    });
  }

  /** Apply data retention policy: delete history rows older than N days */
  async enforceRetention(days: number): Promise<void> {
    if (days <= 0) return;
    await this.withWrite(() => {
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      this.prep("DELETE FROM ticker_history WHERE ts_utc < ?").run(cutoff);
      this.prep("DELETE FROM signal_history WHERE ts_utc < ?").run(cutoff);
      const oldTs = Date.now() - days * 86400_000;
      this.prep("DELETE FROM predictions WHERE ts < ?").run(String(oldTs));
      log.info(`Retention enforced: deleted rows older than ${days} days`);
    });
  }

  getLatestTickers(filter?: {
    symbol?: string;
    chain?: string;
    limit?: number;
  }): TickerRow[] {
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
      sql += " LIMIT 200";
      params.push(200);
    }
    return this.queryAll<TickerRow>(sql, params);
  }

  getSignals(filter?: {
    symbol?: string;
    minScore?: number;
    direction?: string;
    limit?: number;
  }): SignalRow[] {
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
      sql += " LIMIT 200";
      params.push(200);
    }
    return this.queryAll<SignalRow>(sql, params);
  }

  /** Get signal history for a symbol (time series) */
  getSignalHistory(
    symbol: string,
    opts?: { from?: string; limit?: number; order?: "asc" | "desc" },
  ): SignalRow[] {
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
    return allRows<SignalRow>(this.prep(sql), ...params);
  }

  /** Get ticker history for a symbol (time series) */
  getTickerHistory(
    symbol: string,
    opts?: { from?: string; limit?: number; order?: "asc" | "desc" },
  ): TickerRow[] {
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
    return allRows<TickerRow>(this.prep(sql), ...params);
  }

  getNews(filter?: { symbol?: string; limit?: number }): NewsRow[] {
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
      sql += " LIMIT 50";
      params.push(50);
    }
    return allRows<NewsRow>(this.prep(sql), ...params);
  }

  // ── Paper trading ──

  async upsertPaperTrade(t: PaperTradeRow): Promise<void> {
    await this.withWrite(() => {
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
    });
  }

  getPaperTrades(profile: string, status?: "open" | "closed"): PaperTradeRow[] {
    let sql = "SELECT * FROM paper_trades WHERE profile = ?";
    const params: SQLInputValue[] = [profile];
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    return allRows<PaperTradeRow>(this.prep(sql), ...params);
  }

  // ── Users / Auth ──

  getUserByEmail(email: string): UserRow | undefined {
    return oneRow<UserRow>(
      this.prep("SELECT * FROM users WHERE email = ?"),
      email,
    );
  }

  getUserById(id: string): UserRow | undefined {
    return oneRow<UserRow>(this.prep("SELECT * FROM users WHERE id = ?"), id);
  }

  async createUser(user: UserRow): Promise<void> {
    await this.withWrite(() => {
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
    });
  }

  async updateUser(
    id: string,
    fields: Partial<Pick<UserRow, "name" | "role" | "password_hash">>,
  ): Promise<void> {
    await this.withWrite(() => {
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
    });
  }

  // ── Futures sources ──

  async upsertFunding(rows: FundingRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const sql =
      "INSERT OR IGNORE INTO futures_funding (symbol, ts, rate) VALUES (?, ?, ?)";
    return await this.withWrite(() => {
      let count = 0;
      const stmt = this.prep(sql);
      for (const r of rows) {
        if (Number(stmt.run(r.symbol, r.ts, r.rate).changes) > 0) count++;
      }
      return count;
    });
  }

  async upsertOpenInterest(rows: OIRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const sql =
      "INSERT OR IGNORE INTO futures_oi (symbol, ts, open_interest) VALUES (?, ?, ?)";
    return await this.withWrite(() => {
      let count = 0;
      const stmt = this.prep(sql);
      for (const r of rows) {
        if (Number(stmt.run(r.symbol, r.ts, r.open_interest).changes) > 0)
          count++;
      }
      return count;
    });
  }

  async upsertLsRatio(rows: LsRatioRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const sql =
      "INSERT OR IGNORE INTO futures_ls_ratio (symbol, ts, long_account, short_account, long_position, short_position) VALUES (?, ?, ?, ?, ?, ?)";
    return await this.withWrite(() => {
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
    });
  }

  async upsertLiquidations(rows: LiquidationRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const sql =
      "INSERT OR IGNORE INTO liquidations (id, symbol, ts, side, price, qty, usd) VALUES (?, ?, ?, ?, ?, ?, ?)";
    return await this.withWrite(() => {
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
    });
  }

  getFunding(symbol: string, limit = 50): FundingRow[] {
    return allRows<FundingRow>(
      this.prep(
        "SELECT * FROM futures_funding WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
      ),
      symbol,
      limit,
    );
  }

  getOpenInterest(symbol: string, limit = 50): OIRow[] {
    return allRows<OIRow>(
      this.prep(
        "SELECT * FROM futures_oi WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
      ),
      symbol,
      limit,
    );
  }

  getLsRatio(symbol: string, limit = 50): LsRatioRow[] {
    return allRows<LsRatioRow>(
      this.prep(
        "SELECT * FROM futures_ls_ratio WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
      ),
      symbol,
      limit,
    );
  }

  getLiquidations(symbol?: string, limit = 50): LiquidationRow[] {
    if (symbol) {
      return allRows<LiquidationRow>(
        this.prep(
          "SELECT * FROM liquidations WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        ),
        symbol,
        limit,
      );
    }
    return allRows<LiquidationRow>(
      this.prep("SELECT * FROM liquidations ORDER BY ts DESC LIMIT ?"),
      limit,
    );
  }

  // ── Fear & Greed ──

  async upsertFearGreed(row: FearGreedRow): Promise<void> {
    await this.withWrite(() => {
      this.prep(
        "INSERT OR REPLACE INTO fear_greed (ts, value, classification) VALUES (?, ?, ?)",
      ).run(row.ts, row.value, row.classification);
    });
  }

  getFearGreed(limit = 30): FearGreedRow[] {
    return allRows<FearGreedRow>(
      this.prep("SELECT * FROM fear_greed ORDER BY ts DESC LIMIT ?"),
      limit,
    );
  }

  // ── Order Book ──

  async upsertOrderBook(row: OrderBookRow): Promise<void> {
    await this.withWrite(() => {
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
    });
  }

  getOrderBook(symbol: string, limit = 50): OrderBookRow[] {
    return allRows<OrderBookRow>(
      this.prep(
        "SELECT * FROM orderbook WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
      ),
      symbol,
      limit,
    );
  }

  // ── Cross Asset ──

  async upsertCrossAsset(row: CrossAssetRow): Promise<void> {
    await this.withWrite(() => {
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
    });
  }

  getCrossAsset(limit = 50): CrossAssetRow[] {
    const cacheKey = `cross_asset:${limit}`;
    const cached = getGlobalCache().get<CrossAssetRow[]>(cacheKey);
    if (cached) return cached;
    const result = allRows<CrossAssetRow>(
      this.prep("SELECT * FROM cross_asset ORDER BY ts DESC LIMIT ?"),
      limit,
    );
    getGlobalCache().set(cacheKey, result, 60_000);
    return result;
  }

  // ── Predictions (F4) ──

  async upsertPrediction(row: PredictionRow): Promise<void> {
    await this.withWrite(() => {
      this.prep(
        `INSERT OR REPLACE INTO predictions
        (id, symbol, ts, direction, confidence, model_id, horizon, ml_score, features_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    });
  }

  getPredictions(filter?: {
    symbol?: string;
    model_id?: string;
    limit?: number;
    minConfidence?: number;
  }): PredictionRow[] {
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
      sql += " LIMIT 200";
      params.push(200);
    }
    return this.queryAll<PredictionRow>(sql, params);
  }

  /** Delete old predictions */
  async prunePredictions(olderThanMs: number): Promise<number> {
    return await this.withWrite(() => {
      const cutoff = olderThanMs.toString();
      const result = this.prep(
        "DELETE FROM predictions WHERE CAST(ts AS INTEGER) < ?",
      ).run(cutoff);
      return Number(result.changes);
    });
  }

  // ── Drift Events ──

  /** Insert a drift event */
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
    await this.withWrite(() => {
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
    });
  }

  /** Get recent drift events */
  getDriftEvents(filter?: { limit?: number }): Array<{
    id: string;
    ts: string;
    model_id: string;
    detector: string;
    symbol?: string;
    confidence?: number;
    message: string;
  }> {
    let sql = "SELECT * FROM drift_events ORDER BY ts DESC";
    const params: SQLInputValue[] = [];
    if (filter?.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    } else {
      sql += " LIMIT 50";
      params.push(50);
    }
    return this.queryAll(sql, params);
  }

  // ── Meta ──

  stats(): Record<string, number> {
    const tables = [
      "klines",
      "tickers",
      "ticker_history",
      "signals",
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
    for (const t of tables) {
      const row = oneRow<{ c: number }>(
        this.prep(`SELECT COUNT(*) AS c FROM ${t}`),
      );
      result[t] = row?.c ?? 0;
    }
    return result;
  }

  // ── Internal helpers ──

  private runInTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      log.error("Transaction rolled back", { error: String(err) });
      throw err;
    }
  }
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}
