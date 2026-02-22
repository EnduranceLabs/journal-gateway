import type { McpServerConfig } from "../config.js";

export const clickhouse: McpServerConfig = {
  id: "clickhouse",
  type: "mcp_server",
  name: "ClickHouse",
  description: "Query ClickHouse analytics databases",
  command: "npx",
  args: ["-y", "@journal/mcp-clickhouse"],
  envVars: {
    CLICKHOUSE_URL: "CLICKHOUSE_URL",
    CLICKHOUSE_USERNAME: "CLICKHOUSE_USERNAME",
    CLICKHOUSE_PASSWORD: "CLICKHOUSE_PASSWORD",
  },
};
