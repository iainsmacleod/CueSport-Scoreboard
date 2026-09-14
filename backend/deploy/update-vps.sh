#!/usr/bin/env bash
# CueSport Cloud — VPS update / branch switch (preserves SQLite + .env)
#
# Usage (on the VPS):
#   sudo bash /opt/cuesport/backend/deploy/update-vps.sh
#   sudo bash /opt/cuesport/backend/deploy/update-vps.sh main
#   BRANCH=stripe-integration bash /opt/cuesport/backend/deploy/update-vps.sh
#
# Safe by default: never deletes backend/data/ or backend/.env.
# For a true wipe+reinstall, back those up first and do it manually.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cuesport}"
REPO_URL="${REPO_URL:-https://github.com/iainsmacleod/CueSport-Scoreboard.git}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-stripe-integration}"
BACKEND_DIR="${APP_DIR}/backend"
DATA_DIR="${BACKEND_DIR}/data"
ENV_FILE="${BACKEND_DIR}/.env"
ENV_BACKUP="${HOME}/cuesport.env"

BRANCH="${1:-${BRANCH:-}}"
if [[ -z "${BRANCH}" ]]; then
  read -rp "Branch to deploy [${DEFAULT_BRANCH}]: " BRANCH
  BRANCH="${BRANCH:-$DEFAULT_BRANCH}"
fi

echo "==> Deploy dir: ${APP_DIR}"
echo "==> Branch:     ${BRANCH}"

mkdir -p "${APP_DIR}"
cd "${APP_DIR}"

if [[ ! -d .git ]]; then
  echo "==> No git repo at ${APP_DIR}; cloning ${BRANCH}…"
  # Empty dir only — refuse if unrelated files exist (protects data copies, etc.).
  if [[ -n "$(find . -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]]; then
    echo "ERROR: ${APP_DIR} is not empty and is not a git checkout." >&2
    echo "Move or remove it, or set APP_DIR to a clean path." >&2
    exit 1
  fi
  git clone -b "${BRANCH}" --single-branch "${REPO_URL}" .
else
  echo "==> Fetching and checking out ${BRANCH}…"
  git remote set-url origin "${REPO_URL}" 2>/dev/null || true
  git fetch --prune origin
  # Keep local data/.env even if they are untracked — never clean -fdx here.
  git checkout -B "${BRANCH}" "origin/${BRANCH}"
  git reset --hard "origin/${BRANCH}"
fi

mkdir -p "${DATA_DIR}"

# Prefer existing backend/.env; otherwise restore from ~/cuesport.env
if [[ -f "${ENV_FILE}" ]]; then
  echo "==> Keeping existing ${ENV_FILE}"
  cp -a "${ENV_FILE}" "${ENV_BACKUP}"
elif [[ -f "${ENV_BACKUP}" ]]; then
  echo "==> Restoring .env from ${ENV_BACKUP}"
  cp -a "${ENV_BACKUP}" "${ENV_FILE}"
else
  echo "WARN: No ${ENV_FILE} or ${ENV_BACKUP}." >&2
  echo "      Copy .env.example → backend/.env and edit before first start." >&2
fi

cd "${BACKEND_DIR}"

if [[ ! -f docker-compose.yml ]]; then
  echo "ERROR: missing ${BACKEND_DIR}/docker-compose.yml" >&2
  exit 1
fi

echo "==> Building and recreating containers (data volume preserved)…"
docker compose up -d --build --force-recreate

echo "==> Done."
echo "    SQLite data: ${DATA_DIR}"
echo "    Health:      curl -fsS http://127.0.0.1:3000/health || true"
docker compose ps
