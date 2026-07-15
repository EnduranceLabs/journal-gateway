# Database Access Examples

These examples show how to expose SQL databases through Journal Gateway using
[Google MCP Toolbox for Databases](https://github.com/googleapis/mcp-toolbox).
Toolbox is an open source MCP server for databases with prebuilt tools such as
`list_tables` and `execute_sql`, plus a custom-tools framework for restricted
queries.

The gateway does not need database credentials itself. It starts the MCP server
inside your network and passes only the environment variables that MCP server
needs. Credentials stay in your infrastructure.

These examples do not have their own npm package and do not add database MCP
servers as dependencies of Journal Gateway. The `@toolbox-sdk/server` package is
referenced as an external runtime command through `npx -y`.

## Example Configs

| File | Database | Required host env vars |
|------|----------|------------------------|
| [`toolbox-postgres.json`](./toolbox-postgres.json) | PostgreSQL | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DATABASE`, `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| [`toolbox-mysql.json`](./toolbox-mysql.json) | MySQL | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` |
| [`toolbox-mssql.json`](./toolbox-mssql.json) | Microsoft SQL Server | `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD` |
| [`toolbox-snowflake.json`](./toolbox-snowflake.json) | Snowflake | `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PASSWORD`, `SNOWFLAKE_DATABASE`, `SNOWFLAKE_SCHEMA`, `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_ROLE` |

Run one example:

```bash
JOURNAL_GATEWAY_TOKEN=gw_your_token \
POSTGRES_HOST=db.internal.example.com \
POSTGRES_PORT=5432 \
POSTGRES_DATABASE=analytics \
POSTGRES_USER=journal_gateway_ro \
POSTGRES_PASSWORD='replace-me' \
journal-gateway --config examples/integrations/database/toolbox-postgres.json
```

For production, put the environment variables in a local env file and pass it
with `--env-file /etc/journal/gateway.env`.

## Recommended Access Model

Database MCP servers can usually expose an `execute_sql` tool. Treat the database
account as the enforcement boundary:

- create a dedicated account for Journal Gateway;
- grant only the schemas, tables, views, or warehouses the agent should see;
- prefer views over base tables when columns or rows need to be hidden;
- use read replicas for analytical access when possible;
- restrict the account to the gateway host or private network path;
- require TLS for database connections when traffic crosses hosts or networks;
- set statement timeouts and resource limits;
- rotate credentials on the same schedule as other service credentials;
- enable database audit logging for the dedicated account;
- test with the dedicated account and confirm writes fail before enabling it in
  production.

If you need stricter controls than a generic `execute_sql` tool can provide,
use Toolbox custom tools with predefined SQL statements and parameter binding
instead of a prebuilt config.

Use this rollout checklist:

1. Create the database role/user with no default admin or write privileges.
2. Grant read access only to the intended schema, table, view, or warehouse.
3. Run the verification commands below as the new user.
4. Store credentials in the gateway host environment or env file.
5. Start the gateway with the matching example config.
6. Review database audit logs for the dedicated account after first use.

## PostgreSQL Read-Only User

Create a dedicated role and grant it access only to the schemas it should read.
Run default-privilege statements as the role that owns future objects, or add
`FOR ROLE <owner_role>` when your DBA manages grants centrally:

```sql
CREATE ROLE journal_gateway_ro LOGIN PASSWORD 'replace-me';

GRANT CONNECT ON DATABASE analytics TO journal_gateway_ro;
\c analytics

GRANT USAGE ON SCHEMA reporting TO journal_gateway_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO journal_gateway_ro;

ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT SELECT ON TABLES TO journal_gateway_ro;

ALTER ROLE journal_gateway_ro SET default_transaction_read_only = on;
ALTER ROLE journal_gateway_ro SET statement_timeout = '30s';
```

For restricted access, create views in a dedicated schema and grant access only
to those views:

```sql
CREATE SCHEMA journal_ai;

CREATE VIEW journal_ai.customer_summary AS
SELECT id, plan, created_at
FROM app.customers
WHERE deleted_at IS NULL;

GRANT USAGE ON SCHEMA journal_ai TO journal_gateway_ro;
GRANT SELECT ON journal_ai.customer_summary TO journal_gateway_ro;
```

Verify with the dedicated user:

```sql
SELECT current_user;
SELECT * FROM journal_ai.customer_summary LIMIT 1;

CREATE TABLE journal_ai.should_fail(id integer);
INSERT INTO journal_ai.customer_summary(id) VALUES (1);
```

The `SELECT` should work. The `CREATE TABLE` and `INSERT` should fail.

## MySQL Read-Only User

Grant `SELECT` only on the database or on specific tables/views. Replace
`gateway-host.example.com` with the hostname or host pattern your gateway uses
to reach MySQL:

```sql
CREATE USER 'journal_gateway_ro'@'gateway-host.example.com'
  IDENTIFIED BY 'replace-me';

GRANT SELECT ON analytics.* TO 'journal_gateway_ro'@'gateway-host.example.com';
ALTER USER 'journal_gateway_ro'@'gateway-host.example.com'
  WITH MAX_USER_CONNECTIONS 5;
```

For narrower access, grant only a reporting schema or specific views instead of
`analytics.*`.

Verify with the dedicated user. Replace `allowed_table_or_view` with an object
the account should be able to read:

```sql
SELECT CURRENT_USER();
SELECT * FROM analytics.allowed_table_or_view LIMIT 1;

CREATE TABLE analytics.should_fail(id int);
INSERT INTO analytics.allowed_table_or_view(id) VALUES (1);
```

The `SELECT` should work. The `CREATE TABLE` and `INSERT` should fail.

## Microsoft SQL Server Read-Only User

Create a login, map it to the database, and grant read-only access. Use
`db_datareader` only when the account should read every current and future user
table and view in the database:

```sql
USE master;
CREATE LOGIN journal_gateway_ro WITH PASSWORD = 'replace-me';

USE analytics;
CREATE USER journal_gateway_ro FOR LOGIN journal_gateway_ro;
ALTER ROLE db_datareader ADD MEMBER journal_gateway_ro;
GRANT VIEW DEFINITION TO journal_gateway_ro;
```

For restricted access, skip `db_datareader` and grant `SELECT` on a schema or
specific views:

```sql
CREATE SCHEMA journal_ai;
GO

CREATE VIEW journal_ai.customer_summary AS
SELECT id, plan, created_at
FROM dbo.customers
WHERE deleted_at IS NULL;
GO

GRANT SELECT ON SCHEMA::journal_ai TO journal_gateway_ro;
```

Verify with the dedicated user:

```sql
SELECT SYSTEM_USER;
SELECT TOP 1 * FROM journal_ai.customer_summary;

CREATE TABLE journal_ai.should_fail(id int);
INSERT INTO journal_ai.customer_summary(id) VALUES (1);
```

The `SELECT` should work. The `CREATE TABLE` and `INSERT` should fail.

## Snowflake Restricted Role

Create a role with usage on a warehouse/database/schema and select access on the
objects it should read:

```sql
CREATE ROLE JOURNAL_GATEWAY_RO;
CREATE USER JOURNAL_GATEWAY_RO_USER PASSWORD = 'replace-me'
  DEFAULT_ROLE = JOURNAL_GATEWAY_RO
  DEFAULT_WAREHOUSE = JOURNAL_AI_WH;

GRANT ROLE JOURNAL_GATEWAY_RO TO USER JOURNAL_GATEWAY_RO_USER;

GRANT USAGE ON WAREHOUSE JOURNAL_AI_WH TO ROLE JOURNAL_GATEWAY_RO;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE JOURNAL_GATEWAY_RO;
GRANT USAGE ON SCHEMA ANALYTICS.REPORTING TO ROLE JOURNAL_GATEWAY_RO;
GRANT SELECT ON ALL TABLES IN SCHEMA ANALYTICS.REPORTING TO ROLE JOURNAL_GATEWAY_RO;
GRANT SELECT ON FUTURE TABLES IN SCHEMA ANALYTICS.REPORTING TO ROLE JOURNAL_GATEWAY_RO;
GRANT SELECT ON ALL VIEWS IN SCHEMA ANALYTICS.REPORTING TO ROLE JOURNAL_GATEWAY_RO;
GRANT SELECT ON FUTURE VIEWS IN SCHEMA ANALYTICS.REPORTING TO ROLE JOURNAL_GATEWAY_RO;
```

Use a small warehouse with an auto-suspend policy for agent workloads.

Verify with the dedicated user and role. Replace `ALLOWED_TABLE_OR_VIEW` with
an object the role should be able to read:

```sql
USE ROLE JOURNAL_GATEWAY_RO;
USE WAREHOUSE JOURNAL_AI_WH;
USE DATABASE ANALYTICS;
USE SCHEMA REPORTING;

SELECT CURRENT_ROLE();
SELECT * FROM ALLOWED_TABLE_OR_VIEW LIMIT 1;

CREATE TABLE SHOULD_FAIL(id integer);
INSERT INTO ALLOWED_TABLE_OR_VIEW(id) VALUES (1);
```

The `SELECT` should work. The `CREATE TABLE` and `INSERT` should fail.

## Toolbox Notes

The samples use Toolbox prebuilt configs:

- `--prebuilt postgres`
- `--prebuilt mysql`
- `--prebuilt mssql`
- `--prebuilt snowflake`

Toolbox also supports loading a narrower toolset with the
`--prebuilt <database>/<toolset>` syntax, for example
`--prebuilt postgres/data`. Use that when you want fewer tools exposed to the
model.

For production workflows that should only run approved queries, create a Toolbox
`tools.yaml` with custom parameterized SQL tools and point the gateway entry at:

```json
{
  "id": "analytics-restricted",
  "command": "npx",
  "args": ["-y", "@toolbox-sdk/server", "--config", "/etc/journal/tools.yaml", "--stdio"],
  "envVars": {
    "POSTGRES_HOST": "POSTGRES_HOST",
    "POSTGRES_PORT": "POSTGRES_PORT",
    "POSTGRES_DATABASE": "POSTGRES_DATABASE",
    "POSTGRES_USER": "POSTGRES_USER",
    "POSTGRES_PASSWORD": "POSTGRES_PASSWORD"
  }
}
```

Keep the `tools.yaml` next to your infrastructure configuration and review it
like application code.

## Permission References

- [PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html)
  and [default privileges](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)
- [MySQL `CREATE USER`](https://dev.mysql.com/doc/refman/8.4/en/create-user.html),
  [`GRANT`](https://dev.mysql.com/doc/en/grant.html), and
  [account resource limits](https://dev.mysql.com/doc/en/user-resources.html)
- SQL Server
  [database-level roles](https://learn.microsoft.com/en-us/sql/relational-databases/security/authentication-access/database-level-roles),
  [`CREATE USER`](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-user-transact-sql),
  [`ALTER ROLE`](https://learn.microsoft.com/en-us/sql/t-sql/statements/alter-role-transact-sql),
  and [schema permissions](https://learn.microsoft.com/en-us/sql/t-sql/statements/grant-schema-permissions-transact-sql)
- Snowflake
  [access control](https://docs.snowflake.com/en/user-guide/security-access-control-configure),
  [`GRANT <privileges>`](https://docs.snowflake.com/en/sql-reference/sql/grant-privilege),
  and [`SHOW GRANTS`](https://docs.snowflake.com/en/sql-reference/sql/show-grants)
