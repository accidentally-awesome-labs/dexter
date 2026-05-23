# Dexter v1.1.0 — Release Scope (Track B product GA)

**Status:** `v1.1.0` GA tagged on `v1.0.0-rc1`  
**Predecessor:** [v1.0.0 RELEASE_SCOPE.md](../v1.0.0/RELEASE_SCOPE.md) (factory OS + integration)  
**Plan:** [TRACK_B_CLOSED_LOOP_PRODUCT_PLAN.md](../../planning/TRACK_B_CLOSED_LOOP_PRODUCT_PLAN.md)

---

## Product promise (v1.1)

One credible closed loop: **idea → built artifact → deploy that artifact → health on the app URL**, with a documented operator path and CI proof of the deploy contract.

## In scope

| Area | v1.1 deliverable |
|------|------------------|
| Health | FQDN-first strict E2E (`CLOSED_LOOP_E2E.json` schema 1.1) |
| Deploy | Per-run `deploy_manifest.json`, optional docker build, Coolify image sync |
| Repo mutation | `DEXTER_CLOSED_LOOP_SMOKE` stamp task |
| Provision | `npm run coolify:provision`, `DEXTER_COOLIFY_AUTO_PROVISION` |
| Operator path | `factory:bootstrap` → bridge → `npm run factory` |
| CI | `factory:ci-drill` + `coolify:integration-drill`; artifact upload |
| Intake | `intake:run` requires API deploy when bridge env present |

## Out of scope (v1.1)

- Full `cursor-cli` agent backend in CI
- GHCR push automation (local docker build only)
- Multi-app Coolify provisioning per project (B2b)
- Replacing `main` as default branch (ops decision)

## Verification

- [x] `npm run factory:ci-drill` green in CI (PR #12)
- [x] Local `npm run factory:e2e` with strict health + running app FQDN — [CLOSED_LOOP_E2E_LOCAL_PROOF.json](./CLOSED_LOOP_E2E_LOCAL_PROOF.json)
- [x] Staging workflow proof — [CLOSED_LOOP_E2E_STAGING_PROOF.json](./CLOSED_LOOP_E2E_STAGING_PROOF.json) (supersedes [v1.0.0-rc1 proof](../v1.0.0-rc1/CLOSED_LOOP_E2E_PROOF.json) for product loop)
- [x] Tag `v1.1.0-rc1` — [RC1_CHECKLIST.md](./RC1_CHECKLIST.md)
- [x] Tag `v1.1.0` — [GA_CHECKLIST.md](./GA_CHECKLIST.md)
