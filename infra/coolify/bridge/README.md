# Coolify deploy bridge

Dexter expects a thin HTTP API, not the Coolify dashboard URL.

## Contract

- `POST /deploy` — Bearer token, JSON body with `appName`, `provider`, `action`
- `POST /rollback` — same
- Response: `{ "deploymentId": "...", "status": "ok", "revision": "optional" }`

See `src/providers/deployment/coolify-api.ts`.

## Implementation options

1. **Sidecar service** — Node/Go service that calls Coolify API or triggers a GitHub Action.
2. **Hook-backed server** — Wrap `infra/coolify/hooks/deploy.sh` / `rollback.sh` in an HTTP server (implement real Coolify calls inside the hooks).
3. **API gateway** — Route `/deploy` and `/rollback` to your existing deployment automation.

Set `DEXTER_COOLIFY_API_URL` to the bridge base URL (no trailing path except what your bridge uses).
