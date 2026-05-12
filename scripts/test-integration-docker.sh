#!/usr/bin/env bash
# Docker-only integration runner. Use this when the host has Docker but no
# Node/pnpm — e.g. running on a server box where you don't want to install
# tooling globally. Everything happens inside containers.
#
# Brings up docker-compose.test.yml (Postgres + Redis), then runs
# `pnpm -r test` inside an ephemeral node:20-alpine container that shares
# the host network so it can reach 127.0.0.1:55432 / :56379. Tears the
# stack down on exit regardless of pass/fail.
#
# Usage (from the framework root):
#   ./scripts/test-integration-docker.sh
#
# Override the compose project name (parallel runs):
#   COMPOSE_PROJECT=my-prefix ./scripts/test-integration-docker.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.test.yml"
PROJECT="${COMPOSE_PROJECT:-lfm-test}"

PG_URL="postgres://feedback:feedback@127.0.0.1:55432/feedback_test"
REDIS_URL="redis://127.0.0.1:56379"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "error: $COMPOSE_FILE not found" >&2
  exit 1
fi

cleanup() {
  echo
  echo "--- tearing down test infrastructure ---"
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT" down -v --remove-orphans || true
}
trap cleanup EXIT INT TERM

echo "--- bringing up test infrastructure ---"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" up -d --wait --remove-orphans

echo
echo "FEEDBACK_TEST_DATABASE_URL=$PG_URL"
echo "REDIS_URL=$REDIS_URL"
echo
echo "--- running pnpm -r test inside node:20-alpine ---"

docker run --rm \
  --network host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$REPO_ROOT:/workspace" \
  -w /workspace \
  -e FEEDBACK_TEST_DATABASE_URL="$PG_URL" \
  -e TEST_DATABASE_URL="$PG_URL" \
  -e FEEDBACK_TEST_REDIS_URL="$REDIS_URL" \
  -e TEST_REDIS_URL="$REDIS_URL" \
  -e REDIS_URL="$REDIS_URL" \
  -e CI=true \
  node:20-alpine \
  sh -lc "export PNPM='corepack pnpm@10.33.2' && \$PNPM install --frozen-lockfile=false && \$PNPM -r build && \$PNPM -r test"
