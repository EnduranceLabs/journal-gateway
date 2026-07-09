#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseConfig, resolveConfigFilePath } from "./config.js";
import { EnvFile } from "./env-file.js";
import { Runtime } from "./runtime.js";
import { GatewayConnection, AuthenticationError } from "./connection.js";
import { Logger } from "./common/logger.js";
import { Telemetry } from "./telemetry.js";
import { AuditLogger } from "./audit.js";

function resolveEnvFilePath(
  env: Record<string, string | undefined>,
  argv: string[]
): string | null {
  // --env-file CLI arg
  const idx = argv.indexOf("--env-file");
  if (idx !== -1 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }

  // JOURNAL_GATEWAY_ENV_FILE env var
  const envFilePath = env.JOURNAL_GATEWAY_ENV_FILE;
  if (envFilePath) return envFilePath;

  // Auto-detect .env in cwd
  const defaultPath = resolve(".env");
  if (existsSync(defaultPath)) return defaultPath;

  return null;
}

async function main(): Promise<void> {
  // Resolve .env file and load it before parsing config
  const envFilePath = resolveEnvFilePath(process.env, process.argv);

  let mergedEnv: Record<string, string | undefined> = { ...process.env };
  if (envFilePath) {
    const envFile = new EnvFile(envFilePath);
    const envVars = envFile.load();
    // .env values fill in gaps; process.env takes precedence
    mergedEnv = { ...envVars, ...process.env };
  }

  const config = parseConfig(mergedEnv, process.argv);
  const logger = new Logger(config.logLevel);

  const telemetry = new Telemetry();
  await telemetry.start({
    endpoint: mergedEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: mergedEnv.OTEL_SERVICE_NAME ?? "journal-gateway",
    disabled: (mergedEnv.TELEMETRY_DISABLED ?? "").toLowerCase() === "true",
  });

  const audit = new AuditLogger({
    filePath: mergedEnv.AUDIT_LOG_FILE ?? null,
    enabled: true,
    maxBytes: mergedEnv.AUDIT_MAX_BYTES ? Number(mergedEnv.AUDIT_MAX_BYTES) : null,
    maxFiles: mergedEnv.AUDIT_MAX_FILES ? Number(mergedEnv.AUDIT_MAX_FILES) : null,
  });

  const configFilePath = resolveConfigFilePath(mergedEnv, process.argv);

  logger.info("Starting Journal Gateway", {
    url: config.url,
    mcpServers: config.mcpServers.map((s) => s.id),
    ...(config.skillsDir ? { skillsDir: config.skillsDir } : {}),
    ...(configFilePath ? { configFile: configFilePath } : {}),
    ...(envFilePath ? { envFile: envFilePath } : {}),
  });

  const runtime = new Runtime(config, configFilePath, envFilePath, {
    telemetry,
    audit,
  });
  await runtime.start();

  const connection = new GatewayConnection(config, runtime, telemetry, audit);

  // Register signal handlers before connect() so shutdown works during
  // startup retries (connect blocks until first auth success).
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    await connection.close();
    await runtime.stop();
    await telemetry.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await connection.connect();
    logger.info("Journal Gateway is running");
  } catch (err) {
    if (err instanceof AuthenticationError) {
      logger.error("Service rejected the gateway token, exiting", {
        error: err.message,
      });
      await runtime.stop();
      await telemetry.shutdown();
      process.exit(1);
    }
    // close() was called before first successful connection
    // (e.g. SIGTERM during startup). Shutdown handler already ran.
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
