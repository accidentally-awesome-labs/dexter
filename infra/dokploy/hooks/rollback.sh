#!/usr/bin/env sh
set -eu
APP_NAME="${1:-unknown-app}"
echo "dokploy rollback hook invoked for ${APP_NAME}"
