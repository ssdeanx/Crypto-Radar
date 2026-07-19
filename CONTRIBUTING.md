# Contributing to Hermes Crypto Radar

## Development Setup

```bash
git clone https://github.com/ssdeanx/Hermes-Crypto-Radar.git
cd Hermes-Crypto-Radar
npm install
npm run build
```

## PR Workflow

1. **Branch from `main`** — name branches `feature/<description>` or `fix/<description>`
2. **Make changes** — one logical change per commit
3. **Run tests** — `npm test` must pass (all 332 tests)
4. **Build** — `npm run build` must compile clean
5. **Smoke test** — `node dist/cli.js scan --filter SOL --no-news --format json` must return valid JSON
6. **Open PR** — against `main` branch with description of changes
7. **Address reviews** — CodeRabbit and Sourcery-ai auto-review; fix or explain any flagged issues
8. **Generate docs** — `npm run docs` to update TypeDoc API reference if APIs changed

## Testing Guidelines

| Test type | Location | Run command |
|-----------|----------|-------------|
| Unit tests | `src/*.test.ts` (co-located) | `npm test` |
| Watch mode | — | `npm run test:watch` |
| Single file | — | `npx vitest run src/indicators.test.ts` |

- Unit tests in `src/*.test.ts` alongside source files
- Integration tests mock `globalThis.fetch` (see `src/binance.integration.test.ts`)
- No network calls in tests
- All test files use vitest globals: `describe`, `it`, `expect`, `vi` auto-imported

## Code Style

- **ESM only** — `"type": "module"` in `package.json`. All imports use `.js` extensions
- **Strict TypeScript** — `strict: true` in `tsconfig.json`
- **Logging** — structured JSON via `core/logger.ts` to stderr. No `console.log` in production code
- **Error handling** — use typed `CryptoRadarError` hierarchy (`NetworkError`, `RateLimitError`, `DataError`, `ConfigError`)
- **File size** — keep source files under 400 lines; split into submodules if larger

## Dependency Rules

- Every declared dependency must be actually imported in code
- New deps pinned with `<next_major` upper bound in `package.json`
- Run `npm ls --all` before committing to verify no accidental deps
- Prefer Node.js built‑ins over third‑party packages
- XLSX import: `import ExcelJS from 'exceljs'` (default import, NOT `import * as ExcelJS`)

## Token Additions

To add a new token, edit `src/tokens.ts`:

```typescript
'my-token': { id: 'my-token', sym: 'MYT', name: 'My Token', chain: 'solana' },
```

Rebuild with `npm run build` and verify it appears in `node dist/cli.js tokens`.

## Documentation

- README.md: user‑facing, kept concise
- SPEC.md: full specification — architecture, features, roadmap
- CHANGELOG.md: every release documented in Keep a Changelog format
- CRYPTO-ENTERPRISE-AUDIT.md: scored section‑by‑section audit
- HERMES.md: agent‑facing project context (what Hermes needs to know)
