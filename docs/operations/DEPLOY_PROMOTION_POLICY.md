# Deploy Promotion Policy

This policy defines the required progression for production delivery:

`dev -> staging -> canary -> prod`

Any gate failure blocks promotion and triggers rollback policy.

## Scope

- Applies to all services deployed by Dexter-managed promotion flows.
- Applies to autonomous and human-approved promotions.
- Complements `docs/specs/AUTONOMY_POLICY.md` and incident procedures in `docs/operations/INCIDENT_RUNBOOK.md`.
- Uses role constraints defined in `docs/operations/RBAC_POLICY.json`.

## Promotion Stages and Exit Gates

### Stage: dev

Entry criteria:
- Code merged to release branch.
- CI status green (`typecheck`, `test:unit`, release checks).

Exit gates (must pass):
- Smoke checks pass.
- No unresolved required escalations.
- Release decision is `GO`.

Failure behavior:
- Block promotion to staging.
- Open escalation targeted to planner for remediation.

### Stage: staging

Entry criteria:
- Dev stage gates pass.
- Deployment authorization token valid for target environment.

Exit gates (must pass):
- Health checks pass for service endpoints.
- No P0/P1 regressions in staging verification suite.
- SLO burn state is `healthy` or `warn` (not `breach`).

Failure behavior:
- Auto-rollback staging deployment.
- Open high-priority operator escalation if rollback fails.

### Stage: canary

Entry criteria:
- Staging stage gates pass.
- Canary rollout percentage configured.

Exit gates (must pass across evaluation window):
- 5xx error rate <= threshold.
- p95 latency <= threshold.
- Error budget burn rate <= threshold.
- No critical incident alert triggered.

Failure behavior:
- Immediate rollback to last known-good release.
- Block progression to prod.
- Emit governed audit event for rollback trigger.

### Stage: prod

Entry criteria:
- Canary stage gates pass.
- Required approvals satisfied by RBAC policy.

Exit gates (must pass):
- Post-deploy smoke checks pass.
- SLO burn state remains non-breach.
- Release artifacts and attestations generated.

Failure behavior:
- Execute production rollback.
- Trigger incident workflow.
- Freeze further promotions until operator signoff.

## Rollback Trigger Matrix

| Trigger | Metric | Threshold | Evaluation Window | Action |
|---|---|---|---|---|
| Error rate breach | HTTP 5xx ratio | > 2% | 5 minutes | Rollback current stage immediately |
| Latency breach | p95 latency | > 1200 ms | 10 minutes | Rollback if sustained for full window |
| Error budget burn breach | burn multiple | > 2x planned burn | 30 minutes | Halt promotion and rollback |
| Smoke test failure | critical endpoint checks | any failure | single run | Rollback and open escalation |
| Incident alert critical | alert severity | critical | immediate | Rollback and incident runbook |

Notes:
- Thresholds are defaults; service-specific overrides must be documented in service runbooks.
- Any override requires auditable waiver metadata (`approvedBy`, `reason`, `scope`, `expiresAt`).

## Governance and Audit Requirements

- Every promotion action must emit an audit record with:
  - actor
  - action
  - environment
  - runId
  - timestamp
  - outcome
- Every waiver must include:
  - approvedBy
  - reason
  - scope
  - expiresAt
- Expired waivers are invalid and must not allow promotion.

## Required Verification Commands

Minimum verification before promotion:

- `npm run typecheck`
- `npm run test:unit`
- `npm run release:decision`
- `npm run ops:status`

Recommended verification for high-risk releases:

- `npm test`
- `npm run trust:gates`
- `npm run deploy:drill:api:local`

## Emergency Stop

Promotion must stop immediately when any of the following is true:

- unresolved high-priority operator escalation exists
- policy gate is not approved
- attestation or provenance verification fails
- incident declared at critical severity
