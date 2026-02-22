import type { McpServerConfig } from "../config.js";

export const sentry: McpServerConfig = {
  id: "sentry",
  type: "mcp_server",
  name: "Sentry",
  description: "Query Sentry errors and performance data",
  command: "npx",
  args: ["-y", "@sentry/mcp-server"],
  envVars: { SENTRY_AUTH_TOKEN: "SENTRY_AUTH_TOKEN" },
};
