// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Price Alert Engine
// ═══════════════════════════════════════════════════════════════════════
//
// Reads alert thresholds from radar.config.json (no external API, no keys):
//   alerts: [
//     { symbol: "BTC", condition: "above", value: 70000, message: "BTC broke $70K!" }
//   ]
//
// Checks alerts against latest ticker prices after each scan.
// Outputs alerts to console — ready for Hermes gateway integration.

import type { EnrichedTicker } from '../types.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface PriceAlert {
  /** Token symbol (e.g. 'BTC', 'SOL') */
  symbol: string;
  /** Condition: above, below, change_pct */
  condition: 'above' | 'below' | 'change_pct';
  /** Threshold value */
  value: number;
  /** Optional custom message */
  message?: string;
  /** Track whether already triggered (prevents spam) */
  triggered?: boolean;
}

export interface AlertResult {
  triggered: true;
  symbol: string;
  condition: string;
  threshold: number;
  currentPrice: number;
  message: string;
}

// ── Alert Engine ───────────────────────────────────────────────────────

const log = logger.child({ module: 'alerts' });

/** Module-level alert state — persists across scans to prevent re-triggering */
const _alertState = new Map<string, boolean>();

/**
 * Load alerts from config and check against current ticker prices.
 * Returns list of triggered alerts (newly triggered, not previously fired).
 * Stores trigger state in memory to avoid re-triggering on every scan.
 */
export function checkAlerts(tickers: EnrichedTicker[]): AlertResult[] {
  const config = loadConfig();
  const alerts = config.alerts;
  if (!alerts || alerts.length === 0) return [];

  const results: AlertResult[] = [];
  const priceMap = new Map(tickers.map(t => [t.symbol, t.lastPrice]));

  for (const alert of alerts) {
    const currentPrice = priceMap.get(alert.symbol.toUpperCase());
    if (currentPrice === undefined) continue; // Token not in scan results

    const stateKey = `${alert.symbol}:${alert.condition}:${alert.value}`;
    let triggered = false;

    switch (alert.condition) {
      case 'above':
        triggered = currentPrice > alert.value;
        break;
      case 'below':
        triggered = currentPrice < alert.value;
        break;
      case 'change_pct': {
        // Requires a reference price — typically checked against 24h open
        const ticker = tickers.find(t => t.symbol === alert.symbol.toUpperCase());
        if (ticker && ticker.openPrice > 0) {
          const changePct = ((currentPrice - ticker.openPrice) / ticker.openPrice) * 100;
          triggered = Math.abs(changePct) > alert.value;
        }
        break;
      }
    }

    // Only fire if newly triggered (wasn't already triggered before)
    const alreadyTriggered = _alertState.get(stateKey) ?? false;
    if (triggered && !alreadyTriggered) {
      _alertState.set(stateKey, true);
      results.push({
        triggered: true,
        symbol: alert.symbol,
        condition: alert.condition,
        threshold: alert.value,
        currentPrice,
        message: alert.message ?? `${alert.symbol} ${alert.condition} $${alert.value} (current: $${currentPrice})`,
      });
    } else if (!triggered) {
      // Reset trigger state when price moves back
      _alertState.set(stateKey, false);
    }
  }

  // Send notifications for newly triggered alerts
  if (results.length > 0) {
    log.info(`Triggered ${results.length} price alert(s)`);
    import('./webhook.js').then(({ sendAlert, formatAlertMessage }) => {
      const msg = formatAlertMessage(results);
      if (msg) sendAlert(msg).catch(() => {});
    }).catch(() => {});
  }

  return results;
}

/**
 * Format alerts for display.
 */
export function formatAlerts(alerts: AlertResult[]): string {
  if (alerts.length === 0) return '';
  return alerts.map(a => `🔔 ALERT: ${a.message}`).join('\n');
}

/**
 * Clear all alert trigger states (for testing).
 */
export function resetAlertState(): void {
  _alertState.clear();
}
