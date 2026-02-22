#!/usr/bin/env node

import { parseConfig } from "./config.js";
import { BUILT_IN_MCP_SERVERS } from "./integrations/index.js";
import { McpRuntime } from "./mcp-runtime.js";
import { GatewayConnection, Logger } from "@journal/gateway";

async function main(): Promise<void> {
  const config = parseConfig(BUILT_IN_MCP_SERVERS);
  const logger = new Logger(config.logLevel);

  logger.info("Starting Journal Gateway", {
    integrations: config.integrations,
    url: config.url,
  });

  const runtime = new McpRuntime(config);
  await runtime.start();

  const connection = new GatewayConnection(config, runtime);
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
