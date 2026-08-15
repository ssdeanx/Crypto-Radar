// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Zod Config Schema & Validation
// ═══════════════════════════════════════════════════════════════════════

import { z } from "zod";

// ── Sub-schemas ─────────────────────────────────────────────────────────

const LogLevelEnum = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

const IndicatorPeriodsSchema = z.object({
  rsi: z.number(),
  macdFast: z.number(),
  macdSlow: z.number(),
  macdSignal: z.number(),
  bbPeriod: z.number(),
  bbStdDev: z.number(),
  atrPeriod: z.number(),
  ema50: z.number(),
});

const SourcesSchema = z.object({
  binance: z.boolean(),
  coinGecko: z.boolean(),
  defiLlama: z.boolean().optional(),
  futures: z.boolean().optional(),
  fearGreed: z.boolean().optional(),
  crossAsset: z.boolean().optional(),
  orderbook: z.boolean().optional(),
});

const MlTrainingSchema = z.object({
  symbols: z.array(z.string()).optional(),
  intervals: z.array(z.string()).optional(),
  lookbackDays: z.number().optional(),
  retrainIntervalHours: z.number().optional(),
  labelHorizon: z
    .union([z.literal(1), z.literal(5), z.literal(20), z.literal(60)])
    .optional(),
  optimize: z.boolean().optional(),
  optunaTrials: z.number().optional(),
  cvFolds: z.number().optional(),
  balance: z.boolean().optional(),
  shap: z.boolean().optional(),
});

const MlPredictionSchema = z.object({
  inferenceMode: z.enum(["subprocess", "onnx"]).optional(),
  minConfidence: z.number().optional(),
  modelPath: z.string().optional(),
});

const MlSchema = z.object({
  enabled: z.boolean().optional(),
  training: MlTrainingSchema.optional(),
  prediction: MlPredictionSchema.optional(),
});

const TelegramWebhookSchema = z.object({
  botToken: z.string(),
  chatId: z.string(),
});

const WebhooksSchema = z.object({
  discord: z.string().optional(),
  telegram: TelegramWebhookSchema.optional(),
});

const StoreSchema = z.object({
  path: z.string().optional(),
  retentionDays: z.number().optional(),
});

// ── Root schema ─────────────────────────────────────────────────────────

export const RadarConfigSchema = z.object({
  // Network
  binanceBaseUrl: z.string().url(),
  fetchTimeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  cacheTtlMs: z.number().int().positive(),

  // Rate limiting
  rateLimitMax: z.number().int().positive(),
  rateLimitWindowMs: z.number().int().positive(),

  // Logging
  logLevel: LogLevelEnum,
  dataDir: z.string(),
  secondaryDataDir: z.string().optional(),

  // News
  newsFeeds: z.boolean(),
  maxNewsPerFeed: z.number().int().positive(),

  // Indicators
  indicatorPeriods: IndicatorPeriodsSchema,

  // Sources
  sources: SourcesSchema,
  defiLlamaEnabled: z.boolean().optional(),

  // Token whitelist
  tokens: z.array(z.string()).optional(),

  // Strategy / timeframe weights
  strategyWeights: z.record(z.string(), z.number()).optional(),
  timeframeWeights: z.record(z.string(), z.number()).optional(),

  // Log retention & integrity
  logRetentionDays: z.number().int().nonnegative(),
  enableFileChecksums: z.boolean().optional(),

  // Store (SQLite)
  store: StoreSchema.optional(),

  // API / WebSocket
  apiToken: z.string().optional(),
  wsPort: z.number().optional(),
  coinglassKey: z.string().optional(),

  // ML pipeline
  ml: MlSchema.optional(),

  // Price alerts
  alerts: z.array(z.any()).optional(),

  // Webhook notifications
  webhooks: WebhooksSchema.optional(),
});

// ── Exported type ───────────────────────────────────────────────────────

export type ValidatedConfig = z.infer<typeof RadarConfigSchema>;
