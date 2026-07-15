#!/usr/bin/env bash
# End-to-end test runner for Journal Gateway.
#
# Brings up Dockerized Postgres + MySQL, then drives the REAL gateway binary +
# REAL client library + REAL Google MCP Toolbox server against them, and asserts:
#   - the gateway publishes MCP tools to the service (client) side
#   - execute_sql read queries succeed and return rows
#   - write queries are rejected by the dedicated read-only DB account
#   - config hot-reload adds a server at runtime with no restart
#
# Prereqs: docker and node (>=22). See README.md.
#
# Usage:
#   testing/e2e/run-all.sh            # run everything, leave containers up
#   KEEP_UP=0 testing/e2e/run-all.sh  # tear containers down at the end
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
cd "$DIR"

fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  local status=$?
  if [ "${KEEP_UP:-1}" = "0" ]; then
    echo "== Tearing down databases =="
    docker compose down -v >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

echo "== Building workspace packages (idempotent) =="
( cd "$REPO" && pnpm -r build >/dev/null )

echo "== Prewarming @toolbox-sdk/server via npx =="
npx -y @toolbox-sdk/server --version >/dev/null 2>&1 || true

echo "== Starting databases (docker compose) =="
docker compose up -d

wait_healthy() {
  local service="$1" tries="${2:-40}"
  for _ in $(seq 1 "$tries"); do
    local container_id
    container_id="$(docker compose ps -q "$service" 2>/dev/null || true)"
    if [ -n "$container_id" ] &&
      [ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null)" = "healthy" ]; then
      return 0
    fi
    sleep 3
  done
  fail "$service did not become healthy"
}
echo "  waiting for postgres..."; wait_healthy postgres
echo "  waiting for mysql...";    wait_healthy mysql

echo "== E2E: PostgreSQL =="
node driver.mjs configs/postgres.json env/postgres.env postgres \
  "SELECT name, count(*) AS n FROM reporting.events GROUP BY name ORDER BY name" \
  "INSERT INTO reporting.events (name, amount) VALUES ('hack', 1)" \
  '{"purchase":1,"signup":2}' \
  | grep -E "\[driver\] (integrations|read result|write|RESULT)" \
  || fail "postgres driver failed"

echo "== E2E: MySQL =="
node driver.mjs configs/mysql.json env/mysql.env mysql \
  "SELECT name, count(*) AS n FROM analytics.events GROUP BY name ORDER BY name" \
  "INSERT INTO analytics.events (name, amount) VALUES ('hack', 1)" \
  '{"purchase":1,"signup":2}' \
  | grep -E "\[driver\] (integrations|read result|write|RESULT)" \
  || fail "mysql driver failed"

echo "== E2E: config hot-reload =="
node hotreload.mjs | grep -E "\[hotreload\]"

echo "== ALL E2E TESTS PASSED =="
