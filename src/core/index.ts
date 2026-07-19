// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Core Index
// ═══════════════════════════════════════════════════════════════════════

export { loadConfig, resetConfig, writeDefaultConfig } from './config.js';
export type { RadarConfig } from './config.js';
export { CryptoRadarError, NetworkError, RateLimitError, DataError, ConfigError, CacheError, SignalError, logWarn } from './errors.js';
export { logger } from './logger.js';
export type { LogLevel, LogEntry } from './logger.js';
export { Cache } from './cache.js';
export { RateLimiter } from './rate-limiter.js';
export {
  recordFeedResult,
  getFeedHealthReport,
  getDeadFeeds,
  formatFeedHealth,
  resetFeedHealth,
} from './feed-monitor.js';
export type { FeedHealth } from './feed-monitor.js';
export {
  checkLogRotation,
  pruneOldLogs,
  writeLogWithChecksum,
  verifyLogChecksum,
  computeFileChecksum,
} from './log-rotation.js';
