import { logger } from './logger.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  name: string;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  name: 'unknown',
};

/**
 * Circuit breaker pattern for resilient API calls.
 * Prevents repeated calls to a failing service and allows
 * recovery after a cooldown period.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastOpenTime = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get current circuit breaker state.
   * @returns 'CLOSED', 'OPEN', or 'HALF_OPEN'
   */
  getState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  /**
   * Get current failure count.
   * @returns Number of consecutive failures
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Execute a function through the circuit breaker.
   * If the circuit is OPEN, either serves a fallback or throws.
   *
   * @param fn Primary async function
   * @param fallback Optional fallback async function
   * @returns Result of fn or fallback
   */
  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    this.maybeHalfOpen();
    if (this.state === 'OPEN') {
      if (fallback) {
        logger.warn(`Circuit breaker "${this.options.name}" is OPEN — serving fallback`);
        return fallback();
      }
      throw new Error(`Circuit breaker "${this.options.name}" is OPEN (${this.failureCount} consecutive failures)`);
    }
    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        logger.info(`Circuit breaker "${this.options.name}" probe succeeded — closing`);
      }
      this.state = 'CLOSED';
      this.failureCount = 0;
      return result;
    } catch (err) {
      this.failureCount++;
      if (this.failureCount >= this.options.failureThreshold) this.trip();
      throw err;
    }
  }

  /**
   * Manually record a failure (useful when call() is not used).
   */
  recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.options.failureThreshold) this.trip();
  }

  /**
   * Reset the circuit breaker to CLOSED state.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastOpenTime = 0;
  }

  private trip(): void {
    this.state = 'OPEN';
    this.lastOpenTime = Date.now();
    logger.warn(`Circuit breaker "${this.options.name}" TRIPPED after ${this.failureCount} consecutive failures`);
  }

  private maybeHalfOpen(): void {
    if (this.state === 'OPEN' && Date.now() - this.lastOpenTime >= this.options.cooldownMs) {
      logger.info(`Circuit breaker "${this.options.name}" cooldown elapsed — transitioning to HALF_OPEN`);
      this.state = 'HALF_OPEN';
    }
  }
}
