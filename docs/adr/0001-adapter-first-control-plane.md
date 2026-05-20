# ADR 0001: Adapter-First Control Plane

## Status
Accepted

## Context
Dexter must support self-hosted-first execution while preserving a future managed platform path. Control-plane lock-in would make this hard to evolve.

## Decision
Implement deployment control plane as an adapter interface with a primary `coolify` implementation and `dokploy`/`dokku` fallbacks.

## Consequences
- Positive: low lock-in risk and faster future managed-platform evolution.
- Tradeoff: additional maintenance for adapter parity and test coverage.
