# Attestation Key Rotation Policy

## Purpose
Define safe rotation of `DEXTER_ATTESTATION_KEY` without breaking verification of recently signed release artifacts.

## Mechanism

- Active signer key: `DEXTER_ATTESTATION_KEY`
- Optional key ID metadata: `DEXTER_ATTESTATION_KEY_ID`
- Trusted verification key ring: `DEXTER_ATTESTATION_TRUSTED_KEYS` (comma-separated)
- Optional asymmetric signing:
  - `DEXTER_ATTESTATION_PRIVATE_KEY` for signing
  - `DEXTER_ATTESTATION_PUBLIC_KEY` for verification
  - `DEXTER_ATTESTATION_TRUSTED_PUBLIC_KEYS` for rotated public keys

## Rotation Procedure

1. Generate a new signing key and assign a new key ID.
2. Deploy verifier with:
   - new key as active signer
   - previous key(s) in `DEXTER_ATTESTATION_TRUSTED_KEYS`
3. Monitor attest verification for one release window.
4. Remove retired keys from trusted key ring after retention window.

## Guardrails

- Never store keys in repo.
- Use secret manager-backed environment variables.
- Audit attestation verification failures before removing old keys.
