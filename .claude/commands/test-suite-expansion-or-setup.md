---
name: test-suite-expansion-or-setup
description: Workflow command scaffold for test-suite-expansion-or-setup in meta-ads.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /test-suite-expansion-or-setup

Use this workflow when working on **test-suite-expansion-or-setup** in `meta-ads`.

## Goal

Adds new test files, scaffolding, or configuration to expand or improve the automated test suite.

## Common Files

- `worker/test/*.ts`
- `worker/test/tsconfig.json`
- `worker/vitest.config.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add new test files under worker/test/
- Edit or add test setup/configuration files (e.g., setup.ts, tsconfig.json, vitest.config.ts)
- Update or add test cases for new or changed logic

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.