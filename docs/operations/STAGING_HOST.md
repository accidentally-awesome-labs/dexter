# Staging Coolify Host (v1.2)

Long-lived staging for Dexter closed-loop E2E **without** a developer laptop or ephemeral `trycloudflare` tunnels.

**Related:** [PRODUCTION_INTEGRATION.md](./PRODUCTION_INTEGRATION.md) · [closed-loop-staging workflow](../.github/workflows/closed-loop-staging.yml)

---

## Architecture

```text
GitHub Actions / operators
        │
        ▼
  Dexter bridge (:9876)  ──►  Coolify API (:443)
        │                         │
        │                         ▼
        │                    App FQDN (HTTPS)
        └──────────────────► deploy /rollback
```

Requirements:

1. **Coolify panel** reachable at a stable URL (`COOLIFY_ORIGIN`)
2. **Dexter bridge** reachable at `DEXTER_COOLIFY_API_URL` (same host or reverse proxy path)
3. **App FQDN** returns HTTP 200 for strict E2E (configure in Coolify UI — avoid Postgres FQDN hacks)
4. **Registry** hosts images Dexter pushes (`DEXTER_REGISTRY` / GHCR)

---

## 1. Provision the host

Minimum: 2 vCPU, 4 GB RAM, Docker + Docker Compose.

```bash
# On the staging VPS (example)
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
git clone https://github.com/accidentally-awesome-labs/dexter.git /opt/dexter
cd /opt/dexter/infra/coolify/local
cp .env.example .env   # if present; otherwise follow local README
docker compose up -d
```

Complete Coolify onboarding, enable **API Access**, create **Keys & Tokens** → save as `COOLIFY_API_TOKEN`.

Create a **Docker Image** application named `dexter` (or your project name). Note the application UUID for `infra/coolify/apps.json` / `COOLIFY_APP_UUID` secret.

Configure the app **FQDN** in Coolify to a real URL (e.g. `https://dexter-staging.example.com`) that routes to the running container health endpoint.

---

## 2. Run the Dexter bridge as a service

### Option A — Docker (recommended)

```bash
cd /opt/dexter
cp .env.example .env
# Set COOLIFY_ORIGIN, COOLIFY_API_TOKEN, DEXTER_BRIDGE_TOKEN, infra/coolify/apps.json

docker run -d --name dexter-bridge --restart unless-stopped \
  --network host \
  --env-file .env \
  -v /opt/dexter/infra/coolify/apps.json:/opt/dexter/infra/coolify/apps.json:ro \
  -w /opt/dexter \
  node:22-bookworm \
  bash -lc "npm ci && npm run coolify:bridge"
```

Expose `:9876` via firewall or reverse proxy (Caddy/nginx) as `https://bridge-staging.example.com`.

### Option B — systemd on the host

```ini
# /etc/systemd/system/dexter-bridge.service
[Unit]
Description=Dexter Coolify bridge
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/opt/dexter
EnvironmentFile=/opt/dexter/.env
ExecStart=/usr/bin/npm run coolify:bridge
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now dexter-bridge
```

---

## 3. Registry (GHCR)

**Org default:** `ghcr.io/accidentally-awesome-labs/<project>:<deployTag>`

### Local publish

```bash
# One-time: grant packages scope to gh CLI, then log Docker into GHCR
gh auth refresh -h github.com -s write:packages,read:packages
npm run ghcr:login

export DEXTER_REGISTRY=ghcr.io/accidentally-awesome-labs
npm run registry:publish-drill          # smoke build + push
npm run deploy:publish -- --run-id <runId>   # publish an existing run manifest
```

Optional: `DEXTER_DEPLOY_PUBLISH=true` during `factory:e2e` to publish after each closed-loop run.

### CI publish

```bash
gh workflow run registry-publish.yml
```

Uses `GITHUB_TOKEN` with `packages: write` (see `.github/workflows/registry-publish.yml`).

### Coolify pull

**Public GHCR package (current):** no registry login on the Coolify host — wire image + deploy:

