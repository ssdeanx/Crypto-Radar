import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Store } from '../store/db.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'ws-hub' });

interface SubscribeMessage {
  type: 'subscribe';
  channel: string;
  symbol?: string;
}

interface UnsubscribeMessage {
  type: 'unsubscribe';
  channel: string;
}

const VALID_CHANNELS = ['prices', 'signals', 'news', 'portfolio'] as const;
type Channel = typeof VALID_CHANNELS[number];

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

export interface WsHub {
  broadcast(channel: string, data: unknown): void;
  close(): void;
}

export function createWsHub(httpServer: http.Server, _store: Store): WsHub {
  const wss = new WebSocketServer({ noServer: true });

  const channelSubs = new Map<string, Map<WebSocket, { symbol?: string }>>();
  for (const ch of VALID_CHANNELS) {
    channelSubs.set(ch, new Map());
  }

  const clients = new Set<WebSocket>();

  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    (ws as unknown as Record<string, unknown>).alive = true;

    ws.on('pong', () => {
      (ws as unknown as Record<string, unknown>).alive = true;
    });

    ws.on('message', (raw) => {
      try {
        const text = Array.isArray(raw)
          ? Buffer.concat(raw).toString()
          : new TextDecoder().decode(raw as unknown as ArrayBuffer);
        const msg = JSON.parse(text);
        if (msg.type === 'subscribe') {
          handleSubscribe(ws, msg as SubscribeMessage);
        } else if (msg.type === 'unsubscribe') {
          handleUnsubscribe(ws, msg as UnsubscribeMessage);
        }
      } catch (err) {
        log.warn('Invalid message from client', { error: String(err) });
      }
    });

    ws.on('close', () => {
      cleanupClient(ws);
    });

    ws.on('error', (err) => {
      log.warn('WebSocket client error', { error: String(err) });
      cleanupClient(ws);
    });
  });

  function handleSubscribe(ws: WebSocket, msg: SubscribeMessage): void {
    if (!(VALID_CHANNELS as readonly string[]).includes(msg.channel)) {
      safeSend(ws, JSON.stringify({ type: 'error', message: `Invalid channel: ${msg.channel}` }));
      return;
    }
    const channel = msg.channel as Channel;
    const subs = channelSubs.get(channel);
    if (subs) {
      subs.set(ws, { symbol: msg.symbol });
      safeSend(ws, JSON.stringify({ type: 'subscribed', channel }));
    }
  }

  function handleUnsubscribe(ws: WebSocket, msg: UnsubscribeMessage): void {
    const channel = msg.channel as Channel;
    const subs = channelSubs.get(channel);
    subs?.delete(ws);
  }

  function cleanupClient(ws: WebSocket): void {
    clients.delete(ws);
    for (const subs of channelSubs.values()) {
      subs.delete(ws);
    }
  }

  function safeSend(ws: WebSocket, payload: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
      } catch (err) {
        log.warn('Send failed', { error: String(err) });
      }
    }
  }

  const heartbeatTimer = setInterval(() => {
    for (const ws of clients) {
      if ((ws as unknown as Record<string, unknown>).alive === false) {
        ws.terminate();
        cleanupClient(ws);
        continue;
      }
      (ws as unknown as Record<string, unknown>).alive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Enforce client heartbeat timeout: terminate connections that miss pongs
  const timeoutTimer = setInterval(() => {
    for (const ws of clients) {
      if ((ws as unknown as Record<string, unknown>).alive === false) {
        ws.terminate();
        cleanupClient(ws);
      }
    }
  }, HEARTBEAT_TIMEOUT_MS);
  timeoutTimer.unref();
  heartbeatTimer.unref();

  function broadcast(channel: string, data: unknown): void {
    const subs = channelSubs.get(channel);
    if (!subs) return;

    const payload = JSON.stringify({ channel, data, ts: Date.now() });

    for (const [ws, meta] of subs) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (meta.symbol && typeof data === 'object' && data !== null) {
        const obj = data as Record<string, unknown>;
        if (obj.symbol !== meta.symbol) continue;
      }
      safeSend(ws, payload);
    }
  }

  function close(): void {
    clearInterval(heartbeatTimer);
    clearInterval(timeoutTimer);
    for (const ws of clients) {
      ws.close();
    }
    wss.close();
    clients.clear();
    channelSubs.clear();
  }

  return { broadcast, close };
}
