// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Health Check System
// ═══════════════════════════════════════════════════════════════════════
//
// Monitors data source availability, data freshness, and system status.
// Includes checks for:
//   - Binance API
//   - Jupiter DEX API (SOL price)
//   - DeFiLlama API (protocols count)
//   - Data directory integrity
//   - System resources (memory)
//   - In-memory cache performance (hit rate, entries)
//   - RSS feed health (active / degraded / dead feeds)

import { fetchTicker } from '../binance.js';
import { logger } from '../core/logger.js';
import { Cache } from '../core/cache.js';
import { getFeedHealthReport } from '../core/feed-monitor.js';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;          // seconds since last reset
  checks: HealthCheck[];
  details: Record<string, unknown>;
  /** Jupiter DEX API health status */
  jupiter?: { status: string; latencyMs: number };
  /** DeFiLlama API health status */
  defiLlama?: { status: string; latencyMs: number };
  /** In-memory cache performance stats */
  cacheStats?: {
    entries: number;
    hitRate: number;
    ttlConfig: { defaultTtlMs: number };
    memoryEstimate: number;
  };
  /** RSS feed health summary */
  feedHealth?: {
    activeFeeds: number;
    deadFeeds: number;
    feeds: Array<{ name: string; status: string; consecutiveFailures: number }>;
  };
}

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  latencyMs: number;
  message: string;
  lastChecked: string;
}

let _startTime = Date.now();

const log = logger.child({ module: 'health-monitor' });

export class HealthMonitor {
  private checks: HealthCheck[] = [];
  private consecutiveFailures = new Map<string, number>();

