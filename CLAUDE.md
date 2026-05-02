# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

This repository has a root `package.json` for shared tooling plus two app packages:

- `frontend/` — Vite + React + TypeScript dashboard.
- `worker/` — Cloudflare Workers TypeScript backend.
- `docs/` — API, operations, security, ADR, and agent workflow docs.
- `plans/` — implementation plan documents for the Meta Ads Automation System.

Run app commands from the relevant subdirectory. The root package currently has no app scripts.

## Backend architecture

Cloudflare Worker entrypoint: `worker/src/index.ts`.

The default export implements both Worker surfaces:

- `scheduled()` runs the automation every 30 minutes, configured in `worker/wrangler.jsonc` as `*/30 * * * *`.
- `fetch()` serves JSON API routes under `/api/*`, applies auth/origin checks, and applies CORS.

Key backend files:

- `worker/src/index.ts` wires scheduled execution, config loading, auth/origin guards, action logging, D1 audit persistence, and API routes.
- `worker/src/auto-rule-engine.ts` evaluates campaign spend/purchase rules and executes dry-run/live pause/resume decisions.
- `worker/src/meta-api-client.ts` wraps Meta Graph API v21.0 ad account, campaign, insight, pause, and resume calls.
- `worker/src/api-handlers.ts` implements HTTP handlers for ad accounts, campaigns, insights, config, logs, and health.
- `worker/src/router.ts` is a small regex path router for `GET` and `PUT` routes.
- `worker/src/cors.ts` derives CORS headers from request origin and `FRONTEND_URL`.
- `worker/src/types.ts` defines shared Worker env/config/action/audit/API types and `RULE_CONFIG_DEFAULTS`.
- `worker/migrations/0001_audit_schema.sql` defines D1 audit tables.

Backend data/config flow:

- Required env bindings: `META_ACCESS_TOKEN`, `META_ACCOUNT_ID`, `CONFIG_KV`, `AUDIT_DB`.
- `FRONTEND_URL` is configured in `wrangler.jsonc` for deployed dashboard CORS and config mutation origin checks.
- Optional env: `API_AUTH_TOKEN` for bearer API access and `ALLOW_LOCAL_DEV=true` for localhost bypass.
- Rule config is stored in account-scoped KV key `RULE_CONFIG::<accountId>`.
- Rule logs are stored in account-scoped KV key `RULE_LOGS::<accountId>` and capped to the latest 1000 entries.
- Scheduled-run overlap is guarded by KV key `AUTOMATION_RUN_LOCK`.
- D1 stores `config_versions`, `automation_runs`, `campaign_states`, and `action_logs`.
- API campaign/config/log routes require `accountId` query parameter and normalize optional `act_` prefix.

Default rule config comes from `RULE_CONFIG_DEFAULTS` in `worker/src/types.ts`:

- `enabled: true`
- `dryRun: true`
- `pauseThreshold: 170000`
- `pauseThreshold2: 200000`
- `resumeThreshold: 150000`
- `cooldownHours: 24`
- `maxActionsPerRun: 0`
- `maxActionsPerDay: 0`
- `allowlistCampaignIds: []`
- `excludeCampaignIds: []`
- `emergencyStop: false`
- arming starts as `not_armed`

Rule behavior in current code:

- Purchase evidence is strict `omni_purchase`; missing required purchase evidence returns `UNKNOWN_DATA` instead of assuming zero.
- Dry-run mode logs `WOULD_PAUSE` / `WOULD_RESUME` without mutating Meta campaigns.
- Pause an `ACTIVE` campaign when today's spend is above `pauseThreshold` and both today and trailing 3-day `omni_purchase` counts are `0`.
- Pause an `ACTIVE` campaign when today's spend is above `pauseThreshold2` and both today and trailing 3-day `omni_purchase` counts are fewer than `2`.
- Resume a `PAUSED` campaign when today's spend is below `resumeThreshold` and today's `omni_purchase` count is greater than `0`.
- Live mode is blocked by arming requirements, emergency stop, allowlist/caps, and resume provenance checks.

