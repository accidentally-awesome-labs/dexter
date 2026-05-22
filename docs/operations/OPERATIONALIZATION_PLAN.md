# Dexter Operationalization Plan

This document tracks the work required to make Dexter a fully operational autonomous software factory.

## Status Overview

- Plan owner: _TBD_
- Last updated: 2026-05-21
- Current phase: Cross-milestone KPI closure
- Overall completion: 100% (milestones), KPI signoff in progress

## Today View

- Today focus: Milestone 4 / Days 6–9 (triage, release center, incident sims)
- Active owner: _TBD_
- Current status: Alert rules, runbook index, and dry-run routing adapters
- Current blocker: None
- Next command sequence:
  - `npm run typecheck`
  - `npm run ops:status`
- Today success criteria:
  - [x] Cost metrics use run_summary with dogfood benchmark fallback
  - [x] Queue metrics expose backlog aging buckets and degrade flags

## Milestone 1: Production Foundations (Weeks 1-2)

**Goal:** Safe, repeatable deployment and governance baseline for real services.

### Tasks

- [x] Implement staged promotion flow: `dev -> staging -> canary -> prod`
- [x] Add SLO-linked rollback triggers (5xx rate, latency budget burn, smoke + error spikes)
- [x] Enforce approval RBAC for escalations and waivers
- [x] Add immutable audit log for approvals, waivers, and promotions
- [x] Execute 3 real staged promotions
- [x] Execute 1 forced canary rollback drill

### Deliverables

- [x] `docs/operations/DEPLOY_PROMOTION_POLICY.md`
- [x] `docs/operations/RBAC_POLICY.json`
- [x] `artifacts/operations/AUDIT_LOG.jsonl` (append-only)

### Acceptance Gates

- [x] 3 successful staged promotions on a real service
- [x] 1 rollback drill triggered by SLO breach
- [x] 100% approvals include `approvedBy`, `scope`, `expiresAt`, and reason

### Progress Notes

- Baseline deploy drill and trust-gate drill flow already exist and pass.
- Next step is to replace drill-only confidence with real staged promotion in production services.

### Day-by-Day Execution Checklist (Milestone 1)

Use this checklist for day-level tracking. Do not move to the next day until validation passes.

#### Day 1: Promotion Policy Spec

- [x] Draft `docs/operations/DEPLOY_PROMOTION_POLICY.md` with stage entry/exit criteria and rollback triggers
- [x] Define canary promotion thresholds and failure abort conditions

Validation commands:
- `npm run typecheck`
- `npm run test:unit`

Pass criteria:
- Policy doc committed with explicit `dev -> staging -> canary -> prod` flow
- Rollback trigger matrix documented (metric + threshold + action)

#### Day 2: RBAC and Waiver Authority

- [x] Create `docs/operations/RBAC_POLICY.json` with role permissions for approvals and waivers
- [x] Map waiver scope limits (`run`, `service`, `environment`) by role

Validation commands:
- `npm run typecheck`
- `npm run test:unit -- tests/escalation-lifecycle.test.ts tests/escalation-workflow.test.ts`

Pass criteria:
- RBAC policy covers operator/release-manager/security personas
- No role can grant waivers outside defined scope

#### Day 3: Immutable Audit Log Contract

- [x] Implement append-only audit log writer for approval/waiver/promotion events
- [x] Emit `artifacts/operations/AUDIT_LOG.jsonl` on each governed action

Validation commands:
- `npm run typecheck`
- `npm run test:unit`
- `npm run escalation:resolve -- --all-unresolved true --status waived --waiver-approved-by dexter-ops --waiver-reason "test event" --waiver-expires-at "2099-01-01T00:00:00.000Z" --waiver-scope run`

Pass criteria:
- New event is appended (not overwritten) to `AUDIT_LOG.jsonl`
- Event includes actor, action, scope, reason, timestamp, runId

#### Day 4: Staging Promotion Wiring

- [x] Add deploy command path for `--environment staging`
- [x] Enforce policy pre-check before staging promotion

Validation commands:
- `npm run deploy:self -- --environment staging --require-api true`
- `npm run release:decision`

Pass criteria:
- Staging deploy succeeds with policy checks enforced
- Decision remains GO with no unresolved required escalations

