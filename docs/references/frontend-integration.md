# Frontend Integration Guide — Crypto-Radar

This guide outlines how a modern frontend dashboard (React, Vite, Next.js, or Vue) connects to the **Crypto-Radar** backend running on **Google Cloud Run**.

---

## 1. Architecture & Communication Flow

```bash
┌─────────────────────────────────────────────────────────────┐
│                 Frontend UI (React / Vite)                  │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ TanStack Query (React Query) Fetching & Cache       │   │
│   │ - Tickers Polling (10s): GET /api/tickers           │   │
│   │ - Signals Polling (30s): GET /api/signals           │   │
│   │ - Portfolio State:       GET /api/portfolio         │   │
│   │ - Paper Trade Mutation:  POST /api/portfolio/trades │   │
│   │ - Candlestick Chart:     GET /api/klines/:symbol    │   │
│   └──────────────────────────┬──────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────┘
                               │ HTTPS REST Requests
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Crypto-Radar (Google Cloud Run)                │
│                                                             │
│   Fastify REST Engine (Port 8080)                           │
│   - Stateless instances scaling 0 to N                      │
│   - Persists data to Google BigQuery                        │
│   - Fetches live market feeds from Binance & DeFiLlama      │
│   - Runs CatBoost ML predictions and MathJS calculations    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Environment Configuration

In your frontend project's `.env.local`:

```env
# Local development server or deployed Cloud Run endpoint
VITE_RADAR_API_URL=http://localhost:8080
# VITE_RADAR_API_URL=https://crypto-radar-xyz-uc.a.run.app
```

---

## 3. Data Fetching Hooks (TanStack Query)

### Live Tickers Polling Hook

```typescript
import { useQuery } from '@tanstack/react-query';

export interface TickerData {
  symbol: string;
  pair: string;
  chain: string;
  price: number;
  change_24h: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  timestamp: number;
}

export function useRadarTickers(chainFilter?: string) {
  return useQuery<TickerData[]>({
    queryKey: ['radar-tickers', chainFilter],
    queryFn: async () => {
      const url = new URL('/api/tickers', import.meta.env.VITE_RADAR_API_URL);
      if (chainFilter) url.searchParams.set('chain', chainFilter);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    },
    refetchInterval: 10_000, // 10s auto-refresh
    staleTime: 5_000,
  });
}
```

---

### Strategy Signals Hook

```typescript
import { useQuery } from '@tanstack/react-query';

export interface StrategySignal {
  symbol: string;
  chain: string;
  price: number;
  direction: 'buy' | 'sell' | 'neutral';
  compositeScore: number;
  confidence: number;
  momentumScore: number;
  meanReversionScore: number;
  trendFollowingScore: number;
  divergenceScore: number;
  adx: number;
  rsi: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
}

export function useRadarSignals(minScore = 0) {
  return useQuery<StrategySignal[]>({
    queryKey: ['radar-signals', minScore],
    queryFn: async () => {
      const url = new URL('/api/signals', import.meta.env.VITE_RADAR_API_URL);
      if (minScore > 0) url.searchParams.set('minScore', minScore.toString());
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000, // 30s auto-refresh
  });
}
```

---

### Paper Trading Portfolio & Execution Mutation

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface PortfolioState {
  profile: string;
  cash: number;
  holdings: Array<{ symbol: string; quantity: number; avgEntry: number }>;
  pnl: number;
  winRate: number;
  totalTrades: number;
  startBalance: number;
}

export function useRadarPortfolio(profile = 'trader1') {
  return useQuery<PortfolioState>({
    queryKey: ['radar-portfolio', profile],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_RADAR_API_URL}/api/portfolio?profile=${profile}`);
      if (!res.ok) throw new Error(`Failed to fetch portfolio: ${res.statusText}`);
      return res.json();
    },
    refetchInterval: 15_000,
  });
}

export interface PaperTradeRequest {
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  profile?: string;
  reason?: string;
}

export function useSubmitPaperTrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (trade: PaperTradeRequest) => {
      const res = await fetch(`${import.meta.env.VITE_RADAR_API_URL}/api/portfolio/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trade),
      });
      if (!res.ok) throw new Error(`Paper trade failed: ${res.statusText}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['radar-portfolio'] });
    },
  });
}
```

---

## 4. UI Component Construction Blueprint

1. **Market Scanner Grid**:
   - Displays all 149 tokens sorted by 24h volume and % change.
   - Filterable by chain (Solana, Ethereum, Base, Arbitrum, BSC, etc.).

2. **Signal Intelligence Deck**:
   - Visual direction badge (`BUY`, `SELL`, `NEUTRAL`).
   - Strategy score decomposition breakdown (Momentum, Mean Reversion, Trend Following, Divergence).
   - Quantitative risk box showing Stop-Loss ($SL$), Take-Profit ($TP$), and Risk-to-Reward ratio ($R:R$).

3. **Candlestick Charting Container**:
   - Queries `/api/klines/:symbol?interval=1h&limit=100`.
   - Renders OHLCV bars with Bollinger Bands and EMA overlays.

4. **Paper Trading Terminal**:
   - Buy / Sell execution form triggering `useSubmitPaperTrade()`.
   - Portfolio balance, open positions, unrealized P&L, win rate, and leaderboard.

5. **Matplotlib Visual Chart Component (Zero-JS-Charting)**:
   - Embed real publication-grade Python Matplotlib visuals directly in React:

   ```tsx
   import React, { useState } from 'react';

   export function RadarCandlestickChart({ symbol = 'SOL' }: { symbol: string }) {
     const [interval, setInterval] = useState<'15m' | '1h' | '4h' | '1d'>('1h');
     const chartUrl = `${import.meta.env.VITE_RADAR_API_URL}/api/chart/${symbol}?interval=${interval}&limit=100`;

     return (
       <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4">
         <div className="flex justify-between items-center mb-3">
           <h3 className="text-white font-semibold">{symbol} Multi-Panel Dashboard</h3>
           <div className="flex gap-2">
             {(['15m', '1h', '4h', '1d'] as const).map((int) => (
               <button
                 key={int}
                 onClick={() => setInterval(int)}
                 className={`px-3 py-1 text-xs rounded-md ${
                   interval === int ? 'bg-blue-600 text-white' : 'bg-[#21262d] text-gray-400'
                 }`}
               >
                 {int}
               </button>
             ))}
           </div>
         </div>
         <img
           src={chartUrl}
           alt={`${symbol} Technical Chart`}
           className="w-full h-auto rounded-lg shadow-lg"
           loading="lazy"
         />
       </div>
     );
   }
   ```
