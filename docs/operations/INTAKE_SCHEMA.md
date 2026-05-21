# Intake Schema

Dexter normalizes external work requests into a single intake contract before discovery and planning.

## Flow

`request source -> normalize -> INTAKE_BRIEF.json -> discovery/planning`

## Required artifact

- `artifacts/intake/INTAKE_BRIEF.json` (canonical)
- `artifacts/intake/INTAKE_BRIEF.md` (human-readable mirror)

Machine-readable contract: `docs/operations/INTAKE_CONTRACT.json`.

## Source types

| Source | Adapter module | Description |
|---|---|---|
| `cli-prompt` | `src/intake/adapters/cli-prompt.ts` | CLI flags (`--project`, `--idea`, etc.) |
| `issue` | `src/intake/adapters/issue.ts` | GitHub + Linear issue payloads normalized to contract |
| `template` | `src/intake/adapters/template.ts` | Curated templates (`api-endpoint`, `bugfix`) |

Source-only fields (for example GitHub `assignees`, `milestone`, `url`) are consumed by adapters but never written into `INTAKE_BRIEF.json`. Labels map to `request.labels`.

## Adapter CLI

```bash
# CLI prompt (default)
npm run intake:normalize

# GitHub issue fixture
npm run intake:normalize:issue

# Template-driven request
npm run intake:normalize:template
```

Issue adapter flags:

- `--issue-file <path>` JSON payload
- `--issue-title` + `--issue-body` inline payload
- `--issue-labels` comma-separated labels
- `--issue-number` optional external id source

Template adapter flags:

- `--template-id` (`api-endpoint` | `bugfix`)
- `--template-vars` JSON object

## Normalization rules

- Trim whitespace on all string fields.
- Deduplicate `constraints`, `targetUsers`, and `labels` (case-insensitive).
- Derive `title` from first sentence of idea/description (max 120 chars).
- Derive `summary` as normalized one-paragraph brief for planning intake.
- Reject payloads that fail Zod runtime validation.

## CLI

```bash
npm run intake:normalize -- --project my-app --idea "Build an internal billing API with audit logs"
```

Optional flags:

- `--constraints` comma-separated list
- `--target-users` comma-separated list
- `--source-type` (`cli-prompt` default)

## Ambiguity scoring

Every `INTAKE_BRIEF.json` includes an `ambiguity` block scored deterministically from policy:

- Policy: `docs/operations/INTAKE_AMBIGUITY_POLICY.json`
- Clarification threshold: **50** (score `>= 50` sets `clarificationRequired: true`)
- Levels: `low` (0-24), `medium` (25-49), `high` (50-100)

Signals include missing audience/constraints, short descriptions, vague language, placeholders, conflicting constraints, and open questions.

Re-score an existing brief:

```bash
npm run intake:score
```

## Risk and priority scoring

Every `INTAKE_BRIEF.json` includes a `riskPriority` block derived from policy:

- Policy: `docs/operations/INTAKE_RISK_PRIORITY_POLICY.json`
- Dimensions: `security`, `blastRadius`, `complexity`, `urgency`
- High-risk threshold: **60** (`riskScore >= 60` sets `highRisk: true`)

When planning receives an intake brief, `TASK_GRAPH.json` tasks include per-task `riskPriority` metadata.

## Intake-to-execution wiring

`npm run intake:run` executes a full Dexter run from existing intake artifacts (`INTAKE_BRIEF.json`), skipping intake re-normalization.

Run artifacts include:

- `runs/<runId>/intake_execution_manifest.json` — intake risk/routing vs execution/escalation coherence
- `runs/<runId>/run_summary.json` — includes `intake` block and `intakeExecutionCoherent`
- `artifacts/intake/INTAKE_EXECUTION_MANIFEST.json` — latest execution manifest mirror

`npm run ops:status` surfaces intake execution metadata in the ops dashboard.

## Intake-to-plan wiring

`runDexter` now executes intake normalization and clarification gating before planning. Planning uses the intake brief to enrich `TASK_GRAPH.json` with `riskPriority` and `routing` metadata.

Artifacts:

- `artifacts/intake/INTAKE_TO_PLAN_MANIFEST.json` — links intake, clarification state, and planning outputs

Standalone planning from an existing intake brief:

```bash
npm run intake:plan
```

## AFK/HITL mode routing

Task execution mode is auto-routed from intake/task risk profiles:

- Policy: `docs/operations/INTAKE_MODE_ROUTING_POLICY.json`
- High-risk intake (`riskPriority.highRisk`) forces implementation tasks to `HITL`
- Low-risk intake keeps implementation tasks `AFK`-eligible
- Governance tasks (`t3-policy`, `governance` NFR tag) always remain `HITL`

Preview routing for the latest intake brief:

```bash
npm run intake:route-preview
```

## Clarification gate

When `ambiguity.clarificationRequired` is `true`, Dexter blocks progression to planning until the request is clarified.

- Gate runs automatically after `intake-normalize`
- Artifact: `artifacts/intake/CLARIFICATION_LOG.md` (+ JSON mirror)
- Bypass with `--skip-clarification-gate` only for local debugging

```bash
# Ambiguous sample (fails gate, writes clarification log)
npm run intake:normalize:ambiguous

# Re-run gate against latest brief
npm run intake:clarify
```

Non-ambiguous intake bypasses the gate and removes any stale clarification log.

## Validation

```bash
npm run typecheck
npm run test:unit -- tests/intake-ambiguity.test.ts
```
