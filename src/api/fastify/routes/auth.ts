// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Auth Routes
// ═══════════════════════════════════════════════════════════════════════
//
// POST /api/auth/signup  — Create account, return JWT
// POST /api/auth/login   — Authenticate, return JWT
// GET  /api/auth/me      — Get current user (requires auth)
// ═══════════════════════════════════════════════════════════════════════

import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger } from '../../../core/logger.js';

const log = logger.child({ module: 'auth-routes' });

// ── Validation schemas ──

const signupSchema = z.object({
  email: z.email({ error: 'Invalid email address' }),
  password: z.string().min(6, { error: 'Password must be at least 6 characters' }),
  name: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.email({ error: 'Invalid email address' }),
  password: z.string().min(1, { error: 'Password is required' }),
});

// ── Route plugin ──

export const authRoutes: FastifyPluginAsync = async (app) => {
  // ── POST /api/auth/signup ──
  app.post('/signup', async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        detail: parsed.error.issues.map(i => i.message).join('; '),
      });
    }

    const { email, password, name } = parsed.data;

    // Check if user already exists
    const existing = app.store.getUserByEmail(email);
    if (existing) {
      return reply.status(409).send({
        error: 'Email already registered',
        code: 'EMAIL_EXISTS',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    const now = new Date().toISOString();
    const user = {
      id: randomUUID(),
      email,
      password_hash: passwordHash,
      name: name ?? email.split('@')[0] ?? '',
      role: 'user',
      created_at: now,
      updated_at: now,
    };

    try {
      await app.store.createUser(user);
    } catch (err) {
      log.error('Failed to create user', { error: String(err) });
      return reply.status(500).send({
        error: 'Failed to create account',
        code: 'INTERNAL_ERROR',
      });
    }

    // Sign JWT
    const token = await reply.jwtSign({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    log.info('User signed up', { email });

    return reply.status(201).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  });

  // ── POST /api/auth/login ──
  app.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        detail: parsed.error.issues.map(i => i.message).join('; '),
      });
    }

    const { email, password } = parsed.data;

    const user = app.store.getUserByEmail(email);
    if (!user) {
      return reply.status(401).send({
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Sign JWT
    const token = await reply.jwtSign({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    log.info('User logged in', { email });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  });

  // ── GET /api/auth/me ──
  app.get('/me', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const decoded = await request.jwtVerify<{ id: string }>();
    const user = app.store.getUserById(decoded.id);
    if (!user) {
      return reply.status(404).send({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
    };
  });
};
