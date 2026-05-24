#!/usr/bin/env bash
# Push staging VPS URLs/tokens to GitHub Actions secrets (no tunnel URLs).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${STAGING_ENV:-$ROOT/infra/coolify/staging/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI required" >&2
  exit 1
fi

read_env() {
  local val
  val=$(grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)
  printf '%s' "$val"
}

COOLIFY_ORIGIN="$(read_env COOLIFY_ORIGIN)"
COOLIFY_TOKEN="$(read_env COOLIFY_API_TOKEN)"
BRIDGE_URL="$(read_env DEXTER_COOLIFY_API_URL)"
BRIDGE_TOKEN="$(read_env DEXTER_BRIDGE_TOKEN)"
APP_UUID="$(read_env COOLIFY_APP_UUID)"
DEPLOY_KEY="$(read_env DEXTER_DEPLOY_AUTH_KEY)"
POLICY_KEY="$(read_env DEXTER_POLICY_BUNDLE_KEY)"

for var in COOLIFY_ORIGIN COOLIFY_API_TOKEN DEXTER_COOLIFY_API_URL DEXTER_BRIDGE_TOKEN COOLIFY_APP_UUID; do
  eval "val=\$$var"
  if [ -z "$val" ]; then
    echo "Missing $var in $ENV_FILE" >&2
    exit 1
  fi
done

gh secret set COOLIFY_ORIGIN <<< "$COOLIFY_ORIGIN"
gh secret set COOLIFY_API_TOKEN <<< "$COOLIFY_TOKEN"
gh secret set DEXTER_COOLIFY_API_URL <<< "$BRIDGE_URL"
gh secret set DEXTER_COOLIFY_TOKEN <<< "$(read_env DEXTER_COOLIFY_TOKEN)"
gh secret set DEXTER_BRIDGE_TOKEN <<< "$BRIDGE_TOKEN"
gh secret set COOLIFY_APP_UUID <<< "$APP_UUID"
gh secret set DEXTER_DEPLOY_AUTH_KEY <<< "${DEPLOY_KEY:-dexter-staging-deploy-auth-key}"
gh secret set DEXTER_POLICY_BUNDLE_KEY <<< "${POLICY_KEY:-dexter-staging-policy-bundle-key}"

cat <<EOF
GitHub secrets updated for VPS staging:
  COOLIFY_ORIGIN=$COOLIFY_ORIGIN
  DEXTER_COOLIFY_API_URL=$BRIDGE_URL
  COOLIFY_APP_UUID=$APP_UUID

Dispatch closed-loop-staging (no coolify_origin override needed if secret matches):
  gh workflow run closed-loop-staging.yml -f coolify_origin=$COOLIFY_ORIGIN
EOF
