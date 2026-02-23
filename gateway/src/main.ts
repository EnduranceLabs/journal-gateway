#!/usr/bin/env node

import { parseConfig } from "./config.js";
import { Runtime } from "./runtime.js";
import { GatewayConnection } from "./connection.js";
import { Logger } from "./common/logger.js";

async function main(): Promise<void> {
  const config = parseConfig(process.env, process.argv);
  const logger = new Logger(config.logLevel);

  logger.info("Starting Journal Gateway", {
    url: config.url,
    mcpServers: config.mcpServers.map((s) => s.id),
    ...(config.skillsDir ? { skillsDir: config.skillsDir } : {}),
  });

  const runtime = new Runtime(config);
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
