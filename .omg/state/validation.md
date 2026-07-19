# Validation and Verification Guide

This document records the exact validation commands, environment settings, and constraints required to compile, test, and run the Hermes Crypto Radar project safely.

---

## 1. Environment Prerequisites

- **Node.js**: Version 22.0.0 or higher.
- **Python**: Version 3.14 (required for the ML Python pipeline).
- **uv**: Package manager for installing Python libraries rapidly.
- **SQLite**: Local SQL engine (supported natively in Node.js).

---

## 2. Compilation and Build Commands

Before running integration tests or executing the CLI, compile the TypeScript source:

```bash
# Clean previous builds and run typescript compilation
npm run build
```

---

## 3. Testing Commands

```bash
# Run all unit and integration tests (Vitest)
npm run test

# Run tests with HTML/LCOV code coverage reports
npm run test:coverage
```

### Known Vitest Test Failure Check

- **CLI Integration Test Failures**:
  - `src/cli.integration.test.ts` runs compiled code in a separate child process.
  - This child process fails to write files because it defaults to write logs into `/data/crypto-radar` (which requires root access to create/write).
  - To prevent failures, integration tests should run on systems with standard path access or with environment variables initialized.

---

## 4. Run / Execution Commands

To execute a local scan manually, override the default `/data` path with `RADAR__DATA_DIR`:

```bash
# Run a quick 3-token json scan pointing logs to local ./data folder
RADAR__DATA_DIR=./data node dist/cli.js scan --dynamic 3 --no-news --no-tech --format json
```

To start the daemon in the background:

```bash
# Start warm REST and WebSocket API
RADAR__DATA_DIR=./data node dist/cli.js daemon start
```

---

## 5. Machine Learning Pipeline Commands

To initialize the ML virtual environment and train models:

```bash
# Setup uv virtual environment (.venv-ml)
npm run setup:ml

# Train the CatBoost classification models
RADAR__ML_PYTHON=.venv-ml/bin/python3 RADAR__DATA_DIR=./data npm run ml:train
```
