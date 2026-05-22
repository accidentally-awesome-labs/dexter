# Dexter v1.0.0 — Release Scope

**Release name:** v1.0.0 — Factory + Production Integration  
**Status:** GA scope (see [GA_CHECKLIST.md](./GA_CHECKLIST.md) before tagging)  
**Successor product track:** [TRACK_B_CLOSED_LOOP_PRODUCT_PLAN.md](../../planning/TRACK_B_CLOSED_LOOP_PRODUCT_PLAN.md) (v1.1)

## What v1.0.0 is

Dexter v1.0.0 is a **policy-gated autonomous software factory runtime** with **production integration hooks**, not a fully hands-off “idea → your new service URL with zero prep” product.

In scope:

| Capability | Description |
|------------|-------------|
| **Intake → plan → execute → verify** | CLI/issue/template intake, task graph, policy gates, escalation lifecycle, replay-stable planning |
| **Release governance** | GO/NO-GO, provenance, attestation, deploy authorization chain, staged promotion policy |
| **Control plane (Coolify)** | HTTP bridge, Coolify API client, `apps.json` mapping, deploy/rollback hooks |
| **Operations** | `ops:status`, alert routing, soak cycles, reliability KPIs, cross-milestone signoff |
| **Integration proof** | `production:preflight`, `promotion:pipeline` with `deploymentMode: "api"`, `factory:e2e` closed-loop drill |
| **Milestone artifacts** | M1–M4 signoff paths, operational KPI, audit log |

## What v1.0.0 is not (explicitly out of scope)

| Not in v1.0.0 | Planned |
|---------------|---------|
| Deploying **code produced in the same run** to a net-new Coolify app without prior app provisioning | Track B — B2 |
| Health checks on **application FQDN** when only control-plane health is configured | Track B — B1 |
| Default **cursor-cli** (or equivalent) agent building a greenfield repo on every run | Track B — B3 |
| Dokploy/Dokku production deploy adapters | Future |
| Remote/managed Dexter SaaS control plane | Future |
| Zero-config first run (no `.env`, no `apps.json`, no bridge process) | Track B — B4 |

## Positioning (README-aligned)

- **v1.0.0:** Factory OS + Coolify integration — safe, repeatable, auditable automation with real API deploy when wired.
- **v1.1 (Track B):** Product closed loop — idea → built artifact → deploy that artifact → health on app URL.

## Evidence from this repo (local integration)

The following were validated on a **local** Coolify instance (`infra/coolify/local/`) and bridge at `127.0.0.1:9876`:

- `npm run factory:e2e` → `CLOSED_LOOP_E2E.json` with `passed: true`, `deploymentMode: "api"`
- `npm run promotion:pipeline` → four stages with API deploy IDs (staging/canary/prod)
- `npm run production:preflight --require-alerts true` → blockers pass when webhooks configured
- `npm run alert:live-drill` → deliveries in `ALERT_DELIVERIES.jsonl`

Operators running in **production** must repeat checks on their Coolify host, health URLs, and alert endpoints.

## Related documents

- [GA_CHECKLIST.md](./GA_CHECKLIST.md) — pre-tag verification
- [RELEASE_NOTES.md](./RELEASE_NOTES.md) — user-facing summary
- [../v1.0.0-rc1/RELEASE_CANDIDATE.md](../v1.0.0-rc1/RELEASE_CANDIDATE.md) — rc1 freeze criteria
- [../../operations/PRODUCTION_INTEGRATION.md](../../operations/PRODUCTION_INTEGRATION.md) — wiring guide
