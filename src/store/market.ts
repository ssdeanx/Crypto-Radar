import type { DbHandle } from './db.js';
import type { FearGreedRow, OrderBookRow, CrossAssetRow } from '../types.js';
import { getGlobalCache } from '../core/cache.js';

export class MarketStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  // ── Fear & Greed ──

  async upsertFearGreed(row: FearGreedRow): Promise<void> {
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      await dataset.table("fear_greed").insert([{
        insertId: String(row.ts),
        json: row,
      }], { ignoreUnknownValues: true });
    } else if (this.h.db) {
      this.h.prep(
        "INSERT OR REPLACE INTO fear_greed (ts, value, classification) VALUES (?, ?, ?)",
      ).run(row.ts, row.value, row.classification);
    }
  }

  async getFearGreed(limit = 30): Promise<FearGreedRow[]> {
    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("fear_greed")} ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.h.bq.query({ query: sql, params: { limit } });
      return rows as FearGreedRow[];
    } else if (this.h.db) {
      return this.h.allRows<FearGreedRow>(
        this.h.prep("SELECT * FROM fear_greed ORDER BY ts DESC LIMIT ?"),
        limit,
      );
    }
    return [];
  }

  // ── Order Book ──

  async upsertOrderBook(row: OrderBookRow): Promise<void> {
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      await dataset.table("orderbook").insert([{
        insertId: `${row.symbol}-${row.ts}`,
        json: row,
      }], { ignoreUnknownValues: true });
    } else if (this.h.db) {
      this.h.prep(
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
    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("orderbook")} WHERE symbol = @symbol ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.h.bq.query({ query: sql, params: { symbol, limit } });
      return rows as OrderBookRow[];
    } else if (this.h.db) {
      return this.h.allRows<OrderBookRow>(
        this.h.prep(
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
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      await dataset.table("cross_asset").insert([{
        insertId: String(row.ts),
        json: row,
      }], { ignoreUnknownValues: true });
    } else if (this.h.db) {
      this.h.prep(
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

    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("cross_asset")} ORDER BY ts DESC LIMIT @limit`;
      const [rows] = await this.h.bq.query({ query: sql, params: { limit } });
      result = rows as CrossAssetRow[];
    } else if (this.h.db) {
      result = this.h.allRows<CrossAssetRow>(
        this.h.prep("SELECT * FROM cross_asset ORDER BY ts DESC LIMIT ?"),
        limit,
      );
    }

    getGlobalCache().set(cacheKey, result, 60_000);
    return result;
  }
}
