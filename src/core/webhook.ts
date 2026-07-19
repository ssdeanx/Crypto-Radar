// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Webhook Notifications
// ═══════════════════════════════════════════════════════════════════════
//
// Sends price alerts to Discord webhooks and Telegram bots.
// Configured via radar.config.json — no API keys stored in code.
//
// Discord:  config.webhooks.discord = "https://discord.com/api/webhooks/..."
// Telegram: config.webhooks.telegram = { botToken: "...", chatId: "..." }

import { loadConfig } from './config.js';
import { logger } from './logger.js';

export type WebhookType = 'discord' | 'telegram';

export interface WebhookConfig {
  discord?: string;           // Discord webhook URL
  telegram?: {                // Telegram bot config
    botToken: string;
    chatId: string;
  };
}

const log = logger.child({ module: 'webhook' });

/**
 * Send an alert message to all configured webhooks.
 * @param message The alert text to send
 * @param type Optional — send only to specific type, or omit for both
 */
export async function sendAlert(
  message: string,
  type?: WebhookType,
): Promise<void> {
  const config = loadConfig();
  const webhooks = config.webhooks;
  if (!webhooks) return;

  const promises: Promise<void>[] = [];

  if (webhooks.discord && (!type || type === 'discord')) {
    promises.push(sendDiscord(webhooks.discord, message));
  }

  if (webhooks.telegram && (!type || type === 'telegram')) {
    promises.push(sendTelegram(webhooks.telegram.botToken, webhooks.telegram.chatId, message));
  }

  await Promise.allSettled(promises);
}

async function sendDiscord(webhookUrl: string, message: string): Promise<void> {
  // Discord webhook: POST JSON with "content" field
  // https://discord.com/developers/docs/resources/webhook
  const payload = {
    content: message,
    username: '🛰️ Crypto Radar',
    avatar_url: undefined,
  };
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    log.warn(`Discord webhook returned ${response.status}`);
  }
}

async function sendTelegram(botToken: string, chatId: string, message: string): Promise<void> {
  // Telegram bot API: POST to sendMessage
  // https://core.telegram.org/bots/api#sendmessage
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    log.warn(`Telegram API returned ${response.status}`);
  }
}

/**
 * Format an alert result as a Discord/Telegram-friendly message.
 */
export function formatAlertMessage(
  alerts: Array<{ symbol: string; condition: string; threshold: number; currentPrice: number; message: string }>,
): string {
  if (alerts.length === 0) return '';
  const lines = alerts.map(a => `🔔 ${a.message}`);
  return lines.join('\n');
}
