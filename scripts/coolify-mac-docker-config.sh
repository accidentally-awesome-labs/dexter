#!/usr/bin/env bash
# Coolify on Docker Desktop bind-mounts $HOME/.docker/config.json from the Mac host path
# returned by SSH (usually /root/.docker/config.json). Private GHCR pulls need that file on the Mac.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/infra/coolify/local/.docker/config.json"

if [ ! -f "$SRC" ]; then
  echo "Missing $SRC — run: npm run coolify:fix-local-server" >&2
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is for Docker Desktop on macOS. On Linux VPS, run: bash scripts/coolify-host-ghcr-login.sh" >&2
  exit 1
fi

echo "Installing $SRC -> /root/.docker/config.json (sudo required for Coolify deploy mounts) ..."
sudo mkdir -p /root/.docker
sudo cp "$SRC" /root/.docker/config.json
sudo chmod 600 /root/.docker/config.json
echo "OK. Redeploy with: npm run coolify:ghcr-wire"
