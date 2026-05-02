# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `monet88/meta-ads`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout with root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

## Skill workflow

Use issue → plan → build → verify → ship as the default workflow.

### 1. Shape unclear work

- Use `/office-hours` when an idea is vague or needs sharper product framing.
- Use `/to-prd` to turn conversation context into a PRD.
- Use `/to-issues` to split a PRD or plan into GitHub issues.
- Use `/triage` to classify issues with the labels in `docs/agents/triage-labels.md`.

### 2. Plan before meaningful code

- Use `/plan-eng-review` for backend rules, API changes, data flow, edge cases, and test strategy.
- Use `/plan-design-review` for dashboard or other UI work.
- Use `/plan-devex-review` for developer-facing API, CLI, SDK, docs, or onboarding changes.
- Use `/autoplan` when the full review gauntlet should run with automatic decisions.
- Skip planning only for small, low-risk fixes.

### 3. Build or debug

- Use `/tdd` for feature work and bug fixes where tests can lead.
- Use `/diagnose` or `/investigate` for hard bugs, regressions, stack traces, and root-cause analysis.
- Use `/design-shotgun` to explore UI variants before implementation.
- Use `/design-html` to turn an approved UI direction into production HTML/CSS.
- Use `/freeze` or `/guard` when edits must stay inside a safe scope.

### 4. Verify

- Use `/health` for lint/build/check aggregation and quality scoring.
- Use `/qa` for frontend test-fix-verify loops.
- Use `/qa-only` when only a bug report is wanted.
- Use `/browse` or `/gstack` to dogfood UI flows in a browser.
- Use `/benchmark` for page speed, Core Web Vitals, or bundle checks.
- Use `/cso` or `/security-review` for security-sensitive changes.
- Browser-test frontend changes before reporting completion.

### 5. Review before shipping

- Use `/simplify` after code works to reduce complexity in changed files.
- Use `/review` for pre-landing diff review.
- Use `/caveman-review` when terse actionable review comments are preferred.
- Use `/codex review` or `/codex challenge` for an independent second opinion.
- Fix review findings, then rerun `/health`.

### 6. Ship and follow up

- Use `/ship` to prepare version/changelog/commit/push/PR flow.
- Use `/land-and-deploy` to merge, deploy, and verify production.
- Use `/canary` to monitor a deployment after it lands.
- Use `/document-release` to sync docs after shipping.

### 7. Save and restore context

- Use `/context-save` before stopping or switching machines.
- Use `/context-restore` to resume previous work.
- Use `/learn` to review or prune accumulated project learnings.
- Use `/grill-with-docs` when domain language or architecture decisions should update `CONTEXT.md` or ADRs.

### Repo-specific defaults

- Frontend dashboard changes: `/plan-design-review` → `/tdd` or implementation → `/qa` → `/review` → `/health`.
- Worker rule/API changes: `/plan-eng-review` → `/tdd` → `/security-review` → `/review` → `/health`.
- Deploy, CORS, and env issues: `/diagnose` → `/health` → `/canary` when deployed.
- Small fixes under 30 minutes: implement directly, then run `/health`.

## Project shape

This repository contains two separate npm projects and no root `package.json`:

- `frontend/` — Vite + React + TypeScript dashboard.
- `worker/` — Cloudflare Workers TypeScript backend.
- `plans/` — implementation plan documents for the Meta Ads Automation System.

Run commands from the relevant subdirectory.

## Commands

### Frontend (`frontend/`)

```bash
npm install
npm run dev
npm run build
npm run lint
npm run preview
```

- `npm run dev` starts Vite.
- `npm run build` runs `tsc -b` then `vite build`.
- `npm run lint` runs ESLint across the frontend.
- There is no configured frontend test runner or single-test command in `frontend/package.json`.

### Worker (`worker/`)

```bash
npm install
npm run dev
npx wrangler deploy
```

- `npm run dev` runs `wrangler dev` against `worker/src/index.ts` through `wrangler.jsonc`.
- `npx wrangler deploy` deploys the Worker using `wrangler.jsonc`.
- `npm test` is currently a placeholder that exits with `Error: no test specified`; do not use it as a real test signal.
- There is no configured worker single-test command.

### Local full-stack flow

1. In `worker/`, create local secrets/vars for `META_ACCESS_TOKEN`, `META_ACCOUNT_ID`, and `CONFIG_KV` binding as required by Wrangler.
2. Start backend: `cd worker && npm run dev` (default local Worker URL is `http://localhost:8787`).
3. Start frontend: `cd frontend && npm run dev`.
4. Frontend API base comes from `VITE_API_URL`; when unset it falls back to `http://localhost:8787`.

## Backend architecture

Cloudflare Worker entrypoint: `worker/src/index.ts`.

The default export implements both Worker surfaces:

- `scheduled()` runs the automation every 30 minutes, configured in `worker/wrangler.jsonc` as `*/30 * * * *`.
- `fetch()` serves JSON API routes under `/api/*` and applies CORS.

