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
- `npm run dogfood:run` - run multi-scenario dogfood benchmark
- `npm run dogfood:metrics` - regenerate aggregated run metrics
- `npm run provenance:verify` - verify in-toto/SLSA provenance linkage
- `npm run attest:verify` - verify release attestation signatures
- `npm test` - verify required release artifacts exist
- `npm run build` - compile TypeScript

## Production Integration Env Vars

- `DEXTER_APPROVAL_SIGNING_KEY` - HMAC key for signed HITL approvals
- `DEXTER_CONTROL_PLANE_ENDPOINT` - optional deployment API base URL (expects `/deploy` and `/rollback`)
- `DEXTER_CONTROL_PLANE_TOKEN` - bearer token for deployment API calls
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
