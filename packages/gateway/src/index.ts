#!/usr/bin/env node

import { parseConfig } from "./config.js";
import { BUILT_IN_SKILLS } from "./skills/index.js";
import { SkillRuntime } from "./skill-runtime.js";
import { GatewayConnection } from "./connection.js";
import { Logger } from "./logger.js";

export { GatewayConnection } from "./connection.js";
export { SkillRuntime } from "./skill-runtime.js";
export { McpProcess } from "./mcp-process.js";
export { parseConfig } from "./config.js";
export type { GatewayConfig, SkillDefinition } from "./config.js";
export { BUILT_IN_SKILLS } from "./skills/index.js";
export { Logger } from "./logger.js";

async function main(): Promise<void> {
  const config = parseConfig(BUILT_IN_SKILLS);
  const logger = new Logger(config.logLevel);

  logger.info("Starting Journal Gateway", {
    skills: config.skills,
    url: config.url,
  });

  const runtime = new SkillRuntime(config);
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

// Run main only when executed directly (not imported as a library)
const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