#### Day 5: Canary Promotion Wiring

- [x] Add canary stage promotion execution and health/SLO gate checks
- [x] Block auto-progression to prod when canary gates fail

Validation commands:
- `npm run deploy:self -- --environment canary --require-api true`
- `npm run ops:status`

Pass criteria:
- Canary deploy artifacts are produced and readable
- Fail conditions prevent progression to prod

#### Day 6: SLO-Linked Auto Rollback

- [x] Implement rollback trigger evaluation for SLO breaches (error rate and latency)
- [x] Wire rollback action to control-plane adapter path

Validation commands:
- `npm run deploy:drill:api:local`
- `npm run trust:gates`

Pass criteria:
- At least one simulated SLO breach triggers rollback automatically
- Rollback result is captured in release artifacts

#### Day 7: Real Promotion #1

- [x] Run first real `dev -> staging -> canary -> prod` promotion on a target service
- [x] Capture full artifact trail and audit events

Validation commands:
- `npm run typecheck && npm run test:unit`
- `npm run release:decision`
- `npm run ops:status`

Pass criteria:
- Promotion completes end-to-end without manual artifact patching
- No unresolved high-priority operator escalations remain

#### Day 8: Real Promotion #2

- [x] Run second real staged promotion on same or second target service
- [x] Verify policy and waiver governance behavior remains consistent

Validation commands:
- `npm run release:decision`
- `npm run escalation:list -- --output table`

Pass criteria:
- Promotion succeeds and governance logs remain complete
- Escalations are either resolved or correctly waived with metadata

#### Day 9: Real Promotion #3

- [x] Run third real staged promotion
- [x] Confirm repeatability and operator workflow readiness

Validation commands:
- `npm run ops:status`
- `npm run resume:check -- --latest true --output table`

Pass criteria:
- Third promotion succeeds with same gate behavior as prior runs
- Resume readiness and ops dashboard remain coherent

#### Day 10: Forced Canary Rollback Drill + Signoff

- [x] Trigger one intentional canary SLO failure and verify rollback
- [x] Mark Milestone 1 acceptance gates complete if all criteria pass

Validation commands:
- `npm run deploy:drill:api:local`
- `npm run soak:cycle -- --target-streak 1 --enforce-gate false`
- `npm run release:decision`

Pass criteria:
- Forced rollback occurs and is captured in artifacts and audit log
- Milestone 1 acceptance gates are all checked off

## Milestone 2: Autonomous Intake to Execution (Weeks 3-4)

**Goal:** New work can enter Dexter and execute with minimal manual decomposition.

### Tasks

- [x] Build intake pipeline: request/issue -> normalized brief -> task graph
- [x] Add clarification gate for ambiguous requests
- [x] Add risk and priority scoring for incoming work
- [x] Auto-route tasks to AFK or HITL mode based on risk policy
- [x] Validate with 10 real requests end-to-end

### Deliverables

- [x] `artifacts/intake/INTAKE_BRIEF.json`
- [x] `artifacts/intake/CLARIFICATION_LOG.md`
- [x] `artifacts/planning/TASK_GRAPH.json` with risk and priority metadata
- [x] `artifacts/intake/pilot-batch/PILOT_BATCH_REPORT.json`
- [x] `artifacts/intake/pilot-batch/PILOT_BATCH_INTERVENTIONS.md`

### Acceptance Gates

- [x] 10 real requests processed end-to-end
- [x] >=80% requests require no manual task decomposition (Day 9 batch: 100%)
- [x] High-risk requests always route through HITL

### Progress Notes

- Planning and execution task graph generation already exists.
- Missing piece is autonomous intake from external request channels and ambiguity scoring.

### Day-by-Day Execution Checklist (Milestone 2)

Use this checklist for day-level tracking. Do not move to the next day until validation passes.

#### Day 1: Intake Contract and Request Normalization

- [x] Define normalized intake schema for external requests/issues
- [x] Add intake artifact writer for `artifacts/intake/INTAKE_BRIEF.json`

Validation commands:
- `npm run typecheck`
- `npm run test:unit -- tests/intake-normalize.test.ts`
- `npm run intake:normalize`

Pass criteria:
- Intake schema is documented and validated at runtime
- Intake artifact is generated for at least one sample request

