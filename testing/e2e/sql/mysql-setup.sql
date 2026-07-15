-- MySQL E2E fixture for Journal Gateway.
-- Runs against the `analytics` database (MYSQL_DATABASE) on container init.
-- Mirrors examples/integrations/database/README.md ("MySQL Read-Only User").

CREATE TABLE analytics.events (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  name   VARCHAR(64) NOT NULL,
  amount DECIMAL(10,2) NOT NULL
);
INSERT INTO analytics.events (name, amount) VALUES
  ('signup', 10),
  ('signup', 10),
  ('purchase', 42);

-- Dedicated read-only user. '%' host so it is reachable from the gateway
-- container/host; production should scope this to the gateway host.
CREATE USER 'journal_gateway_ro'@'%' IDENTIFIED BY 'ro_pw';
GRANT SELECT ON analytics.* TO 'journal_gateway_ro'@'%';
ALTER USER 'journal_gateway_ro'@'%' WITH MAX_USER_CONNECTIONS 5;
FLUSH PRIVILEGES;
