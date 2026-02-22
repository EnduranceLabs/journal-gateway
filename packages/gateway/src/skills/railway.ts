import type { SkillDefinition } from "../config.js";

export const railway: SkillDefinition = {
  id: "railway",
  type: "mcp_server",
  name: "Railway",
  description: "Manage Railway deployments and services",
  command: "npx",
  args: ["-y", "@railway/mcp-server"],
  envVars: { RAILWAY_TOKEN: "RAILWAY_API_TOKEN" },
};
