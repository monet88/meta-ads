# API Reference

The Cloudflare Worker serves JSON routes under `/api/*`.

Base URL:

- Local: `http://localhost:8787`
- Deployed: the Worker URL or the same-origin route configured for the dashboard

## Auth

All `/api/*` routes except `OPTIONS` require one of:

- local dev bypass: localhost request plus `ALLOW_LOCAL_DEV=true`
- `Authorization: Bearer <API_AUTH_TOKEN>`
- `CF-Access-Jwt-Assertion` from Cloudflare Access

Config writes also require an allowed origin or referer:

- localhost when `ALLOW_LOCAL_DEV=true`
- `FRONTEND_URL` origin in deployed environments

The Worker currently allows `Content-Type` in CORS preflight. If the browser frontend needs bearer auth, update and verify CORS for the `Authorization` header first.

## Response envelope

Success:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "message": "Optional message",
  "meta": {
    "generatedAt": "2026-05-02T00:00:00.000Z",
    "total": 1,
    "version": 1
  }
}
```

Error:

```json
{
  "success": false,
  "data": null,
  "error": {
    "category": "validation",
    "code": "INVALID_CONFIG",
    "message": "Config validation failed",
    "retryable": false,
    "details": []
  },
  "message": "Config validation failed",
  "meta": {
    "generatedAt": "2026-05-02T00:00:00.000Z"
  }
}
```

## Routes

| Method | Path | Query | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/ad-accounts` | none | List Meta ad accounts available to the token. |
| `GET` | `/api/campaigns` | `accountId` required | List account campaigns with insights, decision, evidence, blockers, warnings, and errors. |
| `GET` | `/api/campaigns/:id/insights` | none | Return today's raw Meta insights payload for a campaign. |
| `GET` | `/api/config` | `accountId` required | Read normalized rule config for an account. |
| `PUT` | `/api/config` | `accountId` required | Validate, version, persist, and audit config for an account. |
| `GET` | `/api/logs` | `accountId` required | Read recent account-scoped activity timeline entries. |
| `GET` | `/api/health` | none | Validate the Meta token through Graph API `/me`. |

Use `accountId` with or without the `act_` prefix. The backend normalizes it before reading account-scoped KV keys.

## GET /api/ad-accounts

Returns the token's Meta ad accounts.

```json
{
  "success": true,
  "data": [
    {
      "id": "act_123",
      "account_id": "123",
      "name": "Main account",
      "account_status": 1
    }
  ],
  "error": null,
  "meta": {
    "generatedAt": "2026-05-02T00:00:00.000Z",
    "total": 1
  }
}
```

## GET /api/campaigns?accountId=123

Returns campaign rows shaped for the dashboard.

Important fields:

- `decision` — one of `WOULD_PAUSE`, `WOULD_RESUME`, `PAUSE`, `RESUME`, `MONITORING`, `SKIPPED_COOLDOWN`, `SKIPPED_CAP`, `SKIPPED_LOCK`, `BLOCKED_NOT_ARMED`, `UNKNOWN_DATA`, `ERROR`.
- `why` — human-readable reasons for the decision.
- `evidence` — spend, purchase, dry-run, cap, allowlist, exclusion, emergency stop, arming, and reliability snapshot.
- `blockers` — blocking reasons that prevent trusted or live action.
- `warnings` — non-fatal data warnings such as missing `omni_purchase`.
- `insights` — normalized today insight summary, or `null` on per-campaign insight failure.

Missing required `omni_purchase` evidence returns `UNKNOWN_DATA`; it is not treated as zero purchases.

## GET /api/config?accountId=123

Returns normalized config with metadata:

```json
{
  "enabled": true,
  "dryRun": true,
  "pauseThreshold": 170000,
  "pauseThreshold2": 200000,
  "resumeThreshold": 150000,
  "cooldownHours": 24,
  "maxActionsPerRun": 0,
  "maxActionsPerDay": 0,
  "allowlistCampaignIds": [],
  "excludeCampaignIds": [],
  "emergencyStop": false,
  "arming": {
    "status": "not_armed",
    "adAccountConfirmed": false,
    "recentDryRunRunId": null,
    "recentDryRunReviewedAt": null,
    "reviewedBy": null,
    "reliabilityScore": null,
    "evidenceWindowDays": 3
  },
  "version": null,
  "updatedAt": null,
  "updatedBy": null,
  "liveArmingEligible": false,
  "armingBlockers": []
}
```

## PUT /api/config?accountId=123

The request body must include the full config model and the latest `version` value returned by `GET /api/config`.

Validation rules include:

- `enabled`, `dryRun`, and `emergencyStop` must be booleans.
- thresholds must be finite numbers greater than or equal to `0`.
- `pauseThreshold2` may be `null`.
- `cooldownHours` must be greater than `0`.
- action caps must be integer values greater than or equal to `0`.
- allowlist and exclusion fields must be string arrays.
- `arming` must be an object with valid typed fields.

Version conflicts return `409` with `CONFIG_VERSION_CONFLICT` and the latest config in `data.latestConfig`.

Turning off `dryRun` returns `409` with `LIVE_ARMING_BLOCKED` unless all arming blockers pass.

## GET /api/logs?accountId=123

Returns account-scoped activity timeline entries from KV. The handler also maps legacy action logs into the structured timeline shape.

## GET /api/health

Returns token health:

- success with `status: ok` when Graph API `/me` succeeds.
- `401 META_TOKEN_INVALID` when Meta returns an auth error.
- `500 HEALTH_CHECK_FAILED` when the health check itself fails.