#### Day 2: Source Adapters (Issue/Prompt/Template)

- [x] Implement adapters for at least two request sources (e.g., CLI prompt + issue payload)
- [x] Normalize both sources into a single intake contract

Validation commands:
- `npm run typecheck`
- `npm run test:unit -- tests/intake-adapters.test.ts tests/intake-normalize.test.ts`
- `npm run intake:normalize:issue`
- `npm run intake:normalize:template`

Pass criteria:
- Different source formats produce equivalent normalized intake artifacts
- No source-specific fields leak into downstream planning format

#### Day 3: Ambiguity Scoring Engine

- [x] Add ambiguity scoring for incomplete or conflicting requirements
- [x] Define threshold for auto-clarification gate

Validation commands:
- `npm run typecheck`
- `npm run test:unit -- tests/intake-ambiguity.test.ts`
- `npm run intake:normalize`

Pass criteria:
- Ambiguity score is deterministic for fixed input
- Threshold behavior is documented and tested

#### Day 4: Clarification Gate and Logging

- [x] Implement clarification question generation for ambiguous requests
- [x] Write `artifacts/intake/CLARIFICATION_LOG.md` for each clarification cycle

Validation commands:
- `npm run typecheck`
- `npm run test:unit -- tests/intake-clarification.test.ts`
- `npm run intake:normalize:ambiguous` (expect blocked gate + log)
- `npm run intake:normalize` (expect bypass)

Pass criteria:
- Ambiguous input triggers clarification log
- Non-ambiguous input bypasses clarification path

#### Day 5: Risk and Priority Scoring

- [x] Add risk score and priority score fields to normalized intake/task metadata
- [x] Define scoring rubric (security, blast radius, complexity, urgency)

Validation commands:
- `npm run typecheck`
- `npm run test:unit -- tests/intake-risk-priority.test.ts`
- `npm run intake:normalize:high-risk`

Pass criteria:
- Risk and priority scores are present in intake/task artifacts
- High-risk examples reliably score above policy threshold

#### Day 6: AFK/HITL Auto-Routing

- [x] Implement routing policy from risk profile to AFK/HITL execution mode
- [x] Enforce HITL for high-risk requests

Validation commands:
- `npm run typecheck`
- `npm run test:unit -- tests/intake-mode-routing.test.ts tests/acceptance-verifier.test.ts`
- `npm run intake:normalize:high-risk && npm run intake:route-preview`

Pass criteria:
- High-risk requests route to HITL path
- Low-risk requests remain eligible for AFK path

#### Day 7: Intake-to-Plan End-to-End Wiring

- [x] Connect normalized intake and clarification output into planning compiler
- [x] Ensure `TASK_GRAPH.json` includes intake-derived risk/priority metadata

Validation commands:
- `npm run typecheck`
- `npm run test:unit -- tests/intake-to-plan.test.ts tests/graph-validator.test.ts tests/replay.test.ts`
- `npm run intake:plan`

Pass criteria:
- Intake request deterministically produces task graph with metadata
- Replay stability remains intact

#### Day 8: Intake-to-Execution End-to-End Validation

- [x] Execute full run starting from intake artifacts
- [x] Verify escalations and run status are coherent with risk routing decisions

Validation commands:
- `npm run run:sample`
- `npm run intake:run`
- `npm run ops:status`
- `npm run resume:check -- --latest true --output table`
- `npm run test:unit -- tests/intake-execution-e2e.test.ts`

Pass criteria:
- End-to-end flow completes from intake to run summary
- Run artifacts reflect intake risk and routing decisions

#### Day 9: Real Request Pilot (Batch of 5)

- [x] Process 5 real requests end-to-end with intake pipeline
- [x] Capture manual interventions and decomposition overrides

Validation commands:
- `npm run intake:pilot:batch`
- `npm run test:unit -- tests/intake-pilot-batch.test.ts`
- `npm run release:decision`
- `npm run escalation:list -- --output table`

Pass criteria:
- >=80% of 5 requests require no manual task decomposition
- All high-risk requests route through HITL

#### Day 10: Real Request Pilot (Batch of 5) + Signoff

- [x] Process additional 5 real requests (total 10)
- [x] Close Milestone 2 acceptance gates

