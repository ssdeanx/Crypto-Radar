import type { DbHandle } from './db.js';
import type { EnrichedTicker, NewsMatch, TokenSignal, TaskPayload } from '../types.js';
import type { SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { isCloudMode } from '../core/config.js';
import { logger } from '../core/logger.js';

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

export class ScanArchiveStore {
  private h: DbHandle;

  constructor(h: DbHandle) {
    this.h = h;
  }

  async persistRun(result: {
    tickers: EnrichedTicker[];
    newsMatches: NewsMatch[];
    signals: TokenSignal[];
  }): Promise<void> {
    if (this.h.bq) {
      const dataset = this.h.bq.dataset(this.h.datasetId);

      if (result.tickers.length > 0) {
        const table = dataset.table("ticker_history");
        const bqRows = result.tickers.map(t => ({
          insertId: `${t.symbol}-${t.tsUtc}`,
          json: {
            symbol: t.symbol,
            ts_utc: t.tsUtc,
            price: t.lastPrice,
            price_change_pct: t.priceChangePercent,
            volume: t.volume,
            quote_volume: t.quoteVolume,
            rsi: t.rsi ?? null,
            macd_hist: t.macdHistogram ?? null,
            bb_width: t.bbWidth ?? null,
            atr_pct: t.atrPct ?? null,
            adx: t.adx ?? null,
            regime: t.regime ?? null,
            composite_score: t.compositeScore ?? null,
          },
        }));
        await table.insert(bqRows, { ignoreUnknownValues: true });

        // ── Populate token_traces in BigQuery ──
        const tracesTable = dataset.table("token_traces");
        const bqTraces = result.tickers.map(t => {
          const matchingSignal = result.signals.find(s => s.symbol === t.symbol);
          const traceId = sha1(`${t.symbol}-${t.tsUtc}-trace`);
          return {
            insertId: traceId,
            json: {
              trace_id: traceId,
              run_id: t.runId || `RADAR-${Date.now().toString(36).toUpperCase()}`,
              symbol: t.symbol,
              token_id: t.tokenId,
              observed_at: t.tsUtc,
              last_price: t.lastPrice,
              price_change_pct: t.priceChangePercent,
              volume: t.volume,
              spread_pct: t.spreadPct ?? null,
              market_cap: null,
              composite_score: t.compositeScore ?? null,
              direction: matchingSignal?.alerts?.[0] ?? null,
              regime: t.regime ?? null,
              rsi: t.rsi ?? null,
              macd_histogram: t.macdHistogram ?? null,
              bb_width: t.bbWidth ?? null,
              atr_pct: t.atrPct ?? null,
              adx: t.adx ?? null,
              needs_analysis: 1,
              outcome_evaluated: 0,
              outcome_is_rugpull: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          };
        });
        await tracesTable.insert(bqTraces, { ignoreUnknownValues: true });
      }

      if (result.signals.length > 0) {
        const table = dataset.table("signal_history");
        const bqRows = result.signals.map(s => ({
          insertId: `${s.symbol}-${s.timestamp}`,
          json: {
            symbol: s.symbol,
            ts_utc: s.timestamp,
            composite_score: s.compositeScore,
            direction: s.alerts?.[0] ?? null,
            momentum_score: s.momentumScore ?? null,
            mean_reversion_score: s.technicalScore ?? null,
            trend_following_score: s.newsScore ?? null,
            regime: s.regime ?? null,
            adx: s.adx ?? null,
          },
        }));
        await table.insert(bqRows, { ignoreUnknownValues: true });
      }

      if (result.newsMatches.length > 0) {
        const table = dataset.table("news");
        const bqRows = result.newsMatches.map(n => {
          const newsId = sha1(`${n.headline}|${n.source}|${n.tsUtc}`);
          return {
            insertId: newsId,
            json: {
              id: newsId,
              symbol: n.symbol,
              headline: n.headline,
              description: n.description,
              source: n.source,
              domain: n.domain,
              relevance: n.relevance,
              pub_date: n.tsUtc,
            },
          };
        });
        await table.insert(bqRows, { ignoreUnknownValues: true });
      }

      // ── Publish scan.complete event via Pub/Sub ──
      if (isCloudMode()) {
        try {
          const { PubSub } = await import('@google-cloud/pubsub');
          const pubsub = new PubSub();
          const topicName = process.env['RADAR__PUBSUB_TOPIC'] || 'crypto-radar-events';
          const topic = pubsub.topic(topicName);

          const runId = result.tickers[0]?.runId || `RADAR-${Date.now().toString(36).toUpperCase()}`;
          const tsUtc = result.tickers[0]?.tsUtc || new Date().toISOString();

          const messageData = {
            type: "scan.complete",
            runId,
            tsUtc,
            tokenCount: result.tickers.length,
            tickerSymbols: result.tickers.map(t => t.symbol),
            tickerIds: result.tickers.map(t => t.tokenId),
            signalCount: result.signals.length
          };

          const dataBuffer = Buffer.from(JSON.stringify(messageData));
          await topic.publishMessage({ data: dataBuffer });
          logger.info('[persistRun] Published scan.complete event');
        } catch (pubsubErr) {
          logger.error('[persistRun] Failed to publish PubSub event', { error: String(pubsubErr) });
        }
      }
    } else if (this.h.db) {
      const tickerSnapshot = this.h.prep(`INSERT OR REPLACE INTO tickers
        (symbol, ts_utc, price, price_change_pct, volume, quote_volume,
         rsi, macd_hist, bb_width, atr_pct, adx, regime, composite_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const tickerHistory = this.h.prep(`INSERT OR IGNORE INTO ticker_history
        (symbol, ts_utc, price, price_change_pct, volume, quote_volume,
         rsi, macd_hist, bb_width, atr_pct, adx, regime, composite_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const t of result.tickers) {
        const matchingSignal = result.signals.find(s => s.symbol === t.symbol);
        const traceId = sha1(`${t.symbol}-${t.tsUtc}-trace`);

        // Populate token_traces in SQLite
        this.h.prep(
          `INSERT OR REPLACE INTO token_traces
          (trace_id, run_id, symbol, token_id, observed_at, last_price, price_change_pct, volume, spread_pct, market_cap,
           rsi, macd_histogram, bb_width, atr_pct, adx, regime, composite_score, direction, needs_analysis, outcome_evaluated, outcome_is_rugpull, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)`,
        ).run(
          traceId,
          t.runId || `RADAR-${Date.now().toString(36).toUpperCase()}`,
          t.symbol,
          t.tokenId,
          t.tsUtc,
          t.lastPrice,
          t.priceChangePercent,
          t.volume,
          t.spreadPct ?? null,
          null,
          t.rsi ?? null,
          t.macdHistogram ?? null,
          t.bbWidth ?? null,
          t.atrPct ?? null,
          t.adx ?? null,
          t.regime ?? null,
          t.compositeScore ?? null,
          matchingSignal?.alerts?.[0] ?? null,
          new Date().toISOString(),
          new Date().toISOString()
        );

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

      const signalSnapshot = this.h.prep(`INSERT OR REPLACE INTO signals
        (symbol, ts_utc, composite_score, direction, momentum_score, mean_reversion_score, trend_following_score, regime, adx)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const signalHistory = this.h.prep(`INSERT OR IGNORE INTO signal_history
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

      const newsStmt = this.h.prep(`INSERT OR IGNORE INTO news
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

      // Local fallback queue trigger for development
      if (!isCloudMode()) {
        const runId = result.tickers[0]?.runId || `RADAR-${Date.now().toString(36).toUpperCase()}`;
        const tsUtc = result.tickers[0]?.tsUtc || new Date().toISOString();
        const payload: TaskPayload = {
          runId,
          tsUtc,
          tickers: result.tickers.map(t => ({ symbol: t.symbol, tokenId: t.tokenId })),
          signals: result.signals.map(s => ({ symbol: s.symbol, compositeScore: s.compositeScore }))
        };

        import('../core/queue.js').then(({ enqueueTask }) => {
          enqueueTask('crypto-radar-gemini-analysis', payload).catch((e: unknown) => logger.error('[persistRun] Gemini analysis enqueue failed', { error: String(e) }));
          enqueueTask('crypto-radar-paper-trade', payload).catch((e: unknown) => logger.error('[persistRun] Paper trade enqueue failed', { error: String(e) }));
        }).catch((e: unknown) => logger.error('[persistRun] Queue module import failed', { error: String(e) }));
      }
    }
  }

  async enforceRetention(days: number): Promise<void> {
    if (days <= 0) return;
    if (this.h.bq) {
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      const cutoffTs = String(Date.now() - days * 86400_000);
      await this.h.bq.query({ query: `DELETE FROM ${this.h.getTable("ticker_history")} WHERE ts_utc < @cutoff`, params: { cutoff } });
      await this.h.bq.query({ query: `DELETE FROM ${this.h.getTable("signal_history")} WHERE ts_utc < @cutoff`, params: { cutoff } });
      await this.h.bq.query({ query: `DELETE FROM ${this.h.getTable("predictions")} WHERE ts < @cutoff_ts`, params: { cutoff_ts: cutoffTs } });
      logger.info(`[retention] Pruned BigQuery history older than ${cutoff}`);
    } else if (this.h.db) {
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      this.h.prep("DELETE FROM ticker_history WHERE ts_utc < ?").run(cutoff);
      this.h.prep("DELETE FROM signal_history WHERE ts_utc < ?").run(cutoff);
      const oldTs = Date.now() - days * 86400_000;
      this.h.prep("DELETE FROM predictions WHERE ts < ?").run(String(oldTs));
      logger.info(`[retention] Pruned local store older than ${cutoff}`);
    }
  }
}
