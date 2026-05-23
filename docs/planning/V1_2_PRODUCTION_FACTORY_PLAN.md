# v1.2 — Production Factory Hardening Plan

**Status:** Planning kickoff on `main` (post v1.1.0 merge)  
**Owner:** _TBD_  
**Depends on:** [v1.1.0 RELEASE_SCOPE.md](../releases/v1.1.0/RELEASE_SCOPE.md) (Track B closed-loop GA)  
**Goal:** Move from **credible local/staging loop** to **repeatable production factory** — registry-backed deploys, stable staging, real agent execution in CI, and multi-service Coolify topology without tunnel hacks.

---

## 1. Problem statement

v1.1.0 proves the product loop with:

- Per-run deploy manifest + optional local docker build
- Coolify bridge API deploy + strict FQDN health
- CI mock drill (`factory:ci-drill`) and manual staging workflow

It does **not** yet prove:

1. **Registry-backed deploys** — built images pushed and pulled by Coolify in staging/prod
2. **Stable staging** — no ephemeral `trycloudflare` tunnels or Postgres FQDN patches
3. **Real execution in CI** — factory runs use deterministic agent/scaffold beyond stamp task
4. **Multi-service projects** — worker/API apps provisioned and promoted together
5. **Remote promotion** — `promotion:pipeline` on a non-local Coolify panel

---

## 2. Definition of done (v1.2 GA)

| # | Criterion | Verification |
|---|-----------|----------------|
| D1 | `npm run deploy:publish` pushes manifest image to GHCR (or configured registry) | Digest in `deploy_manifest.json` + Coolify pull succeeds |
| D2 | Staging workflow runs **without** manual tunnels | `closed-loop-staging` green against fixed host + secrets |
| D3 | `factory:e2e` in CI uses **full runDexter** on schedule OR staging dispatch weekly | Artifact `CLOSED_LOOP_E2E.json` from GHA, not drill-only |
| D4 | Multi-app provision for `project` + `{project}-worker` | `coolify:provision --services api,worker` updates `apps.json` |
| D5 | `promotion:pipeline` passes on staging Coolify | `PROMOTION_MANIFEST.json` with all stages `deploymentMode: api` |
| D6 | Operator docs: production host runbook (no DB FQDN patch) | `PRODUCTION_INTEGRATION.md` + `infra/coolify/staging/` |
| D7 | `main` is default branch; release tags from `main` | GitHub default branch + release policy doc |

---

## 3. Workstreams

### C1 — Registry & image pipeline (5–7 days)

| Task | Deliverable |
|------|-------------|
| C1.1 | `deploy:publish` — docker build, tag, push to `GHCR` / `DEXTER_REGISTRY` |
| C1.2 | Manifest fields: `imageDigest`, `registry`, `publishedAt` |
| C1.3 | Bridge sync uses digest or immutable tag; Coolify pull auth via secrets |
| C1.4 | CI: build + push smoke image on `main` (optional job, no deploy) |

**Exit:** Staging deploy pulls the image Dexter built in the same run.

### C2 — Stable staging infrastructure (3–5 days)

| Task | Deliverable |
|------|-------------|
| C2.1 | Document fixed staging Coolify host (VPS or long-lived compose) |
| C2.2 | Bridge as systemd/docker service on staging host OR Cloudflare tunnel with named route |
| C2.3 | App FQDN via Coolify UI/API (eliminate Postgres FQDN workaround) |
| C2.4 | Rotate staging secrets doc; `COOLIFY_APP_UUID` in GitHub secrets |

**Exit:** Re-run `closed-loop-staging` twice without local laptop online.

### C3 — Factory fidelity in automation (5–8 days)

| Task | Deliverable |
|------|-------------|
| C3.1 | `DEXTER_E2E_AGENT_BACKEND` — `shell` \| `scaffold` \| `cursor-cli` |
| C3.2 | Scaffold backend: deterministic multi-file mutation for E2E (beyond stamp) |
| C3.3 | Optional scheduled workflow: `factory:e2e` on staging (weekly) |
| C3.4 | Separate `factory:ci-drill` (fast PR gate) from full E2E (nightly/staging) |

**Exit:** Staging E2E report shows non-stamp repo mutation OR documented agent backend in CI.

### C4 — Multi-service & promotion (4–6 days)

| Task | Deliverable |
|------|-------------|
| C4.1 | Extend `coolify-provision` for service list |
| C4.2 | `apps.json` schema 1.1 — `services: { api, worker }` |
| C4.3 | Promotion pipeline reads service map; stages deploy both or document api-only GA |
| C4.4 | Staging proof: `promotion:pipeline` through canary gate with snapshot metrics |

**Exit:** Two-app project promotes on staging with API deploy at each stage.

### C5 — Release hygiene (1–2 days)

| Task | Deliverable |
|------|-------------|
| C5.1 | GitHub default branch → `main` |
| C5.2 | Tag policy: `v1.x.y` from `main`; `v1.x.y-rcN` optional |
| C5.3 | README version sections updated (v1.1 shipped, v1.2 plan link) |
| C5.4 | Archive Track B plan status → complete |

---

## 4. Sequencing (suggested)

| Phase | Focus | Exit |
|-------|-------|------|
| P1 | C5 release hygiene + C2 staging host | `main` default; staging host reachable |
| P2 | C1 registry publish | Image push + Coolify pull on staging |
| P3 | C3 factory fidelity | Full E2E on staging schedule |
| P4 | C4 multi-service promotion | Promotion manifest on staging |
| P5 | Soak + tag `v1.2.0-rc1` → `v1.2.0` | GA checklist green |

## 5. Out of scope (v1.2)

- Replacing shell agent with full autonomous cursor-cli in every CI run (cost/latency)
- Non-Coolify control planes in production promotion
- Multi-tenant SaaS Dexter hosting

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| GHCR auth in CI | `GITHUB_TOKEN` / `GHCR_PAT` secret; document org package permissions |
| Coolify pull private images | Configure registry credentials in Coolify UI |
| Full E2E duration in GHA | Staging-only schedule; keep `factory:ci-drill` on PRs |
| Multi-app UUID drift | Provision idempotency tests + preflight app name check |

---

## 7. Open questions (kickoff)

1. **Registry:** GHCR only, or support generic `DEXTER_REGISTRY`?
2. **Staging host:** Existing VPS vs new Coolify Cloud vs self-hosted compose on CI runner?
3. **Multi-service GA:** Both api+worker required for v1.2, or api-only with worker beta?
4. **Agent backend default for E2E:** Keep stamp + scaffold, or require scaffold mutation?

**Planning defaults:** GHCR + generic registry URL; long-lived staging VPS; api-only GA with worker behind flag; stamp + scaffold for CI.

---

## 8. Documentation deliverables

- `docs/releases/v1.2.0/RELEASE_SCOPE.md`
- `docs/operations/STAGING_HOST.md` (new)
- Update `PRODUCTION_INTEGRATION.md` — registry publish, stable staging
- Update `README.md` — v1.1 shipped / v1.2 roadmap

---

## Appendix — v1.1 deferred items → v1.2 mapping

| v1.1 out of scope | v1.2 workstream |
|-------------------|-----------------|
| GHCR push automation | C1 |
| Full cursor-cli in CI | C3 (partial / scaffold) |
| Multi-app provision (B2b) | C4 |
| Remote promotion | C4 + C2 |
| Ephemeral tunnel staging | C2 |
| `main` as default branch | C5 |
