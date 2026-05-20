# Changelog v1.0.0-rc1

## Added

- Autonomous pipeline with planning, policy, execution, verification, and release packaging.
- Global learning graph with memory sanitization.
- Tech radar benchmark framework and dogfood metrics.
- Supply-chain gates (provenance + attestation) and planning integrity gate.
- Deployment authorization chain with scope binding, nonce replay protection, revocation, and policy-bundle binding.

## Security/Integrity

- Signed approvals with expiry and planning-digest binding.
- Signed release attestations with optional asymmetric signing and key rotation support.
- Signed deploy policy bundle with digest/version enforcement in deploy auth verification.

## Operations

- Dogfood runner and pilot batch runner.
- Automated GO/NO-GO decision artifact generation.
