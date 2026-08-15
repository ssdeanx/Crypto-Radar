import type { DbHandle } from './db.js';
import type { PredictionRow, TokenTraceRow } from '../types.js';
import type { SQLInputValue } from 'node:sqlite';
import { isCloudMode } from '../core/config.js';

export class PredictionStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async upsertPrediction(row: PredictionRow & { reasoning?: string; outcome?: number; outcome_classification?: string }): Promise<void> {
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      await dataset.table("predictions").insert([{
        insertId: row.id,
        json: {
          id: row.id,
          symbol: row.symbol,
          ts: row.ts,
          direction: row.direction,
          confidence: row.confidence,
          model_id: row.model_id,
          horizon: row.horizon,
          ml_score: row.ml_score ?? null,
          features_hash: row.features_hash ?? null,
          reasoning: row.reasoning ?? null,
          outcome: row.outcome ?? null,
          outcome_classification: row.outcome_classification ?? null,
        },
      }], { ignoreUnknownValues: true });
    } else if (this.h.db) {
      this.h.prep(
        `INSERT OR REPLACE INTO predictions
        (id, symbol, ts, direction, confidence, model_id, horizon, ml_score, features_hash, reasoning, outcome, outcome_classification)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.reasoning ?? null,
        row.outcome ?? null,
        row.outcome_classification ?? null,
      );
      if (isCloudMode() && this.h.syncToBucket) {
        await this.h.syncToBucket();
      }
    }
  }

  async persistTrace(row: TokenTraceRow): Promise<void> {
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      await dataset.table("token_traces").insert([{
        insertId: row.trace_id,
        json: {
          trace_id: row.trace_id,
          run_id: row.run_id,
          symbol: row.symbol,
          token_id: row.token_id,
          observed_at: row.observed_at,
          outcome_at: row.outcome_at ?? null,
          last_price: row.last_price ?? null,
          price_change_pct: row.price_change_pct ?? null,
          volume: row.volume ?? null,
          spread_pct: row.spread_pct ?? null,
          market_cap: row.market_cap ?? null,
          composite_score: row.composite_score ?? null,
          direction: row.direction ?? null,
          regime: row.regime ?? null,
          rsi: row.rsi ?? null,
          macd_histogram: row.macd_histogram ?? null,
          bb_width: row.bb_width ?? null,
          atr_pct: row.atr_pct ?? null,
          adx: row.adx ?? null,
          analysis_text: row.analysis_text ?? null,
          prediction_direction: row.prediction_direction ?? null,
          prediction_confidence: row.prediction_confidence ?? null,
          gemini_raw: row.gemini_raw ?? null,
          needs_analysis: row.needs_analysis ?? 1,
          analyzed_at: row.analyzed_at ?? null,
          outcome_price: row.outcome_price ?? null,
          outcome_change_pct: row.outcome_change_pct ?? null,
          outcome_high: row.outcome_high ?? null,
          outcome_low: row.outcome_low ?? null,
          outcome_volume: row.outcome_volume ?? null,
          outcome_is_rugpull: row.outcome_is_rugpull ?? 0,
          outcome_pnl_pct: row.outcome_pnl_pct ?? null,
          outcome_classification: row.outcome_classification ?? null,
          outcome_evaluated: row.outcome_evaluated ?? 0,
          outcome_evaluated_at: row.outcome_evaluated_at ?? null,
          created_at: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || new Date().toISOString(),
        },
      }], { ignoreUnknownValues: true });
    } else if (this.h.db) {
      this.h.prep(
        `INSERT OR REPLACE INTO token_traces
        (trace_id, run_id, symbol, token_id, observed_at, outcome_at, last_price, price_change_pct, volume, spread_pct,
         market_cap, composite_score, direction, regime, rsi, macd_histogram, bb_width, atr_pct, adx,
         analysis_text, prediction_direction, prediction_confidence, gemini_raw, needs_analysis, analyzed_at,
         outcome_price, outcome_change_pct, outcome_high, outcome_low, outcome_volume, outcome_is_rugpull,
         outcome_pnl_pct, outcome_classification, outcome_evaluated, outcome_evaluated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.trace_id,
        row.run_id,
        row.symbol,
        row.token_id ?? null,
        row.observed_at,
        row.outcome_at ?? null,
        row.last_price ?? null,
        row.price_change_pct ?? null,
        row.volume ?? null,
        row.spread_pct ?? null,
        row.market_cap ?? null,
        row.composite_score ?? null,
        row.direction ?? null,
        row.regime ?? null,
        row.rsi ?? null,
        row.macd_histogram ?? null,
        row.bb_width ?? null,
        row.atr_pct ?? null,
        row.adx ?? null,
        row.analysis_text ?? null,
        row.prediction_direction ?? null,
        row.prediction_confidence ?? null,
        row.gemini_raw ?? null,
        row.needs_analysis ?? 1,
        row.analyzed_at ?? null,
        row.outcome_price ?? null,
        row.outcome_change_pct ?? null,
        row.outcome_high ?? null,
        row.outcome_low ?? null,
        row.outcome_volume ?? null,
        row.outcome_is_rugpull ?? 0,
        row.outcome_pnl_pct ?? null,
        row.outcome_classification ?? null,
        row.outcome_evaluated ?? 0,
        row.outcome_evaluated_at ?? null,
        row.created_at || new Date().toISOString(),
        row.updated_at || new Date().toISOString(),
      );
      if (isCloudMode() && this.h.syncToBucket) {
        await this.h.syncToBucket();
      }
    }
  }

  async updateTrace(traceId: string, updates: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(updates);
    if (keys.length === 0) return;

    updates.updated_at = new Date().toISOString();
    const updatedKeys = Object.keys(updates);

    if (this.h.bq) {
      const setClause = updatedKeys.map(k => `${k} = @${k}`).join(", ");
      const query = `UPDATE ${this.h.getTable("token_traces")} SET ${setClause} WHERE trace_id = @traceId`;
      await this.h.bq.query({
        query,
        params: { ...updates, traceId },
      });
    } else if (this.h.db) {
      const setClause = updatedKeys.map(k => `${k} = ?`).join(", ");
      const query = `UPDATE token_traces SET ${setClause} WHERE trace_id = ?`;
      const params = updatedKeys.map(k => updates[k] as SQLInputValue);
      params.push(traceId);
      this.h.prep(query).run(...params);
      if (isCloudMode() && this.h.syncToBucket) {
        await this.h.syncToBucket();
      }
    }
  }

  async getTracesNeedingAnalysis(limit = 50): Promise<TokenTraceRow[]> {
    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("token_traces")} WHERE needs_analysis = 1 ORDER BY observed_at ASC LIMIT @limit`;
      const [rows] = await this.h.bq.query({ query: sql, params: { limit } });
      return rows as TokenTraceRow[];
    } else if (this.h.db) {
      return this.h.allRows<TokenTraceRow>(
        this.h.prep("SELECT * FROM token_traces WHERE needs_analysis = 1 ORDER BY observed_at ASC LIMIT ?"),
        limit,
      );
    }
    return [];
  }

  async getTracesNeedingOutcome(limit = 100): Promise<TokenTraceRow[]> {
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000; // 24h ago
    const cutoffIso = new Date(cutoffMs).toISOString();
    if (this.h.bq) {
      const sql = `SELECT * FROM ${this.h.getTable("token_traces")} WHERE outcome_evaluated = 0 AND observed_at < @cutoff ORDER BY observed_at ASC LIMIT @limit`;
      const [rows] = await this.h.bq.query({ query: sql, params: { cutoff: cutoffIso, limit } });
      return rows as TokenTraceRow[];
    } else if (this.h.db) {
      return this.h.allRows<TokenTraceRow>(
        this.h.prep("SELECT * FROM token_traces WHERE outcome_evaluated = 0 AND observed_at < ? ORDER BY observed_at ASC LIMIT ?"),
        cutoffIso,
        limit,
      );
    }
    return [];
  }

  async getPredictions(filter?: {
    symbol?: string;
    model_id?: string;
    limit?: number;
    minConfidence?: number;
  }): Promise<PredictionRow[]> {
    if (this.h.bq) {
      let sql = `SELECT * FROM ${this.h.getTable("predictions")} WHERE 1=1`;
      const params: Record<string, unknown> = {};
      if (filter?.symbol) {
        sql += " AND symbol = @symbol";
        params.symbol = filter.symbol;
      }
      if (filter?.model_id) {
        sql += " AND model_id = @model_id";
        params.model_id = filter.model_id;
      }
      if (filter?.minConfidence !== undefined) {
        sql += " AND confidence >= @minConfidence";
        params.minConfidence = filter.minConfidence;
      }
      sql += " ORDER BY ts DESC";
      if (filter?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = filter.limit;
      } else {
        sql += " LIMIT 200";
        params.limit = 200;
      }
      const [rows] = await this.h.bq.query({ query: sql, params });
      return rows as PredictionRow[];
    } else if (this.h.db) {
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
        sql += " LIMIT ?";
        params.push(200);
      }
      return this.h.allRows<PredictionRow>(this.h.prep(sql), ...params);
    }
    return [];
  }

  async prunePredictions(olderThanMs: number): Promise<number> {
    if (this.h.bq) {
      const cutoff = String(olderThanMs);
      const sql = `DELETE FROM ${this.h.getTable("predictions")} WHERE CAST(ts AS INT64) < @cutoff`;
      await this.h.bq.query({ query: sql, params: { cutoff } });
      return 1;
    } else if (this.h.db) {
      const cutoff = olderThanMs.toString();
      const result = this.h.prep(
        "DELETE FROM predictions WHERE CAST(ts AS INTEGER) < ?",
      ).run(cutoff);
      return Number(result.changes);
    }
    return 0;
  }

  // ── Drift Events ──

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
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);
      await dataset.table("drift_events").insert([{
        insertId: event.id,
        json: event,
      }], { ignoreUnknownValues: true });
    } else if (this.h.db) {
      this.h.prep(`
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
    }
  }

  async getDriftEvents(filter?: { limit?: number }): Promise<Array<{
    id: string;
    ts: string;
    model_id: string;
    detector: string;
    symbol?: string;
    confidence?: number;
    message: string;
  }>> {
    if (this.h.bq) {
      let sql = `SELECT * FROM ${this.h.getTable("drift_events")} ORDER BY ts DESC`;
      const params: Record<string, unknown> = {};
      if (filter?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = filter.limit;
      } else {
        sql += " LIMIT 50";
        params.limit = 50;
      }
      const [rows] = await this.h.bq.query({ query: sql, params });
      return rows as Array<{
        id: string;
        ts: string;
        model_id: string;
        detector: string;
        symbol?: string;
        confidence?: number;
        message: string;
      }>;
    } else if (this.h.db) {
      let sql = "SELECT * FROM drift_events ORDER BY ts DESC";
      const params: SQLInputValue[] = [];
      if (filter?.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(filter.limit);
      } else {
        sql += " LIMIT ?";
        params.push(50);
      }
      return this.h.allRows(this.h.prep(sql), ...params);
    }
    return [];
  }
}
