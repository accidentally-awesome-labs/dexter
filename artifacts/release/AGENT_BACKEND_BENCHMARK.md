# Agent Backend Benchmark

Generated at: 2026-05-21T00:55:53.395Z
Selected default backend: **shell**

## Scores
- shell: score=7.66 (rel=7, quality=7.4, latency=8.2, modularity=8, tooling=8.3, recover=7.5)
- scripted: score=7.55 (rel=9.5, quality=4, latency=9.8, modularity=8.5, tooling=5, recover=8.8)
- cursor-cli: score=6.38 (rel=5.8, quality=5.6, latency=6.8, modularity=8.7, tooling=6, recover=5.9)

## Selection Rationale
- Default backend selected by weighted score with priority on reliability and patch quality.
- `cursor-cli` score is intentionally conservative until runtime command-template configuration is present.
- Pluggable provider interface remains available for future backend swaps.
