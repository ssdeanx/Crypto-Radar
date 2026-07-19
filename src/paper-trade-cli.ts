// ═══════════════════════════════════════════════════════════════════════
// Hermes Crypto Radar — Paper Trading CLI
// ═══════════════════════════════════════════════════════════════════════
//
// CLI interface for the paper trading game.
// Available commands:
//   paper-trade buy <symbol> <amount>  — Buy tokens at current price
//   paper-trade sell <symbol> <amount>  — Sell tokens
//   paper-trade portfolio                — Show holdings with current values
//   paper-trade report                   — Performance report
//   paper-trade signals                  — Current signals + trade recommendations
//   paper-trade history                  — Show trade history
//   paper-trade reset                    — Reset to fresh $10,000 wallet
//   paper-trade agent <maxPerTrade>      — Auto-trade based on signals
//   paper-trade profile create <name>    — Create a new profile
//   paper-trade profile list             — List all profiles
//   paper-trade profile switch <name>    — Switch active profile
//   paper-trade profile delete <name>    — Delete a profile
// ═══════════════════════════════════════════════════════════════════════

import { Command } from 'commander';
import { PaperTrader, createPaperTrader, listProfiles, getActiveProfileName, expandHome } from './paper-trade.js';
import type { PaperTraderConfig, PaperTrade, PerformanceReport, PortfolioHolding } from './paper-trade.js';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_DATA_DIR = loadConfig().dataDir;

/** Resolve the data directory, expanding ~ */
function resolveDataDir(dataDir?: string): string {
  return expandHome(dataDir ?? DEFAULT_DATA_DIR);
}

/** Get the profiles directory path */
function profilesDirPath(dataDir?: string): string {
  return `${resolveDataDir(dataDir)}/paper-trade/profiles`;
}

/** Get the last-profile.txt path */
function lastProfilePath(dataDir?: string): string {
  return `${resolveDataDir(dataDir)}/paper-trade/last-profile.txt`;
}

/**
 * Create a paper-trade sub-command for Commander.js.
 * This can be attached to the main program or used standalone.
 */
