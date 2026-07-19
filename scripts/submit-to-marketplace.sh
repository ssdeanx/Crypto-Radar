#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Hermes Crypto Radar — Marketplace Submission Script
# ═══════════════════════════════════════════════════════════════════════
#
# This script helps submit the plugin to the Hermes Agent marketplace.
#
# Prerequisites:
#   - hermes CLI installed and logged in
#   - Tarball built (run: bash scripts/publish.sh)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  🛰️  Hermes Crypto Radar — Marketplace Submission${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo ""

# Compute plugin root (where this script lives)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Show what we have
echo -e "${GREEN}✓${NC} Plugin root:  $ROOT"
TARBALL=$(ls hermes-crypto-radar-*.tar.gz 2>/dev/null | head -1) || true
if [ -n "$TARBALL" ]; then
  echo -e "${GREEN}✓${NC} Tarball:      $TARBALL ($(du -h "$TARBALL" | cut -f1))"
else
  echo -e "${RED}✗${NC} Tarball not found — run 'bash scripts/publish.sh' first"
fi
echo -e "${GREEN}✓${NC} Skill:        crypto-radar-skill.md"
echo ""

# Option 1: CLI submission (if hermes CLI available)
if command -v hermes &>/dev/null; then
  echo -e "${CYAN}━━━ Option 1: Submit via Hermes CLI ━━━${NC}"
  echo ""
  echo "  hermes skills publish ./crypto-radar-skill.md"
  echo ""
  echo "  To publish to a custom registry:"
  echo "  hermes skills publish ./crypto-radar-skill.md --to github --repo your-org/skills"
  echo ""
fi

# Option 2: Manual submission
echo -e "${CYAN}━━━ Option 2: Submit manually via website ━━━${NC}"
echo ""
echo "  1. Visit  https://hermes-agent.nousresearch.com/"
echo "  2. Navigate to  Plugins > Submit Plugin"
echo "  3. Upload the tarball:  $TARBALL"
echo "  4. Copy the contents of  crypto-radar-skill.md  into the description field"
echo ""

# Option 3: PR to registry
echo -e "${CYAN}━━━ Option 3: Submit via GitHub PR ━━━${NC}"
echo ""
echo "  Open a PR at the Hermes plugin registry:"
echo "  https://github.com/nousresearch/hermes-agent/plugins"
echo ""
echo "  Include:"
echo "    - crypto-radar-skill.md"
echo "    - $TARBALL"
echo ""

echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Ready for marketplace submission!${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
