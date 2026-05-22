#!/usr/bin/env sh
set -eu
APP_NAME="${1:-dexter}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
cd "$ROOT"
exec npx tsx src/dev/run-coolify-hook.ts rollback "$APP_NAME"
