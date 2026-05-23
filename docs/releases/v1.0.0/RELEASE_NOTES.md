# Release Notes — Dexter v1.0.0

**Theme:** Factory runtime + Coolify production integration

## Summary

Dexter v1.0.0 delivers a policy-gated software factory: intake, planning, execution, verification, release packaging, staged promotion, and operational controls. Production deploys go through a **real Coolify API** path when the bridge and environment are configured.

This release does **not** yet guarantee that every run builds and deploys a net-new application artifact to its own public URL without operator setup. That scope is **[v1.1 / Track B](../../planning/TRACK_B_CLOSED_LOOP_PRODUCT_PLAN.md)**.

## Highlights

### Factory core

- End-to-end run: discovery → planning → policy-gated execution → verification → release artifacts
- Intake pipeline: normalize, ambiguity/risk scoring, clarification gate, AFK/HITL routing
- Escalation lifecycle, auto-replan waves, resume/triage commands
- Global learning graph, planning signatures, supply-chain and attestation gates

### Production integration (Coolify)

- Coolify API client and HTTP bridge (`npm run coolify:bridge`)
- `infra/coolify/apps.json` application UUID mapping
- `npm run production:preflight` for env and reachability checks
- Staged `npm run promotion:pipeline` with governance preflight
- **`npm run factory:e2e`** — idea → factory run → API deploy proof (`CLOSED_LOOP_E2E.json`)

### Operations

- Alert routing (`ALERT_RULES.yaml`, `alert:route`, `alert:live-drill`)
- Soak runner, scheduler, reliability KPIs
- Cross-milestone KPI and operational signoff commands

## Upgrade from v1.0.0-rc1

1. Pull latest `v1.0.0-rc1` (or release branch) including Coolify bridge merge.
2. Copy `.env.example` → `.env`; run `npm run coolify:setup`.
3. Run [GA_CHECKLIST.md](./GA_CHECKLIST.md).
4. Tag `v1.0.0` when checklist is complete on your environment.

## Breaking / behavior notes

- `npm run alert:route` no longer forces `--dry-run true` in the npm script; CLI default remains dry-run until `--dry-run false`.
- Orchestrator supports `DEXTER_REQUIRE_API_DEPLOY=true` or `requireApiDeploy` option — fails closed if deploy falls back to simulated mode.
- `loadSoakStatus` tolerates legacy truncated `SOAK_STATUS.json` (missing `history` array).

## Commands to try

```bash
npm run production:preflight
npm run coolify:bridge    # separate terminal
npm run factory:e2e
npm run promotion:pipeline -- --app dexter --health-url https://your-health.example/health
```

## What's next (v1.1)

See [Track B plan](../../planning/TRACK_B_CLOSED_LOOP_PRODUCT_PLAN.md): app FQDN health, deploy run-built artifacts, stronger agent backend, default closed-loop path.