API routes registered in `worker/src/index.ts`:

| Method | Path | Handler |
| --- | --- | --- |
| `GET` | `/api/ad-accounts` | list Meta ad accounts visible to the token |
| `GET` | `/api/campaigns?accountId=...` | list campaigns enriched with insights, decisions, blockers, warnings, and errors |
| `GET` | `/api/campaigns/:id/insights` | get raw insight payload for one campaign |
| `GET` | `/api/config?accountId=...` | read normalized account-scoped rule config |
| `PUT` | `/api/config?accountId=...` | validate, version, gate, persist, and audit rule config |
| `GET` | `/api/logs?accountId=...` | read account-scoped action logs from KV |
| `GET` | `/api/health` | validate Meta token through Graph API `/me` |

## Frontend architecture

Frontend entrypoint: `frontend/src/main.tsx`; `frontend/src/App.tsx` renders `Dashboard` directly.

Key frontend files:

- `frontend/src/components/Dashboard.tsx` owns ad account selection, dashboard state, polling, config editing, sorting, and campaign table rendering.
- `frontend/src/lib/api.ts` defines `apiFetch()` and resolves API base from `VITE_API_URL` or `http://localhost:8787`.
- `frontend/src/types.ts` defines dashboard-facing ad account, rule, action, insight, decision, and campaign types.
- `frontend/src/components/ui/*` contains shadcn-style UI primitives.
- `frontend/src/lib/utils.ts` supports UI utility composition.

Frontend behavior:

- On mount, dashboard calls `/api/ad-accounts` and `/api/health` in parallel.
- Dashboard requires account selection before loading `/api/campaigns`, `/api/config`, and `/api/logs` with `accountId`.
- Dashboard refreshes selected-account data every 60 seconds.
- Rule changes are saved with `PUT /api/config?accountId=...`.
- UI uses the `@/*` alias configured in both `vite.config.ts` and `tsconfig*.json`.
- shadcn metadata lives in `frontend/components.json`; Tailwind config is `frontend/tailwind.config.js`.

## Current codebase notes

These are existing repository facts worth checking before frontend or live-rollout work:

- `Dashboard.tsx` still computes action hints locally for display; future UI work should render backend decision/evidence/blocker fields directly.
- The Worker can accept bearer auth, but the current frontend does not send bearer tokens and CORS does not allow the `Authorization` header yet.
- Full browser QA is still needed for account selection, auth failure, config save, version conflict, blocked live mode, unknown data, and responsive states.
- Full cooldown and action-cap enforcement should be verified before live mode.

## Documentation

- Root context: `CONTEXT.md`.
- Project overview: `README.md`.
- Architecture: `ARCHITECTURE.md`.
- Contributor workflow: `CONTRIBUTING.md`.
- API reference: `docs/API.md`.
- Operations runbook: `docs/OPERATIONS.md`.
- Security posture: `docs/SECURITY.md`.
- ADRs: `docs/adr/`.

## Planning docs

Primary plan: `plans/260501-1630-meta-ads-automation/plan.md`.

Important plan facts:

- Intended architecture is Vercel-hosted Vite/React frontend plus Cloudflare Workers backend.
- Backend safety sprint work added auth/origin guards, dry-run/live state, D1 audit schema, strict `omni_purchase`, run locks, provenance checks, and worker tests.
- Frontend and deployed Cloudflare/Vercel validation still need browser and environment verification before production use.


## GBrain Configuration (configured by /setup-gbrain)
- Engine: postgres
- Config file: ~/.gbrain/config.json (mode 0600)
- Setup date: 2026-05-02
- MCP registered: yes
- Memory sync: artifacts-only
- Current repo policy: read-write

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **meta-ads** (594 symbols, 1132 relationships, 49 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/meta-ads/context` | Codebase overview, check index freshness |
| `gitnexus://repo/meta-ads/clusters` | All functional areas |
| `gitnexus://repo/meta-ads/processes` | All execution flows |
| `gitnexus://repo/meta-ads/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
