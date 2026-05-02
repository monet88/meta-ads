# CONTEXT.md

## Product context

Meta Ads Automation is a dashboard and automation worker for monitoring Meta ad campaigns and applying simple spend/purchase guardrails.

The system is intended to help an operator:

- See current campaign status and today's spend/purchase signals.
- Configure pause/resume thresholds without redeploying code.
- Let a scheduled Worker pause overspending campaigns with no purchases.
- Resume paused campaigns when spend is below the resume threshold and purchases are present.
- Review automation actions through a KV-backed log.

## Repository shape

This repo has a root `package.json` for shared tooling, plus two app packages:

- `frontend/` — Vite, React, TypeScript dashboard.
- `worker/` — Cloudflare Workers TypeScript backend.
- `docs/` — API, operations, security, ADR, and agent workflow docs.
- `plans/` — implementation planning documents.

Run app commands from the relevant subdirectory.

## Runtime architecture

The frontend is a Vercel-targeted Vite app that calls the Worker JSON API under `/api/*`.

The Worker has two surfaces:

- `fetch()` handles API routes and CORS.
- `scheduled()` runs the automation cron every 30 minutes.

The Worker talks to:

- Meta Graph API for campaigns, insights, token health, pause, and resume actions.
- Cloudflare KV for account-scoped rule configuration, recent automation logs, and run locks.
- Cloudflare D1 for config versions, automation runs, campaign states, and action logs.

## Backend source of truth

Worker entrypoint: `worker/src/index.ts`.

Important backend modules:

- `worker/src/api-handlers.ts` — HTTP handlers for ad accounts, campaigns, insights, config, logs, and health.
- `worker/src/auto-rule-engine.ts` — scheduled rule evaluation and pause/resume decisions.
- `worker/src/meta-api-client.ts` — Meta Graph API wrapper.
- `worker/src/router.ts` — route matching for `GET` and `PUT` routes.
- `worker/src/cors.ts` — CORS header derivation from `FRONTEND_URL`.
- `worker/src/types.ts` — shared Worker types.

Required bindings and environment:

- `META_ACCESS_TOKEN`
- `META_ACCOUNT_ID`
- `CONFIG_KV`
- `AUDIT_DB`
- `FRONTEND_URL`

Optional env/bindings:

- `API_AUTH_TOKEN`
- `ALLOW_LOCAL_DEV`

KV keys:

- `RULE_CONFIG::<accountId>` — stores account-scoped threshold and safety configuration.
- `RULE_LOGS::<accountId>` — stores recent account-scoped automation action logs, capped to the latest 1000 entries.
- `AUTOMATION_RUN_LOCK` — prevents overlapping scheduled automation runs.

Default rule configuration:

- `pauseThreshold: 170000`
- `pauseThreshold2: 200000`
- `resumeThreshold: 150000`
- `enabled: true`
- `dryRun: true`
- `cooldownHours: 24`
- `maxActionsPerRun: 0`
- `maxActionsPerDay: 0`
- `emergencyStop: false`
- arming starts as `not_armed` with account confirmation and recent dry-run review required before live mode.

Current rule behavior:

- Treat `omni_purchase` as the only purchase metric for trusted automation decisions.
- Return `UNKNOWN_DATA` instead of assuming zero purchases when required `omni_purchase` evidence is missing.
- In dry-run mode, log `WOULD_PAUSE` / `WOULD_RESUME` decisions without mutating Meta campaigns.
- Pause an `ACTIVE` campaign when today's spend is above `pauseThreshold` and both today's and trailing 3-day `omni_purchase` counts are `0`.
- Pause an `ACTIVE` campaign when today's spend is above `pauseThreshold2` and both today's and trailing 3-day `omni_purchase` counts are fewer than `2`.
- Resume a `PAUSED` campaign when today's spend is below `resumeThreshold` and today's `omni_purchase` count is greater than `0`.
- Block live mode unless arming requirements pass, and block live resume unless D1 provenance shows the campaign was paused by this tool.

## Frontend source of truth

Frontend entrypoint: `frontend/src/main.tsx`.

Important frontend modules:

- `frontend/src/App.tsx` — renders the dashboard.
- `frontend/src/components/Dashboard.tsx` — owns account selection, dashboard state, polling, config editing, and campaign table rendering.
- `frontend/src/lib/api.ts` — API client and base URL resolution.
- `frontend/src/types.ts` — dashboard-facing types.
- `frontend/src/components/ui/*` — UI primitives.

Frontend behavior:

- On mount, loads ad accounts and health in parallel.
- Requires an account selection before loading campaigns, config, and logs.
- Refreshes selected-account data every 60 seconds.
- Saves threshold changes with `PUT /api/config?accountId=...`.
- Uses `VITE_API_URL` when present, otherwise defaults to `http://localhost:8787`.

## API surface

Registered Worker routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/ad-accounts` | List Meta ad accounts visible to the configured token. |
| `GET` | `/api/campaigns?accountId=...` | List campaigns enriched with insights, decisions, blockers, warnings, and errors. |
| `GET` | `/api/campaigns/:id/insights` | Return raw insight payload for one campaign. |
| `GET` | `/api/config?accountId=...` | Read normalized account-scoped rule configuration. |
| `PUT` | `/api/config?accountId=...` | Validate, version, gate, persist, and audit account-scoped rule configuration. |
| `GET` | `/api/logs?accountId=...` | Read account-scoped action logs from KV. |
| `GET` | `/api/health` | Validate Meta token through Graph API `/me`. |

## Data semantics

Campaigns are fetched from the account campaigns endpoint. Dashboard API routes use the selected `accountId`; scheduled automation uses `META_ACCOUNT_ID`.

Insights include spend and Meta action counts. Trusted automation decisions require `omni_purchase` evidence for today and, for pause decisions, the trailing 3-day evidence window.

Purchase counting should avoid duplicate counting across Meta action types. Current code treats `omni_purchase` as the only purchase metric and fails closed when it is missing.

Amounts are threshold-like values used by the rule engine and UI. Keep frontend display formatting separate from backend rule comparisons.

## Operational expectations

- Worker cron should remain every 30 minutes unless a plan or issue explicitly changes it.
- Config changes should be persisted in account-scoped KV and audited in D1, not hardcoded into frontend state.
- CORS should be driven by `FRONTEND_URL` for deployed environments.
- Keep deployed `/api/*` behind Cloudflare Access or a verified bearer-token flow.
- Keep live automation in dry-run until arming blockers are cleared and recent dry-run evidence is reviewed.
- Automation logs should preserve enough detail for an operator to understand what action was taken and why.

## Current project status

The branch now includes account-scoped dashboard/API work, strict `omni_purchase` handling, dry-run/live gate fields, D1 audit schema, and worker tests. Frontend browser QA and deployed Cloudflare/Vercel validation remain areas to verify before treating the system as production-ready.

Known areas to check before frontend or rollout work:

- Render backend decision/evidence/blocker fields directly instead of local action hints.
- Verify frontend auth behavior for deployed API access.
- Verify browser states for account selection, config save, version conflict, blocked live mode, unknown data, and auth failure.
- Verify full cooldown/action-cap enforcement before live mode.

## Working conventions

- Keep backend and frontend commands scoped to their subdirectories.
- Prefer small, issue-sized vertical slices.
- Use GitHub Issues for tracking and the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- Store future durable architectural decisions in `docs/adr/`.
- Do not commit, push, create PRs, or deploy without an explicit request.
