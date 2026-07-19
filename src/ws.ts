// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Binance WebSocket Client
// ═══════════════════════════════════════════════════════════════════════
//
// Uses native WebSocket (Node 22+ built-in, no ws package needed).
// Connects to Binance public streams — no API key required.
//
// Streams:
//   <symbol>@ticker        — 24hr rolling ticker (1s updates)
//   <symbol>@kline_<int>   — kline/candlestick data
//   <symbol>@depth20@100ms — top 20 bids/asks (100ms updates)
//
// Combined streams: wss://stream.binance.com:9443/stream?streams=...
//
// Design:
//   - Automatic reconnection with exponential backoff (1s → 30s max)
//   - Event emitter pattern
//   - Graceful degradation (scan falls back to REST on connection failure)

import { logger } from './core/logger.js';
import { logWarn } from './core/errors.js';

const BASE_WS = 'wss://stream.binance.com:9443/ws';
const COMBINED_WS = 'wss://stream.binance.com:9443/stream';

// ── Event handler type ────────────────────────────────────────────────

export type WsEventHandler = (data: Record<string, unknown>) => void;

// ── Types ──────────────────────────────────────────────────────────────

export interface WsTickerEvent {
  /** Event type (always "24hrTicker") */
  e: string;
  /** Event time */
  E: number;
  /** Trading pair symbol */
  s: string;
  /** Price change */
  p: string;
  /** Price change percent */
  P: string;
  /** Weighted average price */
  w: string;
  /** Last price */
  c: string;
  /** Close time */
  C: number;
  /** Open price */
  o: string;
  /** High price */
  h: string;
  /** Low price */
  l: string;
  /** Volume (base asset) */
  v: string;
  /** Quote volume */
  q: string;
  /** Number of trades */
  n: number;
}

export interface WsKlineEvent {
  /** Event type (always "kline") */
  e: string;
  /** Event time */
  E: number;
  /** Trading pair symbol */
  s: string;
  k: {
    /** Kline interval */
    i: string;
    /** Open time */
    t: number;
    /** Close time */
    T: number;
    /** Open price */
    o: string;
    /** High price */
    h: string;
    /** Low price */
    l: string;
    /** Close price */
    c: string;
    /** Volume */
    v: string;
    /** Is this kline closed? */
    x: boolean;
    /** Quote volume */
    q: string;
    /** Taker buy base volume */
    V: string;
    /** Taker buy quote volume */
    Q: string;
    /** Number of trades */
    n: number;
  };
}

// ── Client ─────────────────────────────────────────────────────────────

export class BinanceWsClient {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, WsEventHandler[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30_000;
  private baseReconnectDelay = 1_000;
  private shouldReconnect = true;
  private combinedMode = false;
  private log = logger.child({ module: 'ws' });

  /**
   * Connect to Binance WebSocket streams.
   * @param streams Array of stream names (e.g. ['btcusdt@ticker', 'ethusdt@ticker'])
   * @param handler Callback for all events from these streams
   */
  connect(streams: string[], handler: WsEventHandler): void {
    if (streams.length === 0) return;

    // Register subscription
    for (const stream of streams) {
      if (!this.subscriptions.has(stream)) {
        this.subscriptions.set(stream, []);
      }
      this.subscriptions.get(stream)!.push(handler);
    }

    // Build URL — use combined stream for multiple streams
    let url: string;
    if (streams.length === 1) {
      url = `${BASE_WS}/${streams[0]!}`;
      this.combinedMode = false;
    } else {
      url = `${COMBINED_WS}?streams=${streams.join('/')}`;
      this.combinedMode = true;
    }

    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this._connect(url);
  }

  /**
   * Subscribe to additional streams on an already-open connection.
   */
  subscribe(stream: string, handler: WsEventHandler): void {
    if (!this.subscriptions.has(stream)) {
      this.subscriptions.set(stream, []);
    }
    this.subscriptions.get(stream)!.push(handler);

    // Can't add streams to an existing WebSocket without reconnecting
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.disconnect();
      this._connectAll();
    }
  }

  /**
   * Disconnect and stop reconnecting.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this._closeWs();
  }

  /**
   * Get current connection state.
   */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get reconnectCount(): number {
    return this.reconnectAttempts;
  }

  // ── Private ──

  private _connect(url: string): void {
    if (this.ws) this._closeWs();

    try {
      this.log.info(`Connecting to Binance WS: ${url.replace(BASE_WS, '').replace(COMBINED_WS, '')}...`);
      const ws = new WebSocket(url);

      ws.addEventListener('open', () => {
        this.reconnectAttempts = 0;
        this.log.info('WebSocket connected');
      });

      ws.addEventListener('message', (event: MessageEvent) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const parsed = JSON.parse(raw);

          // Combined stream wraps data: { stream: "...", data: {...} }
          // Single stream returns the data directly
          const streamName = parsed.stream as string | undefined;
          const data = (streamName ? parsed.data : parsed) as Record<string, unknown>;

          if (streamName && this.subscriptions.has(streamName)) {
            for (const h of this.subscriptions.get(streamName)!) {
              h(data);
            }
          } else if (!streamName) {
            // Single stream — dispatch to all handlers
            for (const handlers of this.subscriptions.values()) {
              for (const h of handlers) {
                h(data);
              }
            }
          }
        } catch (err) {
          logWarn("ws", "Failed to parse WS message", err);
          // Malformed JSON — skip silently
        }
      });

      ws.addEventListener('close', () => {
        this.log.warn('WebSocket disconnected');
        this._scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        // 'close' event fires after 'error', reconnection handled there
      });

      this.ws = ws;
    } catch (err) {
      this.log.error('Failed to create WebSocket', { error: String(err) });
      this._scheduleReconnect();
    }
  }

  private _connectAll(): void {
    if (this.subscriptions.size === 0) return;

    const allStreams = Array.from(this.subscriptions.keys());
    const url = allStreams.length === 1
      ? `${BASE_WS}/${allStreams[0]!}`
      : `${COMBINED_WS}?streams=${allStreams.join('/')}`;

    this.combinedMode = allStreams.length > 1;
    this._connect(url);
  }

  private _closeWs(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  private _scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    );

    this.log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    setTimeout(() => this._connectAll(), delay);
  }
}

// ── Helper: Build ticker stream names ──

/**
 * Get Binance WebSocket stream names for 24hr tickers.
 * @param symbols Array of trading symbols (e.g. ['BTCUSDT', 'SOLUSDT'])
 * @returns Array of stream names
 */
export function tickerStreams(symbols: string[]): string[] {
  return symbols.map(s => `${s.toLowerCase()}@ticker`);
}

/**
 * Get Binance WebSocket stream names for klines.
 * @param symbols Array of trading symbols
 * @param interval Kline interval (default: '1h')
 * @returns Array of stream names
 */
export function klineStreams(symbols: string[], interval = '1h'): string[] {
  return symbols.map(s => `${s.toLowerCase()}@kline_${interval}`);
}
