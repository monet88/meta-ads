# Contributing

This repo contains two app packages. Work from the package directory you are changing.

## Prerequisites

- Node.js and npm.
- A Meta access token that can read ad accounts, campaigns, insights, and update campaigns when live mode is intentionally enabled.
- Cloudflare account access for Worker, KV, D1, and secrets work.
- `gh` CLI for GitHub Issues and PR workflow.

## Install

```bash
cd worker
npm install

cd ../frontend
npm install
```

The root `package.json` has a Wrangler devDependency, but it has no app scripts. Use `worker/` and `frontend/` for normal development.

## Local environment

Create `worker/.dev.vars` for local Worker development:

```bash
META_ACCESS_TOKEN=<meta-token>
META_ACCOUNT_ID=<default-account-id-without-act-prefix>
FRONTEND_URL=http://localhost:5173
ALLOW_LOCAL_DEV=true
```

Optional local-only values:

```bash
API_AUTH_TOKEN=<local-api-token>
```

Create `frontend/.env.local` only if the Worker is not running at `http://localhost:8787`:

```bash
VITE_API_URL=http://localhost:8787
```

Do not put secrets in `frontend/.env.local`. Vite exposes `VITE_` variables to client code.

## Local smoke test

Terminal 1:

```bash
cd worker
npm run dev
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Then open the Vite dev server, confirm the API health badge, choose an ad account, and verify campaigns/config load for the selected account.

## Test and build

Worker:

```bash
cd worker
npm test
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

The Worker test suite uses `worker/vitest.config.ts`, `cloudflare:test`, and D1 migrations from `worker/test/d1-migrations.ts`.

## Development workflow

1. Start from a GitHub issue or create one if the work is not tracked.
2. Read [CONTEXT.md](CONTEXT.md) and the relevant docs in [docs/](docs/).
3. Keep changes small and vertical.
4. For backend behavior, update or add Worker tests first when practical.
5. For frontend behavior, run lint/build and browser-test the dashboard before claiming completion.
6. Do not commit, push, create PRs, or deploy unless explicitly asked.

## Documentation expectations

Update docs when behavior changes:

- API contract changes → [docs/API.md](docs/API.md).
- Runtime/data-flow changes → [ARCHITECTURE.md](ARCHITECTURE.md).
- Deploy, secrets, D1, KV, or runbook changes → [docs/OPERATIONS.md](docs/OPERATIONS.md).
- Auth, origin, access, secrets, or live-action safety changes → [docs/SECURITY.md](docs/SECURITY.md).
- Durable design decisions → new ADR in `docs/adr/`.

## Issue tracker

GitHub Issues are the source of truth for planned work. Use the labels documented in [docs/agents/triage-labels.md](docs/agents/triage-labels.md):

- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`
