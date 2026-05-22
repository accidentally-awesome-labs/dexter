# Dexter v1 Autonomous Factory

Dexter is a polyglot-ready autonomous software factory inspired by Ralph-loop execution patterns and skill-driven planning pipelines. It runs through:

1. Discovery and deep-research artifact generation
2. Gapless planning and atomic task graph compilation
3. Policy-gated isolated execution
4. Verification, rollback readiness, and release packaging
5. Global learning graph updates for cross-run improvement

## Quickstart

```bash
npm install
npm run run:sample
npm test
```

## Core Commands

- `npm run start` - run Dexter with CLI args
- `npm run run:sample` - execute a full sample run
- `npm run deploy:self` - execute self-deploy through control-plane adapter (Coolify default)
- `npm run deploy:drill` - run deploy -> rollback -> redeploy validation drill
- `npm run deploy:drill:api` - same drill but hard-fails unless deploy/rollback use API mode
- `npm run deploy:drill:api:local` - run API-only drill against built-in local mock control-plane + health server
- `npm run promotion:pipeline` - run staged `dev -> staging -> canary -> prod` promotion with governance checks
- `npm run promotion:pipeline:local` - local mock promotion #1 (`dexter`)
- `npm run promotion:pipeline:local:2` - local mock promotion #2 (`dexter-ops-api`)
- `npm run promotion:pipeline:local:3` - local mock promotion #3 (`dexter-worker`)
- `npm run governance:verify` - verify waiver metadata and promotion policy consistency
- `npm run promotion:repeatability` - verify repeated promotions use the same gate behavior
- `npm run operator:readiness` - summarize operator workflow readiness from ops + release artifacts
- `npm run canary:rollback:drill` - force canary SLO breach and verify automatic rollback + audit capture
- `npm run milestone:m1:signoff` - verify Milestone 1 acceptance gates and write signoff artifact
- `npm run milestone:m3:signoff` - verify Milestone 3 reliability gates (30+ soak passes, KPI, learning controls) and write `MILESTONE_3_SIGNOFF.md`
- `npm run intake:normalize` - normalize a CLI request into `artifacts/intake/INTAKE_BRIEF.json`
- `npm run intake:normalize:issue` - normalize a GitHub issue fixture into intake brief
- `npm run intake:normalize:template` - normalize a template-driven request into intake brief
- `npm run intake:score` - re-score ambiguity on the latest intake brief using policy file
- `npm run intake:clarify` - run clarification gate against latest intake brief
- `npm run intake:normalize:ambiguous` - sample ambiguous intake that triggers clarification log
- `npm run intake:normalize:high-risk` - sample high-risk intake with elevated risk/priority scores
- `npm run intake:route-preview` - preview AFK/HITL routing for latest intake brief
- `npm run intake:plan` - compile planning artifacts from latest intake brief
- `npm run intake:run` - execute full Dexter run starting from latest intake brief
- `npm run intake:pilot:batch` - run Milestone 2 Day 9 five-request intake pilot batch
- `npm run intake:pilot:batch:full` - same pilot batch with full orchestrator runs
- `npm run ops:status` - write consolidated operator status dashboard artifacts
- `npm run resume:check` - inspect resume readiness for a run (`--latest true` supported)
- `npm run trust:gates` - run failure-injection trust gate matrix and write report artifacts
- `npm run soak:cycle` - run one full soak cycle and update streak gate status (`SOAK_STATUS.json`) plus trend rollups (`SOAK_TRENDS.json`)
- `npm run soak:schedule` - run a scheduled soak cycle when due (writes `SOAK_SCHEDULE_STATE.json`)
- `npm run soak:reliability` - refresh run-to-run reliability deltas and warnings (`SOAK_RELIABILITY.json`)
- `npm run reliability:kpi` - rolling-100 KPI review with top risks and prioritized mitigation backlog (`RELIABILITY_KPI.json`)
- `npm run test:unit` - run unit tests with telemetry ingest, flaky scoring, and quarantine report (`FLAKY_QUARANTINE.json`)
- `npm run benchmark:backend` - benchmark pluggable coding backends and select default
- `npm run dogfood:run` - run multi-scenario dogfood benchmark
- `npm run dogfood:metrics` - regenerate aggregated run metrics
- `npm run provenance:verify` - verify in-toto/SLSA provenance linkage
- `npm run attest:verify` - verify release attestation signatures
- `npm test` - verify required release artifacts exist
- `npm run build` - compile TypeScript

