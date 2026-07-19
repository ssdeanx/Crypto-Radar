#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:-$(node -e "console.log(require('./package.json').version)")}"
echo "Packaging hermes-crypto-radar v$VERSION for marketplace..."
# Create clean tarball including scripts, SECURITY.md, and shared-svg.ts
tar -czf "hermes-crypto-radar-$VERSION.tar.gz" \
  --exclude=node_modules \
  --exclude=data \
  --exclude=coverage \
  --exclude=.git \
  --exclude=.github \
  --exclude=src \
  --exclude=test \
  --exclude=*.test.ts \
  dist/ plugin/ plugin.yaml package.json README.md LICENSE SECURITY.md main-banner.png \
  scripts/crypto-radar-collector.sh scripts/install.sh scripts/install.ps1
echo "Created: hermes-crypto-radar-$VERSION.tar.gz"
echo ""
echo "Tarball contents:"
tar -tzf "hermes-crypto-radar-$VERSION.tar.gz" | head -20
echo ""
echo "To publish: hermes skills publish ./crypto-radar-skill.md"
