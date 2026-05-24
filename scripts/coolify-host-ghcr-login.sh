#!/usr/bin/env bash
# Log the Coolify deployment Docker host into GHCR (required for private packages).
# Local Docker Desktop: targets coolify-testing-host via Coolify SSH key.
# VPS: run on the server where Coolify deploys containers, or pass COOLIFY_DEPLOY_HOST=ssh://...
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER="${GHCR_USER:-$(gh api user -q .login 2>/dev/null || echo "")}"
TOKEN="${GHCR_PAT:-$(gh auth token 2>/dev/null || echo "")}"

if [ -z "$USER" ] || [ -z "$TOKEN" ]; then
  echo "Set GHCR_USER and GHCR_PAT, or run: gh auth refresh -s read:packages,write:packages" >&2
  exit 1
fi

if [ "${COOLIFY_DEPLOY_HOST:-local}" = "local" ] && docker ps --format '{{.Names}}' | grep -qx coolify; then
  KEY_NAME=$(basename "$(ls "$ROOT/infra/coolify/local/ssh/keys/"ssh_key@* 2>/dev/null | head -1)")
  docker exec coolify ssh -i "/var/www/html/storage/app/ssh/keys/$KEY_NAME" \
    -o StrictHostKeyChecking=no root@coolify-testing-host \
    "echo '$TOKEN' | docker login ghcr.io -u '$USER' --password-stdin"
  echo "coolify-testing-host logged in to ghcr.io as $USER"
else
  echo "$TOKEN" | docker login ghcr.io -u "$USER" --password-stdin
  echo "Local docker logged in to ghcr.io as $USER"
fi
