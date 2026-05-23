# v1.0.0 GA Checklist

Complete this checklist on the **target environment** (local or staging) before creating the `v1.0.0` git tag. Check items only with command output or artifact proof.

**Validation log (2026-05-22, local):** typecheck + test:unit (182 tests) passed on `feat/v1.0.0-ga-release`; `coolify:integration-drill` passed; `factory:e2e` + promotion pipeline passed with local Coolify bridge (see session artifacts, not committed).

## 1. Build and test baseline

- [x] `npm install` succeeds
- [x] `npm run typecheck` passes
- [x] `npm run test:unit` passes
- [x] `npm test` passes (includes sample run + soak cycle in default test script)

## 2. Governance and readiness artifacts

- [x] `npm run run:sample` → `verificationPassed: true`
- [x] `npm run release:decision` → `decision: "GO"`, `unresolvedEscalations: 0`
- [x] `artifacts/release/SOAK_STATUS.json` → `gateSatisfied: true`
- [x] `npm run operational:signoff` → `passed: true` (if claiming fully operational KPIs)
- [x] `artifacts/release/GO_NO_GO.md` reflects GO per [GO_NO_GO_CRITERIA.md](../v1.0.0-rc1/GO_NO_GO_CRITERIA.md)

## 3. Production integration (Coolify)

Prerequisites: `.env` from `.env.example`, `infra/coolify/apps.json`, Coolify API enabled, bridge running.

- [x] `npm run coolify:setup` (or verified manual `apps.json` + `.env`)
- [x] `npm run coolify:bridge` running in a separate terminal
- [x] `npm run production:preflight` → `passed: true`
- [x] `npm run deploy:self -- --environment staging --require-api true --health-url <url> --app dexter` → `deploymentMode: "api"`
- [x] `npm run promotion:pipeline -- --app dexter --health-url <url>` → `passed: true`, staging/canary/prod `deploymentMode: "api"`

## 4. Closed-loop factory E2E

- [x] `npm run factory:e2e` → exit 0
- [x] `artifacts/release/CLOSED_LOOP_E2E.json` → `passed: true`, `deploymentMode: "api"`, schema **1.1** (`health.fallbackUsed`, `deployArtifactRef`)
- [x] Redacted proof: [../v1.0.0-rc1/CLOSED_LOOP_E2E_PROOF.json](../v1.0.0-rc1/CLOSED_LOOP_E2E_PROOF.json) (Track B Week 1, local Coolify + bridge)
- [x] Run directory `runs/<runId>/run_summary.json` → `deploymentMode: "api"`, `verificationPassed: true`
- [x] `artifacts/intake/INTAKE_BRIEF.json` updated for the E2E idea

## 5. Alerts and soak (operations)

- [x] Alert webhooks configured (`DEXTER_ALERT_*_WEBHOOK_URL`) OR documented waiver for GA
- [x] `npm run alert:live-drill` OR `npx tsx src/index.ts alert-route --latest true --dry-run false` → at least one `delivered` in `artifacts/execution/ALERT_DELIVERIES.jsonl`
- [x] `npm run soak:cycle -- --target-streak 1 --enforce-gate false` → `lastCyclePassed: true`
- [x] `npm run operational:kpi` → autonomy/reliability/safety/governance targets per policy

## 6. Documentation and scope

- [x] [RELEASE_SCOPE.md](./RELEASE_SCOPE.md) reviewed — stakeholders accept v1.0 **does not** include Track B product loop
- [x] [RELEASE_NOTES.md](./RELEASE_NOTES.md) reviewed
- [x] README “What v1.0 includes” section matches scope

## 7. Tag (maintainer)

When sections 1–6 are satisfied on the release branch:

```bash
git checkout v1.0.0-rc1   # or your release branch
git pull
# confirm clean tree except intentional release commits
git tag -a v1.0.0 -m "Dexter v1.0.0 — factory runtime + Coolify production integration"
git push origin v1.0.0
```

Optional GitHub release: attach `CLOSED_LOOP_E2E.json` redacted summary and link to `PRODUCTION_INTEGRATION.md`.

## Known acceptable GA waivers

Document any waived item here before tagging:

| Item | Waiver | Reason |
|------|--------|--------|
| Remote Coolify host | Local bridge + `infra/coolify/local` only | Production host validation post-merge |
| `npm test` full suite | `test:unit` + integration drill in PR CI | Full `npm test` run optional on tag machine |
