# Operations

This runbook covers local operation, Cloudflare resources, deploy preparation, and incident response for Meta Ads Automation.

## Runtime inventory

- Frontend: Vite static app in `frontend/`.
- Backend: Cloudflare Worker in `worker/`.
- KV binding: `CONFIG_KV`.
- D1 binding: `AUDIT_DB`.
- Cron: `*/30 * * * *` in `worker/wrangler.jsonc`.
- Meta API version: Graph API v21.0.

## Required Worker configuration

Secrets:

- `META_ACCESS_TOKEN` — Meta token used for ad account, campaign, insight, pause, and resume calls.
- `API_AUTH_TOKEN` — optional bearer token for scripted API access.

Vars/bindings:

- `META_ACCOUNT_ID` — default account for scheduled automation, without requiring the `act_` prefix.
- `FRONTEND_URL` — deployed dashboard origin for CORS and config mutation origin checks.
- `CONFIG_KV` — KV namespace binding.
- `AUDIT_DB` — D1 database binding.
- `ALLOW_LOCAL_DEV` — local-only bypass flag; use `true` only for local development.

Add or update Worker secrets with Wrangler:

```bash
cd worker
npx wrangler secret put META_ACCESS_TOKEN
npx wrangler secret put API_AUTH_TOKEN
```

Wrangler creates a new Worker version when a secret is updated.

## Local development

`worker/.dev.vars`:

```bash
META_ACCESS_TOKEN=<meta-token>
META_ACCOUNT_ID=<default-account-id-without-act-prefix>
FRONTEND_URL=http://localhost:5173
ALLOW_LOCAL_DEV=true
```

Start Worker:

```bash
cd worker
npm run dev
```

Start frontend:

```bash
cd frontend
npm run dev
```

Vite exposes only `VITE_` variables to client code. Use `frontend/.env.local` for `VITE_API_URL` only when needed.

## D1 migrations

Migration files live in `worker/migrations/`. The current schema is `0001_audit_schema.sql`.

Apply local migrations:

```bash
cd worker
npx wrangler d1 migrations apply meta-ads-audit --local
```

Apply remote migrations:

```bash
cd worker
npx wrangler d1 migrations apply meta-ads-audit --remote
```

Wrangler D1 migration apply prompts for confirmation outside CI, captures a backup, and rolls back a failed migration while preserving earlier successful migrations. Wrangler 4 commands default to local mode for resource commands; use `--remote` when intentionally touching remote Cloudflare resources.

## KV usage

The Worker uses KV keys:

- `RULE_CONFIG::<accountId>` for account-scoped config.
- `RULE_LOGS::<accountId>` for account-scoped timeline logs.
- `AUTOMATION_RUN_LOCK` for scheduled-run overlap protection.

Use remote KV commands only when intentionally inspecting or changing deployed state.

## Deploy checklist

Before deploying:

1. Run Worker tests: `cd worker && npm test`.
2. Run frontend checks: `cd frontend && npm run lint && npm run build`.
3. Apply D1 migrations to the target database.
4. Confirm `FRONTEND_URL` matches the deployed dashboard origin.
5. Confirm `META_ACCOUNT_ID` is the account intended for scheduled automation.
6. Confirm `META_ACCESS_TOKEN` permissions and expiry.
7. Confirm deployed `/api/*` auth path: Cloudflare Access or bearer token.
8. Keep `dryRun: true` until a human has reviewed recent dry-run evidence.
9. Confirm allowlist, action caps, ad account confirmation, and emergency stop state before live mode.

Deploy Worker:

```bash
cd worker
npx wrangler deploy
```

Build frontend:

```bash
cd frontend
npm run build
```

Deploy the built frontend through the selected host, such as Vercel.

## Scheduled automation runbook

Healthy run behavior:

- A run gets a unique `runId`.
- A KV lock is acquired for up to 25 minutes.
- Campaign and insight data are fetched from Meta.
- Decisions are logged as dry-run, live, skipped, or failed entries.
- D1 records the run lifecycle and campaign state updates.
- KV keeps the recent timeline for dashboard reads.

If a run overlaps:

- The second run records `SKIPPED_LOCK`.
- D1 status becomes `skipped_overlap` when `AUDIT_DB` is available.

If Meta insights fail globally:

- The run records `AUTOMATION_RUN_FAILED`.
- D1 status becomes `failed`.
- Treat this as fail-closed. Do not infer purchases from missing evidence.

## Emergency stop

Use config to enable `emergencyStop: true`. Live mode is blocked when emergency stop is on.

If the dashboard is unavailable, update the account-scoped config through a trusted authenticated API client and preserve the latest config `version` to avoid conflicts.

## Live-mode checklist

Do not disable dry-run until all are true:

- Ad account has been confirmed by a human.
- Recent dry-run output has been reviewed.
- `allowlistCampaignIds` contains only intended campaign IDs.
- `excludeCampaignIds` contains campaigns that must never be touched.
- `maxActionsPerRun` and `maxActionsPerDay` are positive and conservative.
- `emergencyStop` is false.
- D1 audit writes are succeeding.
- Resume provenance is populated for campaigns paused by this tool.

## Troubleshooting

### API returns `ACCESS_UNAUTHORIZED`

Check one of the auth paths:

- local request plus `ALLOW_LOCAL_DEV=true`
- `Authorization: Bearer <API_AUTH_TOKEN>`
- Cloudflare Access identity header

### Config write returns `ORIGIN_FORBIDDEN`

Confirm the request origin or referer matches `FRONTEND_URL`, or use the local dev bypass from localhost.

### Config write returns `CONFIG_VERSION_CONFLICT`

Reload config, merge the intended changes onto the latest version, and retry with the latest `version`.

### Config write returns `LIVE_ARMING_BLOCKED`

Review `armingBlockers`. The backend blocks live mode until all required safety evidence exists.

### Campaign decisions show `UNKNOWN_DATA`

The backend did not receive complete `omni_purchase` evidence. Check Meta insight payloads and avoid treating the missing metric as zero purchases.

### Resume is skipped for provenance

The campaign was not recorded as paused by this tool in `campaign_states`. Manual pauses should not be auto-resumed by this automation.
