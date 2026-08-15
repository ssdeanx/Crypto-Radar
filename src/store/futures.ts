import type { DbHandle } from './db.js';
import type { FundingRow, OIRow, LsRatioRow, LiquidationRow } from '../types.js';
export class FuturesStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async upsertFunding(rows: FundingRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      const bqRows = rows.map(r => ({
        insertId: `${r.symbol}-${r.ts}`,
        json: r,
      }));
      await dataset.table("futures_funding").insert(bqRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.h.db) {
      const sql =
        "INSERT OR IGNORE INTO futures_funding (symbol, ts, rate) VALUES (?, ?, ?)";
      let count = 0;
      const stmt = this.h.prep(sql);
      for (const r of rows) {
        if (Number(stmt.run(r.symbol, r.ts, r.rate).changes) > 0) count++;
      }
      return count;
    }
    return 0;
  }

  async upsertOpenInterest(rows: OIRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      const bqRows = rows.map(r => ({
        insertId: `${r.symbol}-${r.ts}`,
        json: r,
      }));
      await dataset.table("futures_oi").insert(bqRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.h.db) {
      const sql =
        "INSERT OR IGNORE INTO futures_oi (symbol, ts, open_interest) VALUES (?, ?, ?)";
      let count = 0;
      const stmt = this.h.prep(sql);
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
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      const bqRows = rows.map(r => ({
        insertId: `${r.symbol}-${r.ts}`,
        json: r,
      }));
      await dataset.table("futures_ls_ratio").insert(bqRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.h.db) {
      const sql =
        "INSERT OR IGNORE INTO futures_ls_ratio (symbol, ts, long_account, short_account, long_position, short_position) VALUES (?, ?, ?, ?, ?, ?)";
      let count = 0;
      const stmt = this.h.prep(sql);
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
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      const bqRows = rows.map(r => ({
        insertId: r.id,
        json: r,
      }));
      await dataset.table("liquidations").insert(bqRows, { ignoreUnknownValues: true });
      return rows.length;
    } else if (this.h.db) {
      const sql =
        "INSERT OR IGNORE INTO liquidations (id, symbol, ts, side, price, qty, usd) VALUES (?, ?, ?, ?, ?, ?, ?)";
      let count = 0;
      const stmt = this.h.prep(sql);
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
    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("futures_funding")} WHERE symbol = @symbol ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.h.bq.query({ query: sql, params: { symbol, limit } });
      return rows as FundingRow[];
    } else if (this.h.db) {
      return this.h.allRows<FundingRow>(
        this.h.prep(
          "SELECT * FROM futures_funding WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        ),
        symbol,
        limit,
      );
    }
    return [];
  }

  async getOpenInterest(symbol: string, limit = 50): Promise<OIRow[]> {
    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("futures_oi")} WHERE symbol = @symbol ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.h.bq.query({ query: sql, params: { symbol, limit } });
      return rows as OIRow[];
    } else if (this.h.db) {
      return this.h.allRows<OIRow>(
        this.h.prep(
          "SELECT * FROM futures_oi WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        ),
        symbol,
        limit,
      );
    }
    return [];
  }

  async getLsRatio(symbol: string, limit = 50): Promise<LsRatioRow[]> {
    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("futures_ls_ratio")} WHERE symbol = @symbol ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.h.bq.query({ query: sql, params: { symbol, limit } });
      return rows as LsRatioRow[];
    } else if (this.h.db) {
      return this.h.allRows<LsRatioRow>(
        this.h.prep(
          "SELECT * FROM futures_ls_ratio WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
        ),
        symbol,
        limit,
      );
    }
    return [];
  }

  async getLiquidations(symbol?: string, limit = 50): Promise<LiquidationRow[]> {
    if (this.h.bq) {
      let sql = `SELECT * FROM ${this.h.getTable("liquidations")}`;
      const params: Record<string, unknown> = { limit };
      if (symbol) {
        sql += " WHERE symbol = @symbol";
        params.symbol = symbol;
      }
      sql += " ORDER BY ts DESC LIMIT @limit";
      const [rows] = await this.h.bq.query({ query: sql, params });
      return rows as LiquidationRow[];
    } else if (this.h.db) {
      if (symbol) {
        return this.h.allRows<LiquidationRow>(
          this.h.prep(
            "SELECT * FROM liquidations WHERE symbol = ? ORDER BY ts DESC LIMIT ?",
          ),
          symbol,
          limit,
        );
      }
      return this.h.allRows<LiquidationRow>(
        this.h.prep("SELECT * FROM liquidations ORDER BY ts DESC LIMIT ?"),
        limit,
      );
    }
    return [];
  }
}
