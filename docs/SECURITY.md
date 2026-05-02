# Security

Meta Ads Automation can mutate paid advertising campaigns. Treat auth, origin checks, audit logs, and live-mode controls as product safety features, not just technical controls.

## Current protection layers

### API authentication

Every `/api/*` request except `OPTIONS` must satisfy one of:

- localhost request with `ALLOW_LOCAL_DEV=true`
- `Authorization: Bearer <API_AUTH_TOKEN>`
- `CF-Access-Jwt-Assertion` from Cloudflare Access

Local bypass is intended for development only.

### Mutation origin guard

`PUT /api/config` requires an allowed origin or referer:

- localhost when local bypass is enabled
- the origin from `FRONTEND_URL` in deployed environments

This reduces accidental cross-site config writes. It does not replace authentication.

### Secrets

Worker secrets belong in Cloudflare secrets or local `worker/.dev.vars`.

Do not expose secrets through Vite. Only `VITE_` variables are available to client code, so never put Meta tokens or API bearer tokens behind a `VITE_` prefix.

### Fail-closed insight handling

Automation decisions require `omni_purchase` evidence. Missing purchase evidence produces `UNKNOWN_DATA` and blockers instead of assuming zero purchases.

### Dry-run default

Default config uses `dryRun: true`. In dry-run, the system logs `WOULD_PAUSE` and `WOULD_RESUME` decisions without calling Meta mutation endpoints.

### Live-mode arming

Live mode is blocked unless arming requirements pass:

- ad account confirmed
- allowlist present
- action caps present
- recent dry-run review present
- emergency stop off

Live resume also requires D1 provenance that the campaign was paused by this tool.

### Audit persistence

D1 stores:

- config versions
- automation runs
- campaign state/provenance
- action logs

KV also stores recent account-scoped timeline entries for dashboard reads.

## Deployment expectations

For deployed browser use, prefer a same-origin or Cloudflare Access-protected deployment path so the Worker receives an identity assertion without placing tokens in client code.

If using `API_AUTH_TOKEN` from browser code, update and verify CORS first. The current CORS preflight allows `Content-Type`, while browser bearer auth requires `Authorization` to be allowed.

## Known security gaps to verify before production

- Frontend auth plumbing is not complete for bearer-token deployments.
- Cloudflare Access policy and same-origin deployment contract need live validation.
- Full cooldown and action-cap enforcement should be verified before live mode.
- Dashboard browser QA should cover blocked-live, unknown-data, version-conflict, and auth-failure states.
- External notifications are not implemented, so operators must monitor dashboard/logs until alerting exists.

## Handling incidents

### Suspected bad automation decision

1. Enable `emergencyStop` in account config.
2. Confirm the latest config version was saved.
3. Review `action_logs` and `automation_runs` in D1.
4. Check `RULE_LOGS::<accountId>` for recent timeline entries.
5. Manually verify campaign status in Meta Ads Manager.
6. Do not re-enable live mode until the decision evidence and blockers are understood.

### Token exposure

1. Revoke or rotate the Meta token.
2. Update `META_ACCESS_TOKEN` with `npx wrangler secret put META_ACCESS_TOKEN`.
3. Review recent Meta and Worker activity.
4. Check git history and local files for accidental secret commits.

### Unauthorized API access attempt

1. Review Cloudflare Access logs or Worker logs.
2. Rotate `API_AUTH_TOKEN` if bearer auth is enabled.
3. Confirm `FRONTEND_URL` and origin guard behavior.
4. Keep `dryRun` enabled until the access path is understood.
