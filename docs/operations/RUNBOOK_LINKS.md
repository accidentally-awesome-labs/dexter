# Runbook Link Index

Maps alert rule classes to operator procedures. Alert payloads include the `runbook` path from this index.

| Alert class | Runbook | Primary command |
| --- | --- | --- |
| `blocked-run-triage` | [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md) | `npm run resume:check -- --latest-blocked true --output table` |
| `degraded-run-triage` | [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md) | `npm run resume:check -- --latest-degraded true --output table` |
| `slo-breach-response` | [DR_PLAYBOOK.md](./DR_PLAYBOOK.md) | `npm run release:decision` |
| `slo-warn-watch` | [SLO_TEMPLATE.md](./SLO_TEMPLATE.md) | `npm run ops:status` |
| `stale-escalation` | [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md) | `npm run escalation:list -- --unresolved-only true --output table` |
| `stale-backlog` | [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md) | `npm run resume:check -- --latest-blocked true --output table` |

## Navigation

1. Open the runbook path from the alert payload.
2. Run the primary command for that alert class.
3. Confirm recovery with `npm run ops:status` and `npm run release:decision`.
