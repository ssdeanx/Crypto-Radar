import type { DbHandle } from './db.js';
import type { TickerRow } from '../types.js';
import type { SQLInputValue } from 'node:sqlite';

export class TickerStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async getLatestTickers(filter?: {
    symbol?: string;
    chain?: string;
    limit?: number;
  }): Promise<TickerRow[]> {
    if (this.h.bq) {
      let sql = `SELECT symbol, ts_utc, price, price_change_pct, volume, quote_volume, rsi, macd_hist, bb_width, atr_pct, adx, regime, composite_score
                 FROM (
                   SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ts_utc DESC) as rn
                   FROM ${this.h.getTable("ticker_history")}
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
      const [rows] = await this.h.bq.query({ query: sql, params });
      return rows as TickerRow[];
    } else if (this.h.db) {
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
      return this.h.allRows<TickerRow>(this.h.prep(sql), ...params);
    }
    return [];
  }

  async getTickerHistory(
    symbol: string,
    opts?: { from?: string; limit?: number; order?: "asc" | "desc" },
  ): Promise<TickerRow[]> {
    if (this.h.bq) {
      let sql = `SELECT * FROM ${this.h.getTable("ticker_history")} WHERE symbol = @symbol`;
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
      const [rows] = await this.h.bq.query({ query: sql, params });
      return rows as TickerRow[];
    } else if (this.h.db) {
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
      return this.h.allRows<TickerRow>(this.h.prep(sql), ...params);
    }
    return [];
  }
}
