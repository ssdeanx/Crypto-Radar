# Implementation Plan: End-to-End Cloud Migration & Prediction Pipeline

## Phase 1: Stateless Foundation & Guards (TDD)
- [x] Task: Write tests for isCloudMode() and filesystem guards
  - [x] Add tests in `src/core/config.test.ts` for environment detection.
  - [x] Add tests verifying file write guards in `src/radar.ts` and `src/daemon.ts`.
- [x] Task: Implement isCloudMode() and filesystem guards
  - [x] Implement `isCloudMode()` in `src/core/config.ts`.
  - [x] Update `src/radar.ts` and `src/daemon.ts` to disable logs, state writes, lock files, and PID management in cloud mode.
- [x] Task: Write integration tests for stateless server
  - [x] Create tests verifying Fastify server initialization and route routing without starting daemon schedules.
- [x] Task: Create Fastify server entrypoint (`src/server.ts`)
  - [x] Create server starting fastify, executing `migrate()`, and listening on port 8080.
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 2: Messaging Decoupling & Queue Fallback (TDD)
- [x] Task: Write tests for Pub/Sub publishing and local queue fallback
  - [x] Create tests asserting Pub/Sub client is called with standard payload during scan archiving.
  - [x] Create tests verifying in-process queue dispatch and execution routing.
- [x] Task: Implement local queue fallback (`src/core/queue.ts`)
  - [x] Create in-memory queue wrapper running handlers via `setImmediate` for development execution.
- [x] Task: Integrate Pub/Sub publishing
  - [x] Install `@google-cloud/pubsub`.
  - [x] Update `Store.persistRun()` in `src/store/db.ts` to publish `scan.complete` events.
- [x] Task: Implement Cloud Task routing & handlers
  - [x] Create Fastify task endpoints: `/api/tasks/gemini-analyze`, `/api/tasks/paper-trade`, and `/api/tasks/model-retrain`.
  - [x] Move execution paths from daemon handlers to task routes.
- [x] Task: Define Terraform main.tf configurations
  - [x] Create `infra/main.tf` declaring Pub/Sub topics and Cloud Tasks queues.
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 3: LLM Provider Integration (TDD)
- [x] Task: Write tests for LLM provider routing and parsing
  - [x] Create tests asserting routing to OpenAI-compatible provider when environment variables are set.
  - [x] Create tests for response parsing of direction and confidence.
- [x] Task: Implement LLM client provider router (`src/core/llm-provider.ts`)
  - [x] Create router integrating `openai-compatible.ts` and Vertex AI `gemini.ts`.
  - [x] Integrate router into the automated prediction scan pipeline (`src/api/fastify/routes/cron.ts`) to enrich predictions with reasoning.
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 4: Database Schema and Feedback Loop (TDD)
- [x] Task: Write tests for token_traces table and backfill updates
  - [x] Create tests verifying `token_traces` insertion and 24h outcome evaluation updates.
- [x] Task: Update database schemas for token_traces
  - [x] Add `token_traces` definition and increment schema version in `src/store/schema.ts`.
  - [x] Add BQ schema for `token_traces` in `src/store/db.ts`.
  - [x] Update BQ `predictions` schema to add outcome columns.
  - [x] Update `upsertPrediction` and create `persistTrace`/`updateTrace` methods.
- [x] Task: Implement 24h outcome backfilling
  - [x] Add scheduler/query logic to compare observed prices vs 24h outcomes and backfill trace columns.
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 5: Containerization & Evaluation Setup
- [x] Task: Update Dockerfile and deploy.sh
  - [x] Overwrite `Dockerfile` to a multi-stage `node:22-alpine` server build.
  - [x] Overwrite `deploy.sh` to remove hardcoded secrets and leverage Google Secret Manager.
- [x] Task: Create Evaluation SQL Query templates
  - [x] Create `infra/evaluation-queries.sql` documenting win rates, confusion matrices, and A/B prompt models.
- [x] Task: Verify entire local build and validation pipeline
  - [x] Perform a clean local docker build, verify health endpoints locally, and run `npm run validate`.
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 6: Verification & Handoff
- [x] Task: Run full pre-commit validation checks
  - [x] Run `npm run validate` to ensure all tests pass and linters succeed.
- [x] Task: Update Changelog
  - [x] Add version v2.1.0 changes to `CHANGELOG.md`.
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)
