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
# Prereqs: docker, node (>=22), a built repo (`pnpm build` + build protocol &
# clients/typescript). See README.md.
#
# Usage:
#   testing/e2e/run-all.sh            # run everything, leave containers up
#   KEEP_UP=0 testing/e2e/run-all.sh  # tear containers down at the end
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
cd "$DIR"

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== Building gateway + protocol + client (idempotent) =="
( cd "$REPO" && pnpm build >/dev/null )
( cd "$REPO/protocol" && pnpm build >/dev/null )
( cd "$REPO/clients/typescript" && pnpm build >/dev/null )

echo "== Prewarming @toolbox-sdk/server via npx =="
npx -y @toolbox-sdk/server --version >/dev/null 2>&1 || true

echo "== Starting databases (docker compose) =="
docker compose up -d

wait_healthy() {
  local name="$1" tries="${2:-40}"
  for _ in $(seq 1 "$tries"); do
    [ "$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null)" = "healthy" ] && return 0
    sleep 3
  done
  fail "$name did not become healthy"
}
echo "  waiting for postgres..."; wait_healthy e2e-postgres-1
echo "  waiting for mysql...";    wait_healthy e2e-mysql-1

echo "== E2E: PostgreSQL =="
node driver.mjs configs/postgres.json env/postgres.env postgres \
  "SELECT name, count(*) AS n FROM reporting.events GROUP BY name ORDER BY name" \
  "INSERT INTO reporting.events (name, amount) VALUES ('hack', 1)" \
  | grep -E "\[driver\] (integrations|read result|write|RESULT)" \
  || fail "postgres driver failed"

echo "== E2E: MySQL =="
node driver.mjs configs/mysql.json env/mysql.env mysql \
  "SELECT name, count(*) AS n FROM analytics.events GROUP BY name ORDER BY name" \
  "INSERT INTO analytics.events (name, amount) VALUES ('hack', 1)" \
  | grep -E "\[driver\] (integrations|read result|write|RESULT)" \
  || fail "mysql driver failed"

echo "== E2E: config hot-reload =="
node hotreload.mjs | grep -E "\[hotreload\]"

if [ "${KEEP_UP:-1}" = "0" ]; then
  echo "== Tearing down databases =="
  docker compose down -v
fi
echo "== ALL E2E TESTS PASSED =="
