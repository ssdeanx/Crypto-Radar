# Oh-My-Antigravity Command Reference Guide

This reference sheet outlines the complete command set of the Oh-My-Antigravity (OmA) framework (also referred to as Hermes). Use this map to select the correct orchestration tool for your task.

---

## 1. Project Onboarding & Preflights

| Command | Purpose | When to Use | How to Use |
| :--- | :--- | :--- | :--- |
| `/oma:deep-init` | Builds a deep project map and validation baseline. | At the start of a session or when onboarding into unfamiliar code. | Run at session kickoff. |
| `/oma:doctor` | Diagnoses extension, team, workspace, and hook status. | Before launching autonomous runs or when setup is broken. | Use `/oma:doctor team` for full diagnostic review. |
| `/oma:workspace` | Manages active workspace lanes and paths in `workspace.json`. | Before parallel implementation or multi-root work. | Use `/oma:workspace audit` to verify lane cleanliness. |

---

## 2. Requirement Discovery & Design

| Command | Purpose | When to Use | How to Use |
| :--- | :--- | :--- | :--- |
| `/oma:blueprint` | Defines UI states, product flow, content hierarchy, and verification hooks. | Before planning or coding user-facing layouts. | Run to lock down product decisions. |
| `/oma:team-prd` | Establishes measurable acceptance criteria and boundaries. | After initial planning, before writing any code. | Converts requirements into a functional contract. |
| `/oma:interview` | Launches requirement discovery interviews. | When requirements from the user are vague or contradictory. | Tracks active interview state in `.omg/state/interviews/`. |

---

## 3. Planning & Scheduling

| Command | Purpose | When to Use | How to Use |
| :--- | :--- | :--- | :--- |
| `/oma:team-plan` | Builds a dependency-aware execution plan. | After PRD is locked, before coding. | Generates milestones and risk matrices. |
| `/oma:reasoning` | Sets global reasoning effort (low/medium/high/xhigh). | Before starting expensive planning or review loops. | Optimizes depth-of-thought per teammate. |

---

## 4. Execution & Orchestration

| Command | Purpose | When to Use | How to Use |
| :--- | :--- | :--- | :--- |
| `/oma:team-exec` | Implements the highest priority ready slice of a plan. | Main coding phase. | Handed off to specialized executor subagents. |
| `/oma:goal` | Runs goal-driven autonomous loops with pre-approved routine tasks. | When you want hands-off delivery to a specific endpoint. | Run `/oma:goal "Task description"`. |
| `/oma:team` | Executes the entire pipeline sequentially (plan -> prd -> board -> exec -> verify -> fix). | For complex feature or refactor delivery. | Orchestrated by a lead director agent. |
| `/oma:ultragoal` | Runs checkpointed, durable multi-goal workflows. | When decomposing massive requirements that span restarts. | Checkpoints are saved natively in the repository. |

---

## 5. Verification, Quality & Debugging

| Command | Purpose | When to Use | How to Use |
| :--- | :--- | :--- | :--- |
| `/oma:team-verify` | Validates code changes against acceptance criteria and anti-slop rules. | Immediately after an execution slice. | Generates a priority-ordered fix backlog if it fails. |
| `/oma:team-fix` | Patches only verified failures. | When `/oma:team-verify` fails. | Target specifically the failed assertions. |
| `/oma:loop` | Forces repeated exec -> verify -> fix cycles. | Mid/late delivery when findings remain. | Prevents escaping verification gates. |
| `/oma:ralph` | Enforces strict, stage-gated orchestration with rollback points. | On release-critical or production-facing code. | Mandates planning review and zero-warning verification. |

---

## 6. State Tracking, Checkpoints & Recovery

| Command | Purpose | When to Use | How to Use |
| :--- | :--- | :--- | :--- |
| `/oma:status` | Summarizes progress, risks, and next steps. | At the start/end of a work session. | Check status dashboard. |
| `/oma:taskboard` | Manages a compact task ledger (todo, ready, in-progress, blocked, done, verified). | Throughout implementation and verification cycles. | Use `/oma:taskboard next` to pull the next task. |
| `/oma:checkpoint` | Saves a compact session state and resume hints. | Before context swaps or handoffs. | Saves to `.omg/state/checkpoint.md`. |
| `/oma:recall` | Performs state-first semantic searches of past decisions. | When you need prior rationale without replaying raw history. | Run `/oma:recall "query" scope=state`. |
| `/oma:stop` | Gracefully stops autonomous execution. | When an interruption occurs or a manual change is needed. | Preserves active progress state. |
| `/oma:cancel` | Stops execution safely and generates a resume handoff. | To halt the team pipeline. | Prepares session for resumption. |
