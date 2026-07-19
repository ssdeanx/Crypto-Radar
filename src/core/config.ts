// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Configuration Management
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { ConfigError, logWarn } from "./errors.js";
import type { PriceAlert } from "./alerts.js";

const DEFAULT_DATA_DIR = `/data/crypto-radar`;

export interface RadarConfig {
  /** Binance API base URL */
  binanceBaseUrl: string;
  /** Fetch timeout in ms */
  fetchTimeoutMs: number;
  /** Max retries for network calls */
  maxRetries: number;
  /** Cache TTL in ms (default: 5 min) */
  cacheTtlMs: number;
  /** Rate limit — max requests per window */
  rateLimitMax: number;
  /** Rate limit window in ms */
  rateLimitWindowMs: number;
  /** Log level: trace, debug, info, warn, error */
  logLevel: string;
  /** Data directory for logs */
  dataDir: string;
  /** Secondary data directory (auto-detected from legacy ~/.hermes/data/crypto-radar) */
  secondaryDataDir?: string;
  /** News feeds to use */
  newsFeeds: boolean;
  /** Max news articles per feed */
  maxNewsPerFeed: number;
  /** Technical indicator periods */
  indicatorPeriods: {
    rsi: number;
    macdFast: number;
    macdSlow: number;
    macdSignal: number;
    bbPeriod: number;
    bbStdDev: number;
    atrPeriod: number;
    ema50: number;
  };
  /** Market data sources enabled */
  sources: {
    binance: boolean;
    coinGecko: boolean;
    defiLlama?: boolean;
    futures?: boolean;
    fearGreed?: boolean;
    crossAsset?: boolean;
    orderbook?: boolean;
  };
  /** Enable DeFiLlama on-chain metrics during scan */
  defiLlamaEnabled?: boolean;
  /** Optional token whitelist — if set, only these token IDs are scanned */
  tokens?: string[];
  /** Override strategy weights e.g. {"momentum": 0.5, "mean-reversion": 0.2, "trend-following": 0.3} */
  strategyWeights?: Record<string, number>;
  /** Override timeframe weights e.g. {"15m": 0.1, "1h": 0.25, "4h": 0.3, "1d": 0.35} */
  timeframeWeights?: Record<string, number>;
  /** Auto-prune log files older than this many days (default: 0 = no pruning) */
  logRetentionDays: number;
  /** Enable SHA-256 checksum verification on log files */
  enableFileChecksums?: boolean;
  /** Store (SQLite) config */
  store?: { path?: string; retentionDays?: number };
  /** API bearer token for mutating routes (RADAR__API_TOKEN) */
  apiToken?: string;
  /** WebSocket server port (RADAR__WS_PORT, default 9878) */
  wsPort?: number;
  /** Coinglass API key for liquidation fallback (RADAR__COINGLASS_KEY) */
  coinglassKey?: string;
  /** ML pipeline config */
  ml?: {
    enabled?: boolean; // default false
    training?: {
      symbols?: string[];
      intervals?: string[];
      lookbackDays?: number; // default 90
      retrainIntervalHours?: number;
      labelHorizon?: 1 | 5 | 20 | 60; // forward-return horizon (default 5)
      optimize?: boolean; // opt-in hyperparameter optimization
      optunaTrials?: number; // number of Optuna trials (default 30)
      cvFolds?: number; // opt-in cross-validation folds
      balance?: boolean; // opt-in class balancing
      shap?: boolean; // opt-in SHAP feature importance
    };
    prediction?: {
      inferenceMode?: "subprocess" | "onnx"; // default 'subprocess'
      minConfidence?: number; // default 0.6
      modelPath?: string;
    };
  };
  /** Price alert thresholds — loaded from radar.config.json */
  alerts?: PriceAlert[];
  /** Webhook notification config (Discord URL / Telegram bot) */
  webhooks?: {
    discord?: string;
    telegram?: {
      botToken: string;
      chatId: string;
    };
  };
}