```bash
npm run registry:publish-drill   # or deploy:publish on a run
npm run coolify:ghcr-wire        # PATCH app + queue deploy
```

Uses `artifacts/release/REGISTRY_PUBLISH_DRILL.json` or the latest published `deploy_manifest.json` for `imageRef`.

**Private GHCR package:** on the Coolify Docker host:

```bash
./scripts/coolify-host-ghcr-login.sh
```

Or Coolify UI → **Private Docker Registry** → GHCR credentials (`read:packages` PAT).

Manifest after publish includes `registry`, `imageDigest`, and `publishedAt` (schema 1.0 manifest + publish block).

**Local Docker Desktop (two common blockers):**

1. **Server unreachable** — `host.docker.internal:22` is closed. Fix:
   ```bash
   npm run coolify:fix-local-server
   ```
   Points the bundled `localhost` server at `coolify-testing-host` and validates SSH.

2. **Private GHCR pull fails** — Coolify bind-mounts `/root/.docker/config.json` from the **Mac host** (not inside the container). Fix:
   ```bash
   npm run coolify:fix-local-server   # writes infra/coolify/local/.docker/config.json
   sudo npm run coolify:mac-docker-config
   npm run coolify:ghcr-wire
   ```
   Org-owned packages default to **private**; making them public may require org admins to allow public packages in GitHub → Organization settings → Packages.

---

## 4. GitHub secrets (staging workflow)

| Secret | Value |
|--------|--------|
| `COOLIFY_ORIGIN` | `https://coolify-staging.example.com` |
| `COOLIFY_API_TOKEN` | Coolify API token |
| `DEXTER_COOLIFY_API_URL` | `https://bridge-staging.example.com` |
| `DEXTER_COOLIFY_TOKEN` | Same as `DEXTER_BRIDGE_TOKEN` on bridge host |
| `DEXTER_BRIDGE_TOKEN` | Bridge bearer token |
| `COOLIFY_APP_UUID` | Coolify application UUID |
| `DEXTER_DEPLOY_AUTH_KEY` | Non-default deploy auth key |
| `DEXTER_POLICY_BUNDLE_KEY` | Non-default policy bundle key |
| `GHCR_PAT` | CI registry publish (org `GITHUB_TOKEN` often lacks `write_package`; set via `gh secret set GHCR_PAT`) |

Dispatch:

```bash
# Refresh tunnels + GitHub secrets when using local Coolify (interim staging)
./scripts/staging-refresh-tunnels.sh

gh workflow run closed-loop-staging \
  -f coolify_origin=https://coolify-staging.example.com
```

`skip_preflight` defaults to `true` — staging resolves health from the Coolify app FQDN.

---

## 5. Verification checklist

- [ ] `curl -sf $COOLIFY_ORIGIN/api/health`
- [ ] `curl -sf -o /dev/null -w '%{http_code}' -X POST $DEXTER_COOLIFY_API_URL/deploy -H 'authorization: Bearer x'` → `401`
- [ ] App FQDN returns `200` (strict E2E health)
- [ ] `npm run deploy:publish` pushes to registry when `DEXTER_REGISTRY` set
- [ ] Two consecutive `closed-loop-staging` runs pass **without** local laptop online

---

## 6. Secret rotation

Rotate on a quarterly cadence or after personnel change:

1. Coolify API token → update `.env` on bridge host + GitHub secret
2. `DEXTER_BRIDGE_TOKEN` → update bridge `.env`, `DEXTER_COOLIFY_TOKEN` secret, restart bridge
3. Deploy/policy keys → update GitHub secrets and operator `.env`
4. GHCR PAT → update GitHub secret and Coolify registry credentials

---

## Local dev vs staging

| | Local (`infra/coolify/local`) | Staging host |
|--|-------------------------------|--------------|
| Purpose | Developer wiring | CI + operator proof |
| FQDN | `127.0.0.1:18080` workaround OK | Must be real URL in Coolify |
| Bridge | `npm run coolify:bridge` on laptop | Always-on service |
| Tunnels | Acceptable for one-off tests | **Not** used for v1.2 GA |
