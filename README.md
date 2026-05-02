# Meta Ads Automation

Dashboard and Cloudflare Worker automation for monitoring Meta ad campaigns, reviewing rule decisions, and safely pausing or resuming campaigns from spend and purchase evidence.

## What this system does

- Lists Meta ad accounts available to the configured token.
- Lets an operator choose an ad account before loading campaigns and account-scoped rules.
- Shows active and paused campaigns with today's spend, `omni_purchase` counts, decision state, blockers, warnings, and errors.
- Stores rule configuration per ad account in Cloudflare KV.
- Runs a scheduled Worker every 30 minutes for the configured `META_ACCOUNT_ID`.
- Defaults automation to dry-run mode and blocks live mutations until arming requirements pass.
- Persists audit data in D1 for config versions, automation runs, campaign states, and action logs.

## Repository layout

```text
.
├── frontend/              # Vite + React + TypeScript dashboard
├── worker/                # Cloudflare Worker API, cron, tests, and D1 migrations
├── docs/                  # API, operations, security, ADR, and agent workflow docs
├── plans/                 # Planning artifacts, ignored for new local changes
├── AGENTS.md              # Agent entrypoint that points to CLAUDE.md and docs/agents
├── CLAUDE.md              # Claude Code project instructions
├── CONTEXT.md             # Domain context and project vocabulary
└── TODOS.md               # Deferred work that should stay visible
```

There is a root `package.json`, but app commands live in `frontend/` and `worker/`.

## Quick start

Install dependencies in each app package:

```bash
cd worker
npm install

cd ../frontend
npm install
```

Create local Worker secrets in `worker/.dev.vars`:

```bash
META_ACCESS_TOKEN=<meta-token>
META_ACCOUNT_ID=<default-account-id-without-act-prefix>
FRONTEND_URL=http://localhost:5173
ALLOW_LOCAL_DEV=true
```

Start the Worker API:

```bash
cd worker
npm run dev
```

Start the dashboard in another terminal:

```bash
cd frontend
npm run dev
```

For the dashboard, set `frontend/.env.local` only when the Worker is not at the default local URL:

```bash
VITE_API_URL=http://localhost:8787
```

Only variables prefixed with `VITE_` are exposed to Vite client code.

## Verification commands

```bash
cd worker
npm test

cd ../frontend
npm run lint
npm run build
```

The Worker test suite uses `@cloudflare/vitest-pool-workers` and applies D1 migrations from `worker/migrations/` during test setup.

## Documentation map

- [CONTEXT.md](CONTEXT.md) — product context, domain vocabulary, and current project facts.
- [ARCHITECTURE.md](ARCHITECTURE.md) — runtime architecture, data flow, and safety gates.
- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, local smoke test, workflow, and testing expectations.
- [docs/API.md](docs/API.md) — Worker API routes, auth, request shapes, and response envelopes.
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — secrets, D1/KV operations, deploy checklist, and incident runbooks.
- [docs/SECURITY.md](docs/SECURITY.md) — auth, origin checks, secrets, audit posture, and known security gaps.
- [docs/adr/README.md](docs/adr/README.md) — ADR format and storage location.
- [docs/agents/](docs/agents/) — issue tracker, triage label, and domain-doc instructions for agent workflows.
- [frontend/README.md](frontend/README.md) — dashboard-specific development notes.
- [TODOS.md](TODOS.md) — deferred post-safety-sprint work.

## Deployment shape

- Frontend: Vite app intended for Vercel or another static host.
- Backend: Cloudflare Worker with `fetch()` API routes and `scheduled()` cron.
- Persistence: Cloudflare KV for account-scoped config/log cache and D1 for audit records.
- External API: Meta Graph API v21.0.

Before any live deployment, confirm the deployed auth path. The current Worker accepts Cloudflare Access identity headers or `Authorization: Bearer <API_AUTH_TOKEN>`, while the frontend does not currently inject bearer tokens.

## Current status

The branch contains account-scoped dashboard/API work, stricter `omni_purchase` handling, dry-run/live gate fields, D1 audit schema, and worker tests. Frontend browser QA and deployed Cloudflare/Vercel validation still need to be run before calling the system production-ready.
