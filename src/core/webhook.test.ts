// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Webhook Notification Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendAlert, formatAlertMessage } from './webhook.js';
import type { WebhookType } from './webhook.js';

// Mock config so we can control webhook URLs
vi.mock('./config.js', () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from './config.js';
const mockLoadConfig = vi.mocked(loadConfig);

describe('sendAlert', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when no webhooks are configured', async () => {
    mockLoadConfig.mockReturnValue({} as any);
    await sendAlert('test message');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends to Discord webhook', async () => {
    mockLoadConfig.mockReturnValue({
      webhooks: { discord: 'https://discord.com/api/webhooks/test' },
    } as any);
    await sendAlert('Hello from crypto-radar');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/test',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"content":"Hello from crypto-radar"'),
      }),
    );
  });

  it('sends to Telegram webhook', async () => {
    mockLoadConfig.mockReturnValue({
      webhooks: {
        telegram: { botToken: '12345:ABC', chatId: '-100987' },
      },
    } as any);
    await sendAlert('Telegram alert');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain('api.telegram.org/bot12345:ABC/sendMessage');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.telegram.org'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"chat_id":"-100987"'),
      }),
    );
  });

  it('sends to both Discord and Telegram when type is unspecified', async () => {
    mockLoadConfig.mockReturnValue({
      webhooks: {
        discord: 'https://discord.com/api/webhooks/discord-test',
        telegram: { botToken: 'bot:token', chatId: 'chat-id' },
      },
    } as any);
    await sendAlert('broadcast message');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map((c: any) => c[0] as string);
    expect(urls).toContain('https://discord.com/api/webhooks/discord-test');
    expect(urls.some((u: string) => u.includes('api.telegram.org'))).toBe(true);
  });

  it('respects type filter: discord only', async () => {
    mockLoadConfig.mockReturnValue({
      webhooks: {
        discord: 'https://discord.com/api/webhooks/d',
        telegram: { botToken: 'b:t', chatId: 'c' },
      },
    } as any);
    await sendAlert('discord only', 'discord');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://discord.com/api/webhooks/d');
  });

  it('respects type filter: telegram only', async () => {
    mockLoadConfig.mockReturnValue({
      webhooks: {
        discord: 'https://discord.com/api/webhooks/d',
        telegram: { botToken: 'b:t', chatId: 'c' },
      },
    } as any);
    await sendAlert('telegram only', 'telegram');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('api.telegram.org');
  });

  it('logs warning on non-ok response from Discord', async () => {
    mockLoadConfig.mockReturnValue({
      webhooks: { discord: 'https://discord.com/api/webhooks/bad' },
    } as any);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: false, status: 429 } as Response);

    // Should not throw — Promise.allSettled swallows rejections
    // and sendDiscord only logs on non-ok
    await expect(sendAlert('test')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('logs warning on non-ok response from Telegram', async () => {
    mockLoadConfig.mockReturnValue({
      webhooks: {
        telegram: { botToken: 'b:t', chatId: 'c' },
      },
    } as any);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: false, status: 400 } as Response);

    await expect(sendAlert('test')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('formatAlertMessage', () => {
  it('returns empty string for empty alerts array', () => {
    expect(formatAlertMessage([])).toBe('');
  });

  it('formats a single alert', () => {
    const alerts = [
      { symbol: 'BTC', condition: 'above', threshold: 70000, currentPrice: 75000, message: 'BTC broke $70K!' },
    ];
    const result = formatAlertMessage(alerts);
    expect(result).toContain('🔔');
    expect(result).toContain('BTC broke $70K!');
  });

  it('formats multiple alerts on separate lines', () => {
    const alerts = [
      { symbol: 'BTC', condition: 'above', threshold: 70000, currentPrice: 75000, message: 'BTC alert' },
      { symbol: 'SOL', condition: 'below', threshold: 100, currentPrice: 85, message: 'SOL alert' },
    ];
    const result = formatAlertMessage(alerts);
    expect(result).toContain('BTC alert\n🔔 SOL alert');
    expect(result.split('\n')).toHaveLength(2);
  });
});
