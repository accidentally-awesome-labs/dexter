# Dexter v1.1.0-rc1 — Release Notes (draft)

**Branch:** `v1.0.0-rc1`  
**Predecessor:** [v1.0.0](../v1.0.0/RELEASE_NOTES.md)

## Highlights

Track B delivers the **product closed loop**: idea → deploy manifest → Coolify API deploy via bridge → strict health on the application URL, with CI proof and a manual staging workflow.

## Added

- `factory:ci-drill` — mock Coolify + bridge closed-loop proof in PR CI
- `closed-loop-staging` GitHub Actions workflow (`workflow_dispatch`)
- `intake:run` auto-requires API deploy when bridge env is configured
- `DEXTER_RUN_STAMP_PATH` for alternate stamp locations
- v1.1 docs: [RELEASE_SCOPE.md](./RELEASE_SCOPE.md), staging/local E2E proofs, [RC1_CHECKLIST.md](./RC1_CHECKLIST.md)

## Verification

| Check | Status |
|-------|--------|
| PR CI `factory:ci-drill` | Green (PR #12) |
| Staging `closed-loop-staging` | Green ([run 26324234124](https://github.com/accidentally-awesome-labs/dexter/actions/runs/26324234124)) |
| Local `factory:e2e` | Green (see [CLOSED_LOOP_E2E_LOCAL_PROOF.json](./CLOSED_LOOP_E2E_LOCAL_PROOF.json)) |

## Upgrade notes

1. Ensure `infra/coolify/apps.json` maps your app UUID (or set `COOLIFY_APP_UUID` secret for staging workflow).
2. Run `npm run coolify:bridge` before `factory:e2e` / `intake:run` with API deploy.
3. For strict health, the Coolify app FQDN must return HTTP 200 (not panel `/api/health` fallback).

## Known limitations

- Staging workflow expects a reachable bridge + Coolify (tunnels or public host).
- GHCR image push and multi-app provision remain out of scope for v1.1.