Validation commands:
- `npm run ops:status`
- `npm run release:decision`

Pass criteria:
- 10 real requests completed end-to-end
- Milestone 2 acceptance gates are all checked off

## Milestone 3: Reliability and Learning at Scale (Weeks 5-6)

**Goal:** Dexter remains stable under continuous operation and improves over time.

### Tasks

- [x] Add continuous soak runner with trend tracking
- [x] Add flaky-test detection and quarantine policy
- [x] Add memory quality controls: contradiction checks and stale lesson decay
- [x] Add regression-prevention templates by failure class
- [x] Track repeat-failure reduction over rolling windows

### Deliverables

- [x] `artifacts/release/SOAK_TRENDS.json`
- [x] `artifacts/verification/FAILURE_TAXONOMY.md`
- [x] `global-memory/MEMORY_QUALITY_SCORECARD.md`

### Acceptance Gates

- [x] 30+ consecutive soak cycles without critical blocker (verified via `npm run milestone:m3:signoff`)
- [x] Repeat-failure rate decreases week-over-week (weekly pass-rate trend gate in KPI/signoff)
- [x] Contradictory or stale lessons are flagged pre-planning

### Progress Notes

- Soak runner writes `SOAK_STATUS` and `SOAK_TRENDS` trend rollups; unit tests emit flaky telemetry; memory contradiction and quality scorecards are generated before planning.

### Day-by-Day Execution Checklist (Milestone 3)

Use this checklist for day-level tracking. Do not move to the next day until validation passes.

#### Day 1: Soak Trend Artifact Baseline

- [x] Add trend rollup output `artifacts/release/SOAK_TRENDS.json`
- [x] Define retained windows (daily, weekly, rolling 100 runs)

Validation commands:
- `npm run soak:cycle -- --target-streak 1 --enforce-gate false`
- `npm run typecheck`

Pass criteria:
- Trend artifact updates after each soak cycle
- Historical windows are preserved and queryable

#### Day 2: Failure Taxonomy Classification

- [x] Add canonical failure classes and mapping rules
- [x] Emit `artifacts/verification/FAILURE_TAXONOMY.md`

Validation commands:
- `npm run test:unit`
- `npm run release:decision`

Pass criteria:
- All failed runs map to a taxonomy class
- Taxonomy report lists top classes and frequencies

#### Day 3: Flaky Test Detection

- [x] Add flaky-test heuristic (intermittent pass/fail patterns)
- [x] Record flaky candidates and confidence score

Validation commands:
- `npm run test:unit`
- `npm run soak:cycle -- --target-streak 1 --enforce-gate false`

Pass criteria:
- Flaky candidates are identified in test telemetry
- Stable tests are not misclassified at high confidence

#### Day 4: Flaky Quarantine Policy

- [x] Implement quarantine policy and reporting for flaky tests
- [x] Ensure quarantined tests do not silently mask regressions

Validation commands:
- `npm run test:unit`
- `npm run ops:status`

Pass criteria:
- Quarantined tests are explicitly visible in artifacts
- Regression-critical tests remain blocking

#### Day 5: Memory Contradiction Detection

- [x] Detect conflicting lessons in global memory
- [x] Flag contradictions during planning context retrieval

Validation commands:
- `npm run typecheck`
- `npm run test:unit`

Pass criteria:
- Contradictions are surfaced before planning
- Contradictory lessons are scored and deprioritized

#### Day 6: Stale Lesson Decay

- [x] Add freshness decay for older/low-confidence lessons
- [x] Persist quality scoring to `global-memory/MEMORY_QUALITY_SCORECARD.md`

Validation commands:
- `npm run typecheck`
- `npm run test:unit`

Pass criteria:
- Stale lessons lose influence over time
- Quality scorecard updates with confidence/freshness metrics

#### Day 7: Regression-Prevention Templates

- [x] Add per-failure-class remediation templates
- [x] Attach template hints to escalations and replans

Validation commands:
- `npm run test:unit -- tests/replan-loop.test.ts tests/task-executor.test.ts`
- `npm run escalation:list -- --output table`

Pass criteria:
- Escalation artifacts include remediation guidance by failure class
- Retry/replan suggestions are class-specific

