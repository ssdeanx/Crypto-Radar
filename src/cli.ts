// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — CLI Entry Point (Enterprise)
// ═══════════════════════════════════════════════════════════════════════

import { Command } from 'commander';
import { runRadar, displayRadar } from './radar.js';
import type { Chain, SortMode, OutputFormat, KlineInterval } from './types.js';
import { getTokenList } from './tokens.js';
import type { TokenDef } from './tokens.js';
import { getTopTokensByVolume } from './tokens.js';
import { fetchKlines } from './binance.js';
import { getBinancePair } from './tokens.js';
import { priceSparkline, multiMaSparkline, priceSvgChart, multiPanelSvgChart, candlestickSvgChart } from './io/charts.js';
import { HealthMonitor } from './monitor/health.js';
import { loadConfig, writeDefaultConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { StrategyEngine } from './analysis/engine.js';
import { runDaemon, isDaemonRunning, stopDaemon } from './daemon.js';
import { runBacktest, formatBacktest } from './backtest.js';
import type { BacktestOptions } from './backtest.js';
import { detectRegime, getRegimeWeights, formatRegime } from './analysis/regime.js';
import { computeCorrelationMatrix, computePCA, findTopCorrelations, formatCorrelationTable, computeCovMatrix } from './analysis/correlation.js';
import { computePortfolio } from './analysis/portfolio.js';
import { computeADX, computeBB, computeATR, computeVolVsAvg } from './indicators.js';
import { runBenchmark, formatBenchmark } from './core/benchmark.js';
import { exportCsvToSql } from './sqlite-export.js';
import type { ExportResult } from './sqlite-export.js';
import { runCollector } from './collector.js';
import type { CollectorReport } from './types.js';
import { generateHtmlReport, generateSignalSnapshot } from './pdf-export.js';
import { validateOutput, toJSONLine } from './output.js';
import { Store } from './store/db.js';
import { batchPredict, persistPredictions, resolveModelPath, resolveNormStatsPath } from './ml/predict.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileLock } from './core/file-lock.js';

// ── Constants ──

/** Default top-N count for auto-dynamic mode (no --filter, no --dynamic) */
const DEFAULT_TOP_N = 30;

/** Count used when --dynamic flag is passed without a value */
const DYNAMIC_FLAG_TOP_N = 50;

// ── Global error handlers ──
process.on('uncaughtException', (err) => {
  logger.fatal('Unhandled exception', { message: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal('Unhandled rejection', { reason: String(reason) });
  process.exit(1);
});

const program = new Command();

program
  .name('crypto-radar')
  .description('🛰️  Hermes Crypto Radar — Enterprise crypto market intelligence')
  .version('1.0.0');

// ── scan command (default) ──
program
  .command('scan')
  .alias('s')
  .description('Run a full radar scan (prices + technicals + news + strategy signals)')
  .option('-f, --filter <symbols...>', 'Filter to specific tokens by symbol')
  .option('--dynamic [count]', 'Explicit control for auto-dynamic top-N (default when no --filter: top 30 by volume; use --dynamic or --dynamic 50 to override count)')
  .option('-c, --chain <chain>', 'Filter to chain (solana, polygon, bnb, xrp, etc.)')
  .option('--sort <mode>', 'Sort: alpha|change|volume|momentum', 'momentum')
  .option('--format <fmt>', 'Output format: table|json|csv|md|xlsx', 'table')
  .option('-q, --quiet', 'Suppress display output (cron-friendly)')
  .option('--no-log', 'Skip data logging to CSV')
  .option('--no-tech', 'Skip technical indicator computation')
  .option('--no-news', 'Skip news fetching')
  .option('--onchain', 'Include DeFiLlama on-chain metrics (TVL, fees)')
  .option('--period <interval>', 'Kline interval: 15m|1h|4h|1d (default: all)')
  .action(async (opts) => {
    try {
      // ── Auto-dynamic mode by default ──
      // When no --filter is provided, scan fetches the top N tokens by 24h
      // Binance volume (default 30). --dynamic [N] overrides the count.
      let filter = opts.filter;
      if (!filter || filter.length === 0) {
        const count = typeof opts.dynamic === 'string'
          ? parseInt(opts.dynamic, 10)
          : opts.dynamic !== undefined
            ? DYNAMIC_FLAG_TOP_N
            : DEFAULT_TOP_N;
        try {
          const dynamicTokens = await getTopTokensByVolume(count);
          filter = dynamicTokens.map(t => t.sym);
          logger.info(`[auto-dynamic] Top ${dynamicTokens.length} tokens by volume`);
        } catch {
          logger.warn('[auto-dynamic] Failed to fetch top tokens, using default list');
        }
      }

      const result = await runRadar({
        filter,
        chain: opts.chain as Chain | undefined,
        sortBy: opts.sort as SortMode,
        format: opts.format as OutputFormat,
        quiet: opts.quiet ?? false,
        noLog: opts.noLog === false ? false : undefined,
        includeTech: opts.tech,
        includeNews: opts.news,
        includeOnchain: opts.onchain ?? false,
        period: opts.period as KlineInterval | undefined,
      });

      const output = await displayRadar(result, {
        format: opts.format as OutputFormat,
        quiet: opts.quiet ?? false,
      });

      if (output) logger.stdout(output);

      logger.info(`\n[done] ${result.run.runId} — ${result.run.numTokens} tokens in ${result.run.durationMs}ms`);
      logger.info(`       ${result.aggregatedSignals.length} strategy signals`);
      if (!opts.noLog) logger.info(`       Logged to data/ directory`);

      // Auto-save report formats — SNAPSHOT (latest scan only, overwritten each run).
      // The accumulating datasets are radar-runlog.jsonl / radar-tickers.jsonl /
      // crypto-radar-log.csv (see below), not these view files.
      const dataDir = loadConfig().dataDir;
      fs.mkdirSync(dataDir, { recursive: true });

      const formats: OutputFormat[] = ['table', 'csv', 'md', 'xlsx'];
      for (const fmt of formats) {
        if (fmt === 'table') {
          const tableContent = await displayRadar(result, { format: 'table' });
          if (tableContent) {
            fs.writeFileSync(path.join(dataDir, 'radar-output.txt'), tableContent + '\n', 'utf-8');
          }
        } else if (fmt === 'xlsx') {
          await displayRadar(result, { format: 'xlsx' });
        } else {
          const content = await displayRadar(result, { format: fmt });
          if (content) {
            fs.writeFileSync(path.join(dataDir, `radar-output.${fmt}`), content + '\n', 'utf-8');
          }
        }
      }

      // ── Run-history ledger (APPEND-ONLY JSONL) ──
      // Single file accumulates all runs. A single file per type is intentional
      // (the user requested: 1 current file + archive/ for rotated copies).
      const runLogLine = JSON.stringify({
        runId: result.run.runId,
        tsUtc: result.run.tsUtc,
        numTokens: result.run.numTokens,
        numSignals: result.run.numSignals,
        durationMs: result.run.durationMs,
        tickers: result.tickers.length,
        buySignals: result.aggregatedSignals.filter(s => /buy/i.test(s.direction ?? '')).length,
        sellSignals: result.aggregatedSignals.filter(s => /sell/i.test(s.direction ?? '')).length,
      });
      FileLock.withLock('radar-runlog', () => {
        fs.appendFileSync(
          path.join(dataDir, 'radar-runlog.jsonl'),
          runLogLine + '\n', 'utf-8',
        );
      });

      // ── Ticker dataset (APPEND-ONLY JSONL, ML-ready) ──
      // One EnrichedTicker per line. Single file accumulates all runs.
      // Schema consistent: optional fields are `null`, not missing.
      const tickersPath = path.join(dataDir, 'radar-tickers.jsonl');
      let tickerBatch = '';
      for (const ticker of result.tickers) {
        tickerBatch += toJSONLine(ticker) + '\n';
      }
      FileLock.withLock('radar-tickers', () => {
        fs.appendFileSync(tickersPath, tickerBatch, 'utf-8');
      });
      logger.info(`       ${result.tickers.length} tickers appended to ticker dataset`);
    } catch (err) {
      logger.error('[ERROR] Radar scan failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── chart command ──
program
  .command('chart')
  .alias('c')
  .description('Generate price charts for a token')
  .argument('<symbol>', 'Token symbol (e.g. SOL, BTC, ETH)')
  .option('--type <type>', 'Chart type: sparkline|ma|svg|dashboard|candlestick|watermark', 'sparkline')
  .option('--period <p>', 'Kline interval: 15m|1h|4h|1d', '1h')
  .option('--lookback <n>', 'Number of candles', '100')
  .option('--width <px>', 'SVG width (svg/dashboard only)', '600')
  .action(async (symbol, opts) => {
    try {
      const sym = symbol.toUpperCase();
      const tokens = getTokenList();
      const token = tokens.find(t => t.sym === sym);
      if (!token) { logger.error(`Unknown token: ${sym}`); process.exit(1); }

      const pair = getBinancePair(token);
      const klines = await fetchKlines(pair, opts.period, parseInt(opts.lookback, 10));
      if (klines.length === 0) { logger.error(`No data for ${pair}`); process.exit(1); }

      switch (opts.type) {
        case 'sparkline':
          logger.stdout(`\n${sym} Price (${opts.period}, last ${klines.length} candles):\n`);
          logger.stdout(priceSparkline(klines, { height: 12 }));
          logger.stdout(`\nLatest: $${klines[klines.length - 1]!.close.toFixed(2)}`);
          logger.stdout(`High: $${Math.max(...klines.map(k => k.high)).toFixed(2)}`);
          logger.stdout(`Low: $${Math.min(...klines.map(k => k.low)).toFixed(2)}`);
          break;

        case 'ma':
          logger.stdout(`\n${sym} Price + EMA20/EMA50 (${opts.period}):\n`);
          logger.stdout(multiMaSparkline(klines, { height: 12 }));
          break;

        case 'svg':
          logger.stdout(priceSvgChart(`${sym} Price (${opts.period})`, klines, parseInt(opts.width, 10)));
          break;

        case 'dashboard':
          logger.stdout(multiPanelSvgChart(`${sym} Price + RSI`, klines, klines.map(() => null), parseInt(opts.width, 10), 400));
          break;

        case 'candlestick':
          logger.stdout(candlestickSvgChart(`${sym} Candlestick (${opts.period})`, klines, parseInt(opts.width, 10), Math.round(parseInt(opts.width, 10) * 0.6)));
          break;

        case 'watermark':
          // Watermark is embedded in all SVG charts; render a branded SVG as demo
          logger.stdout(priceSvgChart(`${sym} Watermark Demo (${opts.period})`, klines, parseInt(opts.width, 10)));
          break;
      }
    } catch (err) {
      logger.error('[ERROR] Chart generation failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── strategies command ──
program
  .command('strategies')
  .alias('strat')
  .description('List available signal strategies and their weights')
  .action(() => {
    const engine = new StrategyEngine();
    const strategies = engine.getStrategyInfo();
    logger.stdout('\n📊 Signal Strategies:\n');
    logger.stdout(JSON.stringify(strategies.strategies.map(s => ({
      Name: s.name,
      Description: s.description,
      Timeframe: s.timeframe,
      Weight: `${(s.weight * 100).toFixed(0)}%`,
    })), null, 2));
  });

// ── tokens command ──
program
  .command('tokens')
  .description('List all tracked tokens')
  .option('-c, --chain <chain>', 'Filter by chain')
  .action((opts) => {
    const tokens = getTokenList()
      .filter(t => !opts.chain || t.chain === opts.chain || t.chains?.includes(opts.chain));
    logger.stdout(JSON.stringify(tokens.map(t => ({ Symbol: t.sym, Name: t.name, Chain: t.chain })), null, 2));
  });

// ── search command ──
program
  .command('search')
  .alias('find')
  .description('Search for tokens by symbol, name, or address (fuzzy matching)')
  .argument('<query>', 'Search query (symbol, name, or partial/fuzzy match)')
  .option('--json', 'Output as JSON with match scores')
  .option('--limit <n>', 'Max results', '20')
  .action((query, opts) => {
    const q = query.toLowerCase();
    const tokens = getTokenList();

    // Score each token by relevance (fuzzy matching)
    interface ScoredHit { token: TokenDef; score: number; matchField: string; }
    const scored: ScoredHit[] = [];

    for (const token of tokens) {
      const sym = token.sym.toLowerCase();
      const name = token.name.toLowerCase();
      const id = token.id.toLowerCase();
      const chain = token.chain.toLowerCase();

      let bestScore = 0;
      let matchField = '';

      // Exact symbol match → highest priority
      if (sym === q) { bestScore = 100; matchField = 'symbol'; }
      else if (name === q) { bestScore = 95; matchField = 'name'; }
      else if (id === q) { bestScore = 90; matchField = 'id'; }
      // Prefix match
      else if (sym.startsWith(q)) { bestScore = 80; matchField = 'symbol'; }
      else if (name.startsWith(q)) { bestScore = 75; matchField = 'name'; }
      // Substring match
      else if (sym.includes(q)) { bestScore = 60; matchField = 'symbol'; }
      else if (name.includes(q)) { bestScore = 55; matchField = 'name'; }
      else if (id.includes(q)) { bestScore = 50; matchField = 'id'; }
      else if (chain.includes(q)) { bestScore = 40; matchField = 'chain'; }
      // Fuzzy: character overlap (for typos)
      else {
        const overlap = countOverlap(sym, q);
        if (overlap >= q.length * 0.6) { bestScore = Math.round(overlap / q.length * 35); matchField = 'symbol'; }
        else {
          const nameOverlap = countOverlap(name, q);
          if (nameOverlap >= q.length * 0.6) { bestScore = Math.round(nameOverlap / q.length * 30); matchField = 'name'; }
        }
      }

      if (bestScore > 0) {
        scored.push({ token, score: bestScore, matchField });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Apply limit
    const limit = parseInt(opts.limit, 10) || 20;
    const limited = scored.slice(0, limit);

    if (opts.json) {
      logger.stdout(JSON.stringify(limited.map(h => ({
        symbol: h.token.sym,
        name: h.token.name,
        chain: h.token.chain,
        id: h.token.id,
        score: h.score,
        matchField: h.matchField,
        coingeckoId: h.token.coingeckoId,
        ...(h.token.chains ? { chains: h.token.chains } : {}),
      })), null, 2));
    } else {
      if (limited.length === 0) {
        logger.error(`No tokens matching "${query}"`);
        return;
      }
      logger.stdout(JSON.stringify(limited.map(h => ({
        Symbol: h.token.sym,
        Name: h.token.name,
        Chain: h.token.chain,
        ID: h.token.id,
        Match: `${h.matchField} (${h.score}%)`,
      })), null, 2));
      logger.error(`\n${limited.length} result(s) for "${query}"`);
    }
  });

function countOverlap(a: string, b: string): number {
  let score = 0;
  for (const ch of b) {
    if (a.includes(ch)) score++;
  }
  return score;
}

// ── signals command ──
program
  .command('signals')
  .description('Generate composite signals from latest data')
  .option('-f, --filter <symbols...>', 'Filter to specific tokens')
  .option('--format <fmt>', 'Output format: table|json|md|xlsx', 'table')
  .action(async (opts) => {
    try {
      const result = await runRadar({
        filter: opts.filter,
        format: opts.format as OutputFormat,
        sortBy: 'signal',
      });
      const output = await displayRadar(result, { format: opts.format as OutputFormat });
      if (output) logger.stdout(output);
    } catch (err) {
      logger.error('[ERROR] Signal generation failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── news command ──
program
  .command('news')
  .description('Fetch and display crypto news matching tracked tokens')
  .option('-f, --filter <symbols...>', 'Filter to specific tokens')
  .option('--format <fmt>', 'Output format: table|json|md|xlsx', 'table')
  .action(async (opts) => {
    try {
      const result = await runRadar({
        filter: opts.filter,
        format: opts.format as OutputFormat,
        includeTech: false,
      });
      const output = await displayRadar(result, { format: opts.format as OutputFormat });
      if (output) logger.stdout(output);
    } catch (err) {
      logger.error('[ERROR] News fetch failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── health command ──
program
  .command('health')
  .description('Run system health checks')
  .action(async () => {
    const monitor = new HealthMonitor();
    const status = await monitor.check();
    logger.stdout(`\n🛰️  Crypto Radar — Health Check\n`);
    logger.stdout(`Status: ${status.status === 'healthy' ? '✅' : status.status === 'degraded' ? '⚠️' : '❌'} ${status.status.toUpperCase()}`);
    logger.stdout(`Uptime: ${Math.floor(status.uptime / 60)}m ${status.uptime % 60}s`);
    logger.stdout('');

    // Primary checks table
    for (const check of status.checks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
      const name = check.name.padEnd(16);
      logger.stdout(`  ${icon} ${name} (${check.latencyMs}ms)  ${check.message}`);
    }

    // Cache stats summary (from HealthStatus extended fields)
    if (status.cacheStats) {
      const { entries, hitRate, memoryEstimate } = status.cacheStats;
      logger.stdout(`       cache stats: ${entries} entries, ${hitRate}% hit rate, ~${(memoryEstimate / 1024).toFixed(0)}KB est.`);
    }

    // Feed health detail lines
    if (status.feedHealth && status.feedHealth.feeds.length > 0) {
      for (const feed of status.feedHealth.feeds) {
        const icon = feed.status === 'healthy' ? '✅' : feed.status === 'degraded' ? '⚠️' : '❌';
        logger.stdout(`  ${icon} feed: ${feed.name} — ${feed.status} (${feed.consecutiveFailures} failures)`);
      }
    }

    logger.stdout('');
    logger.stdout('Details: ' + JSON.stringify(status.details, null, 2));
  });

// ── configure command ──
program
  .command('configure')
  .alias('config')
  .description('Show or generate configuration')
  .option('--generate', 'Generate default config file at radar.config.json')
  .option('--show', 'Show current resolved configuration')
  .action((opts) => {
    if (opts.generate) {
      writeDefaultConfig('radar.config.json');
      logger.stdout('Generated radar.config.json with defaults. Edit then restart.');
    }
    if (opts.show) {
      const config = loadConfig();
      logger.stdout(JSON.stringify(config, null, 2));
    }
    if (!opts.generate && !opts.show) {
      logger.stdout('Usage: crypto-radar configure --show | --generate');
    }
  });

// ── export-sqlite command ──
program
  .command('export-sqlite')
  .alias('export-db')
  .description('Export radar CSV logs as SQLite-compatible SQL for long-term aggregation')
  .option('-o, --output <path>', 'Output SQL file path (default: stdout)')
  .option('--stdout', 'Force output to stdout (default when no -o given)')
  .option('--validate-only', 'Only validate CSV data, do not generate SQL')
  .action((opts) => {
    const result: ExportResult = exportCsvToSql({
      outputPath: opts.output,
      toStdout: opts.stdout ?? !opts.output,
      validateOnly: opts.validateOnly ?? false,
    });
    if (!opts.validateOnly) {
      logger.info(`[export-sqlite] Exported ${result.tickerRows} ticker rows, ${result.newsRows} news rows`);
      if (result.sqlFile) logger.info(`[export-sqlite] Wrote ${result.sqlFile}`);
    } else {
      logger.warn(`[export-sqlite] Validation: ${result.validationErrors} errors in ${result.validationTotal} rows`);
    }
  });

// ── regime command ──
program
  .command('regime')
  .alias('r')
  .description('Detect current market regime for a token')
  .argument('<symbol>', 'Token symbol (e.g. SOL, BTC, ETH)')
  .option('--period <p>', 'Kline interval: 15m|1h|4h|1d', '1h')
  .option('--lookback <n>', 'Number of candles', '200')
  .option('--weights', 'Show regime-adapted strategy weights', false)
  .action(async (symbol, opts) => {
    try {
      const sym = symbol.toUpperCase();
      const tokens = getTokenList();
      const token = tokens.find(t => t.sym === sym);
      if (!token) { logger.error(`Unknown token: ${sym}`); process.exit(1); }

      const pair = getBinancePair(token);
      const period = opts.period as string;
      const lookback = parseInt(opts.lookback, 10) || 200;

      logger.info(`Fetching ${lookback} ${period} candles for ${pair}...`);
      const klines = await fetchKlines(pair, period, lookback);
      if (klines.length < 30) { logger.error(`Insufficient data for ${pair} (need ≥30 candles, got ${klines.length})`); process.exit(1); }

      const closes = klines.map(k => k.close);
      const highs = klines.map(k => k.high);
      const lows = klines.map(k => k.low);
      const volumes = klines.map(k => k.volume);

      // Compute indicators needed for regime detection
      const adx = computeADX(highs, lows, closes, 14);
      const bb = computeBB(closes, 20);
      const atrPct = computeATR(highs, lows, closes, 14);
      const volVsAvg = computeVolVsAvg(volumes);

      const bbWidth = bb?.width ?? null;

      // Volume ratio (raw: current / avg)
      let volRatio: number | null = null;
      if (volVsAvg != null) {
        volRatio = 1 + volVsAvg; // volVsAvg is (current/avg) - 1
      }

      const result = detectRegime({ adx, bbWidth, atrPct, volRatio, closes });
      logger.stdout(formatRegime(result));

      // Show regime-adapted weights if requested
      if (opts.weights) {
        const weights = getRegimeWeights(result.regime);
        logger.stdout('📊 Regime-Adapted Strategy Weights:');
        logger.stdout(`    Momentum:       ${(weights.momentum * 100).toFixed(0)}%`);
        logger.stdout(`    Mean-Reversion: ${(weights.meanReversion * 100).toFixed(0)}%`);
        logger.stdout(`    Trend-Following: ${(weights.trendFollowing * 100).toFixed(0)}%`);
        logger.stdout(`    Position Size:  ${(weights.positionSize * 100).toFixed(0)}%`);
        logger.stdout('');
      }
    } catch (err) {
      logger.error('[ERROR] Regime detection failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── correlation command ──
program
  .command('correlation')
  .alias('corr')
  .description('Compute cross-token correlation matrix from price movements')
  .option('--symbols <syms...>', 'Specific symbols to correlate (default: top 10 by volume)')
  .option('--count <n>', 'Number of tokens to fetch when auto-detecting', '10')
  .option('--period <p>', 'Kline interval: 15m|1h|4h|1d', '1h')
  .option('--lookback <n>', 'Number of candles', '100')
  .option('--top <n>', 'Show top N correlations for each symbol', '3')
  .option('--json', 'Output as JSON', false)
  .action(async (opts) => {
    try {
      // Resolve symbol list
      let symbols: string[];
      if (opts.symbols && opts.symbols.length > 0) {
        symbols = opts.symbols.map((s: string) => s.toUpperCase());
      } else {
        const count = parseInt(opts.count, 10) || 10;
        const topTokens = await getTopTokensByVolume(Math.min(count, 20));
        symbols = topTokens.map(t => t.sym);
        logger.info(`[auto] Top ${symbols.length} tokens by volume selected`);
      }

      // Validate tokens exist
      const tokens = getTokenList();
      const validTokens = tokens.filter(t => symbols.includes(t.sym));
      if (validTokens.length < 2) {
        logger.error(`Need at least 2 valid tokens. Found ${validTokens.length}.`);
        process.exit(1);
      }

      const period = opts.period as string;
      const lookback = parseInt(opts.lookback, 10) || 100;

      // Fetch klines for each token in parallel
      logger.info(`Fetching ${lookback} ${period} candles for ${validTokens.length} tokens...`);
      const priceMap = new Map<string, number[]>();

      const fetchResults = await Promise.allSettled(
        validTokens.map(async (token) => {
          const pair = getBinancePair(token);
          const klines = await fetchKlines(pair, period, lookback);
          if (klines.length >= 20) {
            priceMap.set(token.sym, klines.map(k => k.close));
          }
        }),
      );

      const failed = fetchResults.filter(r => r.status === 'rejected').length;
      if (failed > 0) logger.warn(`[warn] ${failed} token(s) failed to fetch`);

      if (priceMap.size < 2) {
        logger.error('Insufficient data: need at least 2 tokens with valid klines.');
        process.exit(1);
      }

      logger.info(`Computing correlation matrix for ${priceMap.size} tokens...`);

      const matrix = computeCorrelationMatrix(priceMap);

      if (opts.json) {
        logger.stdout(JSON.stringify(matrix, null, 2));
      } else {
        logger.stdout(formatCorrelationTable(matrix));

        // Show top correlations per symbol
        const topN = parseInt(opts.top, 10) || 3;
        logger.stdout(`\n📈 Top ${topN} Correlations per Token:\n`);

        for (const sym of matrix.symbols) {
          const top = findTopCorrelations(sym, matrix, topN);
          const pairs = top.map(p =>
            `${p.symbolB}: ${p.correlation > 0 ? '+' : ''}${p.correlation.toFixed(3)}`
          ).join(', ');
          logger.stdout(`  ${sym.padEnd(6)} → ${pairs}`);
        }
        logger.stdout('');

        // PCA — Market Breadth
        if (matrix.symbols.length >= 2) {
          const pca = computePCA(matrix.matrix);
          const firstRatio = pca.explainedVariance[0]!;
          let breadthLabel: string;
          if (firstRatio > 0.6) {
            breadthLabel = 'Single-factor market (high correlation breadth)';
          } else if (firstRatio < 0.3) {
            breadthLabel = 'Multi-factor market (low correlation breadth)';
          } else {
            breadthLabel = 'Moderate market breadth';
          }
          logger.stdout('');
          logger.stdout('── PCA — Market Breadth ──');
          logger.stdout(`  PC1 explains ${(firstRatio * 100).toFixed(1)}% of variance → ${breadthLabel}`);
          logger.stdout('');
          logger.stdout('  Top 3 Components:');
          const count = Math.min(3, pca.eigenvalues.length);
          for (let i = 0; i < count; i++) {
            logger.stdout(
              `    PC${i + 1}: λ=${pca.eigenvalues[i]!.toFixed(3)}  ` +
              `(${(pca.explainedVariance[i]! * 100).toFixed(1)}% variance)`
            );
          }
          logger.stdout('');
        }
      }
    } catch (err) {
      logger.error('[ERROR] Correlation analysis failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── portfolio command ──
program
  .command('portfolio')
  .alias('port')
  .description('Markowitz mean-variance portfolio optimization')
  .option('--symbols <syms...>', 'Specific symbols to include (default: top 10 by volume)')
  .option('--count <n>', 'Number of tokens when auto-detecting', '10')
  .option('--period <p>', 'Kline interval: 15m|1h|4h|1d', '1h')
  .option('--lookback <n>', 'Number of candles', '100')
  .option('--rfrate <pct>', 'Annual risk-free rate in percent', '5')
  .option('--json', 'Output as JSON', false)
  .action(async (opts) => {
    try {
      let symbols: string[];
      if (opts.symbols && opts.symbols.length > 0) {
        symbols = opts.symbols.map((s: string) => s.toUpperCase());
      } else {
        const count = parseInt(opts.count, 10) || 10;
        const topTokens = await getTopTokensByVolume(Math.min(count, 20));
        symbols = topTokens.map(t => t.sym);
        logger.info(`[auto] Top ${symbols.length} tokens by volume selected`);
      }

      const tokens = getTokenList();
      const validTokens = tokens.filter(t => symbols.includes(t.sym));
      if (validTokens.length < 2) {
        logger.error(`Need at least 2 valid tokens. Found ${validTokens.length}.`);
        process.exit(1);
      }

      const period = opts.period as string;
      const lookback = parseInt(opts.lookback, 10) || 100;
      const riskFreeRate = (parseFloat(opts.rfrate) || 5) / 100;

      logger.info(`Fetching ${lookback} ${period} candles for ${validTokens.length} tokens...`);
      const priceMap = new Map<string, number[]>();

      const fetchResults = await Promise.allSettled(
        validTokens.map(async (token) => {
          const pair = getBinancePair(token);
          const klines = await fetchKlines(pair, period, lookback);
          if (klines.length >= 20) {
            priceMap.set(token.sym, klines.map(k => k.close));
          }
        }),
      );

      const failed = fetchResults.filter(r => r.status === 'rejected').length;
      if (failed > 0) logger.warn(`[warn] ${failed} token(s) failed to fetch`);

      if (priceMap.size < 2) {
        logger.error('Insufficient data: need at least 2 tokens with valid klines.');
        process.exit(1);
      }

      logger.info(`Computing covariance matrix for ${priceMap.size} tokens...`);

      const covResult = computeCovMatrix(priceMap);

      // Compute expected returns: mean daily return × 365
      const symList = Array.from(priceMap.keys());
      const expectedReturns: number[] = [];

      for (const sym of symList) {
        const prices = priceMap.get(sym)!;
        const dailyReturns: number[] = [];
        for (let i = 1; i < prices.length; i++) {
          if (prices[i - 1] !== 0) {
            dailyReturns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
          }
        }
        const meanRet = dailyReturns.length > 0
          ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
          : 0;
        expectedReturns.push(meanRet * 365);
      }

      logger.info('Running portfolio optimization...');
      const result = computePortfolio(
        covResult.matrix,
        expectedReturns,
        riskFreeRate,
        covResult.symbols,
      );

      if (!result) {
        logger.error('Portfolio optimization returned null (need ≥ 2 assets).');
        process.exit(1);
      }

      if (opts.json) {
        logger.stdout(JSON.stringify(result, null, 2));
        return;
      }

      const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
      const fmtRatio = (v: number) => v.toFixed(3);

      logger.stdout('');
      logger.stdout('═══ Markowitz Portfolio Optimization ═══');
      logger.stdout('');
      logger.stdout(`Risk-free rate: ${fmtPct(riskFreeRate)}`);
      logger.stdout(`Grid step:     ${covResult.symbols.length <= 5 ? '0.05' : '0.10'}`);
      logger.stdout(`Frontier pts:  ${result.frontierPoints}`);
      logger.stdout('');

      // Max Sharpe
      logger.stdout('─ Maximum Sharpe Portfolio ─');
      logger.stdout(`  Return:       ${fmtPct(result.maxSharpeReturn)}`);
      logger.stdout(`  Volatility:   ${fmtPct(result.maxSharpeVol)}`);
      logger.stdout(`  Sharpe ratio: ${fmtRatio(result.maxSharpeRatio)}`);
      logger.stdout('  Weights:');
      for (let i = 0; i < result.symbols.length; i++) {
        if (result.maxSharpeWeights[i]! > 0.005) {
          logger.stdout(`    ${result.symbols[i]!.padEnd(6)} ${fmtPct(result.maxSharpeWeights[i]!)}`);
        }
      }
      logger.stdout('');

      // Min Variance
      logger.stdout('─ Minimum Variance Portfolio ─');
      logger.stdout(`  Return:       ${fmtPct(result.minVarReturn)}`);
      logger.stdout(`  Volatility:   ${fmtPct(result.minVarVol)}`);
      logger.stdout(`  Sharpe ratio: ${fmtRatio(result.minVarRatio)}`);
      logger.stdout('  Weights:');
      for (let i = 0; i < result.symbols.length; i++) {
        if (result.minVarWeights[i]! > 0.005) {
          logger.stdout(`    ${result.symbols[i]!.padEnd(6)} ${fmtPct(result.minVarWeights[i]!)}`);
        }
      }
      logger.stdout('');

    } catch (err) {
      logger.error('[ERROR] Portfolio optimization failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── report command ──
program
  .command('report')
  .description('Generate HTML report and save to file (open in browser → Print → PDF)')
  .option('-o, --output <path>', 'Output HTML file path')
  .option('-s, --snapshot', 'Generate compact signal snapshot instead of full report')
  .action(async (opts) => {
    try {
      logger.info('Running radar scan for report...');
      const result = await runRadar({
        includeTech: true,
        includeNews: true,
        includeOnchain: true,
        noLog: true,
      });

      const tickers = result.tickers;
      const signals = result.aggregatedSignals;
      const onchain = (result as Record<string, unknown>).onchainMetrics as import('./onchain.js').OnChainMetrics | null ?? null;

      let html: string;
      if (opts.snapshot) {
        html = generateSignalSnapshot(signals);
        logger.info(`Generating signal snapshot (${signals.length} signals)...`);
      } else {
        html = generateHtmlReport({
          title: 'Crypto Radar Report',
          date: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
          tickers,
          aggregatedSignals: signals,
          onchain,
          includeCharts: true,
        });
        logger.info(`Generating full report (${tickers.length} tokens, ${signals.length} signals)...`);
      }

      const outputPath = opts.output ?? path.join(loadConfig().dataDir, 'crypto-radar-report.html');
      await import('fs').then(fs => fs.promises.writeFile(outputPath, html, 'utf-8'));
      logger.info(`✅ Report written to ${outputPath}`);
      logger.info(`   Open in browser → File → Print → Save as PDF (enable background graphics)`);
    } catch (err) {
      logger.error('[ERROR] Report generation failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── validate command ──
program
  .command('validate')
  .description('Validate existing radar CSV data against expected schema')
  .option('-f, --file <path>', 'Path to CSV data file')
  .option('--json', 'Output errors as JSON')
  .action(async (opts) => {
    try {
      const fs = await import('fs');
      const pathMod = await import('path');
      const csvFile = opts.file ?? path.join(loadConfig().dataDir, 'radar-output.csv');
      const csvPath = pathMod.resolve(csvFile);

      // Security: prevent path traversal — restrict to project directories
      const projectRoot = pathMod.resolve('.');
      const allowedPrefixes = [
        projectRoot,
        pathMod.resolve('data'),
        pathMod.resolve('dist'),
      ];
      const isAllowed = allowedPrefixes.some(prefix =>
        csvPath.startsWith(prefix + pathMod.sep) || csvPath === prefix,
      );
      if (!isAllowed) {
        logger.error(`❌ Security: file path is not in allowed directories`);
        process.exit(1);
      }

      if (!fs.existsSync(csvPath)) {
        logger.error(`❌ File not found: ${csvPath}`);
        process.exit(1);
      }
      logger.info(`Validating ${csvPath}...`);

      const csvContent = fs.readFileSync(csvPath, 'utf-8');
      const lines = csvContent.trim().split('\n');
      if (lines.length < 2) {
        logger.error('❌ CSV file has no data rows');
        process.exit(1);
      }

      const header = lines[0]!;
      // Parse CSV into partial EnrichedTicker objects
      const headers = header.split(',');
      const tickers: import('./types.js').EnrichedTicker[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i]!.split(',');
        const row: Record<string, unknown> = {};
        for (let j = 0; j < headers.length; j++) {
          row[headers[j]!] = values[j];
        }
        // Parse numeric fields
        const t: Partial<import('./types.js').EnrichedTicker> = {
          runId: String(row.run_id ?? ''),
          tsUtc: String(row.ts_utc ?? ''),
          dateEt: String(row.date_et ?? ''),
          symbol: String(row.symbol ?? ''),
          chain: String(row.chain ?? '') as import('./types.js').Chain,
          tokenId: String(row.tokenId ?? ''),
          tokenName: String(row.tokenName ?? ''),
          lastPrice: parseFloat(String(row.lastPrice ?? '')),
          priceChangePercent: parseFloat(String(row.priceChangePercent ?? '')),
          volume: parseFloat(String(row.volume ?? '')),
          quoteVolume: parseFloat(String(row.quoteVolume ?? '')),
          spreadPct: parseFloat(String(row.spreadPct ?? '')),
          momentum: parseFloat(String(row.momentum ?? '')),
        };
        tickers.push(t as import('./types.js').EnrichedTicker);
      }

      const errors = validateOutput(tickers);

      if (errors.length === 0) {
        logger.stdout(`✅ Validation passed — ${tickers.length} rows checked, 0 errors`);
      } else {
        if (opts.json) {
          logger.stdout(JSON.stringify(errors, null, 2));
        } else {
          logger.stdout(`❌ Validation found ${errors.length} error(s):\n`);
          for (const err of errors) {
            logger.stdout(`  ${err.field}: ${err.message} (got: ${JSON.stringify(err.value)})`);
          }
        }
        process.exit(1);
      }
    } catch (err) {
      logger.error('[ERROR] Validation failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── collect command ──
program
  .command('collect')
  .description('Run historical collector (klines + futures)')
  .option('--klines', 'Collect klines', true)
  .option('--futures', 'Collect futures data', true)
  .option('--backfill <days>', 'Override backfill days')
  .option('--symbol <syms...>', 'Filter to specific symbols')
  .option('--orderbook', 'Include orderbook snapshots')
  .option('--fear-greed', 'Include Fear & Greed index')
  .option('--cross-asset', 'Include cross-asset data')
  .action(async (opts) => {
    try {
      // Resolve user-supplied symbols to Binance pairs (SOL → SOLUSDT)
      const symbols = opts.symbol
        ? opts.symbol.map((s: string) => {
            const token = getTokenList().find((t: TokenDef) => t.sym === s.toUpperCase() || t.id === s.toLowerCase());
            return token ? getBinancePair(token) : s.toUpperCase();
          })
        : undefined;

      const report: CollectorReport = await runCollector({
        klines: opts.klines,
        futures: opts.futures,
        backfillDays: opts.backfill ? parseInt(opts.backfill, 10) : undefined,
        symbols,
        orderbook: opts.orderbook ?? false,
        fearGreed: opts.fearGreed ?? false,
        crossAsset: opts.crossAsset ?? false,
      });

      const parts: string[] = [];
      if (report.klinesInserted > 0) parts.push(`${report.klinesInserted} klines`);
      if (report.fundingInserted > 0) parts.push(`${report.fundingInserted} funding`);
      if (report.oiInserted > 0) parts.push(`${report.oiInserted} OI`);
      if (report.lsInserted > 0) parts.push(`${report.lsInserted} L/S`);
      if (report.liquidationsInserted > 0) parts.push(`${report.liquidationsInserted} liquidations`);
      if (report.fearGreedInserted > 0) parts.push(`${report.fearGreedInserted} fear/greed`);
      if (report.orderBookInserted > 0) parts.push(`${report.orderBookInserted} orderbook`);
      if (report.crossAssetInserted > 0) parts.push(`${report.crossAssetInserted} cross-asset`);

      if (parts.length > 0) {
        logger.stdout(`[collect] Inserted ${parts.join(', ')} in ${report.durationMs}ms`);
      } else {
        logger.stdout(`[collect] No data inserted (${report.durationMs}ms)`);
      }

      if (report.errors.length > 0) {
        for (const err of report.errors) {
          logger.error(`[collect] Error: ${err}`);
        }
      }

      if (report.errors.length > 0 && parts.length === 0) {
        process.exit(1);
      }
    } catch (err) {
      logger.error('[ERROR] Collector failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── daemon command ──
program
  .command('daemon')
  .description('Start/stop/status warm daemon for sub-50ms tool calls')
  .option('--port <port>', 'HTTP port for health endpoint', String(9877))
  .option('--refresh <sec>', 'Cache refresh interval in seconds', String(300))
  .option('--status', 'Check if daemon is running')
  .option('--stop', 'Stop running daemon')
  .action(async (opts) => {
    if (opts.status) {
      const running = isDaemonRunning();
      logger.stdout(`Daemon: ${running ? '✅ RUNNING' : '⏹️  STOPPED'}`);
      process.exit(running ? 0 : 1);
    }
    if (opts.stop) {
      const stopped = stopDaemon();
      logger.stdout(stopped ? '⏹️  Daemon stopped' : '❌ No running daemon found');
      process.exit(stopped ? 0 : 1);
    }
    // Start foreground
    if (opts.port) process.env.RADAR__DAEMON_PORT = opts.port;
    if (opts.refresh) process.env.RADAR__REFRESH_SEC = opts.refresh;
    await runDaemon();
  });

// ── backtest command ──
program
  .command('backtest')
  .description('Run signal backtest against historical kline data')
  .option('-s, --symbol <symbol>', 'Filter to specific token')
  .option('--horizon <n>', 'Candles ahead to check', '1')
  .option('--confidence <n>', 'Minimum confidence threshold (0-1)', '0')
  .action(async (opts) => {
    try {
      logger.info('Running radar scan for backtest data...');
      const result = await runRadar({ includeTech: true, includeNews: false, noLog: true });

      const filterSymbol = opts.symbol ? opts.symbol.toUpperCase() : null;
      const signals = filterSymbol
        ? result.aggregatedSignals.filter(s => s.symbol === filterSymbol)
        : result.aggregatedSignals;

      if (signals.length === 0) {
        logger.error('No signals to backtest. Try running without --symbol filter.');
        process.exit(1);
      }

      // Build klines map: fetch extended klines for each symbol with a signal
      const klinesBySymbol = new Map<string, import('./types.js').Kline[]>();
      const symbols = [...new Set(signals.map(s => s.symbol))];
      const tokens = getTokenList();

      logger.info(`Building kline maps for ${symbols.length} symbols...`);

      for (const sym of symbols) {
        const token = tokens.find(t => t.sym === sym);
        if (!token) continue;
        try {
          const pair = getBinancePair(token);
          // Fetch extra klines so we can look ahead from the signal position
          // Signal uses last 200 candles; fetch 400 to have room
          const klines = await fetchKlines(pair, '1h', 400);
          if (klines.length > 10) {
            klinesBySymbol.set(sym, klines);
          }
        } catch {
          // skip symbol if klines fail
        }
      }

      const backtestOptions: BacktestOptions = {
        horizon: parseInt(opts.horizon, 10) || 1,
        minConfidence: parseFloat(opts.confidence) || 0,
      };

      const btResult = runBacktest(signals, klinesBySymbol, backtestOptions);
      logger.stdout(formatBacktest(btResult));

      // Store for programmatic use
      (globalThis as Record<string, unknown>).__lastBacktestResult = btResult;
    } catch (err) {
      logger.error('[ERROR] Backtest failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── ml command ──
program
  .command('ml')
  .description('ML pipeline: train, predict, status, or drift')
  .argument('<action>', 'train | predict | status | drift')
  .option('--symbols <syms...>', 'Filter to specific symbols')
  .option('--horizon <n>', 'Label horizon (1/5/20/60)', '5')
  .option('--lookback <days>', 'Training lookback days', '90')
  .option('--interval <i>', 'Kline interval for prediction', '1h')
  .option('--model <m>', 'Drift detector model (ADWIN/PageHinkley/KSWIN)', 'ADWIN')
  .option('--delta <n>', 'Drift detector significance delta', '0.002')
  .option('--records <n>', 'Max records for drift detection', '500')
  .action(async (action, opts) => {
    try {
      const config = loadConfig();
      const store = Store.open(config.dataDir);
      store.migrate();

      if (action === 'status') {
        const stats = await store.stats();
        const predictions = await store.getPredictions({ limit: 5 });
        const modelsDir = 'ml/models';
        const hasModelDir = fs.existsSync(modelsDir);
        const manifestPath = path.resolve(modelsDir, 'MANIFEST.json');
        const hasManifest = hasModelDir && fs.existsSync(manifestPath);

        let activeModel = 'none';
        if (hasManifest) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            activeModel = manifest.active_model ?? 'unknown';
          } catch { activeModel = '(parse error)'; }
        }

        logger.stdout('📊 ML Pipeline Status\n');
        logger.stdout(`  Enabled:       ${config.ml?.enabled ? '✅' : '❌'} (set RADAR__ML_ENABLED=true)`);
        logger.stdout(`  Active model:  ${activeModel}`);
        logger.stdout(`  Store rows:    ${stats.tickers ?? 0} tickers, ${stats.klines ?? 0} klines`);
        logger.stdout(`  Predictions:   ${stats.predictions ?? 0} total`);
        logger.stdout(`  Models dir:    ${hasModelDir ? '✅ exists' : '❌ not found'}`);
        if (predictions.length > 0) {
          logger.stdout(`  Latest pred:   ${predictions[0]?.symbol ?? 'N/A'} → ${predictions[0]?.direction ?? 'N/A'} (${((predictions[0]?.confidence ?? 0) * 100).toFixed(0)}%)`);
        }
        process.exit(0);
      }

      if (action === 'train') {
        logger.info('Training ML model...');
        const symbols = opts.symbols ?? getTokenList().map((t: TokenDef) => t.sym).slice(0, 50);
        const pairs = symbols.map((s: string) => {
          const pair = getBinancePair({ sym: s } as TokenDef);
          return pair || s;
        });
        const horizon = parseInt(opts.horizon, 10) || 5;
        const lookbackDays = parseInt(opts.lookback, 10) || 90;
        const intervals: KlineInterval[] = ['15m', '1h', '4h', '1d'];

        const allFeatures: import('./ml/types.js').FeatureRow[] = [];
        const allLabels: import('./ml/types.js').LabelRow[] = [];
        const allKlinesMap = new Map<string, number[]>();
        const { enrichFeatures: ef } = await import('./ml/features.js');
        const btcKlines = (await store.getKlines('BTCUSDT', '1h', { limit: 200, order: 'desc' })).reverse();
        const ethKlines = (await store.getKlines('ETHUSDT', '1h', { limit: 200, order: 'desc' })).reverse();
        const solKlines = (await store.getKlines('SOLUSDT', '1h', { limit: 200, order: 'desc' })).reverse();
        const polKlines = (await store.getKlines('POLUSDT', '1h', { limit: 200, order: 'desc' })).reverse();
        const referenceKlines = new Map<string, number[]>();
        if (btcKlines.length >= 20) referenceKlines.set('BTCUSDT', btcKlines.map(k => k.close));
        if (ethKlines.length >= 20) referenceKlines.set('ETHUSDT', ethKlines.map(k => k.close));
        if (solKlines.length >= 20) referenceKlines.set('SOLUSDT', solKlines.map(k => k.close));
        if (polKlines.length >= 20) referenceKlines.set('POLUSDT', polKlines.map(k => k.close));

        for (const symbol of pairs) {
          for (const interval of intervals) {
            const klines = (await store.getKlines(symbol, interval, {
              limit: Math.max(60, lookbackDays * 24),
              order: 'desc',
            })).reverse();
            if (klines.length < 60) {
              logger.warn(`  ${symbol} ${interval}: insufficient data (${klines.length})`);
              continue;
            }
            allKlinesMap.set(`${symbol}:${interval}`, klines.map(k => k.close));

            const crossAsset = await store.getCrossAsset(200);
            const funding = await store.getFunding(symbol, 100);
            const features = await (await import('./ml/features.js')).buildFeatures(
              symbol, interval, klines,
              { includeReturns: true, includeIndicators: true, includeCrossAsset: true, includeFutures: true, includeTemporal: true },
              crossAsset, funding, referenceKlines,
            );

            const closes = klines.map(k => k.close);
            const labels = (await import('./ml/labels.js')).computeLabels(closes, interval, { classHorizon: horizon as 1 | 5 | 20 | 60 });

            for (const f of features) {
              const lbl = labels.find(l => l.open_time === f.open_time);
              if (lbl && lbl.label_class !== null) {
                allFeatures.push(f);
                allLabels.push(lbl);
              }
            }
            logger.info(`  ${symbol} ${interval}: ${features.length} feature rows`);
          }
        }

        ef(allFeatures, allKlinesMap);
        logger.info(`Total: ${allFeatures.length} feature rows`);

        if (allFeatures.length < 100) {
          logger.error(`Need at least 100 rows, got ${allFeatures.length}. Collect more data first.`);
          process.exit(1);
        }

        const { assembleDataset } = await import('./ml/dataset.js');
        const dataset = assembleDataset(allFeatures, allLabels, {
          labelHorizon: horizon as 1 | 5 | 20 | 60,
          normalize: true,
        });

        // Spawn Python training
        const { spawn } = await import('node:child_process');
        const python = process.env.RADAR__ML_PYTHON ?? 'python3';

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(python, [
            'ml/train.py',
            '--data', dataset.trainPath,
            '--output', 'ml/models',
            '--class-weight', 'custom',
          ], { stdio: ['ignore', 'pipe', 'inherit'] });

          proc.on('close', (code) => {
            if (code === 0) {
              logger.info(`✅ Training complete. Dataset: ${dataset.trainPath}`);
              resolve();
            } else {
              reject(new Error(`Training exited with code ${code}`));
            }
          });
        });
        process.exit(0);
      }

      if (action === 'predict') {
        logger.info('Running ML prediction...');
        
        const modelPath = resolveModelPath();
        if (!modelPath) {
          logger.error('No trained model found in ml/models/. Run "ml train" first.');
          process.exit(1);
        }

        // Load normalization stats from latest training run
        const normStatsPath = resolveNormStatsPath();
        let normalizationStats: import('./ml/types.js').NormalizationStats | undefined;
        if (normStatsPath) {
          try {
            normalizationStats = JSON.parse(fs.readFileSync(normStatsPath, 'utf-8'));
          } catch {
            logger.warn(`Could not load normalization stats from ${normStatsPath}`);
          }
        }

        const symbols = opts.symbols ?? getTokenList().map((t: TokenDef) => t.sym).slice(0, 50);
        const pairs = symbols.map((s: string) => {
          const pair = getBinancePair({ sym: s } as TokenDef);
          return pair || s;
        });
        const results = await batchPredict(store, pairs, opts.interval ?? '1h', {
          modelPath,
          normalizationStats,
          minConfidence: 0,
        });
        if (results.length === 0) {
          logger.error('No predictions generated. Has a model been trained?');
          process.exit(1);
        }

        // Display results
        logger.stdout('\n🤖 ML Predictions:\n');
        for (const r of results) {
          const dirIcon = r.direction === 1 ? '🟢' : r.direction === -1 ? '🔴' : '⚪';
          const dirLabel = r.direction === 1 ? 'BUY' : r.direction === -1 ? 'SELL' : 'NEUTRAL';
          logger.stdout(`  ${dirIcon} ${r.symbol.padEnd(6)} → ${dirLabel.padEnd(8)} (${(r.confidence * 100).toFixed(0)}%)`);
        }

        // Persist to store
        await persistPredictions(store, results, 'cli-manual');
        logger.info(`\n✅ ${results.length} predictions persisted`);
        process.exit(0);
      }

      if (action === 'drift') {
        logger.info('Running drift detection...');
        const { detectDrift } = await import('./ml/drift.js');
        const report = await detectDrift(store, {
          model: (opts.model as 'ADWIN' | 'PageHinkley' | 'KSWIN') || 'ADWIN',
          delta: parseFloat(opts.delta) || 0.002,
          maxRecords: parseInt(opts.records, 10) || 500,
        });

        logger.stdout('\n📊 Drift Detection Report\n');
        logger.stdout(`  Drift detected: ${report.drift_detected ? '⚠️ YES' : '✅ No'}`);
        logger.stdout(`  Observations:   ${report.detector_stats.total_observations}`);
        logger.stdout(`  Detections:     ${report.detector_stats.total_detections}`);
        logger.stdout(`  Detector:       ${report.detector_stats.model}`);

        if (report.warnings.length > 0) {
          logger.stdout(`\n  ⚠️  Warnings (${report.warnings.length}):`);
          for (const w of report.warnings.slice(0, 10)) {
            logger.stdout(`    • ${w.message}`);
          }
          if (report.warnings.length > 10) {
            logger.stdout(`    ... and ${report.warnings.length - 10} more`);
          }
        }
        process.exit(0);
      }

      logger.error(`Unknown action: ${action}. Use train, predict, status, or drift.`);
      process.exit(1);
    } catch (err) {
      logger.error('[ERROR] ML command failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// ── benchmark command ──
program
  .command('benchmark')
  .description('Run performance benchmark')
  .option('--iterations <n>', 'Number of runs for median timing', '3')
  .action(async (opts) => {
    try {
      logger.info('Running performance benchmark...');
      const iterations = Math.max(1, parseInt(opts.iterations, 10) || 3);
      const result = iterations > 1
        ? await (await import('./core/benchmark.js')).runBenchmarkMedian(iterations)
        : await runBenchmark();
      logger.stdout(formatBenchmark(result));
    } catch (err) {
      logger.error('[ERROR] Benchmark failed:', { message: err instanceof Error ? err.message : err });
      process.exit(1);
    }
  });

// Default to scan if no command given
if (process.argv.length <= 2) {
  process.argv.push('scan');
}

program.parse(process.argv);
