import type { DbHandle } from './db.js';
import type { NewsRow } from '../types.js';
import type { SQLInputValue } from 'node:sqlite';

export class NewsStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async getNews(filter?: { symbol?: string; limit?: number }): Promise<NewsRow[]> {
    if (this.h.bq) {
      let sql = `SELECT * FROM ${this.h.getTable("news")}`;
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
      const [rows] = await this.h.bq.query({ query: sql, params });
      return rows as NewsRow[];
    } else if (this.h.db) {
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
      return this.h.allRows<NewsRow>(this.h.prep(sql), ...params);
    }
    return [];
  }
}
