#!/usr/bin/env bash
# Run STAGING_HOST.md verification checklist against a configured VPS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${STAGING_ENV:-$ROOT/infra/coolify/staging/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.example and configure." >&2
  exit 1
fi

read_env() {
  grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true
}

COOLIFY_ORIGIN="$(read_env COOLIFY_ORIGIN)"
BRIDGE_URL="$(read_env DEXTER_COOLIFY_API_URL)"
HEALTH_URL="$(read_env DEXTER_DEPLOY_HEALTH_URL)"
BRIDGE_TOKEN="$(read_env DEXTER_BRIDGE_TOKEN)"

fail=0
check() {
  local name="$1"
  local ok="$2"
  if [ "$ok" = "true" ]; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    fail=1
  fi
}

echo "Staging verification ($ENV_FILE)"
echo "---"

if [ -n "$COOLIFY_ORIGIN" ]; then
  code=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 15 "$COOLIFY_ORIGIN/api/health" 2>/dev/null || echo "000")
  check "coolify health ($COOLIFY_ORIGIN/api/health)" "$([ "$code" = "200" ] && echo true || echo false)"
else
  check "coolify origin configured" "false"
fi

if [ -n "$BRIDGE_URL" ]; then
  code=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$BRIDGE_URL/deploy" -H 'content-type: application/json' -d '{}' 2>/dev/null || echo "000")
  check "bridge unauthorized without token ($BRIDGE_URL/deploy → 401)" "$([ "$code" = "401" ] && echo true || echo false)"
  if [ -n "$BRIDGE_TOKEN" ]; then
    code=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 30 -X POST "$BRIDGE_URL/deploy" \
      -H "authorization: Bearer $BRIDGE_TOKEN" -H 'content-type: application/json' \
      -d '{"appName":"dexter","force":false}' 2>/dev/null || echo "000")
    check "bridge deploy with token (→ 200/502)" "$([ "$code" = "200" ] || [ "$code" = "502" ] && echo true || echo false)"
  fi
else
  check "bridge URL configured" "false"
fi

if [ -n "$HEALTH_URL" ]; then
  code=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 15 "$HEALTH_URL" 2>/dev/null || echo "000")
  check "app FQDN health ($HEALTH_URL → 200)" "$([ "$code" = "200" ] && echo true || echo false)"
else
  check "DEXTER_DEPLOY_HEALTH_URL configured" "false"
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "---"
  echo "GitHub secrets (repo):"
  for key in COOLIFY_ORIGIN COOLIFY_API_TOKEN DEXTER_COOLIFY_API_URL DEXTER_COOLIFY_TOKEN COOLIFY_APP_UUID; do
  if gh secret list 2>/dev/null | awk '{print $1}' | grep -qx "$key"; then
      echo "  set  $key"
    else
      echo "  miss $key"
      fail=1
    fi
  done
fi

echo "---"
if [ "$fail" -eq 0 ]; then
  echo "All checks passed."
  exit 0
fi
echo "One or more checks failed."
exit 1
