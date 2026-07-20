# Technology Stack: Crypto Radar

## Core Platform
*   **Runtime Environment**: Node.js >= 22.0.0 (Target: Node 22 on Debian-based slim container)
*   **Programming Language**: TypeScript >= 6.0.3 (Compiled to ES modules in `dist/`)
*   **Package Manager**: npm >= 10.0.0

## Backend Framework
*   **Web Framework**: Fastify >= 5.10.0 (REST endpoints only; WebSockets are removed in the target production environment, replaced by REST + Pub/Sub)
*   **API Serving**: Fastify plugins including `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/jwt`, `@fastify/cors`, `@fastify/compress`, and `@fastify/swagger` + `@fastify/swagger-ui`

## Machine Learning Pipeline (Python)
*   **Runtime Environment**: Python (Target: 3.14.6 with `uv` package manager)
*   **Core Model**: CatBoost >= 1.2.10 (Gradient boosting direction classifier)
*   **Data Processing**: Pandas >= 3.0.3, NumPy >= 1.26.0, scikit-learn >= 1.9.0, Joblib >= 1.5.3, PyArrow >= 25.0.0
*   **Feature Engineering**: pandas-ta-classic >= 0.6.52 (28 TA indicators — single source of truth for pipeline computations)
*   **Online Learning**: River (Online learning layer + concept drift detection via ADWIN)

## Storage & Data Lake
*   **Production Store**: Google Cloud BigQuery (Raw klines, composite signals, news sentiment, and model registries)
*   **Local/Fallback Store**: SQLite (`node:sqlite` in WAL mode, used when BigQuery is unavailable or for local development)

## AI Integration
*   **LLM Providers (Dual-Path)**:
    *   **Production**: Google Vertex AI Gemini 3.1 Pro (via `@google-cloud/vertexai`) for narrative prediction and market analysis reasoning.
    *   **Local Development & Testing**: Local/custom OpenAI-compatible models integrated via `@ai-sdk/openai-compatible` and `ai` (Vercel AI SDK v7+) in `src/analysis/openai-compatible.ts`. Driven by environment variables (`RADAR__AI_BASE_URL`, `RADAR__AI_API_KEY`, `RADAR__AI_MODEL` / `RADAR__AI_MODEL_ID`).
*   See [Migration Plan §4](../docs/cloud-migration-plan.md) for the planned unified provider abstraction and BigQuery Remote Model integration.

## Cloud Infrastructure (Migration Target)
*   **Containerization**: Docker — current image is `node:22-bookworm-slim`; see [Migration Plan §2.2](../docs/cloud-migration-plan.md) for migration target images.
*   **Hosting**: Google Cloud Run (Stateless services)
*   **Scheduling**: Google Cloud Scheduler (Hourly triggers for scans via `POST /api/cron/scan`)
*   See [Migration Plan §3](../docs/cloud-migration-plan.md) for planned Pub/Sub topics, Cloud Tasks queues, Terraform IaC, and new handler modules.
*   See [Migration Plan §9](../docs/cloud-migration-plan.md) for Secret Manager integration.

## Tooling & Testing
*   **Test Runner**: Vitest >= 4.1.10
*   **Code Quality**: ESLint >= 10.7.0, Prettier >= 3.9.5, Husky >= 9.1.7, mypy (strict), and ruff (for Python check)
*   **Health Check**: `npm run doctor` — verifies Node, TypeScript, Python, env, and test status
