// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Production ML Dataset Exporter CLI
// ═══════════════════════════════════════════════════════════════════════
//
// Assembles production training datasets from historical market database records
// (and live Binance exchange endpoints), computes 42 normalized feature columns
// per candle window, and exports chronological JSONL datasets for CatBoost training.
// ═══════════════════════════════════════════════════════════════════════

import * as path from 'node:path';
import * as fs from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchKlines } from '../binance.js';
import { buildFeatures } from './features.js';
import { computeLabels } from './labels.js';
import { assembleDataset } from './dataset.js';
import type { FeatureRow, LabelRow } from './types.js';
import type { KlineRow } from '../types.js';
import { Store } from '../store/db.js';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';

const log = logger.child({ module: 'ml:build-dataset' });

function generateSyntheticKlines(symbol: string, interval: string, count: number): KlineRow[] {
  const klines: KlineRow[] = [];
  let price = symbol.startsWith('BTC') ? 60000 : symbol.startsWith('ETH') ? 3000 : 150;
  const now = Date.now();
  const stepMs = 3600000;

  for (let i = 0; i < count; i++) {
    const openTime = now - (count - i) * stepMs;
    const changePct = (Math.sin(i / 10) * 0.02) + ((Math.random() - 0.49) * 0.03);
    const open = price;
    const close = Math.max(0.01, open * (1 + changePct));
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    const volume = 1000 + Math.random() * 5000;
    price = close;

    klines.push({
      symbol,
      interval,
      open_time: openTime,
      open,
      high,
      low,
      close,
      volume,
      quote_volume: volume * close,
      taker_buy_vol: volume * 0.52,
      taker_buy_quote_vol: volume * close * 0.52,
    });
  }

  return klines;
}

export async function runBuildDataset(args: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs({
    args,
    options: {
      symbols: { type: 'string', default: 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT' },
      interval: { type: 'string', default: '1h' },
      limit: { type: 'string', default: '500' },
      horizon: { type: 'string', default: '5' },
      outDir: { type: 'string', default: 'data/ml' },
      mock: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (options.values.help) {
    console.log(`
Crypto Radar Production ML Dataset Exporter CLI

Usage:
  node dist/ml/build-dataset-cli.js [options]

Options:
  --symbols   Comma-separated list of symbols (default: "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT")
  --interval  Kline interval (default: "1h")
  --limit     Number of historical klines per symbol (default: 500)
  --horizon   Forward label horizon: 1, 5, 20, 60 (default: 5)
  --outDir    Output directory (default: "data/ml")
  --mock      Offline development mock data (default: false)
  --help      Show this help message
`);
    return;
  }

  const config = loadConfig();
  const store = Store.open(config.dataDir);

  const symbols = (options.values.symbols ?? 'BTCUSDT,ETHUSDT,SOLUSDT')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  const interval = options.values.interval ?? '1h';
  const limit = parseInt(options.values.limit ?? '500', 10);
  const horizon = parseInt(options.values.horizon ?? '5', 10) as 1 | 5 | 20 | 60;
  const outDir = path.resolve(process.cwd(), options.values.outDir ?? 'data/ml');
  const isMock = options.values.mock ?? false;

  fs.mkdirSync(outDir, { recursive: true });

  log.info(`Assembling production dataset for ${symbols.length} symbols (${interval}, ${limit} klines/symbol, horizon ${horizon})...`);

  const allFeatures: FeatureRow[] = [];
  const allLabels: LabelRow[] = [];

  for (const symbol of symbols) {
    try {
      let klines: KlineRow[] = [];

      if (isMock) {
        log.info(`Generating synthetic offline klines for ${symbol}...`);
        klines = generateSyntheticKlines(symbol, interval, limit);
      } else {
        // Step 1: Query local database store for historical kline records
        const storeKlines = await store.getKlines(symbol, interval, { limit, order: 'asc' });
        if (storeKlines.length >= 60) {
          log.info(`Loaded ${storeKlines.length} real historical klines for ${symbol} from database store`);
          klines = storeKlines.map(k => ({
            symbol,
            interval,
            open_time: k.open_time,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
            quote_volume: k.quote_volume,
            taker_buy_vol: k.taker_buy_vol,
            taker_buy_quote_vol: k.taker_buy_quote_vol,
          }));
        } else {
          // Step 2: Fall back to live Binance REST API query
          log.info(`Fetching live market klines for ${symbol} from Binance API...`);
          const bKlines = await fetchKlines(symbol, interval, limit);
          klines = bKlines.map(k => ({
            symbol,
            interval,
            open_time: k.openTime,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
            quote_volume: k.quoteVolume,
            taker_buy_vol: k.takerBuyVol,
            taker_buy_quote_vol: k.takerBuyQuoteVol,
          }));
        }
      }

      if (klines.length < 60) {
        log.warn(`Skipping ${symbol}: insufficiently many klines (${klines.length})`);
        continue;
      }

      const fRows = await buildFeatures(symbol, interval, klines);
      const closes = klines.map(k => k.close);
      const labels = computeLabels(closes, interval, { classHorizon: horizon }, klines);

      for (const f of fRows) {
        const lbl = labels.find(l => l.open_time === f.open_time);
        if (lbl && lbl.label_class !== null) {
          allFeatures.push(f);
          allLabels.push(lbl);
        }
      }

      log.info(`Generated ${fRows.length} feature rows for ${symbol}`);
    } catch (err) {
      log.error(`Failed to generate dataset rows for ${symbol}`, { error: String(err) });
    }
  }

  if (allFeatures.length === 0 || allLabels.length === 0) {
    throw new Error('No feature or label rows were generated. Ensure store contains historical data or network access to Binance is available.');
  }

  const prefix = path.join(outDir, 'dataset');
  const res = assembleDataset(allFeatures, allLabels, {
    labelHorizon: horizon,
    testSplit: 0.15,
    valSplit: 0.15,
    normalize: true,
    outputPathPrefix: prefix,
  });

  log.info(`Production dataset assembly complete!`, {
    rowCount: res.rowCount,
    featureCount: res.featureCount,
    outputPrefix: prefix,
  });

  console.log(`\nProduction dataset successfully exported to ${outDir}/`);
  console.log(`  Total Rows: ${res.rowCount}`);
  console.log(`  Train Set:  ${res.trainPath}`);
  console.log(`  Val Set:    ${res.valPath}`);
  console.log(`  Test Set:   ${res.testPath}`);
}

if (process.argv[1]?.endsWith('build-dataset-cli.js') || process.argv[1]?.endsWith('build-dataset-cli.ts')) {
  runBuildDataset().catch(err => {
    console.error('Fatal error during dataset export:', err);
    process.exit(1);
  });
}
