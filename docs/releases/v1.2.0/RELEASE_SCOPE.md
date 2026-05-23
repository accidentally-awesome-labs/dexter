# Dexter v1.2.0 — Release Scope (draft)

**Status:** Planning on `main`  
**Predecessor:** [v1.1.0 RELEASE_SCOPE.md](../v1.1.0/RELEASE_SCOPE.md)  
**Plan:** [V1_2_PRODUCTION_FACTORY_PLAN.md](../../planning/V1_2_PRODUCTION_FACTORY_PLAN.md)

---

## Product promise (v1.2)

Repeatable **production factory**: registry-backed deploys, stable staging (no laptop/tunnels), and promotion on a real Coolify host — building on v1.1’s closed loop.

## Planned scope

| Area | v1.2 target |
|------|-------------|
| Registry | `deploy:publish` → GHCR/generic registry; digest in manifest |
| Staging | Fixed host + documented secrets; `closed-loop-staging` without tunnels |
| CI fidelity | Scheduled full `factory:e2e` on staging; keep `factory:ci-drill` on PRs |
| Multi-service | Provision `{project}` + `{project}-worker`; apps.json schema 1.1 |
| Promotion | `promotion:pipeline` proof on staging Coolify |
| Release | `main` as default branch; tag policy from `main` |

## Explicitly out of scope (v1.2)

- Full cursor-cli agent in every CI run
- Non-Coolify prod control planes
- Multi-tenant Dexter SaaS

## Verification (in progress — P1)

- [x] `deploy:publish` command + manifest fields (`registry`, `imageDigest`, `publishedAt`)
- [x] [STAGING_HOST.md](../../operations/STAGING_HOST.md) runbook
- [ ] Registry push + Coolify pull same run tag on staging host (`npm run ghcr:login`, `registry:publish-drill`, CI `registry-publish.yml`)
- [x] Two consecutive staging workflow passes without local dev machine ([26338656357](https://github.com/accidentally-awesome-labs/dexter/actions/runs/26338656357), [26338685977](https://github.com/accidentally-awesome-labs/dexter/actions/runs/26338685977); interim: local Coolify + trycloudflare tunnels via `scripts/staging-refresh-tunnels.sh`)
- [ ] Promotion pipeline manifest on staging
- [ ] Tag `v1.2.0-rc1` → soak → `v1.2.0`
