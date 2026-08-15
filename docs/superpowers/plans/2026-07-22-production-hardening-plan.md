# Production Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan dispatches 4 independent workstreams in parallel via `delegate_task`. No sub-skills needed per stream — each is self-contained.
>
> **Goal:** Close 4 production-readiness gaps in the Crypto Radar backend daemon.
>
> **Architecture:** 4 independent parallel workstreams with zero file overlap. Each stream produces its own testable deliverable. Parent verifies all after merge.
>
> **Tech Stack:** TypeScript 7.0.2, Fastify v5, Zod v4, Node 22+, oxlint v1.75.0, Vitest v4

## Global Constraints

- No changes to files outside the specified scope per stream
- No destructive git operations
- All existing tests must continue to pass
- Build must pass with 0 errors after all changes
- No WebSocket code (architectural ban)

---

### Dispatch Model

```
                    ┌─────────────────────────────┐
                    │   Parent: verify & merge      │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     Stream 1          Stream 2          Stream 3     Stream 4
   Build Integrity   API Zod Schemas   Write Locks   ML Tests
   (subagent 1)      (subagent 2)     (subagent 3)  (subagent 4)
```

All 4 dispatched together via `delegate_task(tasks=[...])`. Each subagent works independently, returns a summary. Parent runs full build+test+lint after all return.

Full design details in `docs/superpowers/specs/2026-07-22-production-hardening-design.md`.
