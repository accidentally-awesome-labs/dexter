# v1.1.0-rc1 Checklist

Complete on branch `v1.0.0-rc1` before tagging `v1.1.0-rc1`. Check items only with command output or committed proof artifacts.

**Validation log (2026-05-23):** Track B Week 3 merged (#12); staging workflow + local E2E passed; tag `v1.1.0-rc1` pushed.

## 1. CI closed-loop drills

- [x] `npm run factory:ci-drill` passes locally
- [x] `npm run coolify:integration-drill` passes locally
- [x] PR CI `validate` job includes both drills (see PR #12)

## 2. Staging E2E (GitHub Actions)

Prerequisites: repository secrets (`COOLIFY_*`, `DEXTER_*`, `COOLIFY_APP_UUID`), local Coolify + bridge reachable via tunnel, app FQDN points at a passing health URL.

- [x] Workflow `.github/workflows/closed-loop-staging.yml` present
- [x] `workflow_dispatch` run passed — [actions run 26324234124](https://github.com/accidentally-awesome-labs/dexter/actions/runs/26324234124)
- [x] Redacted proof: [CLOSED_LOOP_E2E_STAGING_PROOF.json](./CLOSED_LOOP_E2E_STAGING_PROOF.json)

## 3. Local factory E2E

Prerequisites: `infra/coolify/local` up, `.env` + `apps.json`, `npm run coolify:bridge`, app health on FQDN (e.g. nginx on `:18080`).

- [x] `npm run factory:e2e -- --skip-preflight true` → exit 0
- [x] `artifacts/release/CLOSED_LOOP_E2E.json` → `passed: true`, `deploymentMode: "api"`, schema **1.1**
- [x] Redacted proof: [CLOSED_LOOP_E2E_LOCAL_PROOF.json](./CLOSED_LOOP_E2E_LOCAL_PROOF.json)

## 4. Scope and docs

- [x] [RELEASE_SCOPE.md](./RELEASE_SCOPE.md) reflects Track B v1.1 deliverables
- [x] [PRODUCTION_INTEGRATION.md](../../operations/PRODUCTION_INTEGRATION.md) documents `factory:ci-drill` and staging workflow
- [ ] Optional: `npm run production:preflight` with full alert webhooks on target host
- [ ] Optional: promotion pipeline on non-local Coolify

## 5. Tag (maintainer)

- [x] Tag `v1.1.0-rc1` pushed (`30a6f17`)

When sections 1–4 are satisfied:

```bash
git checkout v1.0.0-rc1
git pull origin v1.0.0-rc1
git tag -a v1.1.0-rc1 -m "Dexter v1.1.0-rc1 — Track B closed-loop product loop"
git push origin refs/tags/v1.1.0-rc1
```

After soak on RC, repeat for `v1.1.0` GA per [RELEASE_SCOPE.md](./RELEASE_SCOPE.md).

## Staging operator notes

- **Secrets:** `gh secret set` for `COOLIFY_API_TOKEN`, `DEXTER_COOLIFY_API_URL` (public bridge URL), `DEXTER_COOLIFY_TOKEN`, `DEXTER_BRIDGE_TOKEN`, deploy/policy keys, `COOLIFY_APP_UUID`.
- **Tunnels:** Ephemeral `cloudflared` quick tunnels to Coolify (`:8001`), bridge (`:9876`), and app health (`:18080`) while the workflow runs.
- **App FQDN:** Coolify API may not allow PATCH `fqdn`; local dev can set `applications.fqdn` in Postgres for strict health from GitHub runners.