#### Day 8: Continuous Soak Scheduling

- [x] Schedule continuous soak execution (cron/automation)
- [x] Emit run-to-run reliability deltas and warning thresholds

Validation commands:
- `npm run soak:cycle -- --target-streak 1 --enforce-gate false`
- `npm run release:decision`

Pass criteria:
- Automated soak jobs run without manual triggers
- Reliability deltas are tracked and visible

#### Day 9: Reliability KPI Review

- [x] Evaluate rolling 100-run reliability and repeat-failure trend
- [x] Produce remediation actions for top 3 failure classes

Validation commands:
- `npm run ops:status`
- `npm run release:decision`

Pass criteria:
- KPI report exists and identifies top reliability risks
- Mitigation backlog is defined and prioritized

#### Day 10: 30+ Cycle Reliability Signoff

- [x] Demonstrate 30+ consecutive soak cycles without critical blocker
- [x] Close Milestone 3 acceptance gates

Validation commands:
- `npm run soak:cycle`
- `npm run release:decision`

Pass criteria:
- Reliability acceptance gates are satisfied
- Milestone 3 accepted and documented

## Milestone 4: Operational Control Plane (Weeks 7-8)

**Goal:** Operators can manage, diagnose, and trust Dexter from one control surface.

### Tasks

- [x] Extend `OPS_STATUS` with cost/run, queue depth, SLO state, and escalation aging
- [x] Add alerting hooks (Slack/webhook/pager) tied to runbooks
- [x] Add one-command triage flows for blocked and degraded runs
- [x] Add release command center workflow (readiness, waivers, promotion auth)
- [x] Run 3 incident simulations end-to-end

### Deliverables

- [x] `artifacts/execution/OPS_STATUS.json` (extended; baseline artifact already exists)
- [x] `docs/operations/ALERT_RULES.yaml`
- [x] `docs/operations/RUNBOOK_LINKS.md`

### Acceptance Gates

- [x] Failed run diagnosis in <10 minutes from dashboard artifacts only
- [x] Alert -> runbook -> remediation flow validated in 3 simulations
- [x] All promotions pass provenance, attestation, and policy checks

### Progress Notes

- `OPS_STATUS` dashboard baseline is implemented with resume readiness and next-command suggestions.
- Cost, queue, SLO, and escalation aging are integrated into OPS_STATUS v1.1.
- M4 signoff validates triage SLA, incident simulations, release command center, and governance gates.

### Day-by-Day Execution Checklist (Milestone 4)

Use this checklist for day-level tracking. Do not move to the next day until validation passes.

#### Day 1: OPS_STATUS Data Model Extension

- [x] Extend `OPS_STATUS` schema with cost/run, queue depth, SLO state, escalation aging
- [x] Update markdown rendering for new dimensions

Validation commands:
- `npm run typecheck`
- `npm run ops:status`

Pass criteria:
- Extended fields appear in JSON and markdown outputs
- Backward-compatible rendering for older runs

#### Day 2: Cost and Queue Metrics Integration

- [x] Integrate cost/run estimation source
- [x] Add queue depth and backlog aging metrics

Validation commands:
- `npm run ops:status`
- `npm run release:decision`

Pass criteria:
- Cost and queue metrics are visible for latest run
- Missing metric sources degrade gracefully with explicit flags

#### Day 3: SLO State and Escalation Aging

- [x] Add SLO burn state (healthy/warn/breach) to ops dashboard
- [x] Add escalation age buckets and oldest-unresolved indicator

Validation commands:
- `npm run ops:status`
- `npm run escalation:list -- --output table`

Pass criteria:
- SLO and escalation aging data are visible and actionable
- Old unresolved escalations are highlighted

#### Day 4: Alert Rules and Routing

- [x] Create `docs/operations/ALERT_RULES.yaml`
- [x] Implement alert routing to webhook/chat/pager adapters

Validation commands:
- `npm run typecheck`
- `npm run test:unit`

Pass criteria:
- Alert rules cover blocked/degraded/SLO breach events
- Alert payloads include runId, status, and runbook link

#### Day 5: Runbook Link Index

- [x] Create `docs/operations/RUNBOOK_LINKS.md`
- [x] Map each alert/event class to a runbook procedure

