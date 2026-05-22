# Production Integration (Real Services)

Dexter's operational milestones are validated with local mocks. This guide wires **real** control planes, health checks, and alert destinations for bucket-2 production use.

## Architecture

Dexter does not call Coolify/Dokploy/Dokku APIs directly. It uses a **generic HTTP deploy contract**:

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/deploy` (configurable) | `Bearer <token>` | `{ provider, appName, action, authorizationToken }` |
| POST | `/rollback` (configurable) | same | same |

Implementation: `src/providers/deployment/coolify-api.ts`

Your bridge (or hook scripts) must translate these calls into real provider actions.

### Option A: HTTP bridge (recommended)

Deploy a small service that:

1. Validates the Bearer token.
2. On `/deploy`, triggers your CI/CD or control-plane deploy for `appName`.
3. On `/rollback`, rolls back to the previous revision.
4. Returns JSON: `{ "deploymentId": "...", "status": "ok", "revision": "..." }`.

Point Dexter at the bridge:

```bash
export DEXTER_COOLIFY_API_URL=https://deploy-bridge.internal
export DEXTER_COOLIFY_TOKEN=<secret>
```

### Option B: Shell hooks

If `infra/coolify/hooks/deploy.sh` and `rollback.sh` invoke real tooling and exit 0, Dexter can use **hook** mode — but `promotion:pipeline` defaults to `--require-api true`, so hooks alone are not enough for full staged promotion unless you drop that flag.

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

### 5. Continuous reliability

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
