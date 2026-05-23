# Production Integration (Real Services)

Dexter's operational milestones are validated with local mocks. This guide wires **real** control planes, health checks, and alert destinations for bucket-2 production use.

## Provider recommendation

| Provider | Status | Use for |
|----------|--------|---------|
| **Coolify** | Implemented (`npm run coolify:bridge`) | dev, staging, canary, prod |
| Dokploy | Not implemented | dev/staging only (future) |
| Dokku | Not implemented | dev/staging only (future) |

Start with **Coolify** — it is the only provider wired to the real API and the only one allowed for canary/prod in `DEPLOY_AUTH_POLICY.json`.

## Architecture

Dexter uses a **generic HTTP deploy contract** toward the control plane adapter. For Coolify, run the included bridge that calls the Coolify API:

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/deploy` (configurable) | `Bearer <token>` | `{ provider, appName, action, authorizationToken }` |
| POST | `/rollback` (configurable) | same | same |

Implementation: `src/providers/deployment/coolify-api.ts`

Your bridge (or hook scripts) must translate these calls into real provider actions.

### Option A: Coolify bridge (recommended)

Dexter ships a bridge that calls Coolify `/api/v1`:

```bash
cp infra/coolify/apps.example.json infra/coolify/apps.json
# edit application UUIDs

export COOLIFY_ORIGIN=https://coolify.example
export COOLIFY_API_TOKEN=<coolify-api-token>
export DEXTER_BRIDGE_TOKEN=<bridge-secret>
export DEXTER_COOLIFY_API_URL=http://127.0.0.1:9876
export DEXTER_COOLIFY_TOKEN=$DEXTER_BRIDGE_TOKEN

npm run coolify:bridge
```

See `infra/coolify/bridge/README.md`.

### Option B: Shell hooks

`infra/coolify/hooks/deploy.sh` and `rollback.sh` call the Coolify API via `npm run coolify:deploy` / `coolify:rollback`. Hook mode works for `deploy:self`, but `promotion:pipeline` defaults to `--require-api true`, so use the bridge for full staged promotion.

### Option C: Custom HTTP bridge

You can still deploy your own service implementing `POST /deploy` and `POST /rollback` if you do not use the built-in Coolify bridge.

## Environment setup

1. Copy the template:

   ```bash
   cp .env.example .env
   ```

2. Fill control plane URL/token, health URL, production signing keys, and alert webhooks.

3. Load env (Dexter loads `.env` via `dotenv` on startup).

## Preflight checklist

Run before any real promotion:

```bash
npm run production:preflight
```

This writes `artifacts/release/PRODUCTION_PREFLIGHT.json` and checks:

- Control plane credentials and reachability
- `DEXTER_DEPLOY_HEALTH_URL`
- Non-dev deploy signing keys (warning unless `--strict-secrets true`)
- Planning signatures + supply chain gate artifacts
- Release decision GO and zero unresolved escalations

Flags:

- `--probe-api false` — skip HTTP reachability probe
- `--require-alerts true` — fail if no alert webhooks configured
- `--strict-secrets true` — treat dev default keys as blockers

## Recommended rollout sequence

### 1. Seed governance artifacts

```bash
npm run run:sample
npm run release:decision
npm run production:preflight
```

### 2. Prove staging deploy (single stage)

```bash
npm run deploy:self -- \
  --environment staging \
  --require-api true \
  --health-url https://staging.your-service.example/health \
  --app your-app
```

Verify `artifacts/release/self_deploy_result.json` shows `deploymentMode: "api"`.

### 3. Run full staged promotion

```bash
npm run promotion:pipeline -- \
  --app your-app \
  --health-url https://staging.your-service.example/health
```

Stages: `dev → staging → canary → prod` (see `DEPLOY_PROMOTION_POLICY.md`).

- **Canary** uses `DEXTER_CANARY_*` env metrics or `--canary-metrics` snapshot file — wire real observability for production.
- **Prod** requires a passing canary gate artifact from the prior stage.

### 4. Enable live alerts

```bash
export DEXTER_ALERT_CHAT_WEBHOOK_URL=https://hooks.slack.com/services/...
export DEXTER_ALERT_PAGER_WEBHOOK_URL=https://events.pagerduty.com/...

