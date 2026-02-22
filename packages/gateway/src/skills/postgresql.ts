import type { SkillDefinition } from "../config.js";

export const postgresql: SkillDefinition = {
  id: "postgresql",
  type: "mcp_server",
  name: "PostgreSQL",
  description: "Query and inspect PostgreSQL databases",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-postgres"],
  envVars: { DATABASE_URL: "DATABASE_URL" },
};
