# Crypto News RSS Feed Research — New Feeds for Crypto Radar

**Date:** 2026-07-19
**Context:** Adding 10-15 high-quality RSS feeds to supplement the current 28 feeds (heavily Solana-skewed). Each entry is verified working and fills a specific gap.

---

## Existing Feed Landscape (28 feeds)

| Category | Count | Sources |
|---|---|---|
| Tier 1 general | 7 | CoinTelegraph, CoinDesk, Decrypt, The Defiant, The Block, Blockworks, DL News |
| Solana ecosystem | ~12 | Solana Official, SolanaFloor, Solana Compass, CryptoPotato Solana, CryptoSlate Solana, U.Today Solana, SolanaFM, etc. |
| Google News aggregators | 5 | Crypto, Bitcoin, Solana (×2), DeFi |
| Other general/niche | 4 | CryptoSlate, CoinStats, DeFi Saver, NullTX |

**Key gaps:** No dedicated Bitcoin journalism, no Ethereum protocol news, no DeFi research/analytics, no European regulatory news, limited general news breadth.

---

## Recommended New Feeds (12 feeds)

### 🔵 TIER 1 — Original Journalism, High Authority

| # | Feed Name | RSS URL | Ecosystem | Why Add |
|---|---|---|---|---|
| 1 | **Bitcoin Magazine** | `https://bitcoinmagazine.com/.rss/full/` | Bitcoin | The oldest Bitcoin publication. Fills the biggest gap — zero dedicated Bitcoin-first journalism in current feeds. Covers Bitcoin tech, policy, markets, culture. Original reporting, not aggregation. |
| 2 | **Ethereum Foundation Blog** | `https://blog.ethereum.org/en/feed.xml` | Ethereum Protocol | Official Ethereum Foundation publications — protocol upgrades, research, ecosystem grants, Devcon. Unique intelligence angle: protocol-level decisions before they hit market news. Low volume but high signal. |
| 3 | **DefiLlama Research** | `https://defillama.com/research/feed` | DeFi | Premier DeFi analytics platform's research arm. Deep-dive reports, TVL analysis, protocol comparisons, market structure research. Data-backed — complements The Defiant's news coverage with analytics. |

### 🟠 TIER 2 — Quality News / Strong Editorial

