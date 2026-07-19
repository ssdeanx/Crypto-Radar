# Ultragoal Brief: Production-Readiness Scaffolding for GCP (100% Isolated Strategy)

## Objective
Build out PostgreSQL storage and Cloud Run production readiness configs inside a completely separate `gcp/` directory, leaving 100% of your existing local files (code, package.json, scripts) completely untouched.

## Key Requirements & Boundaries
1. **Zero Modifications to Local Files**: Do not edit *any* files in `src/`, `scripts/`, `package.json`, or `tsconfig.json`. Keep the local development pipeline completely unchanged.
2. **Standalone Production Folder**: Build all PostgreSQL storage drivers, authentication hook wrappers, and container configurations inside a new standalone `gcp/` folder (e.g., `gcp/postgres-store.ts`, `gcp/server.ts`, `gcp/package.json`, `gcp/Dockerfile`).
3. **Separate package.json**: To prevent modifying the local `package.json`, we will define a separate `gcp/package.json` that contains the production-only dependencies (like `pg` for Postgres). This dependency will only be resolved during the container build process, keeping your local dev directory completely free of database client libraries.
4. **Retain ML subprocess**: Keep the current subprocess architecture for predictions. In production, the `gcp/Dockerfile` will package Python to support the subprocess without adding Node-level npm modules.

## Constraints
* The local SQLite database, CLI commands, and test suites must continue to run exactly as they do today.
