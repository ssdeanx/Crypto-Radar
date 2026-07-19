import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createWsHub } from './ws.js';
import type { WsHub } from './ws.js';
import type { Store } from '../store/db.js';

function mockStore(): Store {
  return {} as Store;
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      const text = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString();
      resolve(JSON.parse(text));
    });
  });
}

function collectMessages(ws: WebSocket): { messages: unknown[]; stop: () => void } {
  const messages: unknown[] = [];
  const handler = (data: Buffer | ArrayBuffer) => {
    const text = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString();
    messages.push(JSON.parse(text));
  };
  ws.on('message', handler);
  return {
    messages,
    stop: () => ws.off('message', handler),
  };
}

interface ServerCtx {
  server: http.Server;
  hub: WsHub;
  port: number;
}

async function setupServer(): Promise<ServerCtx> {
  const server = http.createServer();
  const hub = createWsHub(server, mockStore());
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, hub, port };
}

async function teardownServer(ctx: ServerCtx): Promise<void> {
  ctx.hub.close();
  await new Promise<void>((resolve) => ctx.server.close(() => resolve()));
}

describe('WsHub', () => {
  const ctxs: ServerCtx[] = [];

  afterEach(async () => {
    for (const ctx of ctxs) {
      await teardownServer(ctx);
    }
    ctxs.length = 0;
  });

  it('subscribes to a channel and receives broadcast', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws = await connectClient(ctx.port);

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    const ack = await waitForMessage(ws);
    expect(ack).toEqual({ type: 'subscribed', channel: 'prices' });

    ctx.hub.broadcast('prices', { symbol: 'BTCUSDT', price: 50000 });
    const msg = await waitForMessage(ws) as Record<string, unknown>;
    expect(msg.channel).toBe('prices');
    expect(msg.data).toEqual({ symbol: 'BTCUSDT', price: 50000 });
    expect(typeof msg.ts).toBe('number');
  });

  it('broadcast reaches only subscribers of that channel', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws1 = await connectClient(ctx.port);
    const ws2 = await connectClient(ctx.port);

    ws1.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    ws2.send(JSON.stringify({ type: 'subscribe', channel: 'signals' }));
    await Promise.all([waitForMessage(ws1), waitForMessage(ws2)]);

    const col1 = collectMessages(ws1);
    const col2 = collectMessages(ws2);

    ctx.hub.broadcast('prices', { symbol: 'BTCUSDT' });

    // Wait for the message to arrive on ws1
    await waitForMessage(ws1);
    await new Promise<void>((resolve) => setImmediate(resolve));

    col1.stop();
    col2.stop();

    expect(col1.messages).toHaveLength(1);
    expect(col2.messages).toHaveLength(0);
  });

  it('filters broadcast by symbol on subscription', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws = await connectClient(ctx.port);

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'prices', symbol: 'SOLUSDT' }));
    await waitForMessage(ws);

    ctx.hub.broadcast('prices', { symbol: 'BTCUSDT', price: 50000 });
    // Should not receive — wrong symbol
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    // Use a timeout to verify no message came

    ctx.hub.broadcast('prices', { symbol: 'SOLUSDT', price: 150 });
    const msg = await waitForMessage(ws) as Record<string, unknown>;
    expect(msg.data).toEqual({ symbol: 'SOLUSDT', price: 150 });
  });

  it('stops receiving after unsubscribe', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws = await connectClient(ctx.port);

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    await waitForMessage(ws);

    ws.send(JSON.stringify({ type: 'unsubscribe', channel: 'prices' }));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    ctx.hub.broadcast('prices', { symbol: 'BTCUSDT' });
    // Race between a potential message and a timeout
    await expect(
      Promise.race([
        waitForMessage(ws).then(() => 'message'),
        new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 100)),
      ]),
    ).resolves.toBe('timeout');
  });

  it('sends error for invalid channel', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws = await connectClient(ctx.port);

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'invalid' }));
    const msg = await waitForMessage(ws) as Record<string, unknown>;
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('Invalid channel');
  });

  it('handles malformed JSON without crashing', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws = await connectClient(ctx.port);

    ws.send('not json');
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));

    const ack = await waitForMessage(ws) as Record<string, unknown>;
    expect(ack.type).toBe('subscribed');
  });

  it('broadcasts to multiple subscribers on same channel', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws1 = await connectClient(ctx.port);
    const ws2 = await connectClient(ctx.port);
    const ws3 = await connectClient(ctx.port);

    ws1.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    ws2.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    await Promise.all([waitForMessage(ws1), waitForMessage(ws2)]);

    ctx.hub.broadcast('prices', { symbol: 'ETHUSDT' });

    const msg1 = await waitForMessage(ws1) as Record<string, unknown>;
    const msg2 = await waitForMessage(ws2) as Record<string, unknown>;
    expect(msg1.data).toEqual({ symbol: 'ETHUSDT' });
    expect(msg2.data).toEqual({ symbol: 'ETHUSDT' });

    // ws3 should not have received anything
    const col3 = collectMessages(ws3);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    col3.stop();
    expect(col3.messages).toHaveLength(0);
  });

  it('close cleans up all connections', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws = await connectClient(ctx.port);

    await new Promise<void>((resolve) => {
      ws.on('close', resolve);
      ctx.hub.close();
    });

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('heartbeat infrastructure does not break connectivity', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws = await connectClient(ctx.port);

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    await waitForMessage(ws);

    ctx.hub.broadcast('prices', { msg: 'alive' });
    const reply = await waitForMessage(ws) as Record<string, unknown>;
    expect(reply.data).toEqual({ msg: 'alive' });
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('client disconnect cleans up subscriptions', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws = await connectClient(ctx.port);

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    await waitForMessage(ws);

    await new Promise<void>((resolve) => {
      ws.on('close', resolve);
      ws.close();
    });

    const ws2 = await connectClient(ctx.port);
    ws2.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    await waitForMessage(ws2);

    ctx.hub.broadcast('prices', { symbol: 'BTCUSDT' });
    const msg = await waitForMessage(ws2) as Record<string, unknown>;
    expect(msg.data).toEqual({ symbol: 'BTCUSDT' });
  });

  it('error on a client does not crash the hub', async () => {
    const ctx = await setupServer();
    ctxs.push(ctx);
    const ws = await connectClient(ctx.port);
    ws.on('error', () => {});

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    await waitForMessage(ws);

    ws.emit('error', new Error('simulated error'));

    const ws2 = await connectClient(ctx.port);
    ws2.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    await waitForMessage(ws2);

    ctx.hub.broadcast('prices', { symbol: 'SOLUSDT' });
    const msg = await waitForMessage(ws2) as Record<string, unknown>;
    expect(msg.data).toEqual({ symbol: 'SOLUSDT' });
  });
});
