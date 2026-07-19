#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Hermes Crypto Radar — Full Setup (npm + Python ML venv)
# ═══════════════════════════════════════════════════════════════════════
# Usage:   bash scripts/setup.sh
# Flags:   --no-ml    Skip ML environment setup
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

SETUP_ML=true
for arg in "$@"; do
  case "$arg" in
    --no-ml) SETUP_ML=false ;;
  esac
done

echo "  🔧 Hermes Crypto Radar — full setup"

# ── npm ──
echo "  → Installing npm dependencies..."
npm ci 2>/dev/null || npm install
npm run build
echo "     Done"

# ── Python ML venv ──
if [ "$SETUP_ML" = true ]; then
  bash scripts/setup-ml-env.sh
  VENV_DIR="${ML_VENV_DIR:-.venv-ml}"
  if [ -f "$VENV_DIR/bin/python3" ]; then
    ABS_VENV="$(cd "$VENV_DIR" && pwd)"
    echo "RADAR__ML_PYTHON=$ABS_VENV/bin/python3" >> .env
    echo "  ✅ Wrote RADAR__ML_PYTHON to .env"
  fi
fi

echo ""
echo "  ✅ Setup complete"
echo "     Run: npx crypto-radar scan --filter SOL"
