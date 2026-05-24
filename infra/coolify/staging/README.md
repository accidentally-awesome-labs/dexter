# Staging VPS (v1.2)

Long-lived Coolify + Dexter bridge on a Linux VPS — no laptop, no ephemeral `trycloudflare` tunnels.

**Runbook:** [docs/operations/STAGING_HOST.md](../../docs/operations/STAGING_HOST.md)

## Layout

| File | Purpose |
|------|---------|
| `docker-compose.full.yml` | Coolify (from `../local`) + bridge + optional Caddy TLS |
| `docker-compose.yml` | Bridge (+ Caddy) only when Coolify already runs |
| `coolify.linux.yml` | Linux overrides (`IS_WINDOWS_DOCKER_DESKTOP=false`, bind UI to localhost) |
| `caddy/Caddyfile` | `coolify.*` and `bridge.*` reverse proxy |
| `.env.example` | Staging URLs, tokens, app UUID |

## Quick start (fresh VPS)

```bash
sudo bash scripts/staging-vps-bootstrap.sh --repo-dir /opt/dexter
```

Then follow the printed checklist (Coolify onboarding, API token, `dexter` app, DNS, TLS).

## Manual compose

```bash
cd infra/coolify/staging
cp .env.example .env   # edit STAGING_DOMAIN, tokens, UUID

# Full stack
docker compose -f docker-compose.full.yml up -d

# Bridge only (Coolify already up)
docker compose -f docker-compose.yml up -d

# Enable HTTPS (after DNS → VPS)
docker compose -f docker-compose.full.yml --profile tls up -d
```

## Wire registry + app

From repo root (`.env` or staging `.env` with `COOLIFY_ORIGIN` + token):

```bash
npm run coolify:ghcr-wire
```

On Linux VPS with **private** GHCR packages:

```bash
bash scripts/coolify-host-ghcr-login.sh
```

## Verify + CI secrets

```bash
bash scripts/staging-vps-verify.sh
bash scripts/staging-vps-sync-secrets.sh
gh workflow run closed-loop-staging.yml -f coolify_origin=https://coolify.staging.example.com
```

## DNS

Point these records at the VPS public IP:

- `coolify.<STAGING_DOMAIN>` → Coolify panel (via Caddy)
- `bridge.<STAGING_DOMAIN>` → Dexter bridge
- `dexter.<STAGING_DOMAIN>` → App FQDN (configure in Coolify UI; Traefik routes the container)

## Local dev vs this stack

| | `infra/coolify/local` | `infra/coolify/staging` |
|--|----------------------|-------------------------|
| Host | Mac / laptop | Linux VPS |
| Exposure | trycloudflare tunnels | Caddy + real DNS |
| Bridge | `npm run coolify:bridge` | Docker service (always on) |
