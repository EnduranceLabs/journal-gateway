import { z } from "zod";
import { readFileSync } from "node:fs";
import type { GatewayConfig } from "@journal.one/gateway-protocol";

// --- Discriminated union for MCP server configs ---

const McpServerBaseSchema = z.object({
  id: z.string().min(1, "Each MCP server must have an id"),
  name: z.string().optional(),
  description: z.string().default(""),
});

const StdioServerSchema = McpServerBaseSchema.extend({
  transport: z.literal("stdio"),
  command: z.string().min(1, "stdio transport requires a command"),
  args: z.array(z.string()).default([]),
  envVars: z.record(z.string()).default({}),
});

const SseServerSchema = McpServerBaseSchema.extend({
  transport: z.literal("sse"),
  url: z.string().url("sse transport requires a valid url"),
  headers: z.record(z.string()).default({}),
});

const StreamableHttpServerSchema = McpServerBaseSchema.extend({
  transport: z.literal("streamable-http"),
  url: z.string().url("streamable-http transport requires a valid url"),
  headers: z.record(z.string()).default({}),
});

const McpServerConfigSchema = z.discriminatedUnion("transport", [
  StdioServerSchema,
  SseServerSchema,
  StreamableHttpServerSchema,
]);

// --- Exported types ---

export type StdioServerConfig = z.infer<typeof StdioServerSchema> & {
  name: string;
};
export type SseServerConfig = z.infer<typeof SseServerSchema> & {
  name: string;
};
export type StreamableHttpServerConfig = z.infer<
  typeof StreamableHttpServerSchema
> & { name: string };

export type McpServerConfig =
  | StdioServerConfig
  | SseServerConfig
  | StreamableHttpServerConfig;

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

/**
 * Backward compat: inject `transport: "stdio"` into objects that have
 * `command` but no `transport` field.
 */
function preprocessMcpServers(
  servers: unknown[]
): unknown[] {
  return servers.map((s) => {
    if (
      typeof s === "object" &&
      s !== null &&
      "command" in s &&
      !("transport" in s)
    ) {
      return { ...s, transport: "stdio" };
    }
    return s;
  });
}

export const GatewayConfigFileSchema = z.object({
  mcpServers: z
    .array(z.unknown())
    .default([])
    .transform((servers) => preprocessMcpServers(servers))
    .pipe(z.array(McpServerConfigSchema)),
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

  // Build McpServerConfig[] and resolve envVars / headers
  const mcpServers: McpServerConfig[] = [];
  const mcpEnvVars = new Map<string, Record<string, string>>();

  for (const server of configFile.mcpServers) {
    const config: McpServerConfig = {
      ...server,
      name: server.name ?? server.id,
    } as McpServerConfig;

    const resolvedEnv: Record<string, string> = {};

    if (config.transport === "stdio") {
      // Resolve envVars mapping: { hostVar: serverVar }
      for (const [hostVar, serverVar] of Object.entries(config.envVars)) {
        const value = env[hostVar];
        if (!value) {
          throw new Error(
            `MCP server "${config.id}" requires environment variable ${hostVar}`
          );
        }
        resolvedEnv[serverVar as string] = value;
      }
    } else {
      // SSE / streamable-http: resolve headers mapping { headerName: envVarName }
      for (const [headerName, envVarName] of Object.entries(config.headers)) {
        const value = env[envVarName];
        if (!value) {
          throw new Error(
            `MCP server "${config.id}" requires environment variable ${envVarName} for header "${headerName}"`
          );
        }
        resolvedEnv[headerName] = value;
      }
    }

    mcpServers.push(config);
    mcpEnvVars.set(config.id, resolvedEnv);
  }

  return { ...base, mcpServers, mcpEnvVars, skillsDir: configFile.skillsDir };
}