Validation commands:
- `npm run ops:status`
- `npm run release:decision`

Pass criteria:
- Every alert class has an associated runbook entry
- Operators can navigate from alert to procedure in one step

#### Day 6: One-Command Triage Expansion

- [x] Add single-command triage workflows for blocked and degraded states
- [x] Ensure commands produce actionable summaries and next steps

Validation commands:
- `npm run resume:check -- --latest-blocked true --output table`
- `npm run resume:check -- --latest-degraded true --output table`

Pass criteria:
- Triage commands reduce diagnosis flow to one command per state
- Suggested commands are accurate and executable

#### Day 7: Release Command Center Flow

- [x] Compose readiness + waiver + promotion authorization into one operator flow
- [x] Ensure full audit coverage across that flow

Validation commands:
- `npm run release:decision`
- `npm run escalation:list -- --output table`
- `npm run ops:status`

Pass criteria:
- Operator can execute release-governance flow without ad hoc steps
- Each action is captured in governance artifacts

#### Day 8: Incident Simulation #1 and #2

- [x] Run simulation: blocked escalation storm
- [x] Run simulation: canary SLO breach with rollback

Validation commands:
- `npm run deploy:drill:api:local`
- `npm run trust:gates`
- `npm run ops:status`

Pass criteria:
- Both simulated incidents are detected, routed, and remediated
- Timeline and outcomes captured in artifacts

#### Day 9: Incident Simulation #3

- [x] Run simulation: provenance/attestation/policy gate failure at promotion time
- [x] Validate alert-to-runbook response path

Validation commands:
- `npm run release:decision`
- `npm run ops:status`

Pass criteria:
- Promotion is blocked as expected
- Operator can diagnose and recover using documented flow

#### Day 10: Control Plane Signoff

- [x] Validate <10 minute diagnosis target with timed operator run
- [x] Close Milestone 4 acceptance gates

Validation commands:
- `npm run ops:status`
- `npm run resume:check -- --latest true --output table`
- `npm run release:decision`

Pass criteria:
- Diagnosis SLA and incident simulation acceptance criteria pass
- Milestone 4 accepted and documented

## Cross-Milestone KPI Targets (Definition of Fully Operational)

- [x] Autonomy: >=85% work items complete without manual decomposition/intervention
- [x] Reliability: >=95% successful runs across last 100 runs
- [x] Safety: 100% production promotions gated by policy + provenance + rollback readiness
- [x] Recovery: blocked-run MTTR <30 minutes
- [x] Governance: 100% waivers/overrides have complete metadata and valid expiry

Validation commands:
- `npm run operational:kpi`
- `npm run operational:signoff`

Pass criteria:
- `artifacts/release/CROSS_MILESTONE_KPI.json` reports `passed: true`
- `artifacts/release/OPERATIONAL_SIGNOFF.json` reports `passed: true`

## Weekly Update Template

Copy this section each week and append below.

- Week of: _YYYY-MM-DD_
- Milestone focus: _M1/M2/M3/M4_
- Completed this week:
  - _item_
- In progress:
  - _item_
- Blockers:
  - _item_
- KPI movement:
  - _item_
- Next week plan:
  - _item_

## Weekly Updates

### Week of 2026-05-21

- Milestone focus: M1
- Completed this week:
  - Released and validated `v1.0.0` with CI fresh-state gate, replan-aware release decision gating, escalation lifecycle controls, and `OPS_STATUS` baseline.
  - Added operator ergonomics for blocked/degraded recovery (`run-resume`, `resume-check`, `escalation:list`, `escalation:resolve`, `ops-status`).
- In progress:
  - Define production promotion policy and wire true staged promotion flow.
  - Define RBAC model for waiver/approval authority.
- Blockers:
  - No real production services are wired yet for staged promotion validation.
  - Audit log contract for immutable governance events not implemented yet.
- KPI movement:
  - Reliability baseline is strong in CI and drills; production reliability KPIs are not yet measurable due to missing real-service rollout.
- Next week plan:
  - Implement Milestone 1 deliverables (`DEPLOY_PROMOTION_POLICY.md`, `RBAC_POLICY.json`, append-only audit log).
  - Run first real staged promotions and one SLO-triggered rollback drill.
