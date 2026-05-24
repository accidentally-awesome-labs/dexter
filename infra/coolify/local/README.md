# Local Coolify (Dexter Step 2)

Self-hosted Coolify for wiring Dexter's production integration path without a remote panel.

## Start

```bash
cd infra/coolify/local
docker compose up -d
```

Default UI: `http://127.0.0.1:8001` (`APP_PORT` in `.env`).

Health: `http://127.0.0.1:8001/api/health`

## First-time panel setup

1. Register an admin user and complete or skip onboarding.
2. **Settings → Advanced** → enable **API Access** (or set `instance_settings.is_api_enabled = true` in the DB for local dev).
3. **Keys & Tokens** → create an API token.

## Wire Dexter

From the repo root (with Coolify running):

```bash
export COOLIFY_ORIGIN=http://127.0.0.1:8001
export COOLIFY_API_TOKEN=<your-token>
export DEXTER_DEPLOY_HEALTH_URL=http://127.0.0.1:8001/api/health

npm run coolify:setup    # writes .env + infra/coolify/apps.json (gitignored)
npm run coolify:bridge   # keep running in another terminal

npm run production:preflight
npm run deploy:self -- --environment staging --require-api true --health-url http://127.0.0.1:8001/api/health --app dexter
```

Confirm `artifacts/release/self_deploy_result.json` has `"deploymentMode": "api"`.

## Create a test application

If Coolify has no apps yet, create a **Docker Image** app named `dexter` (e.g. `nginx:alpine`) in the UI or via `POST /api/v1/applications/dockerimage`. Re-run `npm run coolify:setup` to refresh `apps.json`.

## Notes

- `apps.json` and repo-root `.env` are gitignored; do not commit tokens.
- **Unreachable localhost server (Docker Desktop):** `host.docker.internal:22` is usually closed. From repo root:
  ```bash
  npm run coolify:fix-local-server   # point server at coolify-testing-host + validate + GHCR login
  ```
- **Private GHCR images on Docker Desktop:** after `npm run coolify:fix-local-server`, run `sudo npm run coolify:mac-docker-config` (installs `/root/.docker/config.json` on the Mac for Coolify’s helper container mounts). Then `npm run coolify:ghcr-wire`.
- Traefik/proxy may be `exited` on Docker Desktop; app containers can still run on the testing host Docker socket.