## Production Integration Env Vars

- `DEXTER_APPROVAL_SIGNING_KEY` - HMAC key for signed HITL approvals
- `DEXTER_COOLIFY_API_URL` / `DEXTER_COOLIFY_TOKEN` - Coolify deployment API endpoint + token
- `DEXTER_DOKPLOY_API_URL` / `DEXTER_DOKPLOY_TOKEN` - Dokploy deployment API endpoint + token
- `DEXTER_DOKKU_API_URL` / `DEXTER_DOKKU_TOKEN` - Dokku deployment API endpoint + token
- `DEXTER_CONTROL_PLANE_ENDPOINT` / `DEXTER_CONTROL_PLANE_TOKEN` - backward-compatible Coolify fallback vars
- `DEXTER_COOLIFY_DEPLOY_PATH`, `DEXTER_COOLIFY_ROLLBACK_PATH` - optional endpoint path overrides (provider-specific variants also supported for Dokploy/Dokku)
- `DEXTER_DEPLOY_HEALTH_URL` / `DEXTER_DEPLOY_HEALTH_URLS` - comma-separated health endpoints checked immediately after deploy
- `DEXTER_DEPLOY_HEALTH_TIMEOUT_MS` - timeout per health endpoint (default `5000`)
- `DEXTER_SOAK_TARGET_STREAK` - consecutive successful soak cycles required before release gate is satisfied (default `10`)
- `DEXTER_AGENT_BACKEND` - active coding backend adapter (`cursor-cli`, `shell`, or `scripted`)
- `DEXTER_RESEARCH_API_URL` - optional live research API endpoint
- `DEXTER_RESEARCH_API_KEY` - optional bearer token for research API
- `DEXTER_PLAN_SIGNING_KEY` - key for planning artifact signature integrity gate
- `DEXTER_DEPLOY_AUTH_KEY` - key used to sign deploy authorization chain tokens
- `DEXTER_DEPLOY_APPROVER` - signer identity embedded into deploy authorization
- `DEXTER_DEPLOY_ENV` - expected deployment environment scope (default `production`)
- `DEXTER_DEPLOY_SOURCE_ENV` - source environment identity in auth token (defaults to target env)
- `DEXTER_DEPLOY_TENANT` - expected tenant scope for deployment authorization
- `DEXTER_POLICY_BUNDLE_KEY` - key used to sign and verify deploy policy bundle metadata
- `DEXTER_ATTESTATION_KEY` - signing key for release artifact attestation
- `DEXTER_ATTESTATION_KEY_ID` - metadata key identifier embedded in attestations
- `DEXTER_ATTESTATION_TRUSTED_KEYS` - comma-separated previous keys accepted during rotation
- `DEXTER_ATTESTATION_PRIVATE_KEY` / `DEXTER_ATTESTATION_PRIVATE_KEY_B64` - private key for asymmetric attestation signing
- `DEXTER_ATTESTATION_PUBLIC_KEY` / `DEXTER_ATTESTATION_PUBLIC_KEY_B64` - active public key for asymmetric attestation verification
- `DEXTER_ATTESTATION_TRUSTED_PUBLIC_KEYS` - comma-separated trusted public keys during rotation windows

## Opinionated v1 Defaults

- Core runtime: TypeScript + Node.js LTS
- Isolation: Docker + Compose (Podman fallback)
- Memory: Hybrid graph + vector + global learning graph
- KB: Git-native markdown + ADR corpus
- Observability: Structured run logs + OpenTelemetry-compatible event model
- Deployment target: Coolify adapter first (Dokploy/Dokku adapters included)

## Repo Layout

- `src/` - orchestration and module implementations
- `artifacts/` - generated delivery artifacts
- `docs/` - governance, security, architecture, and operations docs
- `infra/` - runtime and control-plane templates
- `tech-radar/` - tooling decisions and benchmark records
- `global-memory/` - cross-run learning graph policies and schema
