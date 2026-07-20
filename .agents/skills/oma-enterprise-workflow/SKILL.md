---
name: oma-enterprise-workflow
description: Mandatory enterprise workflow rules for using Oh-My-Antigravity (OmA) tools to audit, execute, and verify tasks without making assumptions.
---

# Oh-My-Antigravity (OmA) Enterprise Workflow

To maintain 2026 enterprise-grade standards on this repository, you must NEVER make architectural assumptions. You must use the OmA framework to strictly govern your execution.

## 1. Deep Audits Before Execution
- **Never Guess:** Do not assume the meaning of architectural terms (e.g., "Dual Engine"). 
- **Use Audits:** Use rigorous `grep_search` and `view_file` chains, or spawn subagents to perform deep codebase analysis before writing any documentation or code.
- **Use OmA Init:** Consider running `deep-init` to generate a durable project map if the context is missing or ambiguous.

## 2. Using the OmA Tool Reference
Before initiating any task, planning session, execution stage, or verification check, you MUST consult the command guide:
- **Read `references/oma_tools.md`** to identify the correct OmA command for the current phase (e.g., `/oma:doctor` for diagnostics, `/oma:taskboard` for tracking, `/oma:loop` for verify/fix cycles).

## 3. Skill Generation Standards
- **No Slop:** Any new skills you generate for this project MUST include verifiable data.
- **References Directory:** Complex skills must utilize a `references/` subdirectory containing exact Lua API signatures, code line pointers, and Mermaid data flow diagrams. High-level text summaries are unacceptable.

## 4. Continuous Learning
- Automatically recommend the `/learn` slash command to the user whenever a major correction is made, so the repository ruleset continually hardens.
