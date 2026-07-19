// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Warm Daemon (Plugin Distribution Bridge)
// ═══════════════════════════════════════════════════════════════════════
//
// Pre-loads the radar engine and exposes a lightweight HTTP server
// so the Hermes plugin bridge can pull scan results without re-spawning
// Node each time.
//
// Usage:
//   HERMES_CRYPTO_DAEMON_PORT=9123 node dist/core/warm-daemon.js
//   curl http://localhost:9123/scan
//
// ═══════════════════════════════════════════════════════════════════════

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runRadar } from '../radar.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

const PORT = parseInt(process.env.HERMES_CRYPTO_DAEMON_PORT ?? '9123', 10);

// ── State ──────────────────────────────────────────────────────────────

interface CachedState {
  result: Awaited<ReturnType<typeof runRadar>>;
  cachedAt: number;
}

let _state: CachedState | null = null;
let _scanning = false;

// ── Scan runner ────────────────────────────────────────────────────────

async function refreshScan(): Promise<CachedState> {
  _scanning = true;
  try {
    logger.info('[warm-daemon] Running radar scan...');
    const config = loadConfig();
    logger.info(`[warm-daemon] Using dataDir: ${config.dataDir}`);
    const result = await runRadar({
      includeTech: true,
      includeNews: true,
      sortBy: 'momentum',
    });
    _state = { result, cachedAt: Date.now() };
    logger.info(`[warm-daemon] Scan complete: ${result.run.numTokens} tokens in ${result.run.durationMs}ms`);
  } finally {
    _scanning = false;
  }
  return _state!;
}

// Warm the cache on startup
refreshScan().catch(err => {
  logger.error('[warm-daemon] Initial scan failed', { error: String(err) });
  // The daemon still starts — first client request will trigger a scan
});

// ── HTTP handler ───────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // CORS for localhost plugin bridge
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  switch (url) {
    case '/scan': {
      if (_scanning) {
        jsonResponse(res, 503, { status: 'scanning', message: 'Scan in progress, try again shortly' });
        return;
      }
      if (!_state) {
        jsonResponse(res, 503, { status: 'warming', message: 'Initial scan pending, try again shortly' });
        return;
      }
      jsonResponse(res, 200, {
        status: 'ok',
        cachedAt: new Date(_state.cachedAt).toISOString(),
        ageMs: Date.now() - _state.cachedAt,
        run: _state.result.run,
        tickers: _state.result.tickers,
        signals: _state.result.signals,
        aggregatedSignals: _state.result.aggregatedSignals,
      });
      break;
    }

    case '/refresh': {
      if (_scanning) {
        jsonResponse(res, 409, { status: 'scanning', message: 'Scan already in progress' });
        return;
      }
      refreshScan()
        .then(state => {
          jsonResponse(res, 200, {
            status: 'ok',
            cachedAt: new Date(state.cachedAt).toISOString(),
            numTokens: state.result.run.numTokens,
          });
        })
        .catch(err => {
          jsonResponse(res, 500, { status: 'error', message: String(err) });
        });
      break;
    }

    case '/health': {
      jsonResponse(res, 200, {
        status: _state ? 'ready' : 'warming',
        scanning: _scanning,
        cached: _state !== null,
        cachedAt: _state ? new Date(_state.cachedAt).toISOString() : null,
        uptime: process.uptime(),
      });
      break;
    }

    default:
      jsonResponse(res, 404, { status: 'error', message: `Not found: ${url}` });
  }
}

// ── Server ─────────────────────────────────────────────────────────────

const server = createServer(handleRequest);

server.listen(PORT, () => {
  logger.info(`[warm-daemon] Hermes Crypto Radar daemon listening on http://localhost:${PORT}`);
  logger.info(`[warm-daemon] Endpoints: GET /scan  GET /refresh  GET /health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('[warm-daemon] SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('[warm-daemon] SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});
