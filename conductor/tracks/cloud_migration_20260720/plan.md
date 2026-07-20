# Implementation Plan: End-to-End Cloud Migration & Prediction Pipeline

## Phase 1: Stateless Foundation & Guards (TDD)
- [ ] Task: Write tests for isCloudMode() and filesystem guards
  - [ ] Add tests in `tests/core/config.test.ts` for environment detection.
  - [ ] Add tests verifying file write guards in `src/radar.ts` and `src/daemon.ts`.
- [ ] Task: Implement isCloudMode() and filesystem guards
  - [ ] Implement `isCloudMode()` in `src/core/config.ts`.
  - [ ] Update `src/radar.ts` and `src/daemon.ts` to disable logs, state writes, lock files, and PID management in cloud mode.
- [ ] Task: Write integration tests for stateless server
  - [ ] Create tests verifying Fastify server initialization and route routing without starting daemon schedules.
- [ ] Task: Create Fastify server entrypoint (`src/server.ts`)
  - [ ] Create server starting fastify, executing `migrate()`, and listening on port 8080.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 2: Messaging Decoupling & Queue Fallback (TDD)
- [ ] Task: Write tests for Pub/Sub publishing and local queue fallback
  - [ ] Create tests asserting Pub/Sub client is called with standard payload during scan archiving.
  - [ ] Create tests verifying in-process queue dispatch and execution routing.
- [ ] Task: Implement local queue fallback (`src/core/queue.ts`)
  - [ ] Create in-memory queue wrapper running handlers via `setImmediate` for development execution.
- [ ] Task: Integrate Pub/Sub publishing
  - [ ] Install `@google-cloud/pubsub`.
  - [ ] Update `Store.persistRun()` in `src/store/db.ts` to publish `scan.complete` events.
- [ ] Task: Implement Cloud Task routing & handlers
  - [ ] Create Fastify task endpoints: `/api/tasks/gemini-analyze`, `/api/tasks/paper-trade`, and `/api/tasks/model-retrain`.
  - [ ] Move execution paths from daemon handlers to task routes.
- [ ] Task: Define Terraform main.tf configurations
  - [ ] Create `infra/main.tf` declaring Pub/Sub topics and Cloud Tasks queues.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 3: LLM Provider Integration (TDD)
- [ ] Task: Write tests for LLM provider routing and parsing
  - [ ] Create tests asserting routing to OpenAI-compatible provider when environment variables are set.
  - [ ] Create tests for response parsing of direction and confidence.
- [ ] Task: Implement LLM client provider router (`src/core/llm-provider.ts`)
  - [ ] Create router integrating `openai-compatible.ts` and Vertex AI `gemini.ts`.
  - [ ] Integrate router into the automated prediction scan pipeline (`src/api/fastify/routes/cron.ts`) to enrich predictions with reasoning.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 4: Database Schema and Feedback Loop (TDD)
- [ ] Task: Write tests for token_traces table and backfill updates
  - [ ] Create tests verifying `token_traces` insertion and 24h outcome evaluation updates.
- [ ] Task: Update database schemas for token_traces
  - [ ] Add `token_traces` definition and increment schema version in `src/store/schema.ts`.
  - [ ] Add BQ schema for `token_traces` in `src/store/db.ts`.
  - [ ] Update BQ `predictions` schema to add outcome columns.
  - [ ] Update `upsertPrediction` and create `persistTrace`/`updateTrace` methods.
- [ ] Task: Implement 24h outcome backfilling
  - [ ] Add scheduler/query logic to compare observed prices vs 24h outcomes and backfill trace columns.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 5: Containerization & Evaluation Setup
- [ ] Task: Update Dockerfile and deploy.sh
  - [ ] Overwrite `Dockerfile` to a multi-stage `node:22-alpine` server build.
  - [ ] Overwrite `deploy.sh` to remove hardcoded secrets and leverage Google Secret Manager.
- [ ] Task: Create Evaluation SQL Query templates
  - [ ] Create `infra/evaluation-queries.sql` documenting win rates, confusion matrices, and A/B prompt models.
- [ ] Task: Verify entire local build and validation pipeline
  - [ ] Perform a clean local docker build, verify health endpoints locally, and run `npm run validate`.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 6: Verification & Handoff
- [ ] Task: Run full pre-commit validation checks
  - [ ] Run `npm run validate` to ensure all tests pass and linters succeed.
- [ ] Task: Update Changelog
  - [ ] Add version v2.1.0 changes to `CHANGELOG.md`.
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
