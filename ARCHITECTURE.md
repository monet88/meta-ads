# Architecture

Meta Ads Automation is split into a browser dashboard and a Cloudflare Worker backend.

```text
Browser dashboard
  │
  │ HTTPS /api/*
  ▼
Cloudflare Worker fetch()
  ├─ Auth and mutation-origin guard
  ├─ JSON API routes
  ├─ Cloudflare KV for account-scoped config/log cache
  ├─ Cloudflare D1 for audit history
  └─ Meta Graph API v21.0

Cloudflare Worker scheduled()
  ├─ 30-minute cron
  ├─ run lock in KV
  ├─ rule evaluation from Meta campaign + insight data
  ├─ dry-run/live action executor
  ├─ D1 audit persistence
  └─ KV action-log persistence
```

## Runtime surfaces

### Frontend

The frontend is a Vite, React, and TypeScript app in `frontend/`.

Key files:

- `frontend/src/main.tsx` mounts the React app.
- `frontend/src/App.tsx` renders `Dashboard`.
- `frontend/src/components/Dashboard.tsx` owns account selection, campaign polling, sorting, config editing, and dashboard rendering.
- `frontend/src/lib/api.ts` provides `apiFetch()` and resolves `VITE_API_URL` with a local Worker fallback.
- `frontend/src/types.ts` mirrors dashboard-facing backend response models.

The dashboard first calls `/api/ad-accounts`, then requires the operator to choose an account before loading campaigns, config, and logs for that account.

### Worker API

The Worker entrypoint is `worker/src/index.ts`.

`fetch()` handles:

- CORS preflight.
- `/api/*` authentication.
- Mutation origin checks for config writes.
- Route registration through `worker/src/router.ts`.
- JSON API responses from `worker/src/api-handlers.ts`.

### Worker cron

`scheduled()` runs every 30 minutes from `worker/wrangler.jsonc`.

The cron path:

1. Loads config from KV, preferring `RULE_CONFIG::<META_ACCOUNT_ID>` and falling back to `RULE_CONFIG`.
2. Skips when config is disabled.
3. Acquires `AUTOMATION_RUN_LOCK` in KV for up to 25 minutes.
4. Fetches active and paused campaigns for `META_ACCOUNT_ID`.
5. Fetches account-level insights for today and for the trailing 3-day evidence window.
6. Evaluates each campaign with strict `omni_purchase` evidence.
7. Logs dry-run decisions or applies live pause/resume actions if gates allow.
8. Persists run status, action logs, and campaign state into D1.
9. Prepends KV action logs under `RULE_LOGS::<META_ACCOUNT_ID>`.

## Persistence

### KV

KV is used for fast config/log storage and the run lock:

- `RULE_CONFIG::<accountId>` — account-scoped normalized rule config.
- `RULE_LOGS::<accountId>` — recent timeline entries capped to 1000 records.
- `AUTOMATION_RUN_LOCK` — overlap guard for scheduled runs.

The API path always expects `accountId` for account-scoped config, campaign list, and logs.

### D1

D1 stores audit records from `worker/migrations/0001_audit_schema.sql`:

- `config_versions` — versioned config snapshots.
- `automation_runs` — run lifecycle status and summaries.
- `campaign_states` — last decision/action and `pausedByTool` provenance.
- `action_logs` — structured dry-run, live, skipped, and failed decision records.

## Rule model

The source of truth for defaults is `RULE_CONFIG_DEFAULTS` in `worker/src/types.ts`.

Defaults:

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
- arming status starts as `not_armed`

Decision inputs include today's spend, today's `omni_purchase`, trailing 3-day `omni_purchase`, dry-run state, action caps, allowlist/exclusion, emergency stop, arming state, and provenance.

The evaluator fails closed when required `omni_purchase` evidence is missing. It returns `UNKNOWN_DATA` instead of treating missing purchases as zero.

## Live-mode safety gates

Live pause/resume actions are blocked unless all relevant gates pass:

- `dryRun` is false.
- Emergency stop is off.
- The ad account is confirmed.
- At least one campaign is allowlisted.
- Per-run and per-day action caps are positive.
- A recent dry-run review timestamp is present.
- The campaign is not excluded.
- Live campaigns are allowlisted.
- Live resume has `pausedByTool` provenance in D1.

The current code models cooldown and action caps in config/evidence, but full cap/cooldown enforcement should be verified before live rollout.

## API response shape

Worker responses use an envelope:

```ts
interface ApiSuccessResponse<T> {
  success: true
  data: T
  error: null
  message?: string
  meta?: {
    generatedAt: string
    total?: number
    version?: number | null
    run?: RunHealthSummary | null
  }
}
```

Errors return `success: false`, `data`, a classified `error`, a user-facing `message`, and optional `meta`.

## Deployment boundaries

The frontend can be deployed independently from the Worker, but the backend auth contract must be settled first. The Worker accepts Cloudflare Access identity headers, `API_AUTH_TOKEN` bearer auth, or local bypass when `ALLOW_LOCAL_DEV=true` and the request is from localhost.

For browser calls with bearer auth, confirm CORS headers before relying on `Authorization` from the frontend. The current frontend does not send bearer tokens.
