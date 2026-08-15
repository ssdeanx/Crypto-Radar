import type { DbHandle } from './db.js';
import type { KlineRow } from '../types.js';
import type { SQLInputValue } from 'node:sqlite';
import { getGlobalCache } from '../core/cache.js';

export class KlineStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async upsertKlines(rows: KlineRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      const table = dataset.table("klines");
      const insertRows = rows.map(r => ({
        insertId: `${r.symbol}-${r.interval}-${r.open_time}`,
        json: r,
      }));
      await table.insert(insertRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.h.db) {
      const sql = `INSERT OR IGNORE INTO klines (symbol, interval, open_time, open, high, low, close, volume, quote_volume, taker_buy_vol, taker_buy_quote_vol)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      let count = 0;
      const stmt = this.h.prep(sql);
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

    if (this.h.bq) {
      let sql = `SELECT * FROM ${this.h.getTable("klines")} WHERE symbol = @symbol AND interval = @interval`;
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
      const [bqRows] = await this.h.bq.query({ query: sql, params });
      result = bqRows as KlineRow[];
    } else if (this.h.db) {
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
      result = this.h.allRows<KlineRow>(this.h.prep(sql), ...params);
    }

    getGlobalCache().set(cacheKey, result, 60_000);
    return result;
  }

  async latestKlineTime(symbol: string, interval: string): Promise<number | null> {
    if (this.h.bq) {
      const sql = `SELECT MAX(open_time) AS t FROM ${this.h.getTable("klines")} WHERE symbol = @symbol AND interval = @interval`;
      const [rows] = await this.h.bq.query({ query: sql, params: { symbol, interval } });
      const val = rows[0]?.t;
      return val !== undefined && val !== null ? Number(val) : null;
    } else if (this.h.db) {
      const row = this.h.oneRow<{ t: number | null }>(
        this.h.prep("SELECT MAX(open_time) AS t FROM klines WHERE symbol = ? AND interval = ?"),
        symbol,
        interval,
      );
      return row?.t ?? null;
    }
    return null;
  }

  async klineCount(symbol?: string, interval?: string): Promise<number> {
    if (this.h.bq) {
      let sql = `SELECT COUNT(*) AS c FROM ${this.h.getTable("klines")}`;
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
      const [rows] = await this.h.bq.query({ query: sql, params });
      return Number(rows[0]?.c ?? 0);
    } else if (this.h.db) {
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
      const row = this.h.oneRow<{ c: number }>(this.h.prep(sql), ...params);
      return row?.c ?? 0;
    }
    return 0;
  }
}
