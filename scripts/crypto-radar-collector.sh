#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Hermes Crypto Radar — Cron Collector
# ═══════════════════════════════════════════════════════════════════════
# Designed for Hermes cron (no_agent=true) or system crontab.
#
# Datasets written every run:
#   • radar-runlog.jsonl          — RUN-HISTORY LEDGER (1 line/run, append)
#   • radar-tickers.jsonl         — TICKER DATASET, ML-ready (1 line/ticker, append)
#   • radar-output.{txt,csv,md,xlsx} — Current snapshot (rotated to archive/ before overwrite)
#   • crypto-radar.db             — klines + futures store (via `collect`)
#   • crypto-radar-log.csv        — Rolling CSV (append)
#   • crypto-radar-news.csv       — Rolling news CSV (append)
#
# CSV is the canonical dataset. The ticker JSONL is the append-friendly
# ML fine-tuning dataset (consistent schema, nulls not missing keys).
#
# Environment:
#   RADAR__DATA_DIR   — override data/log directory
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Resolve plugin dir (built dist/cli.js) ──
# 1. Sibling of this script (plugin install layout: scripts/../dist/cli.js)
# 2. Cron workdir (cwd has dist/cli.js)
# 3. Explicit install location
if [ -f "$SCRIPT_DIR/../dist/cli.js" ]; then
  PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [ -f "$(pwd)/dist/cli.js" ]; then
  PLUGIN_DIR="$(pwd)"
else
  PLUGIN_DIR="/home/sam/Music/Crypto-Radar-Signals/Hermes-Crypto-Radar"
fi

DATA_DIR="${RADAR__DATA_DIR:-${PLUGIN_DIR}/data/crypto-radar}"
TICKERS_JSONL="${DATA_DIR}/radar-tickers.jsonl"

# Ensure TS code sees the same dataDir — script default or env override
export RADAR__DATA_DIR="${RADAR__DATA_DIR:-${DATA_DIR}}"

# ── Secondary path: if ~/.hermes/data/crypto-radar/ exists and differs from
#    DATA_DIR, run archive/migration operations on it too. The TS code handles
#    dual-write (config.dataDir + secondaryDataDir auto-detection), this just
#    keeps the shell's housekeeping in sync. ──
SECONDARY_DIR="${HOME}/.hermes/data/crypto-radar"
if [ "$SECONDARY_DIR" != "$DATA_DIR" ] && [ -d "$SECONDARY_DIR" ]; then
  HAS_SECONDARY=true
else
  HAS_SECONDARY=false
fi
MAX_LOG_AGE_DAYS=30

# ── Validate build exists ──
if [ ! -f "$PLUGIN_DIR/dist/cli.js" ]; then
  echo "  ❌ Crypto Radar collector: dist/cli.js not found at $PLUGIN_DIR"
  echo "     Run 'npm run build' in $PLUGIN_DIR"
  exit 1
fi

mkdir -p "$DATA_DIR"
cd "$PLUGIN_DIR"

# ── Run scan (prices + technicals + strategy signals) ──
# Captured so we can both validate and append JSONL. --quiet suppresses the
# human table on stderr; --format json puts the structured payload on stdout.
SCAN_STDERR=$(mktemp)
SCAN_STDOUT=$(mktemp)
trap 'rm -f "$SCAN_STDERR" "$SCAN_STDOUT"' EXIT

SCAN_EXIT=0
node dist/cli.js scan \
  --dynamic 30 \
  --onchain \
  --no-news \
  --format json \
  --quiet \
  --sort momentum \
  >"$SCAN_STDOUT" 2>"$SCAN_STDERR" || SCAN_EXIT=$?

if [ "$SCAN_EXIT" -ne 0 ] || [ ! -s "$SCAN_STDOUT" ]; then
  echo "  ❌ Crypto Radar scan failed (exit: $SCAN_EXIT)"
  [ -s "$SCAN_STDERR" ] && sed 's/^/     /' "$SCAN_STDERR"
  exit 1
fi

# ── Validate JSON payload before trusting it ──
if ! node -e "try{JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.exit(0)}catch(e){process.exit(1)}" <"$SCAN_STDOUT" 2>/dev/null; then
  echo "  ❌ Crypto Radar scan produced invalid JSON"
  [ -s "$SCAN_STDERR" ] && sed 's/^/     /' "$SCAN_STDERR"
  exit 1
fi

# ── Run collector (klines + futures) → updates crypto-radar.db ──
# Writes klines/futures datasets every run. Non-fatal: if the DB write
# hits issues, scan datasets + JSONL are already written, so the run still
# records successfully.
COLLECT_STDERR=$(mktemp)
trap 'rm -f "$SCAN_STDERR" "$SCAN_STDOUT" "$COLLECT_STDERR"' EXIT
node dist/cli.js collect --klines --futures 2>"$COLLECT_STDERR" || {
  echo "  ⚠️  Collector reported issues (klines/futures may be partial):"
  [ -s "$COLLECT_STDERR" ] && sed 's/^/     /' "$COLLECT_STDERR"
  # Non-fatal: scan datasets + JSONL already written. Continue.
}

# ── Run ML prediction if model exists ──
MODELS_DIR="${DATA_DIR}/ml/models"
if [ -f "${MODELS_DIR}/model.joblib" ] || ls "${MODELS_DIR}"/model_*.joblib 2>/dev/null; then
  node dist/cli.js ml predict --interval 1h 2>/dev/null || true
