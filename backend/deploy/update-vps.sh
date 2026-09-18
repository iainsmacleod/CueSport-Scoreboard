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
PROD_COMPOSE="${BACKEND_DIR}/deploy/docker-compose.prod.yml"

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
  # Prior single-branch clones only track one ref; widen fetch so we can switch branches.
  git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
  git fetch --prune origin
  if ! git rev-parse --verify --quiet "origin/${BRANCH}" >/dev/null; then
    echo "ERROR: origin/${BRANCH} not found after fetch." >&2
    echo "Available remote branches:" >&2
    git branch -r >&2 || true
    exit 1
  fi
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

COMPOSE_ARGS=(-f docker-compose.yml)
if [[ -f "${PROD_COMPOSE}" ]]; then
  echo "==> Using production port overlay (127.0.0.1:3000 for Caddy)"
  COMPOSE_ARGS+=(-f deploy/docker-compose.prod.yml)
else
  echo "WARN: missing deploy/docker-compose.prod.yml — repo compose may bind :4003, not :3000" >&2
fi
# Optional host-specific overrides that survive git reset (untracked file).
if [[ -f docker-compose.override.yml ]]; then
  echo "==> Also applying local docker-compose.override.yml"
  COMPOSE_ARGS+=(-f docker-compose.override.yml)
fi

echo "==> Building and recreating containers (data volume preserved)…"
docker compose "${COMPOSE_ARGS[@]}" up -d --build --force-recreate

echo "==> Waiting for health…"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done

echo "==> Done."
echo "    SQLite data: ${DATA_DIR}"
if [[ "${ok}" -eq 1 ]]; then
  echo "    Health:      OK (http://127.0.0.1:3000/health)"
else
  echo "    Health:      NOT OK on :3000 — check logs / port binding (502 from Caddy usually means this)." >&2
  echo "    Diagnose:    docker compose ${COMPOSE_ARGS[*]} ps" >&2
  echo "                 docker compose ${COMPOSE_ARGS[*]} logs --tail=80" >&2
  echo "                 ss -tlnp | grep -E ':3000|:4003'" >&2
fi
docker compose "${COMPOSE_ARGS[@]}" ps
