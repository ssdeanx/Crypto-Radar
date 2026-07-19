#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Hermes Crypto Radar — One-Line Install
# ═══════════════════════════════════════════════════════════════════════
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/ssdeanx/Hermes-Crypto-Radar/main/scripts/install.sh)
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

VERSION="2.0.0"
REPO="ssdeanx/Hermes-Crypto-Radar"
INSTALL_DIR="${HERMES_PLUGIN_DIR:-$HOME/.hermes/plugins/crypto-radar}"

echo ""
echo "  ╔═══════════════════════════════════════════════════════╗"
echo "  ║       🛰️  Hermes Crypto Radar  v${VERSION}            ║"
echo "  ║   Enterprise Crypto Market Intelligence Plugin       ║"
echo "  ╚═══════════════════════════════════════════════════════╝"
echo ""

# ── Check prerequisites ──
echo "  🔍 Checking prerequisites..."

if ! command -v node &>/dev/null; then
  echo ""
  echo "  ❌ Node.js is required but not found."
  echo "     Install Node.js >= 22 from https://nodejs.org"
  echo ""
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 22 ]; then
  echo ""
  echo "  ❌ Node.js >= 22 required (found v$(node -v))."
  echo "     Upgrade from https://nodejs.org"
  echo ""
  exit 1
fi
echo "  ✅ Node.js $(node -v)"

# ── Check Hermes Agent (optional) ──
if command -v hermes &>/dev/null; then
  echo "  ✅ Hermes Agent $(hermes --version 2>/dev/null | head -1 || echo 'found')"
else
  echo "  ⚠️  Hermes Agent not detected — install CLI only mode"
fi

# ── Download and extract ──
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo ""
echo "  📦 Downloading Crypto Radar v${VERSION}..."

if curl -fsSL "https://github.com/${REPO}/archive/refs/tags/v${VERSION}.tar.gz" -o "$TMP_DIR/release.tar.gz" 2>/dev/null; then
  echo "  ✅ Downloaded from tagged release"
else
  echo "  ⚠️  Tagged release not found, downloading from main..."
  curl -fsSL "https://github.com/${REPO}/archive/main.tar.gz" -o "$TMP_DIR/release.tar.gz"
  echo "  ✅ Downloaded from main branch"
fi

echo ""
echo "  📂 Extracting..."
mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP_DIR/release.tar.gz" -C "$TMP_DIR"
EXTRACTED_DIR=$(find "$TMP_DIR" -maxdepth 1 -type d | tail -1)
cp -r "$EXTRACTED_DIR"/* "$INSTALL_DIR"/ 2>/dev/null || true

# ── Install dependencies and build ──
cd "$INSTALL_DIR"

echo "  🔧 Installing dependencies..."
npm install --production 2>/dev/null || npm install
echo "  ✅ Dependencies installed"

echo ""
echo "  🔨 Building TypeScript..."
npm run build 2>/dev/null
echo "  ✅ Build complete"

# ── Register as Hermes plugin ──
if command -v hermes &>/dev/null; then
  echo ""
  echo "  🔌 Registering with Hermes..."
  hermes plugins install "$INSTALL_DIR" 2>/dev/null \
    && echo "  ✅ Plugin registered with Hermes" \
    || {
      ln -sf "$INSTALL_DIR" "$HOME/.hermes/plugins/crypto-radar" 2>/dev/null
      echo "  ✅ Plugin symlinked to ~/.hermes/plugins/crypto-radar"
    }
fi

# ── Complete ──
echo ""
echo "  ╔═══════════════════════════════════════════════════════╗"
echo "  ║          ✅  Installation Complete!                  ║"
echo "  ╚═══════════════════════════════════════════════════════╝"
echo ""
echo "  📊  Quick start:"
echo ""
echo "    # Run your first scan"
echo "    $ crypto-radar scan"
echo ""
echo "    # Check system health"
echo "    $ crypto-radar health"
echo ""
echo "    # Generate a chart"
echo "    $ crypto-radar chart SOL --type candlestick"
echo ""
echo "  🔌  Hermes Agent tools available:"
echo "    crypto_radar_scan     — Full market scan (auto-dynamic)"
echo "    crypto_radar_signals  — Trading signals + divergence"
echo "    crypto_radar_news     — 11 RSS feed aggregation"
echo "    crypto_radar_tokens   — 49 tokens / 31 chains"
echo "    crypto_radar_chart    — SVG candlestick charts"
echo "    crypto_radar_daemon   — Warm daemon (<50ms calls)"
echo "    crypto_radar_onchain  — DeFiLlama metrics"
echo "    crypto_radar_ws       — Real-time price streams"
echo ""
echo "  ⏰  Cron automation (every 2h):"
echo "    $ bash scripts/crypto-radar-collector.sh"
echo ""
echo "  📖  Documentation:"
echo "    README.md    — Full reference"
echo "    SPEC.md      — Architecture & design"
echo "    CHANGELOG.md — Release history"
echo ""
