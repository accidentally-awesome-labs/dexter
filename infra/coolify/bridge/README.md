# Coolify deploy bridge

Dexter speaks a small HTTP contract (`POST /deploy`, `POST /rollback`). This bridge translates those calls to the **Coolify API** (`/api/v1`).

## Quick start

1. Copy app UUID mapping:

   ```bash
   cp infra/coolify/apps.example.json infra/coolify/apps.json
   # Edit UUIDs from Coolify → Applications → your app
   ```

2. Set env (see `.env.example`):

   - `COOLIFY_ORIGIN` — e.g. `https://coolify.example`
   - `COOLIFY_API_TOKEN` — Coolify API bearer token
   - `DEXTER_BRIDGE_TOKEN` — token Dexter sends to the bridge
   - `DEXTER_COOLIFY_API_URL=http://127.0.0.1:9876`
   - `DEXTER_COOLIFY_TOKEN` — same as `DEXTER_BRIDGE_TOKEN`

3. Start the bridge:

   ```bash
   npm run coolify:bridge
   ```

4. Run Dexter deploy/promotion against the bridge URL.

## API mapping

| Dexter bridge | Coolify API |
|---------------|-------------|
| `POST /deploy` `{ appName }` | `POST /api/v1/deploy` `{ uuid }` or deploy by `tag` from `apps.json` |
| `POST /rollback` `{ appName }` | `POST /api/v1/applications/{uuid}/restart` (default) |

Rollback modes (`COOLIFY_ROLLBACK_MODE`):

- `restart` (default) — restarts the running container (fast operational rollback).
- `redeploy` — queues a new deployment for the same application (no git pin in public API).

Coolify does not expose git-level rollback on the public API; use the Coolify UI for revision-specific rollback if needed.

## Hooks (optional)

Shell hooks call the same Coolify client directly (no HTTP bridge):

```bash
npm run coolify:deploy -- dexter
npm run coolify:rollback -- dexter
```

Or via `infra/coolify/hooks/deploy.sh` when hook mode is used.

## Implementation

- Client: `src/providers/deployment/coolify-client.ts`
- Bridge server: `src/providers/deployment/coolify-bridge-server.ts`
- CLI: `src/dev/run-coolify-bridge.ts`, `src/dev/run-coolify-hook.ts`

## Dokploy / Dokku

Not implemented yet. Policy allows them for dev/staging, but canary/prod require Coolify per `DEPLOY_AUTH_POLICY.json`. Add provider-specific clients using the same bridge pattern when needed.
