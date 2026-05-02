---
name: feature-development-with-tests-and-schema
description: Workflow command scaffold for feature-development-with-tests-and-schema in meta-ads.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-with-tests-and-schema

Use this workflow when working on **feature-development-with-tests-and-schema** in `meta-ads`.

## Goal

Implements a new feature or major enhancement, including backend logic, shared types, database schema/migrations, and comprehensive test coverage.

## Common Files

- `worker/migrations/*.sql`
- `worker/src/*.ts`
- `worker/src/types.ts`
- `frontend/src/types.ts`
- `frontend/src/components/*.tsx`
- `worker/test/*.spec.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update or add SQL migration files for schema changes
- Modify backend logic or API handlers
- Update shared type definitions (frontend/src/types.ts, worker/src/types.ts)
- Update or add frontend components if needed
- Update package files if dependencies or scripts change

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.