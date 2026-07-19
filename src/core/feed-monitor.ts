// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — RSS Feed Health Monitor
// ═══════════════════════════════════════════════════════════════════════
//
// Tracks feed health — detects dead/stale feeds and reports them.
// No external API — purely based on HTTP response tracking.

import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface FeedHealth {
  name: string;
  url: string;
  lastSuccess: number | null;
  lastFailure: number | null;
  consecutiveFailures: number;
  status: 'healthy' | 'degraded' | 'dead';
}

interface FeedHealthState {
  name: string;
  url: string;
  lastSuccess: number | null;
  lastFailure: number | null;
  consecutiveFailures: number;
}

// ── State ──────────────────────────────────────────────────────────────

const log = logger.child({ module: 'feed-monitor' });

/** Module-level feed health state — persists across radar scan cycles */
const _feedHealth = new Map<string, FeedHealthState>();

// ── Thresholds ─────────────────────────────────────────────────────────

const HEALTHY_MAX_FAILURES = 1;   // 0–1 consecutive failures → healthy
const DEGRADED_MAX_FAILURES = 2;  // 2–2 consecutive failures → degraded
// 3+ consecutive failures → dead

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Track feed fetch result.
 * Resets consecutiveFailures on success, increments on failure.
 * Logs warning when degraded, error when dead.
 */
export function recordFeedResult(
  feedName: string,
  feedUrl: string,
  success: boolean,
  error?: string,
): void {
  let state = _feedHealth.get(feedName);
  if (!state) {
    state = { name: feedName, url: feedUrl, lastSuccess: null, lastFailure: null, consecutiveFailures: 0 };
    _feedHealth.set(feedName, state);
  }

  if (success) {
    const wasDegraded = state.consecutiveFailures >= HEALTHY_MAX_FAILURES + 1;
    state.consecutiveFailures = 0;
    state.lastSuccess = Date.now();
    if (wasDegraded) {
      log.info(`Feed recovered: ${feedName}`);
    }
  } else {
    state.consecutiveFailures++;
    state.lastFailure = Date.now();

    const newStatus = computeStatus(state.consecutiveFailures);
    if (newStatus === 'dead') {
      log.error(`Feed dead: ${feedName} (${state.consecutiveFailures} consecutive failures)${error ? `: ${error}` : ''}`);
    } else if (newStatus === 'degraded') {
      log.warn(`Feed degraded: ${feedName} (${state.consecutiveFailures} consecutive failures)${error ? `: ${error}` : ''}`);
    }
  }
}

/**
 * Get health report for all feeds.
 */
export function getFeedHealthReport(): FeedHealth[] {
  const report: FeedHealth[] = [];
  for (const state of _feedHealth.values()) {
    report.push({
      name: state.name,
      url: state.url,
      lastSuccess: state.lastSuccess,
      lastFailure: state.lastFailure,
      consecutiveFailures: state.consecutiveFailures,
      status: computeStatus(state.consecutiveFailures),
    });
  }
  // Sort: dead first, then degraded, then healthy
  report.sort((a, b) => {
    const order = { healthy: 0, degraded: 1, dead: 2 };
    return order[b.status] - order[a.status];
  });
  return report;
}

/**
 * Get list of dead feeds (3+ consecutive failures).
 */
export function getDeadFeeds(): FeedHealth[] {
  return getFeedHealthReport().filter(f => f.status === 'dead');
}

/**
 * Format feed health as string for display/logging.
 */
export function formatFeedHealth(): string {
  const report = getFeedHealthReport();
  if (report.length === 0) return 'No feed health data collected yet.';

  const lines: string[] = ['── Feed Health Report ──'];
  for (const f of report) {
    const icon = f.status === 'healthy' ? '✅' : f.status === 'degraded' ? '⚠️' : '❌';
    const since = f.lastSuccess
      ? `last OK: ${new Date(f.lastSuccess).toISOString().slice(11, 19)}`
      : 'never OK';
    lines.push(
      `${icon} ${f.name} (${f.status}) — ${f.consecutiveFailures} failures — ${since}`,
    );
  }
  return lines.join('\n');
}

/**
 * Reset all feed health state (for testing).
 */
export function resetFeedHealth(): void {
  _feedHealth.clear();
}

// ── Helpers ────────────────────────────────────────────────────────────

function computeStatus(consecutiveFailures: number): FeedHealth['status'] {
  if (consecutiveFailures >= DEGRADED_MAX_FAILURES + 1) return 'dead';
  if (consecutiveFailures >= HEALTHY_MAX_FAILURES + 1) return 'degraded';
  return 'healthy';
}
