#!/usr/bin/env node

import { parseConfig } from "./config.js";
import { BUILT_IN_MCP_SERVERS } from "./integrations/index.js";
import { McpRuntime } from "./mcp-runtime.js";
import { GatewayConnection, Logger } from "@journal/gateway";
import type { IntegrationProvider } from "@journal/gateway";
import { SkillLoader } from "@journal/skills";

async function main(): Promise<void> {
  const config = parseConfig(BUILT_IN_MCP_SERVERS);
  const logger = new Logger(config.logLevel);

  logger.info("Starting Journal Gateway", {
    integrations: config.integrations,
    url: config.url,
    ...(config.skillsDir ? { skillsDir: config.skillsDir } : {}),
  });

  const runtime = new McpRuntime(config);
  await runtime.start();

  const skillLoader = new SkillLoader(config.skillsDir, logger);
  await skillLoader.load();

  const skillIntegrations = skillLoader.getIntegrations();

  const provider: IntegrationProvider = {
    start: () => runtime.start(),
    stop: () => runtime.stop(),
    getRegistrations: async () => {
      const mcpIntegrations = await runtime.getRegistrations();
      return [...mcpIntegrations, ...skillIntegrations];
    },
    callTool: (id, tool, args) => runtime.callTool(id, tool, args),
  };

  const connection = new GatewayConnection(config, provider);
  await connection.connect();

  logger.info("Journal Gateway is running");

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    await connection.close();
    await runtime.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
