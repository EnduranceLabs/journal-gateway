import type { McpServerConfig } from "../config.js";

export const postgresql: McpServerConfig = {
  id: "postgresql",
  type: "mcp_server",
  name: "PostgreSQL",
  description: "Query and inspect PostgreSQL databases",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-postgres"],
  envVars: { DATABASE_URL: "DATABASE_URL" },
};
