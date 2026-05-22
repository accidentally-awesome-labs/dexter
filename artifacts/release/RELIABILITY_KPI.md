# Reliability KPI Review

Generated at: 2026-05-21T22:51:41.172Z
Rolling-100 soak cycles: 100
Run telemetry count: 538

## KPI Snapshot
- Soak pass rate (rolling-100): 1 (delta 0.01)
- Consecutive soak failures: 0
- Soak repeat-failure rate: 0
- Run repeat-failure rate: 0
- Run readiness pass rate: 1
- Soak reliability status: healthy
- KPI gates passed: yes

## Top Reliability Risks
- #1 release.soak (high): Soak cycle step failed — count=122, share=1, trend=stable

## Mitigation Backlog
- [P1] release.soak — owner=platform
  - Rationale: 122 failures (100.0% share), severity=high, trend=stable.
  - Action: Re-run soak with enforce-gate disabled only for diagnosis; fix root step before enforcing gates again.
  - Action: Quarantine flaky unit tests identified in FLAKY_CANDIDATES.json
  - Action: Stabilize soak step ordering and timeouts
  - Action: Track soak failure class share week over week
  - Action: Alert on repeat failure class across 3+ cycles
