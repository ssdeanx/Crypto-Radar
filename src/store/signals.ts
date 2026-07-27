import type { DbHandle } from './db.js';
import type { SignalRow } from '../types.js';
import type { SQLInputValue } from 'node:sqlite';

export class SignalStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async getSignals(filter?: {
    symbol?: string;
    minScore?: number;
    direction?: string;
    limit?: number;
  }): Promise<SignalRow[]> {
    if (this.h.bq) {
      let sql = `SELECT symbol, ts_utc, composite_score, direction, momentum_score, mean_reversion_score, trend_following_score, regime, adx
                 FROM (
                   SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY ts_utc DESC) as rn
                   FROM ${this.h.getTable("signal_history")}
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
      const [rows] = await this.h.bq.query({ query: sql, params });
      return rows as SignalRow[];
    } else if (this.h.db) {
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
      return this.h.allRows<SignalRow>(this.h.prep(sql), ...params);
    }
    return [];
  }

  async getSignalHistory(
    symbol: string,
    opts?: { from?: string; limit?: number; order?: "asc" | "desc" },
  ): Promise<SignalRow[]> {
    if (this.h.bq) {
      let sql = `SELECT * FROM ${this.h.getTable("signal_history")} WHERE symbol = @symbol`;
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
      return rows as SignalRow[];
    } else if (this.h.db) {
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
      return this.h.allRows<SignalRow>(this.h.prep(sql), ...params);
    }
    return [];
  }
}
