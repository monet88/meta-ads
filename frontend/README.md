# Frontend Dashboard

Vite + React + TypeScript dashboard for Meta Ads Automation.

## What it does

- Checks Worker health.
- Lists Meta ad accounts available to the configured backend token.
- Requires an operator to choose an ad account before loading campaigns and rules.
- Loads account-scoped campaigns, config, and logs from the Worker API.
- Displays campaign spend, purchases, status, and a local action hint.
- Saves threshold config through `PUT /api/config?accountId=...`.
- Polls selected-account data every 60 seconds.

## Scripts

```bash
npm run dev      # Start Vite dev server
npm run build    # Type-check and build production assets
npm run lint     # Run ESLint
npm run preview  # Preview the built app locally
```

## Environment

The API base URL comes from `VITE_API_URL` and falls back to `http://localhost:8787`.

Use `frontend/.env.local` when needed:

```bash
VITE_API_URL=http://localhost:8787
```

Only `VITE_` variables are exposed to browser code. Do not place Meta tokens or API bearer tokens in frontend env files.

## Local development

Start the Worker first:

```bash
cd ../worker
npm run dev
```

Then start Vite:

```bash
cd ../frontend
npm run dev
```

Open the Vite URL, confirm the API health badge, choose an ad account, and verify campaigns/config load.

## Important files

- `src/main.tsx` — React mount.
- `src/App.tsx` — renders `Dashboard`.
- `src/components/Dashboard.tsx` — dashboard state, polling, account selection, config editing, sorting, and table rendering.
- `src/lib/api.ts` — `apiFetch()` and API base URL resolution.
- `src/types.ts` — frontend API types.
- `tailwind.config.js` — Tailwind/shadcn content and theme configuration.

## Current frontend gaps

The dashboard still computes some action hints locally for display. The backend already returns richer decision, evidence, blocker, warning, and error fields; future frontend work should render those backend truth fields directly.

Browser QA is still required for account selection, auth failure, config save, version conflict, blocked live mode, unknown data, and responsive states.
