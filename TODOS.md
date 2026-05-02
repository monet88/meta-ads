# TODOs

## Expose meta-ads API through MCP tools after Safety Sprint

**What:** Expose read-only and tightly controlled mutation MCP tools over the secured meta-ads API.

**Why:** Unlock an AI-native ad ops loop where agents can inspect campaigns, read action history, propose safer rules, and monitor outcomes after the trust layer exists.

**Pros:**
- Agents can reason from campaign state, config versions, D1 audit logs, and recent automation outcomes.
- Read-only tools can help debugging and reporting without granting mutation power.
- Controlled write tools can later support approval-based rule changes with full audit.

**Cons:**
- Write tools could amplify bad automation if auth, permissions, and audit are weak.
- Requires strict tool permission design, rate limits, and provenance in logs.
- Adds another API surface that must be tested and documented.

**Context:** Current Safety Sprint explicitly defers MCP because the existing API lacks sufficient auth, logs, action provenance, and tests. Revisit once Cloudflare Access, D1 audit, dry-run, action caps, and backend decision models are stable.

**Depends on / blocked by:** Cloudflare Access same-origin auth, D1 audit tables, config versions, action caps, dry-run mode, rule engine tests, and documented API contracts.

## Add external notifications for automation actions and failures

**What:** Add Slack, Telegram, email, or generic webhook notifications for live actions, dry-run candidates, failed runs, Meta API errors, emergency stop changes, and action-cap hits.

**Why:** Dashboard activity logs only help when the operator is looking. Notifications make failed or dangerous automation visible quickly.

**Pros:**
- Operator learns when the bot acted, skipped, or failed without polling the dashboard.
- Failed cron/rate-limit/token issues become visible before spend risk compounds.
- Notification payloads can reuse D1 action/run log records.

**Cons:**
- Requires webhook secrets, retry policy, delivery failure handling, and noise controls.
- Bad notification design can create alert fatigue.
- Adds integration surface outside the core Worker/Dashboard loop.

**Context:** Safety Sprint includes dashboard activity and run status. External notifications should come after run/action/error taxonomy is stable so alerts are meaningful and not noisy.

**Depends on / blocked by:** D1 action logs, automation run status, error classification, dry-run/live state, and action-cap tracking.