const DEFAULTS: RadarConfig = {
  binanceBaseUrl: "https://data-api.binance.vision",
  fetchTimeoutMs: 10_000,
  maxRetries: 3,
  cacheTtlMs: 300_000, // 5 min
  rateLimitMax: 20,
  rateLimitWindowMs: 1_000, // 20 req/sec
  logLevel: "info",
  dataDir: DEFAULT_DATA_DIR,
  newsFeeds: true,
  maxNewsPerFeed: 30,
  indicatorPeriods: {
    rsi: 14,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    bbPeriod: 20,
    bbStdDev: 2,
    atrPeriod: 14,
    ema50: 50,
  },
  sources: {
    binance: true,
    coinGecko: false,
    futures: true,
    fearGreed: true,
    crossAsset: true,
  },
  defiLlamaEnabled: false,
  logRetentionDays: 30, // auto-prune logs older than 30 days
  enableFileChecksums: true,
  ml: {
  },
};

let _instance: RadarConfig | null = null;

/**
 * Load config from file + env overrides.
 *
 * Resolution priority:
 *   1. Config file at path (if provided)
 *   2. Environment variables (RADAR__<KEY>)
 *   3. Defaults
 */
export function loadConfig(configPath?: string): RadarConfig {
  if (_instance) return _instance;

  const base = JSON.parse(JSON.stringify(DEFAULTS)) as RadarConfig;

  // 1. Auto-discover config file from well-known paths
  const autoPaths = configPath
    ? [configPath]
    : ["radar.config.json", resolve("radar.config.json")];

  for (const path of autoPaths) {
    if (existsSync(path)) {
      configPath = path;
      break;
    }
  }

  // 2. File overrides (if provided or discovered)
  if (configPath && existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const fileConfig = JSON.parse(raw);
      mergeDeep(base as unknown as Record<string, unknown>, fileConfig);
    } catch (err) {
      throw new ConfigError(
        "config_file",
        `Failed to load ${configPath}: ${err}`,
      );
    }
  }

  // 2. Environment overrides (RADAR__BINANCE_BASE_URL, RADAR__LOG_LEVEL, etc.)
  const envMap: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith("RADAR__") && val) {
      envMap[key.slice(7).toLowerCase()] = val;
    }
  }

  if (envMap.binance_base_url) base.binanceBaseUrl = envMap.binance_base_url;
  if (envMap.fetch_timeout_ms)
    base.fetchTimeoutMs = parseInt(envMap.fetch_timeout_ms, 10);
  if (envMap.max_retries) base.maxRetries = parseInt(envMap.max_retries, 10);
  if (envMap.cache_ttl_ms) base.cacheTtlMs = parseInt(envMap.cache_ttl_ms, 10);
  if (envMap.log_level) base.logLevel = envMap.log_level;
  if (envMap.data_dir) base.dataDir = envMap.data_dir;
  if (envMap.rate_limit_max)
    base.rateLimitMax = parseInt(envMap.rate_limit_max, 10);
  if (envMap.tokens) {
    // Support both JSON array: ["bitcoin","ethereum"]
    // and comma-separated: bitcoin,ethereum
    const raw = envMap.tokens.trim();
    if (raw.startsWith("[")) {
      try {
        base.tokens = JSON.parse(raw);
      } catch (err) {
        logWarn("config", "Failed to parse RADAR__TOKENS", err);
        base.tokens = raw
          .replace(/[[\]"'\s]/g, "")
          .split(",")
          .filter(Boolean);
      }
    } else {
      base.tokens = raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  if (envMap.strategy_weights) {
    try {
      base.strategyWeights = JSON.parse(envMap.strategy_weights);
    } catch (err) {
      logWarn("config", "Failed to parse strategy_weights", err);
    }
  }
  if (envMap.timeframe_weights) {
    try {
      base.timeframeWeights = JSON.parse(envMap.timeframe_weights);
    } catch (err) {
      logWarn("config", "Failed to parse timeframe_weights", err);
    }
  }
  if (envMap.log_retention_days)
    base.logRetentionDays = parseInt(envMap.log_retention_days, 10);
  if (envMap.enable_file_checksums)
    base.enableFileChecksums = envMap.enable_file_checksums === "true";
  if (envMap.store_path) {
    base.store ??= {};
    base.store.path = envMap.store_path;
  }
  if (envMap.store_retention_days) {
    base.store ??= {};
    base.store.retentionDays = parseInt(envMap.store_retention_days, 10);
  }
  if (envMap.sources_futures)
    base.sources.futures = envMap.sources_futures === "true";
  if (envMap.sources_fear_greed)
    base.sources.fearGreed = envMap.sources_fear_greed === "true";
  if (envMap.sources_cross_asset)
    base.sources.crossAsset = envMap.sources_cross_asset === "true";
  if (envMap.sources_orderbook)
    base.sources.orderbook = envMap.sources_orderbook === "true";
  if (envMap.api_token) base.apiToken = envMap.api_token;
  if (envMap.ws_port) base.wsPort = parseInt(envMap.ws_port, 10);
  if (envMap.coinglass_key) base.coinglassKey = envMap.coinglass_key;
  // ML config env overrides
  if (envMap.ml_enabled) {
    base.ml ??= {};
    base.ml.enabled = envMap.ml_enabled === "true";
  }
  if (envMap.ml_lookback_days) {
    base.ml ??= {};
    base.ml.training ??= {};
    base.ml.training.lookbackDays = parseInt(envMap.ml_lookback_days, 10);
  }
  if (envMap.ml_retrain_hours) {
    base.ml ??= {};
    base.ml.training ??= {};
    base.ml.training.retrainIntervalHours = parseInt(
      envMap.ml_retrain_hours,
      10,
    );
  }
  if (envMap.ml_min_confidence) {
    base.ml ??= {};
    base.ml.prediction ??= {};
    base.ml.prediction.minConfidence = parseFloat(envMap.ml_min_confidence);
  }
  if (envMap.ml_optimize) {
    base.ml ??= {};
    base.ml.training ??= {};
    base.ml.training.optimize = envMap.ml_optimize === "true";
  }
  if (envMap.ml_optuna_trials) {
    base.ml ??= {};
    base.ml.training ??= {};
    base.ml.training.optunaTrials = parseInt(envMap.ml_optuna_trials, 10);
  }
  if (envMap.ml_cv_folds) {
    base.ml ??= {};
    base.ml.training ??= {};
    base.ml.training.cvFolds = parseInt(envMap.ml_cv_folds, 10);
  }
  if (envMap.ml_balance) {
    base.ml ??= {};
    base.ml.training ??= {};
    base.ml.training.balance = envMap.ml_balance === "true";
  }
  if (envMap.ml_shap) {
    base.ml ??= {};
    base.ml.training ??= {};
    base.ml.training.shap = envMap.ml_shap === "true";
  }

  // 3. Secondary data directory auto-detection + env override
  const legacyDir = `${homedir()}/.hermes/data/crypto-radar`;
  if (!base.secondaryDataDir && existsSync(legacyDir)) {
    base.secondaryDataDir = legacyDir;
  }
  if (envMap.secondary_data_dir) base.secondaryDataDir = envMap.secondary_data_dir;

  // 4. Startup info log — show resolved data dirs on first load
  if (base.secondaryDataDir) {
    logWarn(
      "config",
      `dataDir=${base.dataDir} secondaryDataDir=${base.secondaryDataDir}`,
    );
  } else {
    logWarn("config", `dataDir=${base.dataDir}`);
  }

  _instance = base;
  return base;
}

/** Reset config (for testing) */
export function resetConfig(): void {
  _instance = null;
}

/** Generate a default config file */
export function writeDefaultConfig(path: string): void {
  writeFileSync(path, JSON.stringify(DEFAULTS, null, 2) + "\n");
}

function mergeDeep(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      if (!target[key] || typeof target[key] !== "object") {
        target[key] = {};
      }
      mergeDeep(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      target[key] = source[key];
    }
  }
}
