# Release Skill Pack

- Validate release readiness gate.
- Generate deployment, operations, and release-note documents.
- Enforce clean-repo and synchronized docs criteria.
- Run staged promotion pipeline: `npm run promotion:pipeline:local` (mock control plane) or `npm run promotion:pipeline` (configured endpoints).
- Run second promotion locally: `npm run promotion:pipeline:local:2` (targets `dexter-ops-api`).
- Run third promotion locally: `npm run promotion:pipeline:local:3` (targets `dexter-worker`).
- Verify governance consistency: `npm run governance:verify -- --minimum-promotions 2` (or `:3` after third promotion).
- Verify repeatability: `npm run promotion:repeatability`.
- Check operator readiness: `npm run operator:readiness`.
- Run forced canary rollback drill: `npm run canary:rollback:drill`.
- Close Milestone 1: `npm run milestone:m1:signoff`.
- Verify promotion manifest at `artifacts/release/PROMOTION_PIPELINE_MANIFEST.json`, history at `artifacts/release/PROMOTION_HISTORY.json`, and audit trail at `artifacts/operations/AUDIT_LOG.jsonl`.
