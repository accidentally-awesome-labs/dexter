#!/usr/bin/env bash
# Refresh trycloudflare tunnels for local Coolify staging and update GitHub secrets.
# Requires: cloudflared, docker (coolify-db), gh CLI, .env with COOLIFY_API_TOKEN + bridge tokens.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TUNNEL_DIR="$ROOT/.tmp/tunnels"
APP_UUID="${COOLIFY_APP_UUID:-xxp6c5dqyanqybc1iqmxfmb0}"

mkdir -p "$TUNNEL_DIR"
pkill -f 'cloudflared tunnel --url' 2>/dev/null || true

start_tunnel() {
  local name="$1" port="$2"
  local log="$TUNNEL_DIR/${name}.log"
  : > "$log"
  nohup cloudflared tunnel --url "http://127.0.0.1:${port}" > "$log" 2>&1 &
  for _ in $(seq 1 30); do
    if url=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" 2>/dev/null | head -1); then
      echo "$url"
      return 0
    fi
    sleep 1
  done
  echo "tunnel $name failed; see $log" >&2
  return 1
}

COOLIFY_TUNNEL="$(start_tunnel coolify 8001)"
BRIDGE_TUNNEL="$(start_tunnel bridge 9876)"
APP_TUNNEL="$(start_tunnel app 18080)"

docker exec coolify-db psql -U coolify -d coolify -c \
  "UPDATE applications SET fqdn='${APP_TUNNEL}' WHERE uuid='${APP_UUID}';"

read_env() {
  local key="$1"
  local line
  line=$(grep -E "^${key}=" "$ROOT/.env" | tail -1 || true)
  if [ -z "$line" ]; then
    return
  fi
  printf '%s' "${line#*=}"
}

gh secret set COOLIFY_API_TOKEN <<< "$(read_env COOLIFY_API_TOKEN)"
gh secret set DEXTER_COOLIFY_API_URL <<< "$BRIDGE_TUNNEL"
gh secret set DEXTER_COOLIFY_TOKEN <<< "$(read_env DEXTER_COOLIFY_TOKEN)"
gh secret set DEXTER_BRIDGE_TOKEN <<< "$(read_env DEXTER_BRIDGE_TOKEN)"
DEPLOY_AUTH_KEY="$(read_env DEXTER_DEPLOY_AUTH_KEY)"
POLICY_BUNDLE_KEY="$(read_env DEXTER_POLICY_BUNDLE_KEY)"
gh secret set DEXTER_DEPLOY_AUTH_KEY <<< "${DEPLOY_AUTH_KEY:-dexter-staging-deploy-auth-key}"
gh secret set DEXTER_POLICY_BUNDLE_KEY <<< "${POLICY_BUNDLE_KEY:-dexter-staging-policy-bundle-key}"
gh secret set COOLIFY_APP_UUID <<< "$APP_UUID"

cat <<EOF
Tunnels refreshed:
  coolify: $COOLIFY_TUNNEL
  bridge:  $BRIDGE_TUNNEL
  app:     $APP_TUNNEL

Dispatch staging:
  gh workflow run closed-loop-staging.yml -f coolify_origin=$COOLIFY_TUNNEL
EOF
