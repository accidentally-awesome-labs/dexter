# Dexter v1 Opinionated Default Stack Matrix

## Core Runtime
- Default: TypeScript + Node.js LTS
- Fallbacks: Python worker adapters; polyglot executor split
- Pivot trigger: sustained concurrency or latency failures in orchestrator tier

## Autonomous Coding Backend
- Selection method: weighted benchmark (`npm run benchmark:backend`) producing `artifacts/release/AGENT_BACKEND_BENCHMARK.json`
- Default candidate: `cursor-cli` (selected by weighted score and tooling fit)
- Fallbacks: `shell`, `scripted` backends through pluggable provider interface (`src/providers/agents/*`)
- Pivot trigger: sustained reliability drop, degraded patch quality, or better benchmark score from a new adapter

## Memory and Knowledge
- Default: Hybrid temporal graph + vector retrieval + project memory
- Fallbacks: vector-only mode; project-only memory mode
- Pivot trigger: elevated stale-memory and false-guidance rates

## Knowledge Base
- Default: Git-native markdown corpus (`BRIEF`, `PRD`, ADRs, runbooks)
- Fallbacks: external index mirror; read-only restricted mode
- Pivot trigger: retrieval precision/latency misses SLO

## Observability
- Default: OpenTelemetry-compatible traces + structured run logs
- Fallbacks: JSON logs only; platform-native observability
- Pivot trigger: instrumentation overhead exceeds budget

## Evaluation and CI
- Default: continuous eval harness + GitHub Actions
- Fallbacks: nightly heavy eval cadence; GitLab/self-hosted runner templates
- Pivot trigger: tooling mismatch with target environments

## Deployment
- Default: Coolify adapter
- Fallbacks: Dokploy, Dokku
- Pivot trigger: benchmark scorecard favors a fallback for reliability/rollback/observability

## Data Layer
- Default: Postgres + pgvector
- Fallbacks: managed Postgres-compatible or workload-specific adapters
- Pivot trigger: cost/performance thresholds breached for repeated workload classes
