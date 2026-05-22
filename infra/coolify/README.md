# Coolify Adapter Notes

- Primary v1 control-plane target (canary/prod require Coolify per deploy auth policy).
- **Native API client:** `src/providers/deployment/coolify-client.ts`
- **Dexter HTTP bridge:** `npm run coolify:bridge` — see `infra/coolify/bridge/README.md`
- **App mapping:** copy `apps.example.json` → `apps.json` (gitignored) with Coolify application UUIDs
- **Hooks:** `hooks/deploy.sh` and `hooks/rollback.sh` call Coolify via `npm run coolify:deploy` / `coolify:rollback`
