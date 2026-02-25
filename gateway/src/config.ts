import { z } from "zod";
import { readFileSync } from "node:fs";
import type { GatewayConfig } from "@journal.one/gateway-protocol";

export interface McpServerConfig {
  id: string;
  type: "mcp_server";
  name: string;
  description: string;
  command: string;
  args: string[];
  envVars: Record<string, string>;
}

export type RuntimeConfig = GatewayConfig & {
  mcpServers: McpServerConfig[];
  mcpEnvVars: Map<string, Record<string, string>>;
  skillsDir: string | null;
};

const OperationalSchema = z.object({
  token: z.string().min(1, "JOURNAL_GATEWAY_TOKEN is required"),
  url: z.string().url(),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
});

const McpServerConfigSchema = z.object({
  id: z.string().min(1, "Each MCP server must have an id"),
  command: z.string().min(1, "Each MCP server must have a command"),
  args: z.array(z.string()).default([]),
  name: z.string().optional(),
  description: z.string().default(""),
  envVars: z.record(z.string()).default({}),
});

export const GatewayConfigFileSchema = z.object({
  mcpServers: z.array(McpServerConfigSchema).default([]),
  skillsDir: z.string().nullable().default(null),
});

export type GatewayConfigFile = z.infer<typeof GatewayConfigFileSchema>;

function parseCliConfigArg(argv: string[]): string | null {
  const idx = argv.indexOf("--config");
  if (idx === -1 || idx + 1 >= argv.length) return null;
  return argv[idx + 1];
}

function readConfigFile(path: string): GatewayConfigFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Cannot read config file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Config file is not valid JSON: ${path}`);
  }
  return GatewayConfigFileSchema.parse(parsed);
}

export function parseConfig(
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv
): RuntimeConfig {
  const token = env.JOURNAL_GATEWAY_TOKEN ?? "";
  const url = env.JOURNAL_GATEWAY_URL ?? "wss://gateway.journal.one/v1";
  const logLevel = (env.LOG_LEVEL ?? "info") as
    | "debug"
    | "info"
    | "warn"
    | "error";

  const base = OperationalSchema.parse({ token, url, logLevel });

  // Resolve config: --config arg > JOURNAL_GATEWAY_CONFIG env var > empty config
  const cliConfigPath = parseCliConfigArg(argv);
  const envConfig = env.JOURNAL_GATEWAY_CONFIG ?? null;

  let configFile: GatewayConfigFile;

  if (cliConfigPath) {
    configFile = readConfigFile(cliConfigPath);
  } else if (envConfig) {
    if (envConfig.trimStart().startsWith("{")) {
      // Inline JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(envConfig);
      } catch {
        throw new Error("JOURNAL_GATEWAY_CONFIG is not valid JSON");
      }
      configFile = GatewayConfigFileSchema.parse(parsed);
    } else {
      configFile = readConfigFile(envConfig);
    }
  } else {
    configFile = GatewayConfigFileSchema.parse({});
  }

  if (configFile.mcpServers.length === 0 && !configFile.skillsDir) {
    console.warn(
      "Warning: no mcpServers or skillsDir configured. The gateway will connect but have no tools or skills to offer."
    );
  }

  // Build McpServerConfig[] and resolve envVars
  const mcpServers: McpServerConfig[] = [];
  const mcpEnvVars = new Map<string, Record<string, string>>();

  for (const server of configFile.mcpServers) {
    const config: McpServerConfig = {
      id: server.id,
      type: "mcp_server",
      name: server.name ?? server.id,
      description: server.description,
      command: server.command,
      args: server.args,
      envVars: server.envVars,
    };

    const resolvedEnv: Record<string, string> = {};
    for (const [hostVar, serverVar] of Object.entries(config.envVars)) {
      const value = env[hostVar];
      if (!value) {
        throw new Error(
          `MCP server "${config.id}" requires environment variable ${hostVar}`
        );
      }
      resolvedEnv[serverVar as string] = value;
    }

    mcpServers.push(config);
    mcpEnvVars.set(config.id, resolvedEnv);
  }

  return { ...base, mcpServers, mcpEnvVars, skillsDir: configFile.skillsDir };
}
