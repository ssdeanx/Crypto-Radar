// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Enterprise Fastify Application
// ═══════════════════════════════════════════════════════════════════════
//
// Enterprise-grade Fastify API server with:
//   - Rate limiting (@fastify/rate-limit) — 100 req/min anonymous, 300 req/min authed
//   - Compression (@fastify/compress) — gzip/brotli response compression
//   - JWT auth (@fastify/jwt) — stateless bearer tokens
//   - CORS (@fastify/cors) — fine-grained origin control
//   - Swagger/OpenAPI (@fastify/swagger + @fastify/swagger-ui) — auto-generated docs at /docs
//   - Security headers (@fastify/helmet) — XSS, clickjacking, MIME-sniffing protection
//   - Plugin-based route organization
//   - Consistent error responses
//   - Zod schema validation on all mutation routes
//
// WebSocket hub attaches to the underlying Node http.Server externally.
// ═══════════════════════════════════════════════════════════════════════

import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Store } from '../../store/db.js';
import type { PaperTrader } from '../../paper-trade.js';
import { authRoutes } from './routes/auth.js';
import { mlRoutes } from './routes/ml.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { restRoutes } from './routes/rest.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'fastify-app' });

export interface FastifyAppOptions {
  store: Store;
  paperTrader?: PaperTrader;
  jwtSecret: string;
  corsOrigin?: string | string[];
}

export async function createApp(opts: FastifyAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    // Enterprise: Disable Fastify's built-in Pino (we use our own logger via hooks)
    // We use onResponse hooks for structured logging instead of stdout JSON lines
    logger: false,
    // Enterprise: sensible body limits (default 1MB, we set 100KB for API)
    bodyLimit: 1024 * 100, // 100KB
    // Enterprise: application-level handler timeout (Fastify 5+)
    // Prevents slow handlers from holding connections open
    handlerTimeout: 30_000, // 30s per handler
    // Enterprise: socket-level request timeout (prevents slow-loris attacks)
    requestTimeout: 60_000, // 60s to receive full request
    // Enterprise: trust X-Forwarded-* headers when behind Railway/Vercel proxy
    trustProxy: true,
    // Enterprise: graceful shutdown — drain idle connections before closing
    forceCloseConnections: 'idle',
    // Enterprise: return 503 when server is closing (lets load balancers route away)
    return503OnClosing: true,
  });

  // ── Enterprise: Security Headers (@fastify/helmet) ──
  // Sets X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security,
  // X-XSS-Protection, Content-Security-Policy, and more.
  await app.register(helmet, {
    contentSecurityPolicy: false, // Disabled for API — enable if serving frontend assets
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  // ── Enterprise: CORS (@fastify/cors) ──
  await app.register(cors, {
    origin: opts.corsOrigin ?? [
      'https://crypto-radar.vercel.app',
      'http://localhost:5173',
      'http://localhost:4173',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
    maxAge: 600, // 10 min preflight cache
  });

  // ── Enterprise: Rate Limiting (@fastify/rate-limit) ──
  // 100 req/min per IP anonymous, 300 req/min if authenticated
  await app.register(rateLimit, {
    max: async (request: FastifyRequest, _key: string) => {
      if (request.headers.authorization?.startsWith('Bearer ')) {
        try {
          await request.jwtVerify();
          return 300;
        } catch {
          return 100;
        }
      }
      return 100;
    },
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return request.headers.authorization?.slice(7) ?? request.ip;
    },
    errorResponseBuilder: (_request, context) => ({
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      detail: `Rate limit exceeded. Try again in ${Math.ceil((context.ttl ?? 60_000) / 1000)}s.`,
    }),
  });

  // ── Enterprise: Compression (@fastify/compress) ──
  // Brotli > Gzip > Deflate, with threshold at 1KB
  await app.register(compress, {
    global: true,
    threshold: 1024, // 1KB minimum to compress
  });

  // ── Enterprise: Swagger / OpenAPI (@fastify/swagger + @fastify/swagger-ui) ──
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Hermes Crypto Radar API',
        description: 'Enterprise-grade multi-chain crypto market intelligence API',
        version: '2.0.0',
        contact: {
          name: 'Hermes Crypto Radar',
          url: 'https://github.com/ssdeanx/Hermes-Crypto-Radar',
        },
      },
      servers: [{ url: 'http://localhost:9877', description: 'Development' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // ── Enterprise: JWT Auth (@fastify/jwt) ──
  await app.register(jwt, {
    secret: opts.jwtSecret,
    sign: { expiresIn: '7d' },
    // Enterprise: verify audience/issuer in production
    ...(process.env['RADAR__JWT_AUDIENCE']
      ? { audience: process.env['RADAR__JWT_AUDIENCE'] }
      : {}),
    ...(process.env['RADAR__JWT_ISSUER']
      ? { issuer: process.env['RADAR__JWT_ISSUER'] }
      : {}),
  });

  // ── Enterprise: Decorate with Store ──
  app.decorate('store', opts.store);


  // ── Enterprise: Request logging hook ──
  app.addHook('onResponse', (request, reply, done) => {
    const statusCode = reply.statusCode;
    const method = request.method;
    const url = request.url;
    const contentLength = reply.getHeader('content-length') ?? '-';
    const responseTime = reply.elapsedTime?.toFixed(0) ?? '-';

    if (statusCode >= 500) {
      log.error('API request', { method, url, statusCode, contentLength, responseTime: responseTime + 'ms' });
    } else if (statusCode >= 400) {
      log.warn('API request', { method, url, statusCode, contentLength, responseTime: responseTime + 'ms' });
    } else {
      log.info('API request', { method, url, statusCode, contentLength, responseTime: responseTime + 'ms' });
    }
    done();
  });

  // ── Auth / JWT helper decorator ──
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
  });

  // ── Route plugins ──
  await app.register(restRoutes);                                    // Existing REST API routes (ported)
  await app.register(authRoutes, { prefix: '/api/auth' });          // Auth routes (login, signup, me)
  await app.register(portfolioRoutes, { prefix: '/api/portfolio' }); // Portfolio routes (trade, history)
  await app.register(mlRoutes);                                      // ML pipeline routes

  // ── Enterprise: 404 handler ──
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: 'Route not found',
      code: 'NOT_FOUND',
      detail: `No matching route for ${_request.method} ${_request.url}`,
    });
  });

  // ── Enterprise: Global error handler ──
  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number; validation?: Array<{ message: string }> };
    const statusCode = err.statusCode ?? 500;
    const code = statusCode === 500 ? 'INTERNAL_ERROR' : statusCode === 429 ? 'RATE_LIMITED' : 'REQUEST_ERROR';

    // Log server errors
    if (statusCode >= 500) {
      log.error('Internal server error', { error: err.message, stack: err.stack, url: _request.url });
    }

    // Validation errors
    if (err.validation) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        detail: err.validation.map((v: { message: string }) => v.message).join('; '),
      });
    }

    reply.status(statusCode).send({
      error: err.message ?? 'Internal server error',
      code,
      ...(process.env['NODE_ENV'] !== 'production' && statusCode >= 500 ? { stack: err.stack } : {}),
    });
  });

  return app;
}

// ── Type augmentation for fastify instance ──
declare module 'fastify' {
  interface FastifyInstance {
    store: Store;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
