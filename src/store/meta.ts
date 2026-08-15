import type { DbHandle } from './db.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'meta' });

export class MetaStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async stats(): Promise<Record<string, number>> {
    if (!this.h.db && !this.h.bq) {
      throw new Error("Database not initialized or closed");
    }
    if (this.h.db && !this.h.db.open) {
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

    if (this.h.bq) {
      for (const t of tables) {
        try {
          const sql = `SELECT COUNT(*) AS c FROM ${this.h.getTable(t)}`;
          const [rows] = await this.h.bq.query({ query: sql });
          result[t] = Number(rows[0]?.c ?? 0);
        } catch (err) {
          log.error(`Failed to count BigQuery table ${t}`, { error: String(err) });
          result[t] = 0;
        }
      }
      result["tickers"] = result["ticker_history"] ?? 0;
      result["signals"] = result["signal_history"] ?? 0;
    } else if (this.h.db) {
      for (const t of tables) {
        try {
          const row = this.h.oneRow<{ c: number }>(
            this.h.prep(`SELECT COUNT(*) AS c FROM ${t}`),
          );
          result[t] = row?.c ?? 0;
        } catch (err) {
          log.error(`Failed to count SQLite table ${t}`, { error: String(err) });
          result[t] = 0;
        }
      }
      try {
        result["tickers"] = this.h.oneRow<{ c: number }>(this.h.prep(`SELECT COUNT(*) AS c FROM tickers`))?.c ?? 0;
        result["signals"] = this.h.oneRow<{ c: number }>(this.h.prep(`SELECT COUNT(*) AS c FROM signals`))?.c ?? 0;
      } catch (err) {
        log.error('Failed to count tickers/signals', { error: String(err) });
        result["tickers"] = 0;
        result["signals"] = 0;
      }
    }
    return result;
  }
}