export function createPaperTradeCommand(): Command {
  const cmd = new Command('paper-trade')
    .description('📈 Fake-money paper trading game — practice with $10,000 fake USD')
    .summary('Paper trade crypto with fake money');

  // ── buy command ──
  cmd
    .command('buy')
    .description('Buy tokens at current market price')
    .argument('<symbol>', 'Token symbol (e.g. SOL, ETH, BTC)')
    .argument('<amount>', 'Quantity to buy (e.g. 10)', parseFloat)
    .option('--max <n>', 'Max USD to spend (default: all cash if sufficient)', parseFloat)
    .option('--profile <name>', 'Profile name to use (temporary override)')
    .action(async (symbol, amount, opts) => {
      try {
        const trader = await loadPaperTrader(opts.profile);
        const trade = await trader.buy(symbol, amount);
        if (!trade) {
          const price = await trader.getPrice(symbol);
          if (price === null) {
            logger.error(`❌ Could not fetch price for ${symbol.toUpperCase()}`);
            process.exit(1);
          }
          const cost = amount * price;
          const portfolio = await trader.getPortfolio();
          logger.error(`❌ Insufficient funds: need $${cost.toFixed(2)} but have $${portfolio.cash.toFixed(2)}`);
          process.exit(1);
        }
        await trader.save(!opts.profile);
        logger.stdout(`✅ BOUGHT ${trade.amount.toFixed(4)} ${trade.symbol} @ $${trade.price.toFixed(6)}`);
        logger.stdout(`   Total: $${trade.total.toFixed(2)} | Cash remaining: $${trader.cash.toFixed(2)}`);
      } catch (err) {
        logger.error('[ERROR] Buy failed:', { message: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  // ── sell command ──
  cmd
    .command('sell')
    .description('Sell tokens at current market price')
    .argument('<symbol>', 'Token symbol (e.g. SOL, ETH, BTC)')
    .argument('<amount>', 'Quantity to sell (or "all" for full position)', (v) => v === 'all' ? -1 : parseFloat(v))
    .option('--profile <name>', 'Profile name to use (temporary override)')
    .action(async (symbol, amount, opts) => {
      try {
        const trader = await loadPaperTrader(opts.profile);
        const trade = await trader.sell(symbol, amount);
        if (!trade) {
          logger.error(`❌ No holdings for ${symbol.toUpperCase()} or insufficient balance`);
          process.exit(1);
        }
        await trader.save(!opts.profile);
        const pnlStr = trade.pnl != null
          ? (trade.pnl >= 0 ? `+$${trade.pnl.toFixed(2)}` : `-$${Math.abs(trade.pnl).toFixed(2)}`)
          : 'N/A';
        logger.stdout(`✅ SOLD ${trade.amount.toFixed(4)} ${trade.symbol} @ $${trade.price.toFixed(6)}`);
        logger.stdout(`   Total: $${trade.total.toFixed(2)} | P&L: ${pnlStr} | Cash: $${trader.cash.toFixed(2)}`);
      } catch (err) {
        logger.error('[ERROR] Sell failed:', { message: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  // ── portfolio command ──
  cmd
    .command('portfolio')
    .alias('p')
    .alias('holdings')
    .description('Show current holdings with live prices and unrealized P&L')
    .option('--profile <name>', 'Profile name to use (temporary override)')
    .action(async (opts) => {
      try {
        const trader = await loadPaperTrader(opts.profile);
        const portfolio = await trader.getPortfolio();

        logger.stdout(`\n📊 Paper Trading Portfolio\n`);
        logger.stdout(`   Cash: $${portfolio.cash.toFixed(2)}`);
        logger.stdout(`   Holdings Value: $${portfolio.totalHoldingsValue.toFixed(2)}`);
        logger.stdout(`   Total Equity: $${portfolio.totalEquity.toFixed(2)}`);
        const startBal = trader.startBalance;
        const totalReturn = portfolio.totalEquity - startBal;
        const returnPct = startBal > 0 ? (totalReturn / startBal) * 100 : 0;
        const returnSign = totalReturn >= 0 ? '+' : '';
        logger.stdout(`   Net P&L: ${returnSign}$${totalReturn.toFixed(2)} (${returnSign}${returnPct.toFixed(2)}%)\n`);

        if (portfolio.holdings.length === 0) {
          logger.stdout('   No holdings. Start trading with: paper-trade buy <symbol> <amount>\n');
          return;
        }

        // Table header
        logger.stdout(`   ${'Token'.padEnd(8)} ${'Amount'.padEnd(12)} ${'Entry'.padEnd(12)} ${'Price'.padEnd(12)} ${'Value'.padEnd(12)} ${'P&L'.padEnd(14)} ${'Return'}`);
        logger.stdout(`   ${''.padEnd(8, '─')} ${''.padEnd(12, '─')} ${''.padEnd(12, '─')} ${''.padEnd(12, '─')} ${''.padEnd(12, '─')} ${''.padEnd(14, '─')} ${''.padEnd(7, '─')}`);

        for (const h of portfolio.holdings) {
          const pnlSign = h.unrealizedPnl >= 0 ? '+' : '';
          const pnlStr = `${pnlSign}$${h.unrealizedPnl.toFixed(2)}`;
          const retStr = `${pnlSign}${h.unrealizedPnlPercent.toFixed(2)}%`;
          logger.stdout(`   ${h.symbol.padEnd(8)} ${h.amount.toFixed(6).padEnd(12)} $${h.avgEntryPrice.toFixed(4).padEnd(9)} $${h.currentPrice.toFixed(4).padEnd(9)} $${h.value.toFixed(2).padEnd(9)} ${pnlStr.padEnd(14)} ${retStr}`);
        }
        logger.stdout('');
      } catch (err) {
        logger.error('[ERROR] Portfolio failed:', { message: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  // ── report command ──
  cmd
    .command('report')
    .alias('r')
    .alias('performance')
    .description('Generate comprehensive performance report')
    .option('--profile <name>', 'Profile name to use (temporary override)')
    .action(async (opts) => {
      try {
        const trader = await loadPaperTrader(opts.profile);
        const report: PerformanceReport = await trader.getReport();

        logger.stdout(`\n📈 Paper Trading Performance Report\n`);
        logger.stdout(`   ┌─ Overview ─────────────────────────────┐`);
        logger.stdout(`   │ Start Balance:    $${report.startBalance.toFixed(2).padStart(10)} │`);
        logger.stdout(`   │ Current Cash:     $${report.currentCash.toFixed(2).padStart(10)} │`);
        logger.stdout(`   │ Holdings Value:   $${report.holdingsValue.toFixed(2).padStart(10)} │`);
        logger.stdout(`   │ Total Equity:     $${report.totalEquity.toFixed(2).padStart(10)} │`);
        const retSign = report.totalReturn >= 0 ? '+' : '';
        logger.stdout(`   │ Total Return:     ${retSign}$${report.totalReturn.toFixed(2).padStart(9)} │`);
        logger.stdout(`   │ Return %:         ${retSign}${report.totalReturnPercent.toFixed(2).padStart(9)}% │`);
        logger.stdout(`   └─────────────────────────────────────────┘\n`);

        logger.stdout(`   ┌─ Trade Statistics ─────────────────────┐`);
        logger.stdout(`   │ Total Trades:     ${String(report.totalTrades).padStart(11)} │`);
        logger.stdout(`   │ Wins:             ${String(report.wins).padStart(11)} │`);
        logger.stdout(`   │ Losses:           ${String(report.losses).padStart(11)} │`);
        logger.stdout(`   │ Win Rate:         ${(report.winRate * 100).toFixed(1).padStart(9)}%   │`);
        logger.stdout(`   │ Sharpe Ratio:     ${report.sharpeRatio.toFixed(2).padStart(11)} │`);
        logger.stdout(`   └─────────────────────────────────────────┘\n`);

        if (report.bestTrade) {
          logger.stdout(`   🏆 Best Trade: ${report.bestTrade.type.toUpperCase()} ${report.bestTrade.amount.toFixed(4)} ${report.bestTrade.symbol} @ $${report.bestTrade.price.toFixed(4)} (P&L: +$${report.bestTrade.pnl?.toFixed(2) ?? 'N/A'})`);
        }
        if (report.worstTrade) {
          logger.stdout(`   💀 Worst Trade: ${report.worstTrade.type.toUpperCase()} ${report.worstTrade.amount.toFixed(4)} ${report.worstTrade.symbol} @ $${report.worstTrade.price.toFixed(4)} (P&L: ${report.worstTrade.pnl != null ? `-$${Math.abs(report.worstTrade.pnl).toFixed(2)}` : 'N/A'})`);
        }

        if (report.perToken.length > 0) {
          logger.stdout(`\n   ┌─ Per-Token Breakdown ───────────────────────────────────────────────────────────────────┐`);
          logger.stdout(`   │ ${'Token'.padEnd(8)} ${'Holdings'.padEnd(10)} ${'Entry'.padEnd(10)} ${'Price'.padEnd(10)} ${'Value'.padEnd(10)} ${'Unrealized'.padEnd(12)} ${'Realized'.padEnd(10)} ${'Total P&L'.padEnd(12)} │`);
          logger.stdout(`   │ ${''.padEnd(8, '─')} ${''.padEnd(10, '─')} ${''.padEnd(10, '─')} ${''.padEnd(10, '─')} ${''.padEnd(10, '─')} ${''.padEnd(12, '─')} ${''.padEnd(10, '─')} ${''.padEnd(12, '─')} │`);
          for (const pt of report.perToken) {
            const pnlSign = pt.totalPnl >= 0 ? '+' : '';
            logger.stdout(`   │ ${pt.symbol.padEnd(8)} ${pt.amount.toFixed(4).padEnd(10)} $${(pt.avgEntry || 0).toFixed(2).padEnd(7)} $${(pt.currentPrice || 0).toFixed(2).padEnd(7)} $${pt.value.toFixed(2).padEnd(7)} ${pnlSign}$${pt.unrealizedPnl.toFixed(2).padEnd(8)} ${pnlSign}$${pt.realizedPnl.toFixed(2).padEnd(7)} ${pnlSign}$${pt.totalPnl.toFixed(2).padEnd(8)} │`);
          }
          logger.stdout(`   └────────────────────────────────────────────────────────────────────────────────────────┘`);
        }
        logger.stdout('');
      } catch (err) {
        logger.error('[ERROR] Report failed:', { message: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  // ── signals command ──
  cmd
    .command('signals')
    .alias('s')
    .description('Show current trading signals with recommendations')
    .option('--profile <name>', 'Profile name to use (temporary override)')
    .action(async (opts) => {
      try {
        const trader = await loadPaperTrader(opts.profile);
        logger.stdout(`\n📡 Current Market Signals & Recommendations\n`);
        logger.stdout(`   Fetching live data...\n`);

        const recommendations = await trader.getSignalRecommendations();
        if (recommendations.length === 0) {
          logger.stdout('   No signals available right now. Try running the scan command first.\n');
          return;
        }

        // Show top signals by confidence
        const sorted = [...recommendations].sort((a, b) => {
          const order = { buy: 0, sell: 1, hold: 2 };
          return order[a.action] - order[b.action] || b.confidence - a.confidence;
        });

        logger.stdout(`   ${'Action'.padEnd(8)} ${'Token'.padEnd(8)} ${'Price'.padEnd(12)} ${'Confidence'.padEnd(12)} ${'Signal'}${'Score'.padStart(8)}`);
        logger.stdout(`   ${''.padEnd(8, '─')} ${''.padEnd(8, '─')} ${''.padEnd(12, '─')} ${''.padEnd(12, '─')} ${''.padEnd(20, '─')}`);

        for (const rec of sorted) {
          const actionStr = rec.action === 'buy'
            ? '🟢 BUY '
            : rec.action === 'sell'
              ? '🔴 SELL'
              : '⚪ HOLD';
          const confStr = `${(rec.confidence * 100).toFixed(0)}%`;
          const priceStr = `$${rec.currentPrice.toFixed(4)}`;
          logger.stdout(`   ${actionStr.padEnd(8)} ${rec.symbol.padEnd(8)} ${priceStr.padEnd(12)} ${confStr.padEnd(12)} ${(rec.reason || '').substring(0, 40).padEnd(20)}`);
        }
        logger.stdout(`\n   Tip: Use "paper-trade buy <symbol> <amount>" or "paper-trade agent" to auto-trade\n`);
      } catch (err) {
        logger.error('[ERROR] Signals failed:', { message: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  // ── history command ──
  cmd
    .command('history')
    .alias('h')
    .alias('ledger')
    .description('Show complete trade history')
    .option('--profile <name>', 'Profile name to use (temporary override)')
    .action(async (opts) => {
      try {
        const trader = await loadPaperTrader(opts.profile);
        const trades: readonly PaperTrade[] = [...trader.trades];

        if (trades.length === 0) {
          logger.stdout('\n   No trades yet. Start with: paper-trade buy <symbol> <amount>\n');
          return;
        }

        logger.stdout(`\n📜 Trade History (${trades.length} trades)\n`);
        logger.stdout(` ${'ID'.padEnd(14)} ${'Type'.padEnd(6)} ${'Symbol'.padEnd(8)} ${'Amount'.padEnd(14)} ${'Price'.padEnd(12)} ${'Total'.padEnd(12)} ${'P&L'.padEnd(12)} ${'Timestamp'}`);
        logger.stdout(` ${''.padEnd(14, '─')} ${''.padEnd(6, '─')} ${''.padEnd(8, '─')} ${''.padEnd(14, '─')} ${''.padEnd(12, '─')} ${''.padEnd(12, '─')} ${''.padEnd(12, '─')} ${''.padEnd(20, '─')}`);

        for (const t of trades) {
          const typeStr = t.type === 'buy' ? '🟢 BUY' : '🔴 SELL';
          const pnlStr = t.pnl != null
            ? (t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`)
            : '     N/A';
          const dateStr = t.timestamp.substring(0, 19).replace('T', ' ');
          logger.stdout(` ${t.id.padEnd(14)} ${typeStr.padEnd(6)} ${t.symbol.padEnd(8)} ${t.amount.toFixed(6).padEnd(14)} $${t.price.toFixed(4).padEnd(9)} $${t.total.toFixed(2).padEnd(9)} ${pnlStr.padEnd(12)} ${dateStr}`);
        }
        logger.stdout('');
      } catch (err) {
        logger.error('[ERROR] History failed:', { message: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  // ── agent command ──
  cmd
    .command('agent')
    .alias('auto')
    .description('Auto-trade: let the Hermes agent trade based on signals')
    .argument('[maxPerTrade]', 'Max USD per trade (default: 500)', parseFloat, 500)
    .option('--min-confidence <n>', 'Minimum confidence threshold 0-1 (default: 0.3)', parseFloat, 0.3)
    .option('--max-trades <n>', 'Maximum trades per run (default: 5)', parseFloat, 5)
    .option('--profile <name>', 'Profile name to use (temporary override)')
    .action(async (maxPerTrade, opts) => {
      try {
        const trader = await loadPaperTrader(opts.profile);
        logger.stdout(`\n🤖 Hermes Agent Trading Mode\n`);
        logger.stdout(`   Max per trade: $${maxPerTrade}`);
        logger.stdout(`   Min confidence: ${(opts.minConfidence * 100).toFixed(0)}%`);
        logger.stdout(`   Max trades: ${opts.maxTrades}\n`);

        const recommendations = await trader.getSignalRecommendations();
        if (recommendations.length === 0) {
          logger.stdout('   No trade recommendations available. Try running signals first.\n');
          return;
        }

        const buyRecs = recommendations.filter(r => r.action === 'buy');
        const sellRecs = recommendations.filter(r => r.action === 'sell');

        logger.stdout(`   Found ${buyRecs.length} buy signals, ${sellRecs.length} sell signals\n`);

        // Execute sell recommendations first (free up cash for buys)
        let totalTrades = 0;
        const allTrades: PaperTrade[] = [];

        // Sort sells by confidence
        const topSells = [...sellRecs]
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, opts.maxTrades);

        for (const rec of topSells) {
          if (totalTrades >= opts.maxTrades) break;
          const trades = await trader.agentPlay([rec], 0, opts.minConfidence);
          allTrades.push(...trades);
          totalTrades += trades.length;
        }

        // Then buy
        const topBuys = [...buyRecs]
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, opts.maxTrades);

        for (const rec of topBuys) {
          if (totalTrades >= opts.maxTrades) break;
          const trades = await trader.agentPlay([rec], maxPerTrade, opts.minConfidence);
          allTrades.push(...trades);
          totalTrades += trades.length;
        }

        if (allTrades.length === 0) {
          logger.stdout('   🤷 No trades executed. Try lowering --min-confidence.\n');
        } else {
          logger.stdout(`   Executed ${allTrades.length} trades:\n`);
          for (const t of allTrades) {
            const pnlStr = t.pnl != null
              ? (t.pnl >= 0 ? ` (P&L: +$${t.pnl.toFixed(2)})` : ` (P&L: -$${Math.abs(t.pnl).toFixed(2)})`)
              : '';
            logger.stdout(`     ${t.type === 'buy' ? '🟢' : '🔴'} ${t.type.toUpperCase()} ${t.amount.toFixed(4)} ${t.symbol} @ $${t.price.toFixed(4)} — $${t.total.toFixed(2)}${pnlStr}`);
          }
          await trader.save(!opts.profile);
          const portfolio = await trader.getPortfolio();
          logger.stdout(`\n   💰 Cash: $${portfolio.cash.toFixed(2)} | Holdings: $${portfolio.totalHoldingsValue.toFixed(2)} | Equity: $${portfolio.totalEquity.toFixed(2)}`);
        }
        logger.stdout('');
      } catch (err) {
        logger.error('[ERROR] Agent trade failed:', { message: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  // ── reset command ──
  cmd
    .command('reset')
    .description('Reset portfolio to fresh $10,000 wallet (clears all trades)')
    .option('--force', 'Skip confirmation prompt')
    .option('--profile <name>', 'Profile name to use (temporary override)')
    .action(async (opts) => {
      // Simple confirmation
      if (!opts.force) {
        logger.error('⚠️  This will delete all trading history and reset to $10,000.');
        logger.error('   Pass --force to skip this prompt.');
        // We can't prompt interactively, so just show the message and exit
        process.exit(0);
      }

      try {
        const trader = await loadPaperTrader(opts.profile);
        trader.reset();
        await trader.save(!opts.profile);
        logger.stdout('✅ Portfolio reset to $10,000. All trades cleared.\n');
      } catch (err) {
        logger.error('[ERROR] Reset failed:', { message: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  // ── config command ──
  cmd
    .command('config')
    .description('Show current paper trader configuration')
    .option('--profile <name>', 'Profile name to use (temporary override)')
    .action(async (opts) => {
      const trader = await loadPaperTrader(opts.profile);
      const rawState = trader.getRawState();
      const holdings: readonly PortfolioHolding[] = rawState.holdings;
      logger.stdout('\n⚙️  Paper Trader Configuration\n');
      logger.stdout(`   Starting Balance: $${trader.startBalance.toFixed(2)}`);
      logger.stdout(`   Current Cash:     $${trader.cash.toFixed(2)}`);
      logger.stdout(`   Total Trades:     ${trader.tradeCount}`);
      logger.stdout(`   Active Holdings:  ${holdings.length}`);
      logger.stdout('');
    });

  // ── profile command group ──
  const profileCmd = cmd.command('profile')
    .description('Manage paper trading profiles');

  // ── profile create ──
  profileCmd
    .command('create')
    .description('Create a new trading profile')
    .argument('<name>', 'Profile name (letters, numbers, hyphens, underscores)')
    .action(async (name) => {
      // Validate name
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
        logger.error('❌ Invalid profile name. Use letters, numbers, hyphens, and underscores only (1–64 chars).');
        process.exit(1);
      }
      if (name === 'last-profile') {
        logger.error('❌ "last-profile" is a reserved name.');
        process.exit(1);
      }
      try {
        const trader = new PaperTrader({ profileName: name });
        const exists = await trader.load();
        if (exists) {
          logger.error(`❌ Profile "${name}" already exists.`);
          process.exit(1);
        }
        await trader.save(); // writes fresh state
        logger.stdout(`✅ Created profile "${name}" with $10,000.00`);
      } catch (err) {
        logger.error('[ERROR]', { message: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  // ── profile list ──
  profileCmd
    .command('list')
    .description('List all profiles')
    .action(async () => {
      const activeProfile = getActiveProfileName();
      const profiles = await listProfiles();
      if (profiles.length === 0) {
        logger.stdout('\n📋 No profiles found.\n');
        return;
      }
      logger.stdout('\n📋 Paper Trading Profiles\n');
      for (const p of profiles) {
        const active = p.profileName === activeProfile ? '  ← active' : '';
        logger.stdout(
          `  ${p.profileName.padEnd(20)} $${p.cash.toFixed(2).padStart(10)}  ` +
          `${String(p.tradeCount).padStart(4)} trades  ` +
          `Created ${p.createdAt?.substring(0, 10) ?? '?'}${active}`
        );
      }
      logger.stdout('');
    });

  // ── profile switch ──
  profileCmd
    .command('switch')
    .description('Switch to a different profile')
    .argument('<name>', 'Profile name')
    .action(async (name) => {
      // Validate profile name
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
        logger.error('❌ Invalid profile name. Use letters, numbers, hyphens, and underscores only (1–64 chars).');
        process.exit(1);
      }
      const activeProfile = getActiveProfileName();
      if (name === activeProfile) {
        logger.stdout(`ℹ️  Already on profile "${name}".`);
        return;
      }
      // Verify profile exists by trying to load it
      const trader = new PaperTrader({ profileName: name });
      const exists = await trader.load();
      if (!exists) {
        logger.error(`❌ Profile "${name}" not found. Use "profile create ${name}" first.`);
        process.exit(1);
      }
      // Write last-profile.txt
      const fs = await import('node:fs');
      fs.writeFileSync(lastProfilePath(), `${name}\n`, 'utf-8');
      logger.stdout(`✅ Switched to profile "${name}".`);
    });

  // ── profile delete ──
  profileCmd
    .command('delete')
    .description('Delete a profile')
    .argument('<name>', 'Profile name')
    .action(async (name) => {
      // Validate profile name
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
        logger.error('❌ Invalid profile name. Use letters, numbers, hyphens, and underscores only (1–64 chars).');
        process.exit(1);
      }
      const activeProfile = getActiveProfileName();
      if (name === activeProfile) {
        logger.error(`❌ Cannot delete active profile "${name}". Switch to another profile first.`);
        process.exit(1);
      }
      const profiles = await listProfiles();
      const isLastProfile = profiles.length <= 1;
      const fs = await import('node:fs');
      const profilePath = `${profilesDirPath()}/${name}.json`;
      if (!fs.existsSync(profilePath)) {
        logger.error(`❌ Profile "${name}" not found.`);
        process.exit(1);
      }
      fs.unlinkSync(profilePath);
      logger.stdout(`✅ Deleted profile "${name}".`);

      // P2: If it was the last profile, auto-create "trader1" with fresh state
      if (isLastProfile) {
        const trader = new PaperTrader({});
        await trader.save();
        logger.stdout(`ℹ️  Last profile deleted. Created default "trader1" profile with $10,000.00.`);
      }
    });

  // ── profile current ──
  profileCmd
    .command('current')
    .description('Show the currently active profile name')
    .action(() => {
      const activeProfile = getActiveProfileName();
      logger.stdout(`${activeProfile}`);
    });

  return cmd;
}

// ═══════════════════════════════════════════════════════════════════════
// Standalone CLI entry point (for "npm run paper-trade")
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run the paper trading CLI standalone.
 * Used by the "paper-trade" npm script.
 */
export async function runPaperTradeCli(): Promise<void> {
  const program = new Command();

  program
    .name('paper-trade')
    .description('📈 Hermes Crypto Radar — Paper Trading Game')
    .version('1.0.0');

  // Create the sub-commands and re-parent them to the top-level program
  const paperTradeCmd = createPaperTradeCommand();
  for (const child of paperTradeCmd.commands) {
    program.addCommand(child);
  }

  // Handle "reset --force" correctly (it needs a command name)
  // Also add the original parent reference
  program.command('help').description('Display help').action(() => {
    program.outputHelp();
  });

  program.parse(process.argv);
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Load or create a PaperTrader, restoring state from disk if available. */
async function loadPaperTrader(profileName?: string, config?: PaperTraderConfig): Promise<PaperTrader> {
  const name = profileName ?? getActiveProfileName();
  const trader = createPaperTrader({ profileName: name, ...config });
  const restored = await trader.load();
  if (restored) {
    // State restored from disk
  }
  return trader;
}

// ═══════════════════════════════════════════════════════════════════════
// Auto-execute when run directly as a script
// ═══════════════════════════════════════════════════════════════════════

// Detect if ran as the main module (node dist/paper-trade-cli.js ...)
const isMainModule = process.argv[1]?.endsWith('paper-trade-cli.js');
if (isMainModule) {
  runPaperTradeCli().catch(err => {
    logger.error('[FATAL]', { message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
