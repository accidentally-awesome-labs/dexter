#!/usr/bin/env sh
set -eu
APP_NAME="${1:-unknown-app}"
echo "dokku rollback hook invoked for ${APP_NAME}"
