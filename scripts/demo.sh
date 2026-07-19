#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Hermes Crypto Radar — Quick Demo Script
# ═══════════════════════════════════════════════════════════════════════
# This script runs a quick demo of the plugin's key capabilities.
# Usage: bash scripts/demo.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "═══════════════════════════════════════════════════════════════"
echo "  🛰️  Hermes Crypto Radar — Quick Demo"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Check build is ready ──
if [ ! -f dist/cli.js ]; then
  echo "⚙️  Building project first..."
  npm run build --silent
fi
echo "✅ Build ready"
echo ""

# ── Step 2: System health ──
echo "━━━ Step 1: System Health ━━━"
node dist/cli.js health 2>/dev/null || echo "   (health check requires network)"
echo ""

# ── Step 3: Token list ──
echo "━━━ Step 2: Tracked Tokens ━━━"
node dist/cli.js tokens 2>/dev/null || echo "   (tokens list requires network)"
echo ""

# ── Step 4: Price scan (3 tokens, no news, no logging) ──
echo "━━━ Step 3: Price Scan (SOL, BTC, ETH) ━━━"
node dist/cli.js scan --filter SOL BTC ETH --no-news --no-log 2>/dev/null || echo "   (scan requires network)"
echo ""

# ── Step 5: Signals snapshot ──
echo "━━━ Step 4: Trading Signals ━━━"
node dist/cli.js signals --filter SOL BTC 2>/dev/null || echo "   (signals require network)"
echo ""

# ── Step 6: Chart generation ──
echo "━━━ Step 5: Chart (SOL, simple line) ━━━"
node dist/cli.js chart SOL --type line --period 1d 2>/dev/null || echo "   (chart requires network)"
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ Demo complete!"
echo ""
echo "  For full documentation:"
echo "    node dist/cli.js --help"
echo "    cat crypto-radar-skill.md"
echo "═══════════════════════════════════════════════════════════════"