  /** Run all health checks and return overall status. */
  async check(): Promise<HealthStatus> {
    const results = await Promise.allSettled([
      this.checkBinance(),
      this.checkDataFiles(),
      this.checkSystem(),
      this._checkJupiter(),
      this._checkDefiLlama(),
      (async () => this._checkCache())(),
      (async () => this._checkFeedHealth())(),
    ]);

    this.checks = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        this.checks.push(result.value);
      }
    }

    const failures = this.checks.filter(c => c.status === 'fail').length;
    const warnings = this.checks.filter(c => c.status === 'warn').length;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (failures > 0) status = 'unhealthy';
    else if (warnings > 0) status = 'degraded';
    else status = 'healthy';

    // Gather structured sub-status fields
    const jupiterCheck = this.checks.find(c => c.name === 'jupiter');
    const defiLlamaCheck = this.checks.find(c => c.name === 'defillama');

    const allCacheStats = Cache.getAllHealthStats();
    const feedReport = getFeedHealthReport();

    const healthStatus: HealthStatus = {
      status,
      uptime: Math.floor((Date.now() - _startTime) / 1000),
      checks: this.checks,
      details: {
        tokensTracked: 40,
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      },
      jupiter: jupiterCheck
        ? { status: jupiterCheck.status, latencyMs: jupiterCheck.latencyMs }
        : undefined,
      defiLlama: defiLlamaCheck
        ? { status: defiLlamaCheck.status, latencyMs: defiLlamaCheck.latencyMs }
        : undefined,
      cacheStats: allCacheStats.length > 0
        ? {
            entries: allCacheStats.reduce((s, c) => s + c.entries, 0),
            hitRate: Math.round(
              (allCacheStats.reduce((s, c) => s + c.hitRate, 0) / allCacheStats.length) * 100,
            ) / 100,
            ttlConfig: { defaultTtlMs: allCacheStats[0]!.ttlConfig.defaultTtlMs },
            memoryEstimate: allCacheStats.reduce((s, c) => s + c.memoryEstimate, 0),
          }
        : { entries: 0, hitRate: 0, ttlConfig: { defaultTtlMs: 300_000 }, memoryEstimate: 0 },
      feedHealth: {
        activeFeeds: feedReport.filter(f => f.status === 'healthy').length,
        deadFeeds: feedReport.filter(f => f.status === 'dead').length,
        feeds: feedReport.map(f => ({
          name: f.name,
          status: f.status,
          consecutiveFailures: f.consecutiveFailures,
        })),
      },
    };

    log.info(`Health check complete: ${status} (${failures} failures, ${warnings} warnings)`);
    return healthStatus;
  }

  // ── Individual checks ──────────────────────────────────────────────

  private async checkBinance(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const ticker = await fetchTicker('BTCUSDT');
      const latency = Date.now() - start;
      this.consecutiveFailures.set('binance', 0);

      if (ticker && ticker.symbol === 'BTCUSDT') {
        return {
          name: 'binance-api',
          status: 'pass',
          latencyMs: latency,
          message: `BTCUSDT: $${parseFloat(ticker.lastPrice).toFixed(2)}`,
          lastChecked: new Date().toISOString(),
        };
      }
      return {
        name: 'binance-api',
        status: 'warn',
        latencyMs: latency,
        message: 'Response received but data may be incomplete',
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      const failCount = (this.consecutiveFailures.get('binance') ?? 0) + 1;
      this.consecutiveFailures.set('binance', failCount);
      const latency = Date.now() - start;

      return {
        name: 'binance-api',
        status: failCount >= 3 ? 'fail' : 'warn',
        latencyMs: latency,
        message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkDataFiles(): Promise<HealthCheck> {
    const start = Date.now();
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dataDir = path.resolve('data');

    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const latency = Date.now() - start;
      log.debug(`Data directory check passed: ${dataDir}`);
      return {
        name: 'data-files',
        status: 'pass',
        latencyMs: latency,
        message: 'Data directory accessible',
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      const latency = Date.now() - start;
      log.warn(`Data directory check failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        name: 'data-files',
        status: 'warn',
        latencyMs: latency,
        message: `Data dir issue: ${err instanceof Error ? err.message : String(err)}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkSystem(): Promise<HealthCheck> {
    const start = Date.now();
    const mem = process.memoryUsage();
    const latency = Date.now() - start;

    const memMB = Math.round(mem.heapUsed / 1024 / 1024);
    const status = memMB > 500 ? 'warn' : 'pass';

    return {
      name: 'system',
      status,
      latencyMs: latency,
      message: `Heap: ${memMB}MB, RSS: ${Math.round(mem.rss / 1024 / 1024)}MB`,
      lastChecked: new Date().toISOString(),
    };
  }

  // ── Jupiter DEX API ────────────────────────────────────────────────

  /**
   * Check Jupiter DEX API availability.
   * Fetches the current SOL price from Jupiter's price API.
   */
  private async _checkJupiter(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch('https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112', {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latency = Date.now() - start;

      if (!res.ok) {
        return {
          name: 'jupiter',
          status: 'warn',
          latencyMs: latency,
          message: `HTTP ${res.status}: ${res.statusText}`,
          lastChecked: new Date().toISOString(),
        };
      }

      const data = (await res.json()) as Record<string, { usdPrice: number | null }>;

      const solEntry = data['So11111111111111111111111111111111111111112'];
      if (solEntry && typeof solEntry.usdPrice === 'number') {
        return {
          name: 'jupiter',
          status: 'pass',
          latencyMs: latency,
          message: `SOL: $${solEntry.usdPrice.toFixed(2)}`,
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        name: 'jupiter',
        status: 'warn',
        latencyMs: latency,
        message: 'Response received but SOL price missing',
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      const latency = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      // Timeout is most common for API failures
      if (message.includes('abort') || message.includes('timeout')) {
        return {
          name: 'jupiter',
          status: 'fail',
          latencyMs: latency,
          message: 'Timed out after 10s',
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        name: 'jupiter',
        status: 'fail',
        latencyMs: latency,
        message: `Failed: ${message}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  // ── DeFiLlama API ──────────────────────────────────────────────────

  /**
   * Check DeFiLlama API availability.
   * Fetches total protocols count from the DeFiLlama protocols endpoint.
   */
  private async _checkDefiLlama(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch('https://api.llama.fi/protocols', {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latency = Date.now() - start;

      if (!res.ok) {
        return {
          name: 'defillama',
          status: 'warn',
          latencyMs: latency,
          message: `HTTP ${res.status}: ${res.statusText}`,
          lastChecked: new Date().toISOString(),
        };
      }

      const data = (await res.json()) as unknown[];

      if (Array.isArray(data)) {
        return {
          name: 'defillama',
          status: 'pass',
          latencyMs: latency,
          message: `${data.length} protocols tracked`,
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        name: 'defillama',
        status: 'warn',
        latencyMs: latency,
        message: 'Unexpected response format (expected array)',
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      const latency = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('abort') || message.includes('timeout')) {
        return {
          name: 'defillama',
          status: 'fail',
          latencyMs: latency,
          message: 'Timed out after 10s',
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        name: 'defillama',
        status: 'fail',
        latencyMs: latency,
        message: `Failed: ${message}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  // ── Cache performance ──────────────────────────────────────────────

  /**
   * Check cache performance stats from all registered cache instances.
   */
  private _checkCache(): HealthCheck {
    const start = Date.now();
    const allStats = Cache.getAllHealthStats();
    const latency = Date.now() - start;

    const totalEntries = allStats.reduce((sum, s) => sum + s.entries, 0);
    const avgHitRate =
      allStats.length > 0
        ? allStats.reduce((sum, s) => sum + s.hitRate, 0) / allStats.length
        : 0;

    const suffix =
      allStats.length > 1 ? ` (${allStats.length} caches)` : '';

    return {
      name: 'cache',
      status: 'pass',
      latencyMs: latency,
      message: `${totalEntries} entries, ${avgHitRate.toFixed(1)}% hit rate${suffix}`,
      lastChecked: new Date().toISOString(),
    };
  }

  // ── RSS Feed Health ────────────────────────────────────────────────

  /**
   * Check RSS feed health from the feed-monitor module.
   */
  private _checkFeedHealth(): HealthCheck {
    const start = Date.now();
    const report = getFeedHealthReport();
    const latency = Date.now() - start;

    const activeFeeds = report.filter(f => f.status === 'healthy').length;
    const deadFeeds = report.filter(f => f.status === 'dead').length;
    const degradedFeeds = report.filter(f => f.status === 'degraded').length;

    let status: 'pass' | 'warn' | 'fail';
    let msgParts: string[];

    if (report.length === 0) {
      status = 'pass';
      msgParts = ['no feeds registered'];
    } else {
      msgParts = [`${activeFeeds} active`];
      if (degradedFeeds > 0) {
        msgParts.push(`${degradedFeeds} degraded`);
      }
      if (deadFeeds > 0) {
        msgParts.push(`${deadFeeds} dead`);
        status = 'warn';
      } else if (degradedFeeds > 0) {
        status = 'warn';
      } else {
        status = 'pass';
      }
    }

    return {
      name: 'feed-health',
      status,
      latencyMs: latency,
      message: msgParts.join(', '),
      lastChecked: new Date().toISOString(),
    };
  }

  // ── Utility ─────────────────────────────────────────────────────────

  /** Reset uptime counter. */
  reset(): void {
    _startTime = Date.now();
    this.consecutiveFailures.clear();
  }
}