fi

# ── Archive old logs — DISABLED ──
# Previously this moved files into archive/ on EVERY cron run once they aged
# past MAX_LOG_AGE_DAYS. That fought the user (who deletes the archive) and
# looked like hourly archiving. Archiving now happens ONLY at the first of the
# month via monthlyArchiveLogs() in src/core/log-rotation.ts. The per-run move
# loop below is intentionally disabled; only the one-time legacy JSONL rename
# remains (see migrate_legacy_jsonl above).
#
# archive_housekeeping() {
#   local dir="$1"
#   local archive_dir="${dir}/archive"
#   local archive_age="${MAX_LOG_AGE_DAYS:-30}"
#   mkdir -p "$archive_dir"
#   for pattern in "cron-*" "crypto-radar-*.xlsx" "radar-*.*"; do
#     find "$dir" -maxdepth 1 -name "$pattern" -mtime +"$archive_age" -exec mv {} "$archive_dir/" \; 2>/dev/null || true
#   done
#   if [ -f "$dir/cron-$(date +%Y%m)-runlog.jsonl" ] && [ ! -f "$dir/radar-runlog.jsonl" ]; then
#     mv "$dir"/cron-*-runlog.jsonl "$dir/radar-runlog.jsonl" 2>/dev/null || true
#   fi
#   if ls "$dir"/cron-*-tickers.jsonl 2>/dev/null | head -1 | grep -q . && [ ! -f "$dir/radar-tickers.jsonl" ]; then
#     cat "$dir"/cron-*-tickers.jsonl > "$dir/radar-tickers.jsonl" 2>/dev/null || true
#     mv "$dir"/cron-*-tickers.jsonl "$archive_dir/" 2>/dev/null || true
#   fi
# }

# ── Per-run archive DISABLED ──
# The old archive_housekeeping() moved files into archive/ on EVERY cron run
# once they aged past MAX_LOG_AGE_DAYS, which fought the user (who deletes the
# archive) and looked like hourly archiving. Archiving now happens ONLY at the
# first of the month via monthlyArchiveLogs() in src/core/log-rotation.ts.
# We keep the one-time migration step (rename old cron-* JSONL) but skip the
# per-run move-to-archive loop.
migrate_legacy_jsonl() {
  local dir="$1"
  if [ -f "$dir/cron-$(date +%Y%m)-runlog.jsonl" ] && [ ! -f "$dir/radar-runlog.jsonl" ]; then
    mv "$dir"/cron-*-runlog.jsonl "$dir/radar-runlog.jsonl" 2>/dev/null || true
  fi
  if ls "$dir"/cron-*-tickers.jsonl 2>/dev/null | head -1 | grep -q . && [ ! -f "$dir/radar-tickers.jsonl" ]; then
    cat "$dir"/cron-*-tickers.jsonl > "$dir/radar-tickers.jsonl" 2>/dev/null || true
    rm -f "$dir"/cron-*-tickers.jsonl 2>/dev/null || true
  fi
}
migrate_legacy_jsonl "$DATA_DIR"
if [ "$HAS_SECONDARY" = true ]; then
  migrate_legacy_jsonl "$SECONDARY_DIR"
fi

# ── Summary for cron delivery (real stdout → meaningful recorded run) ──
export TICKERS_JSONL
node -e "
const fs = require('fs');
const d = fs.readFileSync('$SCAN_STDOUT', 'utf8');
try {
  const data = JSON.parse(d);
  const tickers = data.tickers || [];
  const signals = data.aggregatedSignals || data.signals || [];
  const onchain = data.onchain;
  const run = data.run || {};
  const buySignals    = signals.filter(s => /buy/i.test(s.direction || '')).length;
  const sellSignals   = signals.filter(s => /sell/i.test(s.direction || '')).length;
  const neutralSignals = signals.length - buySignals - sellSignals;
  const strongSignals = signals.filter(s => (s.compositeConfidence || 0) > 0.7);
  const topMovers = [...tickers]
    .sort((a,b) => Math.abs(b.priceChangePercent || 0) - Math.abs(a.priceChangePercent || 0))
    .slice(0, 5);

  console.log('');
  console.log('  🛰️  Crypto Radar — Market Scan Complete');
  console.log('  ─────────────────────────────────────────');
  console.log('  📊  Tracked tokens:  ' + tickers.length);
  console.log('  🟢  Buy signals:     ' + buySignals);
  console.log('  🔴  Sell signals:    ' + sellSignals);
  console.log('  ⚪  Neutral:         ' + neutralSignals);
  console.log('  🔔  Strong (>70%):   ' + strongSignals.length);
  console.log('  ⏱   Duration:       ' + (run.durationMs || '?') + 'ms');
  if (onchain && onchain.chains && onchain.chains.length) {
    console.log('  ⛓️   Top chain TVL:  ' + onchain.chains.slice(0,3)
      .map(c => c.chain + ' \$' + (c.tvl||0).toLocaleString('en-US',{maximumFractionDigits:0})).join('  '));
  }
  console.log('  📁  Ticker dataset: ' + process.env.TICKERS_JSONL);
  console.log('  🕐  ' + new Date().toISOString());
  console.log('');
} catch (e) {
  console.log('  ❌ Crypto Radar summary parse failed: ' + e.message);
  process.exit(1);
}
"