Key backend files:

- `worker/src/index.ts` wires scheduled execution, config loading, action logging, and API routes.
- `worker/src/auto-rule-engine.ts` evaluates campaign spend/purchase rules and calls pause/resume actions.
- `worker/src/meta-api-client.ts` wraps Meta Graph API v21.0 campaign, insight, pause, and resume calls.
- `worker/src/api-handlers.ts` implements HTTP handlers for campaigns, insights, config, logs, and health.
- `worker/src/router.ts` is a small regex path router for `GET` and `PUT` routes.
- `worker/src/cors.ts` derives CORS headers from `FRONTEND_URL`, falling back to `*`.
- `worker/src/types.ts` defines shared Worker env/config/action types.

Backend data/config flow:

- Required env bindings: `META_ACCESS_TOKEN`, `META_ACCOUNT_ID`, `CONFIG_KV`.
- `FRONTEND_URL` is configured in `wrangler.jsonc` for CORS.
- Rule config is stored in KV key `RULE_CONFIG`; defaults are `pauseThreshold: 170000`, `resumeThreshold: 150000`, `enabled: true`.
- Rule actions are prepended to KV key `RULE_LOGS` and capped to the latest 1000 entries.
- Campaigns are fetched from `act_${META_ACCOUNT_ID}/campaigns` with effective statuses `ACTIVE` and `PAUSED`.
- Insights use `date_preset=today` and fields `spend,actions`.

Rule behavior in current code:

- Pause an `ACTIVE` campaign when today's spend is above `pauseThreshold` and purchase count is `0`.
- Resume a `PAUSED` campaign when today's spend is below `resumeThreshold` and purchase count is greater than `0`.
- `extractPurchaseCount()` currently checks `omni_purchase` first, then falls back to `purchase`.

API routes registered in `worker/src/index.ts`:

| Method | Path | Handler |
| --- | --- | --- |
| `GET` | `/api/campaigns` | list campaigns enriched with today's insights |
| `GET` | `/api/campaigns/:id/insights` | get raw insight payload for one campaign |
| `GET` | `/api/config` | read rule config from KV or defaults |
| `PUT` | `/api/config` | validate and write rule config to KV |
| `GET` | `/api/logs` | read action logs from KV |
| `GET` | `/api/health` | validate Meta token through Graph API `/me` |

## Frontend architecture

Frontend entrypoint: `frontend/src/main.tsx`; `frontend/src/App.tsx` renders `Dashboard` directly.

Key frontend files:

- `frontend/src/components/Dashboard.tsx` owns dashboard state, polling, config editing, and campaign table rendering.
- `frontend/src/api/client.ts` defines `apiFetch()` and resolves API base from `VITE_API_URL` or `http://localhost:8787`.
- `frontend/src/types.ts` defines dashboard-facing rule, action, insight, and campaign types.
- `frontend/src/components/ui/*` contains shadcn-style UI primitives.
- `frontend/src/lib/utils.ts` supports UI utility composition.

Frontend behavior:

- On mount, dashboard calls `/api/campaigns`, `/api/config`, and `/api/health` in parallel.
- Dashboard refreshes data every 60 seconds.
- Rule changes are saved with `PUT /api/config`.
- UI uses the `@/*` alias configured in both `vite.config.ts` and `tsconfig*.json`.
- shadcn metadata lives in `frontend/components.json`; Tailwind config is `frontend/tailwind.config.js`.

## Current codebase notes

These are existing repository facts worth checking before frontend work:

- `Dashboard.tsx` imports `apiFetch` from `@/lib/api`, but the existing client file is `frontend/src/api/client.ts`.
- `Dashboard.tsx` imports `CampaignEnriched`, but `frontend/src/types.ts` does not export that name.
- `Dashboard.tsx` imports icons from `lucide-react`, but `frontend/package.json` does not list `lucide-react`.
- `tailwind.config.js` has `content: []`, so Tailwind will not scan source files until content globs are added.
- Worker plan docs say to use only `omni_purchase`; current worker code falls back to `purchase` after `omni_purchase`.

## Planning docs

Primary plan: `plans/260501-1630-meta-ads-automation/plan.md`.

Important plan facts:

- Intended architecture is Vercel-hosted Vite/React frontend plus Cloudflare Workers backend.
- Backend phases are marked completed in the plan; frontend and deploy validation are pending.
- Success criteria include 30-minute cron, no duplicate purchase counting, real-time campaign list, KV-backed threshold updates, working CORS, and deployment to Cloudflare Workers/Vercel.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

## GBrain Configuration (configured by /setup-gbrain)
- Engine: postgres
- Config file: ~/.gbrain/config.json (mode 0600)
- Setup date: 2026-05-02
- MCP registered: yes
- Memory sync: artifacts-only
- Current repo policy: read-write
