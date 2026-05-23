# v1.1.0 GA Checklist

Ship **Track B product loop** on top of v1.0 factory OS. Base branch: `v1.0.0-rc1`. RC tag: `v1.1.0-rc1`.

## 1. RC baseline

- [x] Tag `v1.1.0-rc1` on commit with release proofs
- [x] Staging E2E — [CLOSED_LOOP_E2E_STAGING_PROOF.json](./CLOSED_LOOP_E2E_STAGING_PROOF.json)
- [x] Local E2E — [CLOSED_LOOP_E2E_LOCAL_PROOF.json](./CLOSED_LOOP_E2E_LOCAL_PROOF.json)
- [x] CI drills (`factory:ci-drill`, `coolify:integration-drill`) in `ci.yml`

## 2. Post-RC soak (2026-05-23)

- [x] `npm run test:unit` — 191 tests passed (env isolation fix for `.env` + bridge)
- [x] `npm run soak:cycle -- --target-streak 1 --enforce-gate false` — `lastCyclePassed: true`
- [x] `npm run release:decision` → `GO`, `unresolvedEscalations: 0`

## 3. GA tag

```bash
git checkout v1.0.0-rc1
git pull origin v1.0.0-rc1
git tag -a v1.1.0 -m "Dexter v1.1.0 — Track B closed-loop product GA"
git push origin refs/tags/v1.1.0
```

## 4. GitHub release

Publish release notes from [RELEASE_NOTES.md](./RELEASE_NOTES.md) (promote RC draft to GA). Attach redacted `CLOSED_LOOP_E2E_*_PROOF.json` files.

## Out of scope for GA (documented)

- Remote production Coolify host (local + staging workflow validated)
- GHCR push automation
- `main` as default branch
