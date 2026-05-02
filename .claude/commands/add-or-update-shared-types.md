---
name: add-or-update-shared-types
description: Workflow command scaffold for add-or-update-shared-types in meta-ads.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-or-update-shared-types

Use this workflow when working on **add-or-update-shared-types** in `meta-ads`.

## Goal

Synchronizes or updates shared TypeScript type definitions between frontend and backend to support new features or fixes.

## Common Files

- `frontend/src/types.ts`
- `worker/src/types.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit frontend/src/types.ts
- Edit worker/src/types.ts
- Update related implementation files to use new or changed types

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.