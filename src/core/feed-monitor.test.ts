// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — RSS Feed Health Monitor Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordFeedResult,
  getFeedHealthReport,
  getDeadFeeds,
  formatFeedHealth,
  resetFeedHealth,
} from './feed-monitor.js';

describe('Feed Health Monitor', () => {
  beforeEach(() => {
    resetFeedHealth();
  });

  describe('recordFeedResult', () => {
    it('starts a new feed as healthy on first success', () => {
      recordFeedResult('test-feed', 'https://example.com/rss', true);

      const report = getFeedHealthReport();
      expect(report).toHaveLength(1);
      expect(report[0]).toMatchObject({
        name: 'test-feed',
        url: 'https://example.com/rss',
        status: 'healthy',
        consecutiveFailures: 0,
      });
      expect(report[0].lastSuccess).not.toBeNull();
      expect(report[0].lastFailure).toBeNull();
    });

    it('transitions from healthy to degraded to dead', () => {
      recordFeedResult('feed1', 'https://example.com/rss', true);

      // 1st failure: still healthy (0-1 consecutive failures)
      recordFeedResult('feed1', 'https://example.com/rss', false);
      expect(getFeedHealthReport()[0].status).toBe('healthy');
      expect(getFeedHealthReport()[0].consecutiveFailures).toBe(1);

      // 2nd failure: degraded (2 consecutive failures)
      recordFeedResult('feed1', 'https://example.com/rss', false);
      expect(getFeedHealthReport()[0].status).toBe('degraded');
      expect(getFeedHealthReport()[0].consecutiveFailures).toBe(2);

      // 3rd failure: dead (3+ consecutive failures)
      recordFeedResult('feed1', 'https://example.com/rss', false);
      expect(getFeedHealthReport()[0].status).toBe('dead');
      expect(getFeedHealthReport()[0].consecutiveFailures).toBe(3);
    });

    it('recovers to healthy after a successful fetch', () => {
      // Drive to dead
      recordFeedResult('feed1', 'https://example.com/rss', false);
      recordFeedResult('feed1', 'https://example.com/rss', false);
      recordFeedResult('feed1', 'https://example.com/rss', false);
      expect(getFeedHealthReport()[0].status).toBe('dead');

      // Recover
      recordFeedResult('feed1', 'https://example.com/rss', true);
      const report = getFeedHealthReport();
      expect(report[0].status).toBe('healthy');
      expect(report[0].consecutiveFailures).toBe(0);
      expect(report[0].lastSuccess).not.toBeNull();
    });

    it('tracks lastFailure timestamp on errors', () => {
      recordFeedResult('feed1', 'https://example.com/rss', false, 'Connection timeout');
      const report = getFeedHealthReport();
      expect(report[0].lastFailure).not.toBeNull();
      expect(report[0].consecutiveFailures).toBe(1);
    });

    it('tracks multiple feeds independently', () => {
      recordFeedResult('healthy-feed', 'url1', true);
      recordFeedResult('dead-feed', 'url2', false);
      recordFeedResult('dead-feed', 'url2', false);
      recordFeedResult('dead-feed', 'url2', false);
      recordFeedResult('degraded-feed', 'url3', false);
      recordFeedResult('degraded-feed', 'url3', false);

      const report = getFeedHealthReport();
      expect(report).toHaveLength(3);

      const dead = report.find((f) => f.name === 'dead-feed');
      expect(dead?.status).toBe('dead');

      const degraded = report.find((f) => f.name === 'degraded-feed');
      expect(degraded?.status).toBe('degraded');

      const healthy = report.find((f) => f.name === 'healthy-feed');
      expect(healthy?.status).toBe('healthy');
    });
  });

  describe('getFeedHealthReport', () => {
    it('returns empty array when no feeds recorded', () => {
      expect(getFeedHealthReport()).toEqual([]);
    });

    it('sorts by severity: dead first, then degraded, then healthy', () => {
      recordFeedResult('healthy', 'u1', true);
      recordFeedResult('dead', 'u2', false);
      recordFeedResult('dead', 'u2', false);
      recordFeedResult('dead', 'u2', false);
      recordFeedResult('degraded', 'u3', false);
      recordFeedResult('degraded', 'u3', false);

      const report = getFeedHealthReport();
      expect(report[0].name).toBe('dead');
      expect(report[1].name).toBe('degraded');
      expect(report[2].name).toBe('healthy');
    });
  });

  describe('getDeadFeeds', () => {
    it('returns only dead feeds', () => {
      recordFeedResult('alive', 'u1', true);
      recordFeedResult('dying', 'u2', false);
      recordFeedResult('dying', 'u2', false);
      recordFeedResult('dead-feed', 'u3', false);
      recordFeedResult('dead-feed', 'u3', false);
      recordFeedResult('dead-feed', 'u3', false);

      const dead = getDeadFeeds();
      expect(dead).toHaveLength(1);
      expect(dead[0].name).toBe('dead-feed');
    });

    it('returns empty array when no feeds are dead', () => {
      recordFeedResult('feed1', 'url', true);
      expect(getDeadFeeds()).toEqual([]);
    });
  });

  describe('formatFeedHealth', () => {
    it('returns placeholder text when no data', () => {
      const output = formatFeedHealth();
      expect(output).toBe('No feed health data collected yet.');
    });

    it('includes feed names and health icons', () => {
      recordFeedResult('CoinTelegraph', 'https://example.com/rss', true);
      recordFeedResult('CoinDesk', 'https://example.com/rss2', false);
      recordFeedResult('CoinDesk', 'https://example.com/rss2', false);

      const output = formatFeedHealth();
      expect(output).toContain('Feed Health Report');
      expect(output).toContain('✅');
      expect(output).toContain('⚠️');
      expect(output).toContain('CoinTelegraph');
      expect(output).toContain('CoinDesk');
    });

    it('formats a feed that has never succeeded', () => {
      recordFeedResult('new-feed', 'url', false);
      const output = formatFeedHealth();
      expect(output).toContain('never OK');
    });
  });

  describe('resetFeedHealth', () => {
    it('clears all recorded feed health state', () => {
      recordFeedResult('feed1', 'url', true);
      recordFeedResult('feed2', 'url2', false);
      expect(getFeedHealthReport()).toHaveLength(2);

      resetFeedHealth();
      expect(getFeedHealthReport()).toHaveLength(0);
      expect(getDeadFeeds()).toEqual([]);
    });
  });
});