npm run ops:status
npm run alert:route -- --dry-run false
```

### 5. Closed-loop E2E (idea → deploy)

Proves the full factory path with a **real** Coolify API deploy (not simulated):

```bash
# Terminal 1: bridge must be running
npm run coolify:bridge

# Terminal 2: one command
npm run factory:e2e
```

Requirements:

- `infra/coolify/apps.json` maps your Coolify app name (default `dexter`)
- `DEXTER_COOLIFY_API_URL` + `DEXTER_COOLIFY_TOKEN` in `.env`
- Health resolution order: app FQDN probe (default), optional `DEXTER_DEPLOY_HEALTH_URL` when `DEXTER_E2E_ALLOW_PANEL_HEALTH=true`, panel `/api/health` fallback (warns in report)

Track B env (see `.env.example`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEXTER_CLOSED_LOOP_SMOKE` | `true` in `factory:e2e` | Injects stamp task → `generated/RUN_STAMP.json` |
| `DEXTER_E2E_STRICT_HEALTH` | `true` | Fail E2E if health uses panel fallback |
| `DEXTER_DEPLOY_USE_MANIFEST_TAG` | `false` | Pass manifest `deployTag` to Coolify (needs registry tag) |
| `DEXTER_DEPLOY_SYNC_MANIFEST` | `false` | PATCH Coolify app image from manifest before deploy |
| `DEXTER_REQUIRE_API_DEPLOY` | auto when bridge env set | Fail runs if deploy is not `api` mode (`intake:run`, uses this) |

Success writes `artifacts/release/CLOSED_LOOP_E2E.json` (schema **1.1**) with `deploymentMode: "api"`, `deployArtifactRef`, and `passed: true`.

### 5a. CI closed-loop drill (no live Coolify)

GitHub Actions runs a mock Coolify + bridge drill on every PR:

```bash
npm run coolify:integration-drill
npm run factory:ci-drill
```

`factory:ci-drill` builds a deploy manifest, PATCHes the mock app image, deploys via the bridge, and writes `artifacts/release/CLOSED_LOOP_E2E.json` with `ci.drill: "factory:ci-drill"`. CI uploads that file as artifact `closed-loop-e2e-ci`.

### 5b. Staging E2E (manual)

For a real Coolify panel, use workflow **closed-loop-staging** (`workflow_dispatch`) with repository secrets (`COOLIFY_*`, `DEXTER_*`). Set `coolify_origin` to your panel URL; the job runs `factory:e2e` with strict health.

**v1.0 scope:** See [releases/v1.0.0/RELEASE_SCOPE.md](../releases/v1.0.0/RELEASE_SCOPE.md).  
**v1.1 product loop (deploy built artifact + app URL health):** [releases/v1.1.0/RELEASE_SCOPE.md](../releases/v1.1.0/RELEASE_SCOPE.md) and [planning/TRACK_B_CLOSED_LOOP_PRODUCT_PLAN.md](../planning/TRACK_B_CLOSED_LOOP_PRODUCT_PLAN.md).

### 6. Continuous reliability

- Schedule `npm run soak:schedule` (see `.github/workflows/soak-schedule.yml`).
- Monitor `npm run operational:kpi` and `npm run ops:status`.

## Control plane by environment

From `docs/specs/DEPLOY_AUTH_POLICY.json`:

| Environment | Allowed providers |
|-------------|-------------------|
| dev, staging | coolify, dokploy, dokku |
| canary, prod | **coolify only** |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `deploymentMode: simulated` | Missing API URL/token | Set `DEXTER_COOLIFY_API_URL` + `TOKEN` |
| Promotion blocked at preflight | NO-GO or escalations | `npm run release:decision`, resolve escalations |
| Canary fails | Default metric env not real | Export observability to `DEXTER_CANARY_*` or snapshot JSON |
| Health check fails | Wrong URL or service down | Fix `DEXTER_DEPLOY_HEALTH_URL` |
| Alerts not delivered | Dry-run default | `alert:route --dry-run false` + webhook env vars |

## Related docs

- `docs/operations/DEPLOY_PROMOTION_POLICY.md`
- `docs/operations/ALERT_RULES.yaml`
- `docs/operations/RUNBOOK_LINKS.md`
- `infra/coolify/README.md`
- `README.md` (Production Integration Env Vars)
