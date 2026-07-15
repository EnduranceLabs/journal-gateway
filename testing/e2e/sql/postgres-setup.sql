-- Postgres E2E fixture for Journal Gateway.
-- Runs against the `analytics` database (POSTGRES_DB) on container init.
-- Mirrors the read-only role recipe in
-- examples/integrations/database/README.md ("PostgreSQL Read-Only User").

-- Base application data (private schema the RO role must NOT reach directly).
CREATE SCHEMA app;
CREATE TABLE app.customers (
  id         integer PRIMARY KEY,
  plan       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
INSERT INTO app.customers (id, plan, deleted_at) VALUES
  (1, 'pro',   NULL),
  (2, 'free',  NULL),
  (3, 'pro',   now()),      -- soft-deleted; must be hidden by the view
  (4, 'team',  NULL);

-- Reporting schema the RO role may read in full.
CREATE SCHEMA reporting;
CREATE TABLE reporting.events (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  amount     numeric NOT NULL
);
INSERT INTO reporting.events (name, amount) VALUES
  ('signup', 10),
  ('signup', 10),
  ('purchase', 42);

-- Curated view schema (least-privilege exposure) from the README.
CREATE SCHEMA journal_ai;
CREATE VIEW journal_ai.customer_summary AS
SELECT id, plan, created_at
FROM app.customers
WHERE deleted_at IS NULL;

-- Dedicated read-only role (verbatim shape from the docs).
CREATE ROLE journal_gateway_ro LOGIN PASSWORD 'ro_pw';
GRANT CONNECT ON DATABASE analytics TO journal_gateway_ro;

GRANT USAGE ON SCHEMA reporting TO journal_gateway_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO journal_gateway_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT SELECT ON TABLES TO journal_gateway_ro;

GRANT USAGE ON SCHEMA journal_ai TO journal_gateway_ro;
GRANT SELECT ON journal_ai.customer_summary TO journal_gateway_ro;

ALTER ROLE journal_gateway_ro SET default_transaction_read_only = on;
ALTER ROLE journal_gateway_ro SET statement_timeout = '30s';
