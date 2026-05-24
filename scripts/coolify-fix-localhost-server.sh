#!/usr/bin/env bash
# Fix Coolify "localhost" server unreachable on Docker Desktop (Mac/Windows).
# Coolify SSH-validates host.docker.internal:22, which is often closed on the host.
# Point the server at coolify-testing-host (bundled sidecar with Docker socket + SSH).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "Missing .env — run npm run coolify:setup first" >&2
  exit 1
fi

read_env() {
  local key="$1"
  local line
  line=$(grep -E "^${key}=" .env | tail -1 || true)
  if [ -z "$line" ]; then
    return
  fi
  printf '%s' "${line#*=}"
}

ORIGIN="${COOLIFY_ORIGIN:-$(read_env COOLIFY_ORIGIN)}"
ORIGIN="${ORIGIN:-http://127.0.0.1:8001}"
TOKEN="${COOLIFY_API_TOKEN:-$(read_env COOLIFY_API_TOKEN)}"
SERVER_UUID="${COOLIFY_SERVER_UUID:-u11nwdtvx1u8rxy28ty81cb3}"

if [ -z "$TOKEN" ]; then
  echo "COOLIFY_API_TOKEN required in .env" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx coolify; then
  echo "Coolify is not running. Start: cd infra/coolify/local && docker compose up -d" >&2
  exit 1
fi

echo "Patching server $SERVER_UUID -> coolify-testing-host (root) ..."
/usr/bin/curl -sf -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "$ORIGIN/api/v1/servers/$SERVER_UUID" \
  -d '{"ip":"coolify-testing-host","user":"root"}' >/dev/null

if command -v gh >/dev/null 2>&1; then
  GHCR_USER="${GHCR_USER:-$(gh api user -q .login 2>/dev/null || echo "")}"
  GHCR_TOKEN="${GHCR_PAT:-$(gh auth token 2>/dev/null || echo "")}"
  if [ -n "$GHCR_USER" ] && [ -n "$GHCR_TOKEN" ]; then
    mkdir -p "$ROOT/infra/coolify/local/.docker"
    AUTH=$(printf '%s:%s' "$GHCR_USER" "$GHCR_TOKEN" | openssl base64 -A)
    printf '%s\n' "{\"auths\":{\"ghcr.io\":{\"auth\":\"$AUTH\"}}}" >"$ROOT/infra/coolify/local/.docker/config.json"
    echo "Wrote GHCR auth to infra/coolify/local/.docker/config.json"
    if [ "$(uname -s)" = "Darwin" ]; then
      if bash "$ROOT/scripts/coolify-mac-docker-config.sh" 2>/dev/null; then
        echo "Mac /root/.docker/config.json installed for Coolify helper mounts."
      else
        echo "Could not install /root/.docker/config.json (sudo). Either:"
        echo "  sudo bash scripts/coolify-mac-docker-config.sh"
        echo "  or set GHCR package dexter to Public in GitHub → Packages → dexter → Package settings."
      fi
    fi
  fi
fi

echo "Validating server (may take ~15s) ..."
/usr/bin/curl -sf -H "Authorization: Bearer $TOKEN" \
  "$ORIGIN/api/v1/servers/$SERVER_UUID/validate" >/dev/null

for _ in $(seq 1 30); do
  reachable=$(/usr/bin/curl -sf -H "Authorization: Bearer $TOKEN" \
    "$ORIGIN/api/v1/servers/$SERVER_UUID" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('settings',{}).get('is_reachable', False))" 2>/dev/null || echo "False")
  if [ "$reachable" = "True" ]; then
    echo "Server reachable and usable."
    exit 0
  fi
  sleep 1
done

echo "Server still unreachable. Open $ORIGIN/server/$SERVER_UUID and check validation logs." >&2
exit 1
