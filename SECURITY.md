# 🔒 Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 2.0.x   | ✅ Active support  |
| 1.x.x   | ⚠️ Security patches only |
| < 1.0   | ❌ No longer supported |

## Reporting a Vulnerability

We take the security of Hermes Crypto Radar seriously. If you discover a security vulnerability, please report it privately.

**Please do NOT report security vulnerabilities via public GitHub issues.**

### How to Report

1. **Email**: [security@nousresearch.com](mailto:security@nousresearch.com)
2. **GitHub**: Use the [Security Advisory](https://github.com/ssdeanx/Hermes-Crypto-Radar/security/advisories/new) feature
3. **Encrypted communication**: Contact the maintainers for PGP keys

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Potential impact
- Any suggested fix (if known)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 5 business days
- **Fix timeline**: Depends on severity (critical: 7 days, high: 14 days, moderate: 30 days)
- **Public disclosure**: Coordinated release after fix is available

## Vulnerability Disclosure Policy

We follow a **coordinated disclosure** process:

1. Reporter submits vulnerability privately
2. Maintainers verify and assess severity
3. Fix is developed and tested
4. Fix is deployed to supported versions
5. Public disclosure after users have reasonable time to update

## Security Architecture

### Zero API Key Design
This plugin uses **only public APIs** that require no authentication:
- **Binance** — Public REST + WebSocket endpoints (`data-api.binance.vision`, `stream.binance.com`)
- **CoinGecko** — Free tier API (`api.coingecko.com`)
- **DeFiLlama** — Public endpoints (`api.llama.fi`, `coins.llama.fi`)
- **RSS News Feeds** — Public RSS/Atom feeds

No API keys, tokens, or credentials are hardcoded in the source code.

### Supply Chain Security
- **npm overrides** for transitive dependency vulnerabilities (see `package.json`)
- All dependencies are pinned to compatible semver ranges
- Regular `npm audit` runs via CI pipeline
- Verified builds via TypeScript compilation

### Network Security
- All external API calls use **HTTPS only**
- WebSocket connections use **WSS** (secure WebSocket)
- Configurable fetch timeouts prevent hanging connections
- Circuit breaker pattern prevents cascading failures (3 failures → 60s cooldown)
- Token-bucket rate limiter prevents API abuse (gradual refill)

### HTTP Daemon Security
The warm daemon HTTP servers include these security headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `X-XSS-Protection` | `1; mode=block` | Enables XSS filter |
| `Strict-Transport-Security` | `max-age=31536000` | Enforces HTTPS |
| `Cache-Control` | `no-store` | Prevents caching of sensitive data |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | Restricts resource loading |
| `Referrer-Policy` | `no-referrer` | Prevents referrer leakage |
| `Access-Control-Allow-Origin` | `*` | CORS (localhost only) |

### Data Privacy
- **No PII collected**: The plugin does not collect, store, or transmit personally identifiable information
- **Logs are local**: All log files are stored in `~/.hermes/data/crypto-radar/` and never leave the machine
- **No telemetry**: No usage statistics or analytics are sent
- **SHA-256 checksums**: Optional file integrity verification for log files
- **Log rotation**: Automatic rotation at 10MB with gzip compression (configurable)
- **Retention policy**: Configurable log pruning (default: disabled — opt-in via `RADAR__LOG_RETENTION_DAYS`)

### Input Validation
- All CLI parameters are validated through Commander.js with typed options
- Token symbols are uppercased and validated against the known token registry
- Numeric parameters use `parseInt`/`parseFloat` with safe defaults
- Path traversal protection on file operations
- Tool schemas use JSON Schema with type constraints and enums for string parameters

### Error Handling
- Typed error classes prevent information leakage
- Error messages do not expose internal paths, credentials, or stack traces
- Sensitive URLs are sanitized in error messages (query parameters removed)

## Security Checklist for Releases

Before each release, verify:

- [ ] `npm audit` reports 0 vulnerabilities
- [ ] No hardcoded secrets in source code
- [ ] All file write operations validate paths
- [ ] HTTP security headers present on daemon endpoints
- [ ] Error messages do not leak sensitive information
- [ ] Webhook URLs are not logged in plaintext
- [ ] Token whitelist does not expose internal details
- [ ] Circuit breaker thresholds are appropriate

## Related Documentation

- [README.md](README.md) — Project overview and usage
- [CHANGELOG.md](CHANGELOG.md) — Release history with security fixes
- [SPEC.md](SPEC.md) — Full specification
- [CRYPTO-ENTERPRISE-AUDIT.md](CRYPTO-ENTERPRISE-AUDIT.md) — Enterprise audit
