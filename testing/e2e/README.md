# End-to-End Tests

These tests exercise the **real** Journal Gateway stack against **real**
databases — no mocks:

```
client library (service side)  <—ws—>  journal-gateway  <—stdio—>  Toolbox MCP server  <—>  Postgres / MySQL (Docker)
```

They validate the database integration examples added under
[`examples/integrations/`](../../examples/integrations) and the
legacy Postgres reference-server to `@toolbox-sdk/server` migration in the docs,
plus the gateway's config hot-reload.

## What is covered

| Test | What it proves |
|------|----------------|
| `driver.mjs` (postgres) | Gateway starts the Toolbox Postgres MCP server over stdio, publishes `execute_sql` (+28 tools) to the client, read queries return rows, writes are rejected by the read-only role. |
| `driver.mjs` (mysql) | Same, for MySQL (writes rejected with `ERROR 1142 command denied`). |
| `hotreload.mjs` | Adding an MCP server to the config file on disk at runtime republishes tools with no restart, and the new server is immediately callable. |
| `sql/*-setup.sql` | The exact read-only role recipes from [`examples/integrations/database/README.md`](../../examples/integrations/database/README.md): reads succeed, writes fail. |

The env-var names in `configs/*.json` are the ones the Toolbox prebuilt configs
actually read (`POSTGRES_*`, `MYSQL_*`), so a green run also confirms the docs'
env-var tables are correct.

## Prerequisites

- Docker (Compose v2)
- Node.js >= 22
- Workspace dependencies:
  ```bash
  pnpm install
  ```

## Run everything

```bash
testing/e2e/run-all.sh            # brings up DBs, runs all tests, leaves DBs up
KEEP_UP=0 testing/e2e/run-all.sh  # ...and tears the DBs down at the end
```

## Run pieces manually

```bash
docker compose -f testing/e2e/docker-compose.yml up -d

# Postgres
node testing/e2e/driver.mjs \
  testing/e2e/configs/postgres.json testing/e2e/env/postgres.env postgres \
  "SELECT name, count(*) n FROM reporting.events GROUP BY name ORDER BY name" \
  "INSERT INTO reporting.events (name, amount) VALUES ('hack', 1)" \
  '{"purchase":1,"signup":2}'

# Config hot-reload
node testing/e2e/hotreload.mjs

docker compose -f testing/e2e/docker-compose.yml down -v
```

## Shipped example scripts

The shipped `examples/client-server.ts` / `examples/client_server.py` +
`examples/gateway.json` were also run by hand against this Postgres. To repeat:

```bash
# make the workspace client resolvable to the TS example (mimics `npm install`)
mkdir -p examples/node_modules/@journal.one
ln -sfn ../../../clients/typescript examples/node_modules/@journal.one/gateway-client

# TS (node 22 strips the types; no tsx needed)
( cd examples && node --experimental-strip-types client-server.ts ) &
JOURNAL_GATEWAY_TOKEN=gw_demo node gateway/dist/main.js \
  --env-file testing/e2e/env/examples-postgres.env --config examples/gateway.json
```

The `remote-api` entry in `gateway.json` points at a non-existent host on
purpose — it demonstrates the gateway's resilient startup (the failed server is
logged and skipped, the healthy ones still serve).

## Files

```
docker-compose.yml     Postgres (host :5433) + MySQL (host :3307)
sql/postgres-setup.sql Fixture data + read-only role (from the docs)
sql/mysql-setup.sql    Fixture data + read-only user (from the docs)
configs/*.json         Gateway configs (Toolbox stdio) for each DB
env/*.env              Host env vars the gateway maps into the MCP subprocess
driver.mjs             DB integration driver (asserts read ok / write rejected)
hotreload.mjs          Config hot-reload driver
run-all.sh             One-shot runner
```
