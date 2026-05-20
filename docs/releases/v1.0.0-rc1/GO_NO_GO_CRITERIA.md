# GO/NO-GO Criteria

- Readiness pass rate >= 0.95
- Memory hit rate >= 0.80
- Repeated failure rate <= 0.05
- Avg time-to-ready <= 5000ms
- Soak streak gate satisfied (`artifacts/release/SOAK_STATUS.json` shows `gateSatisfied: true`)

Decision must be recorded in `artifacts/release/GO_NO_GO.md`.
