import type { McpServerConfig } from "../config.js";

export const langfuse: McpServerConfig = {
  id: "langfuse",
  type: "mcp_server",
  name: "Langfuse",
  description: "Access Langfuse observability data",
  command: "npx",
  args: ["-y", "mcp-langfuse"],
  envVars: {
    LANGFUSE_PUBLIC_KEY: "LANGFUSE_PUBLIC_KEY",
    LANGFUSE_SECRET_KEY: "LANGFUSE_SECRET_KEY",
  },
};
