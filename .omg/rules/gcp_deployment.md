---
description: Constraints and instructions for GCP deployment and PostgreSQL database setup
globs: gcp/*, Dockerfile
alwaysApply: true
---

# GCP Deployment Rules

## 1. File Constraints
*   **Do NOT create package.json or Dockerfile inside gcp/**. There must only be one `package.json` and one `Dockerfile` in the entire project workspace (at the root).
*   **GCP folder scope**: Keep all production integration TypeScript code strictly inside the `gcp/` folder (`gcp/server.ts`, `gcp/postgres-store.ts`). Do not modify files in `src/` to prevent breaking the local SQLite development pipeline.

## 2. Dockerfile Configuration
*   **Existing Dockerfile**: Update the existing root `Dockerfile` to configure the multi-stage build.
*   **Python Setup**: Use `uv` to build the Python virtual environment containing the dependencies from `ml/requirements.txt` and copy it into the final slim runtime image.
