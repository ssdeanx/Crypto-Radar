// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Typed Error Classes
// ═══════════════════════════════════════════════════════════════════════

/**
 * Base error for all Crypto Radar errors.
 */
export class CryptoRadarError extends Error {
  public readonly code: string;
  public readonly recoverable: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(code: string, message: string, opts?: { recoverable?: boolean; context?: Record<string, unknown> }) {
    super(message);
    this.name = 'CryptoRadarError';
    this.code = code;
    this.recoverable = opts?.recoverable ?? false;
    this.context = opts?.context;
  }
}

/**
 * Network-level error (timeout, HTTP failure, DNS).
 */
export class NetworkError extends CryptoRadarError {
  public readonly wrappedCause: unknown;

  constructor(source: string, cause: unknown) {
    super('NETWORK_ERROR', `Network request to ${source} failed: ${formatCause(cause)}`, {
      recoverable: true,
      context: { source },
    });
    this.name = 'NetworkError';
    this.wrappedCause = cause;
  }
}

/**
 * Rate-limit error from an API provider.
 */
export class RateLimitError extends CryptoRadarError {
  public readonly retryAfterMs: number;

  constructor(source: string, retryAfterMs = 10_000) {
    super('RATE_LIMIT', `Rate limited by ${source}, retry in ${retryAfterMs}ms`, {
      recoverable: true,
      context: { source, retryAfterMs },
    });
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Data validation / parsing error.
 */
export class DataError extends CryptoRadarError {
  constructor(source: string, reason: string) {
    super('DATA_ERROR', `Invalid data from ${source}: ${reason}`, {
      recoverable: false,
      context: { source, reason },
    });
    this.name = 'DataError';
  }
}

/**
 * Configuration error (missing/invalid settings).
 */
export class ConfigError extends CryptoRadarError {
  constructor(key: string, message: string) {
    super('CONFIG_ERROR', `Configuration error [${key}]: ${message}`, {
      recoverable: false,
      context: { key },
    });
    this.name = 'ConfigError';
  }
}

/**
 * Cache operation error.
 */
export class CacheError extends CryptoRadarError {
  constructor(operation: string, reason: string) {
    super('CACHE_ERROR', `Cache ${operation} failed: ${reason}`, {
      recoverable: true,
      context: { operation },
    });
    this.name = 'CacheError';
  }
}

/**
 * Signal strategy evaluation error.
 */
export class SignalError extends CryptoRadarError {
  constructor(strategy: string, reason: string) {
    super('SIGNAL_ERROR', `Signal strategy "${strategy}" error: ${reason}`, {
      recoverable: true,
      context: { strategy },
    });
    this.name = 'SignalError';
  }
}

function formatCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return String(cause);
}

/**
 * Log a non-fatal warning without importing the full logger.
 * Safe for catch blocks that intentionally swallow but want visibility.
 * Silenced in test environment to avoid noise.
 */
export function logWarn(component: string, message: string, err?: unknown): void {
  if (process.env.VITEST || process.env.JEST_WORKER_ID) return;
  const detail = err instanceof Error ? `: ${err.message}` : err ? `: ${err}` : '';
  process.stderr.write(`[warn:${component}] ${message}${detail}\n`);
}
