# Dexter Architecture

## Pipeline

`discovery -> planning -> policyGate -> provisioning -> execution -> verification -> release`

## Key Principles

- Artifact-first state: every stage writes explicit outputs.
- Policy-first autonomy: destructive operations require rollback-ready checks.
- Adapter boundaries: runtime and control plane remain replaceable.
- Memory compounding: global learning graph is queried before planning and execution.
