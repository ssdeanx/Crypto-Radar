## Strict File Modification Constraints

1. **NEVER use `sed`, `awk`, `perl -pi`, or any other destructive CLI text-processing tools to modify files.**
2. All file modifications (including to markdown artifacts, configuration files, and source code) MUST be done exclusively through the dedicated, non-destructive tools: `replace_file_content`, `multi_replace_file_content`, or `write_to_file`.
3. This rule applies globally to all files in all directories, with absolutely zero exceptions.
4. Do not run commands that redirect output (`>`) into the user's project directory just for the sake of reading it later. Either read the standard output directly, or put temporary outputs strictly in the designated artifact scratch directory (`<appDataDir>/brain/<conversation-id>/scratch/`).

## Git Flow & Branching Conventions

1. This repository uses `git-flow` for branch management:
   - Production releases: `main`
   - Active development: `develop`
   - Feature branches: `feature/<name>`
   - Bugfix branches: `bugfix/<name>`
2. Always create new features or bugfixes using git-flow commands:
   - `git flow feature start <name>`
   - `git flow bugfix start <name>`
3. Never commit or merge directly into `main` or `develop` without running verification checks.

## Strict Verification and Code Standards

1. **No Guessing/Assuming**: When setting up integrations, external API configurations (e.g. OpenAI-compatible endpoints), or libraries, always search online or read the documentation. Do not assume fields or options.
2. **No Error Suppression**: Do not comment out errors or use `any` types to bypass type checker or linter compiler blocks. Fix all errors cleanly.

## TypeScript and Python Indicator Alignment

1. Technical indicators are computed in both TypeScript (`src/indicators.ts`) and Python (`ml/indicators.py`).
2. Formulas (such as averages, volume lookbacks, and range checks) must be identical between both implementations.
3. Both TS and Python components must handle empty inputs, flat arrays, and non-finite numbers (NaN, Infinity, -Infinity) gracefully:
   - Python code must filter out non-finite floats in its `val` output helper to prevent invalid JSON literals.
   - Fallback states and empty lists must return fully populated default dictionaries/objects with null-filled structures rather than `None`/`null` or empty dicts.
4. **Batch Execution Architecture**: To avoid spawning hundreds of separate Python processes (e.g. for 149 tokens), all calculations in execution paths (such as `src/radar.ts`) must use `batchComputeAllIndicators(batches)` to route calculations to `ml/indicators.py` in a single batch, rather than executing individual TS-based indicator helpers iteratively.
5. **Database Strategy Score Mappings**: In `src/store/db.ts`, strategy scores map to database fields using proxy fields: `s.technicalScore` maps to `mean_reversion_score`, and `s.newsScore` maps to `trend_following_score`. Ensure any storage adapter updates align with these conventions unless explicitly refactored.
