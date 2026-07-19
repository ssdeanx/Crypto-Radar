// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Price Alert Engine Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkAlerts, formatAlerts, resetAlertState } from './alerts.js';
import type { AlertResult, PriceAlert } from './alerts.js';
import { makeTicker } from '../shared-test-helpers.js';

// Mock config so loadConfig returns controlled data
vi.mock('./config.js', () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from './config.js';
const mockLoadConfig = vi.mocked(loadConfig);

describe('checkAlerts', () => {
  beforeEach(() => {
    resetAlertState();
    vi.clearAllMocks();
  });

  it('returns empty array when no alerts configured', () => {
    mockLoadConfig.mockReturnValue({ alerts: [] } as any);
    const result = checkAlerts([makeTicker({ symbol: 'BTC' })]);
    expect(result).toEqual([]);
  });

  it('returns empty when config.alerts is undefined', () => {
    mockLoadConfig.mockReturnValue({} as any);
    const result = checkAlerts([makeTicker({ symbol: 'BTC' })]);
    expect(result).toEqual([]);
  });

  it('triggers alert when price is above threshold', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'BTC', condition: 'above', value: 50000 }],
    } as any);
    const result = checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 60000 })]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      triggered: true,
      symbol: 'BTC',
      condition: 'above',
      threshold: 50000,
      currentPrice: 60000,
    });
  });

  it('does not trigger when price is below threshold for above condition', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'BTC', condition: 'above', value: 70000 }],
    } as any);
    const result = checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 60000 })]);
    expect(result).toEqual([]);
  });

  it('triggers alert when price is below threshold', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'BTC', condition: 'below', value: 50000 }],
    } as any);
    const result = checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 40000 })]);
    expect(result).toHaveLength(1);
    expect(result[0].condition).toBe('below');
    expect(result[0].currentPrice).toBe(40000);
  });

  it('does not trigger when price is above threshold for below condition', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'BTC', condition: 'below', value: 40000 }],
    } as any);
    const result = checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 50000 })]);
    expect(result).toEqual([]);
  });

  it('triggers alert for change_pct condition when change exceeds threshold', () => {
    // openPrice=99, lastPrice=100 => changePct ≈ 1.01%, threshold 1% => triggers
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'BTC', condition: 'change_pct', value: 1 }],
    } as any);
    const result = checkAlerts([
      makeTicker({ symbol: 'BTC', lastPrice: 100, openPrice: 99 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].condition).toBe('change_pct');
  });

  it('does not re-trigger an already fired alert (state persistence)', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'BTC', condition: 'above', value: 50000 }],
    } as any);
    // First call — triggers
    expect(checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 60000 })])).toHaveLength(1);
    // Second call — same price still above, should NOT re-trigger
    expect(checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 61000 })])).toHaveLength(0);
  });

  it('re-triggers after price drops back then exceeds threshold again', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'BTC', condition: 'above', value: 50000 }],
    } as any);
    // Initial trigger
    checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 60000 })]);
    // Drop below — resets state
    checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 40000 })]);
    // Come back above — should re-trigger
    const result = checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 60000 })]);
    expect(result).toHaveLength(1);
  });

  it('skips tokens not present in ticker data', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'UNKNOWN', condition: 'above', value: 1 }],
    } as any);
    const result = checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 60000 })]);
    expect(result).toEqual([]);
  });

  it('uses default message when no custom message is provided', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'SOL', condition: 'above', value: 200 }],
    } as any);
    const result = checkAlerts([makeTicker({ symbol: 'SOL', lastPrice: 250 })]);
    expect(result[0].message).toContain('SOL');
    expect(result[0].message).toContain('above');
    expect(result[0].message).toContain('200');
  });

  it('uses custom message when provided', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [
        { symbol: 'SOL', condition: 'above', value: 200, message: 'Solana moon!' },
      ],
    } as any);
    const result = checkAlerts([makeTicker({ symbol: 'SOL', lastPrice: 250 })]);
    expect(result[0].message).toBe('Solana moon!');
  });
});

describe('formatAlerts', () => {
  it('returns empty string for empty alerts array', () => {
    expect(formatAlerts([])).toBe('');
  });

  it('formats a single alert result', () => {
    const alerts: AlertResult[] = [
      {
        triggered: true,
        symbol: 'BTC',
        condition: 'above',
        threshold: 70000,
        currentPrice: 75000,
        message: 'BTC broke $70K!',
      },
    ];
    const output = formatAlerts(alerts);
    expect(output).toContain('🔔 ALERT:');
    expect(output).toContain('BTC broke $70K!');
  });

  it('formats multiple alert results on separate lines', () => {
    const alerts: AlertResult[] = [
      {
        triggered: true,
        symbol: 'BTC',
        condition: 'above',
        threshold: 70000,
        currentPrice: 75000,
        message: 'BTC alert',
      },
      {
        triggered: true,
        symbol: 'SOL',
        condition: 'below',
        threshold: 100,
        currentPrice: 85,
        message: 'SOL alert',
      },
    ];
    const output = formatAlerts(alerts);
    expect(output).toContain('BTC alert');
    expect(output).toContain('SOL alert');
    expect(output.split('\n')).toHaveLength(2);
  });
});

describe('resetAlertState', () => {
  it('clears internal state and allows re-triggering', () => {
    mockLoadConfig.mockReturnValue({
      alerts: [{ symbol: 'BTC', condition: 'above', value: 50000 }],
    } as any);
    // Trigger once
    checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 60000 })]);
    // Reset
    resetAlertState();
    // Should trigger again
    const result = checkAlerts([makeTicker({ symbol: 'BTC', lastPrice: 60000 })]);
    expect(result).toHaveLength(1);
  });
});
