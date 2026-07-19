#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

VENV_DIR="${ML_VENV_DIR:-.venv-ml}"
REQUIREMENTS="ml/requirements.txt"

if ! command -v uv &>/dev/null; then
  echo "  ❌ uv not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

echo "  🐍 Setting up ML Python environment with uv..."

if [ ! -d "$VENV_DIR" ]; then
  echo "  → Creating virtual environment..."
  uv venv --python 3.14 "$VENV_DIR"
fi

if [ -f "$REQUIREMENTS" ]; then
  echo "  → Installing ML dependencies..."
  uv pip install --requirement "$REQUIREMENTS" --python "$VENV_DIR"
fi

echo ""
echo "  ✅ ML environment ready"
echo "     Venv: $VENV_DIR"
echo "     Run:  RADAR__ML_PYTHON=$VENV_DIR/bin/python3 npm run ml:train"
