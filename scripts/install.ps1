<#
.SYNOPSIS
    🛰️ Hermes Crypto Radar — Windows Installer
.DESCRIPTION
    Installs the Hermes Crypto Radar plugin for Hermes Agent on Windows.
    Requires Node.js >= 22 and Hermes Agent.
.LINK
    https://github.com/ssdeanx/Hermes-Crypto-Radar
#>

$ErrorActionPreference = "Stop"
$VERSION = "2.0.0"
$REPO = "ssdeanx/Hermes-Crypto-Radar"
$INSTALL_DIR = "$env:USERPROFILE\.hermes\plugins\crypto-radar"

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║       🛰️  Hermes Crypto Radar  v$VERSION            ║" -ForegroundColor Cyan
Write-Host "  ║   Enterprise Crypto Market Intelligence Plugin       ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Check prerequisites ──
Write-Host "  🔍  Checking prerequisites..." -ForegroundColor Yellow

$nodePath = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $nodePath) {
    Write-Host "`n  ❌ Node.js is required but not found." -ForegroundColor Red
    Write-Host "     Install Node.js >= 22 from https://nodejs.org" -ForegroundColor Red
    exit 1
}

$nodeVer = node -v
$verNum = [int]($nodeVer -replace '[v.]', '').Substring(0,2)
if ($verNum -lt 22) {
    Write-Host "`n  ❌ Node.js >= 22 required (found $nodeVer)." -ForegroundColor Red
    Write-Host "     Upgrade from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ Node.js $nodeVer" -ForegroundColor Green

$hermesPath = Get-Command "hermes" -ErrorAction SilentlyContinue
if ($hermesPath) {
    Write-Host "  ✅ Hermes Agent detected" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  Hermes Agent not detected — installing CLI only" -ForegroundColor Yellow
}

# ── Download and extract ──
Write-Host ""
Write-Host "  📦  Downloading Crypto Radar v$VERSION..." -ForegroundColor Yellow
$tmpDir = Join-Path $env:TEMP "crypto-radar-install-$([System.IO.Path]::GetRandomFileName())"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

$zipUrl = "https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz"
try {
    Invoke-WebRequest -Uri $zipUrl -OutFile "$tmpDir\release.tar.gz" -UseBasicParsing -ErrorAction Stop
    Write-Host "  ✅ Downloaded from tagged release" -ForegroundColor Green
} catch {
    Write-Host "  ⚠️  Tagged release not found, downloading from main..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/$REPO/archive/main.tar.gz" -OutFile "$tmpDir\release.tar.gz" -UseBasicParsing
    Write-Host "  ✅ Downloaded from main branch" -ForegroundColor Green
}

# Using tar (available in Windows 10 1803+ or with Git for Windows)
Write-Host ""
Write-Host "  📂  Extracting..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null

if (Get-Command "tar" -ErrorAction SilentlyContinue) {
    tar -xzf "$tmpDir\release.tar.gz" -C "$tmpDir"
    $extracted = Get-ChildItem "$tmpDir" -Directory | Where-Object { $_.Name -ne $tmpDir } | Select-Object -First 1
    Copy-Item "$($extracted.FullName)\*" "$INSTALL_DIR\" -Recurse -Force
} else {
    Write-Host "  ❌ tar not found. Install Git for Windows or Windows Subsystem for Linux." -ForegroundColor Red
    exit 1
}

# ── Install dependencies and build ──
Set-Location $INSTALL_DIR

Write-Host ""
Write-Host "  🔧  Installing dependencies..." -ForegroundColor Yellow
npm install --production 2>$null
if ($LASTEXITCODE -ne 0) { npm install }
Write-Host "  ✅ Dependencies installed" -ForegroundColor Green

Write-Host ""
Write-Host "  🔨  Building TypeScript..." -ForegroundColor Yellow
npm run build
Write-Host "  ✅ Build complete" -ForegroundColor Green

# ── Register as Hermes plugin ──
if ($hermesPath) {
    Write-Host ""
    Write-Host "  🔌  Registering with Hermes..." -ForegroundColor Yellow
    hermes plugins install $INSTALL_DIR 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ Plugin registered with Hermes" -ForegroundColor Green
    } else {
        Write-Host "  ✅ Plugin symlinked to ~/.hermes/plugins/crypto-radar" -ForegroundColor Green
    }
}

# ── Complete ──
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║          ✅  Installation Complete!                  ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  📊  Quick start:" -ForegroundColor White
Write-Host ""
Write-Host "    # Run your first scan"
Write-Host "    > crypto-radar scan"
Write-Host ""
Write-Host "    # Check system health"
Write-Host "    > crypto-radar health"
Write-Host ""
Write-Host "    # Generate a chart"
Write-Host "    > crypto-radar chart SOL --type candlestick"
Write-Host ""
Write-Host "  🔌  Hermes Agent tools:" -ForegroundColor White
Write-Host "    crypto_radar_scan     — Full market scan (auto-dynamic)"
Write-Host "    crypto_radar_signals  — Trading signals + divergence"
Write-Host "    crypto_radar_news     — 11 RSS feed aggregation"
Write-Host "    crypto_radar_tokens   — 49 tokens / 31 chains"
Write-Host "    crypto_radar_chart    — SVG candlestick charts"
Write-Host "    crypto_radar_daemon   — Warm daemon (<50ms calls)"
Write-Host "    crypto_radar_onchain  — DeFiLlama metrics"
Write-Host "    crypto_radar_ws       — Real-time price streams"
Write-Host ""
Write-Host "  📖  Documentation: README.md | SPEC.md | CHANGELOG.md"
Write-Host ""
