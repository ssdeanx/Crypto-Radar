// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — News Fetcher Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAndMatchNews } from './news.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('News Fetcher', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns empty array when all feeds fail', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    const result = await fetchAndMatchNews('RUN-1', '2026-01-01T00:00:00Z');
    expect(result).toEqual([]);
  });

  it('handles non-ok response gracefully', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await fetchAndMatchNews('RUN-1', '2026-01-01T00:00:00Z');
    expect(result).toEqual([]);
  });

  it('parses RSS feed and matches tokens', async () => {
    const rssXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Solana upgrade boosts network performance</title>
      <description>Solana blockchain completes major upgrade</description>
      <pubDate>Mon, 01 Jan 2026 12:00:00 GMT</pubDate>
      <link>https://cointelegraph.com/news/solana-upgrade</link>
    </item>
    <item>
      <title>Bitcoin reaches new all-time high</title>
      <description>Bitcoin price surges past previous record</description>
      <pubDate>Mon, 01 Jan 2026 12:00:00 GMT</pubDate>
      <link>https://cointelegraph.com/news/bitcoin-ath</link>
    </item>
  </channel>
</rss>`;

    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => rssXml,
    });

    const result = await fetchAndMatchNews('RUN-1', '2026-01-01T00:00:00Z');
    // Should match Solana (token name) and Bitcoin (token name)
    const symbols = result.map(m => m.symbol);
    expect(symbols).toContain('SOL');
    expect(symbols).toContain('BTC');
  });

  it('filters out poison headlines', async () => {
    const rssXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Bitcoin price prediction for 2026</title>
      <description>Expert predicts Bitcoin price</description>
      <pubDate>Mon, 01 Jan 2026 12:00:00 GMT</pubDate>
      <link>https://cointelegraph.com/news/btc-prediction</link>
    </item>
  </channel>
</rss>`;

    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => rssXml,
    });

    const result = await fetchAndMatchNews('RUN-1', '2026-01-01T00:00:00Z');
    // "price" in headline should be filtered by poison patterns
    expect(result).toEqual([]);
  });

  it('deduplicates identical headlines', async () => {
    const rssXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Solana upgrade successful</title>
      <description>Major upgrade for Solana blockchain</description>
      <pubDate>Mon, 01 Jan 2026 12:00:00 GMT</pubDate>
      <link>https://cointelegraph.com/news/solana-upgrade</link>
    </item>
    <item>
      <title>Solana upgrade successful</title>
      <description>Another article about Solana upgrade</description>
      <pubDate>Mon, 01 Jan 2026 12:30:00 GMT</pubDate>
      <link>https://cointelegraph.com/news/solana-upgrade-2</link>
    </item>
  </channel>
</rss>`;

    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => rssXml,
    });

    const result = await fetchAndMatchNews('RUN-1', '2026-01-01T00:00:00Z');
    // Only one SOL match due to dedup
    const solMatches = result.filter(m => m.symbol === 'SOL');
    expect(solMatches).toHaveLength(1);
  });
});