| # | Feed Name | RSS URL | Ecosystem | Why Add |
|---|---|---|---|---|
| 4 | **crypto.news** | `https://crypto.news/feed/` | General | Fast-growing independent crypto news outlet (formerly U.Today's English arm, now separate). Good editorial standards, frequent updates (hourly), covers Bitcoin, Ethereum, DeFi, regulation, AI + crypto. |
| 5 | **NewsBTC** | `https://newsbtc.com/feed/` | General | Established outlet since 2013. Strong Bitcoin and altcoin coverage, market analysis, on-chain data reports. Good signal-to-noise ratio — less clickbait than peers. |
| 6 | **Bitcoin.com News** | `https://news.bitcoin.com/feed/` | Bitcoin + Global | Bitcoin.com network's news division. Excellent global perspective — "Latam Insights" and "Africa Insights" regular features. Covers Bitcoin adoption, regulation, payments worldwide. Complements Bitcoin Magazine's US-centric coverage. |
| 7 | **CoinJournal** | `https://coinjournal.net/feed/` | EU / Regulation | UK-based crypto news with strong European regulatory coverage (MiCA, UK FCA, EU policy). Current feeds have no dedicated EU regulatory source — this fills a critical gap. Good for regulatory signal detection. |
| 8 | **CryptoPotato** | `https://cryptopotato.com/feed/` | General | Currently only have "CryptoPotato Solana" tag feed. Adding the main feed broadens coverage to Bitcoin, Ethereum, DeFi, NFTs, and macro. Solid mid-tier outlet with frequent updates. |

### 🟢 TIER 3 — Niche / Specialist / Aggregator

| # | Feed Name | RSS URL | Ecosystem | Why Add |
|---|---|---|---|---|
| 9 | **U.Today** | `https://u.today/rss.php` | General | Currently only have "U.Today Solana" tag feed. General feed adds Bitcoin, Ethereum, XRP, regulation, and broader market coverage. Tier 3 due to some advertorial/sponsored content — use tier penalty. |
| 10 | **Crypto Briefing Prediction Markets** | `https://cryptobriefing.com/prediction-markets/feed/` | Prediction Markets | AI-powered prediction market analysis and odds tracking. Prediction markets (Polymarket, Kalshi) are a growing signal source. However: content overlaps with main CB feed (already included) — **only add if duplicate filtering is acceptable** or use as a focused supplement. ⚠️ |
| 11 | **Google News Ethereum** | `https://news.google.com/rss/search?q=ethereum&hl=en-US&gl=US&ceid=US:en` | Ethereum | Dedicated Ethereum news aggregator. Current feeds have Google News for Crypto, Bitcoin, Solana, DeFi — but not Ethereum specifically. Ethereum is the #2 crypto by market cap, so this is a notable gap. |
| 12 | **Google News Regulation** | `https://news.google.com/rss/search?q=cryptocurrency+regulation&hl=en-US&gl=US&ceid=US:en` | Regulation | Dedicated regulatory news aggregator from Google News. Complements CoinJournal's EU/UK focus with global regulatory coverage (SEC, CFTC, EU MiCA, Asia). Regulatory signals are high-value for crypto market intelligence. |

---

## 📋 Feeds Considered But Not Recommended

| Feed | URL | Result | Why Not |
|---|---|---|---|
| **CryptoPanic** | `https://cryptopanic.com/news/rss/` | ❌ Failed | Requires API key (paid plans start at free tier). Their `/news/rss/` endpoint returned 404. Could integrate via their API but needs auth token — out of scope for zero-API-key project. |
| **rekt.news** | `https://rekt.news/feed.xml` | ❌ No RSS | rekt.news doesn't publish an RSS feed. Content is great for security/hack signals but requires web scraping. |
| **Week in Ethereum News** | `https://weekinethereumnews.com/feed.xml` | ❌ Deprecated | Evan Van Ness ended the newsletter. Site appears to be winding down ("END OF SERVICE" noted in recent issues). |
| **Bankless** | various | ❌ No RSS | Bankless is primarily a podcast + paid newsletter. No public RSS feed for written articles. |
| **Milk Road** | various | ❌ No RSS | Newsletter-only (Beehiiv). No public RSS feed. |
| **Unchained** | `https://feeds.megaphone.fm/LSHML4761942757` | ⚠️ Podcast | This is a podcast audio feed, not news articles. Not suitable for the text-based news pipeline. |
| **CoinMarketCap Blog** | `https://blog.coinmarketcap.com/feed/` | ⚠️ Educational | Returns educational/learning content (glossary definitions, tutorials), not news. Low signal for token matching. |
| **CoinGecko** | `https://www.coingecko.com/en/rss` | ❌ 404 | CoinGecko doesn't offer a public RSS feed anymore. They have an API but requires key. |
| **Cryptonews.com** | `https://cryptonews.com/news/feed/` | ✅ Works | Heavy SEO/clickbait content ("Elon Musk Grok AI Predicts XRP Price"). Low signal-to-noise ratio. Current tier 4 equivalent (NullTX tier). Only add if you want quantity over quality. |
| **CryptoSlate Ethereum** | `https://cryptoslate.com/news/ethereum/feed/` | ✅ Works | Overlaps with existing CryptoSlate main feed. Same articles, just pre-filtered to Ethereum tag. Redundant. |
| **Crypto Briefing sub-feeds** | Various (`/category/ai/feed/`, etc.) | ✅ Work | Overlap with existing Crypto Briefing main feed. Only Prediction Markets has unique enough content to consider (it's not a category — it's a standalone feature). |

---

## Recommended Implementation

### Priority order for adding:
1. **Tier 1** (3 feeds): Bitcoin Magazine, EF Blog, DefiLlama Research — fill genuine content gaps
2. **Tier 2** (5 feeds): crypto.news, NewsBTC, Bitcoin.com News, CoinJournal, CryptoPotato — broaden general coverage
3. **Tier 3** (4 feeds): U.Today, Google News Ethereum, Google News Regulation — fill niche gaps

### Source tier configuration (for `SOURCE_TIERS` map in news.ts):
```typescript
'Bitcoin Magazine': 1.0,              // Tier 1 — original Bitcoin journalism
'Ethereum Foundation Blog': 1.0,      // Tier 1 — official protocol news
'DefiLlama Research': 1.0,            // Tier 1 — premier DeFi research
'crypto.news': 0.8,                   // Tier 2 — quality general outlet
'NewsBTC': 0.8,                       // Tier 2 — established outlet
'Bitcoin.com News': 0.8,              // Tier 2 — Bitcoin with global view
'CoinJournal': 0.8,                   // Tier 2 — EU regulatory focus
'CryptoPotato': 0.8,                  // Tier 2 — solid mid-tier outlet
'U.Today': 0.6,                       // Tier 3 — some advertorial content
'Crypto Briefing Prediction Markets': 0.7, // Tier 2 — niche but high signal
'Google News Ethereum': 0.7,          // Tier 2 — aggregator
'Google News Regulation': 0.7,        // Tier 2 — aggregator
```

### Cost/performance notes:
- All feeds are **free, no API key needed** — aligns with ADR-002 (zero API keys)
- Estimated additional load: ~6-8 HTTP requests per radar cycle (12 feeds at concurrency-4)
- Dead feed risk: Low for Tier 1 (Bitcoin Magazine, EF Blog, DefiLlama are established). Medium for Tier 2. Google News feeds are extremely stable.
- Rate limits: None observed during testing. Standard `User-Agent` header (`Hermes-Crypto-Radar/1.0`) recommended.

---

## Coverage Impact Analysis

After adding all 12 feeds, the coverage map looks like:

| Ecosystem | Current | After | Improvement |
|---|---|---|---|
| General crypto | 10 feeds | 15 feeds | +50% breadth |
| Bitcoin-specific | 1 (Google News) | 4 (BM, NewsBTC, Bitcoin.com, GNews) | 4× coverage |
| Ethereum-specific | 0 | 3 (EF Blog, GNews ETH, CoinJournal) | New category |
| DeFi | 3 | 4 (+DefiLlama Research) | Data angle added |
| Regulation | 0 | 2 (CoinJournal, GNews Regulation) | New category |
| Solana | ~12 | ~12 | Unchanged (already saturated) |
| AI x Crypto | 0 | 1 (Prediction Markets) | New category |
