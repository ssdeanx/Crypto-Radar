import type { DbHandle } from './db.js';
import type { PaperTradeRow } from '../types.js';
import type { SQLInputValue } from 'node:sqlite';

export class PaperTradeStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async upsertPaperTrade(t: PaperTradeRow): Promise<void> {
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      const table = dataset.table("paper_trades");
      await table.insert([{
        insertId: t.id,
        json: t,
      }], { ignoreUnknownValues: true });
    } else if (this.h.db) {
      this.h.prep(
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
    if (this.h.bq) {
      let sql = `SELECT id, profile, symbol, side, entry_price, entry_time, quantity, exit_price, exit_time, pnl, fees, status
                 FROM (
                   SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY COALESCE(exit_time, entry_time) DESC) as rn
                   FROM ${this.h.getTable("paper_trades")}
                   WHERE profile = @profile
                 )
                 WHERE rn = 1`;
      const params: Record<string, unknown> = { profile };
      if (status) {
        sql += " AND status = @status";
        params.status = status;
      }
      const [rows] = await this.h.bq.query({ query: sql, params });
      return rows as PaperTradeRow[];
    } else if (this.h.db) {
      let sql = "SELECT * FROM paper_trades WHERE profile = ?";
      const params: SQLInputValue[] = [profile];
      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
      return this.h.allRows<PaperTradeRow>(this.h.prep(sql), ...params);
    }
    return [];
  }
}
