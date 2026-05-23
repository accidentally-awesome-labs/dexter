#!/usr/bin/env bash
# Log Docker into ghcr.io using the GitHub CLI token (needs write:packages).
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

USER="${GHCR_USER:-$(gh api user -q .login)}"

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "Run: gh auth login" >&2
  exit 1
fi

if ! gh auth status -h github.com 2>&1 | grep -q 'write:packages'; then
  echo "GitHub token missing write:packages. Run:" >&2
  echo "  gh auth refresh -h github.com -s write:packages,read:packages" >&2
  exit 1
fi

echo "$(gh auth token)" | docker login ghcr.io -u "$USER" --password-stdin
echo "Logged in to ghcr.io as $USER"
