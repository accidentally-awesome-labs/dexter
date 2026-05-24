#!/usr/bin/env bash
# Bootstrap Dexter staging on a fresh Linux VPS (Ubuntu/Debian).
# Run as a user with sudo; adds user to docker group when needed.
#
# Usage (on VPS):
#   curl -fsSL https://raw.githubusercontent.com/accidentally-awesome-labs/dexter/main/scripts/staging-vps-bootstrap.sh | bash
#   # or from a cloned repo:
#   sudo bash scripts/staging-vps-bootstrap.sh --repo-dir /opt/dexter
#
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/dexter}"
REPO_URL="${REPO_URL:-https://github.com/accidentally-awesome-labs/dexter.git}"
BRANCH="${BRANCH:-main}"
SKIP_CLONE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --repo-dir) REPO_DIR="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --skip-clone) SKIP_CLONE=true; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
  DEPLOY_USER="$SUDO_USER"
else
  DEPLOY_USER="$(whoami)"
fi

echo "==> Installing Docker (if missing) ..."
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "${VERSION_CODENAME:-jammy}") stable" >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

if ! groups "$DEPLOY_USER" | grep -q docker; then
  usermod -aG docker "$DEPLOY_USER"
  echo "Added $DEPLOY_USER to docker group (log out/in for group to apply)."
fi

echo "==> Cloning Dexter to $REPO_DIR ..."
if [ "$SKIP_CLONE" = false ]; then
  if [ -d "$REPO_DIR/.git" ]; then
    git -C "$REPO_DIR" fetch origin "$BRANCH"
    git -C "$REPO_DIR" checkout "$BRANCH"
    git -C "$REPO_DIR" pull --ff-only origin "$BRANCH" || true
  else
    mkdir -p "$(dirname "$REPO_DIR")"
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$REPO_DIR"
  fi
fi

STAGING_DIR="$REPO_DIR/infra/coolify/staging"
LOCAL_DIR="$REPO_DIR/infra/coolify/local"

if [ ! -f "$STAGING_DIR/.env" ]; then
  cp "$STAGING_DIR/.env.example" "$STAGING_DIR/.env"
  BRIDGE_TOKEN="$(openssl rand -hex 24)"
  DEPLOY_KEY="$(openssl rand -hex 16)"
  POLICY_KEY="$(openssl rand -hex 16)"
  sed -i "s/^DEXTER_BRIDGE_TOKEN=.*/DEXTER_BRIDGE_TOKEN=$BRIDGE_TOKEN/" "$STAGING_DIR/.env"
  sed -i "s/^DEXTER_COOLIFY_TOKEN=.*/DEXTER_COOLIFY_TOKEN=$BRIDGE_TOKEN/" "$STAGING_DIR/.env"
  sed -i "s/^DEXTER_DEPLOY_AUTH_KEY=.*/DEXTER_DEPLOY_AUTH_KEY=$DEPLOY_KEY/" "$STAGING_DIR/.env"
  sed -i "s/^DEXTER_POLICY_BUNDLE_KEY=.*/DEXTER_POLICY_BUNDLE_KEY=$POLICY_KEY/" "$STAGING_DIR/.env"
  echo "Created $STAGING_DIR/.env with generated bridge/deploy keys."
fi

if [ ! -f "$LOCAL_DIR/.env" ]; then
  echo "==> Generating Coolify local .env (first boot) ..."
  mkdir -p "$LOCAL_DIR/ssh" "$LOCAL_DIR/applications" "$LOCAL_DIR/databases" "$LOCAL_DIR/services" "$LOCAL_DIR/backups"
  APP_KEY="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
  DB_PASS="$(openssl rand -hex 16)"
  REDIS_PASS="$(openssl rand -hex 16)"
  PUSHER_ID="$(openssl rand -hex 8)"
  PUSHER_KEY="$(openssl rand -hex 16)"
  PUSHER_SECRET="$(openssl rand -hex 16)"
  cat >"$LOCAL_DIR/.env" <<EOF
APP_ID=dexter-staging
APP_NAME=Coolify
APP_ENV=production
APP_KEY=base64:$(openssl rand -base64 32)
APP_PORT=8001
DB_USERNAME=coolify
DB_PASSWORD=$DB_PASS
DB_DATABASE=coolify
REDIS_PASSWORD=$REDIS_PASS
PUSHER_APP_ID=$PUSHER_ID
PUSHER_APP_KEY=$PUSHER_KEY
PUSHER_APP_SECRET=$PUSHER_SECRET
EOF
  echo "Created $LOCAL_DIR/.env"
fi

echo "==> Starting Coolify stack (Linux overrides) ..."
docker compose -f "$STAGING_DIR/docker-compose.full.yml" up -d coolify postgres redis soketi coolify-testing-host

cat <<EOF

Bootstrap phase 1 complete.

Next steps (manual):
  1. Open Coolify (SSH tunnel until DNS/TLS ready):
       ssh -L 8001:127.0.0.1:8001 $DEPLOY_USER@<vps-ip>
       open http://127.0.0.1:8001
  2. Register admin, enable Settings → Advanced → API Access.
  3. Create API token → set COOLIFY_API_TOKEN in $STAGING_DIR/.env
  4. Create Docker Image app "dexter" (ghcr.io/accidentally-awesome-labs/dexter:latest).
  5. Set app FQDN to https://dexter.\${STAGING_DOMAIN}/ in Coolify UI.
  6. Copy app UUID to COOLIFY_APP_UUID and infra/coolify/apps.json.
  7. Point DNS: coolify, bridge, dexter → VPS IP; edit STAGING_DOMAIN in .env.
  8. Start bridge + TLS:
       cd $STAGING_DIR
       docker compose -f docker-compose.full.yml up -d dexter-bridge
       docker compose -f docker-compose.full.yml --profile tls up -d
  9. Wire GHCR + deploy from repo root on VPS or laptop:
       npm run coolify:ghcr-wire
 10. Verify + sync GitHub secrets:
       bash $REPO_DIR/scripts/staging-vps-verify.sh
       bash $REPO_DIR/scripts/staging-vps-sync-secrets.sh

EOF
