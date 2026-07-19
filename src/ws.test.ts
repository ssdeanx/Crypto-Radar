// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Binance WebSocket Client Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BinanceWsClient,
  tickerStreams,
  klineStreams,
} from './ws.js';

// ── Mock WebSocket ──

const wsInstances: MockWebSocket[] = [];

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.OPEN;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(url: string) {
    this.url = url;
    wsInstances.push(this);
    setTimeout(() => this._emit('open'), 0);
  }

  addEventListener(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  close(): void { this.readyState = MockWebSocket.CLOSED; }

  _emit(event: string, data?: unknown): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const h of handlers) {
      if (event === 'message') h({ data: typeof data === 'string' ? data : JSON.stringify(data) });
      else h();
    }
  }

  _simulateClose(): void { this._emit('close'); }
  _simulateError(): void { this._emit('error'); }
  _simulateMessage(data: unknown): void { this._emit('message', data); }
}

vi.stubGlobal('WebSocket', MockWebSocket);

// ═══════════════════════════════════════════════════════════════════════
// tickerStreams
// ═══════════════════════════════════════════════════════════════════════

describe('tickerStreams', () => {
  it('converts symbols to lowercase ticker stream names', () => {
    expect(tickerStreams(['BTCUSDT'])).toEqual(['btcusdt@ticker']);
  });

  it('handles multiple symbols', () => {
    expect(tickerStreams(['BTCUSDT', 'SOLUSDT', 'ETHUSDT'])).toEqual([
      'btcusdt@ticker', 'solusdt@ticker', 'ethusdt@ticker',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(tickerStreams([])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// klineStreams
// ═══════════════════════════════════════════════════════════════════════

describe('klineStreams', () => {
  it('uses default 1h interval', () => {
    expect(klineStreams(['BTCUSDT'])).toEqual(['btcusdt@kline_1h']);
  });

  it('accepts custom interval', () => {
    expect(klineStreams(['SOLUSDT'], '15m')).toEqual(['solusdt@kline_15m']);
  });

  it('handles multiple symbols', () => {
    expect(klineStreams(['BTCUSDT', 'ETHUSDT'], '4h')).toEqual([
      'btcusdt@kline_4h', 'ethusdt@kline_4h',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BinanceWsClient
// ═══════════════════════════════════════════════════════════════════════

describe('BinanceWsClient', () => {
  let client: BinanceWsClient;
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new BinanceWsClient();
    handler = vi.fn();
    wsInstances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
  });

  // ── connect ──

  it('creates single-stream WebSocket for one stream', () => {
    client.connect(['btcusdt@ticker'], handler);
    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0]!.url).toContain('/ws/btcusdt@ticker');
  });

  it('creates combined-stream WebSocket for multiple streams', () => {
    client.connect(['btcusdt@ticker', 'solusdt@ticker'], handler);
    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0]!.url).toContain('/stream');
  });

  it('does nothing for empty streams', () => {
    client.connect([], handler);
    expect(wsInstances).toHaveLength(0);
  });

  it('connected getter returns false when no WebSocket exists', () => {
    expect(client.connected).toBe(false);
  });

  it('connected getter returns true when WebSocket is OPEN', () => {
    client.connect(['btcusdt@ticker'], handler);
    expect(client.connected).toBe(true);
  });

  // ── subscribe ──

  it('subscribe adds stream and reconnects if ws is open', () => {
    client.connect(['btcusdt@ticker'], handler);
    vi.advanceTimersByTime(10);
    const handler2 = vi.fn();
    client.subscribe('solusdt@ticker', handler2);
    // subscribe triggers reconnect — new WS instance created
    expect(wsInstances.length).toBeGreaterThanOrEqual(2);
  });

  it('subscribe does not throw when called before connect', () => {
    expect(() => client.subscribe('btcusdt@ticker', vi.fn())).not.toThrow();
  });

  // ── disconnect ──

  it('closes the WebSocket and prevents reconnection', () => {
    client.connect(['btcusdt@ticker'], handler);
    const ws = wsInstances[0]!;
    const closeSpy = vi.spyOn(ws, 'close');
    client.disconnect();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('disconnect is safe when no socket exists', () => {
    expect(() => client.disconnect()).not.toThrow();
  });

  // ── reconnectCount ──

  it('reconnectCount starts at 0', () => {
    expect(client.reconnectCount).toBe(0);
  });

  // ── Message handling ──

  it('dispatches single-stream messages to handlers', () => {
    client.connect(['btcusdt@ticker'], handler);
    vi.advanceTimersByTime(10);
    const msg = { e: '24hrTicker', s: 'BTCUSDT', c: '67000' };
    wsInstances[0]!._simulateMessage(msg);
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('unwraps combined stream messages by stream name', () => {
    client.connect(['btcusdt@ticker', 'solusdt@ticker'], handler);
    vi.advanceTimersByTime(10);
    const inner = { e: '24hrTicker', s: 'BTCUSDT', c: '67000' };
    wsInstances[0]!._simulateMessage({ stream: 'btcusdt@ticker', data: inner });
    expect(handler).toHaveBeenCalledWith(inner);
  });

  it('ignores combined messages for unknown streams', () => {
    client.connect(['btcusdt@ticker'], handler);
    vi.advanceTimersByTime(10);
    wsInstances[0]!._simulateMessage({ stream: 'unknown@ticker', data: { price: '100' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('handles malformed JSON gracefully', () => {
    client.connect(['btcusdt@ticker'], handler);
    vi.advanceTimersByTime(10);
    expect(() => wsInstances[0]!._emit('message', 'not-json{{{')).not.toThrow();
  });

  // ── Reconnection ──

  it('triggers reconnection on close', () => {
    client.connect(['btcusdt@ticker'], handler);
    vi.advanceTimersByTime(10);
    wsInstances[0]!._simulateClose();
    vi.advanceTimersByTime(2000);
    // A new WebSocket instance should be created
    expect(wsInstances.length).toBeGreaterThanOrEqual(2);
  });

  it('creates multiple WS instances across reconnections', () => {
    client.connect(['btcusdt@ticker'], handler);
    vi.advanceTimersByTime(10);

    // 3 close/reconnect cycles
    for (let i = 0; i < 3; i++) {
      const lastWs = wsInstances[wsInstances.length - 1]!;
      lastWs._simulateClose();
      vi.advanceTimersByTime(35_000);
    }

    // Should have created 4 instances (1 initial + 3 reconnects)
    expect(wsInstances.length).toBeGreaterThanOrEqual(4);
  });

  it('does not reconnect after disconnect is called', () => {
    client.connect(['btcusdt@ticker'], handler);
    vi.advanceTimersByTime(10);
    client.disconnect();
    const countBefore = wsInstances.length;
    if (wsInstances[wsInstances.length - 1]) {
      wsInstances[wsInstances.length - 1]!._simulateClose();
    }
    vi.advanceTimersByTime(35_000);
    expect(wsInstances.length).toBe(countBefore);
  });

  // ── Error handling ──

  it('does not throw on error event', () => {
    client.connect(['btcusdt@ticker'], handler);
    vi.advanceTimersByTime(10);
    expect(() => wsInstances[0]!._simulateError()).not.toThrow();
  });

  it('handles multiple rapid subscribe calls without throwing', () => {
    client.connect(['btcusdt@ticker'], handler);
    vi.advanceTimersByTime(10);
    expect(() => {
      client.subscribe('solusdt@ticker', handler);
      client.subscribe('ethusdt@ticker', handler);
      client.subscribe('bnbusdt@ticker', handler);
    }).not.toThrow();
  });
});
