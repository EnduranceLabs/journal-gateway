import { z } from "zod";
import { readFileSync } from "node:fs";
import type { GatewayConfig } from "journal-gateway-protocol";

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

const WS_SCHEMES = new Set(["ws:", "wss:", "http:", "https:"]);

const OperationalSchema = z.object({
  token: z.string().min(1, "JOURNAL_GATEWAY_TOKEN is required"),
  url: z
    .string()
    .url()
    .refine(
      (u) => {
        try {
          return WS_SCHEMES.has(new URL(u).protocol);
        } catch {
          return false;
        }
      },
      { message: "URL must use ws://, wss://, http://, or https:// scheme" }
    ),
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

/**
 * Read and parse a config file from disk. Throws on read or JSON parse errors.
 */
export function readConfigFile(path: string): GatewayConfigFile {
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

/**
 * Resolve a GatewayConfigFile against environment variables.
 * Returns McpServerConfig[] with name defaults applied, and a Map of resolved env vars per server.
 */
export function resolveConfigFile(
  configFile: GatewayConfigFile,
  env: Record<string, string | undefined>
): { mcpServers: McpServerConfig[]; mcpEnvVars: Map<string, Record<string, string>> } {
  const mcpServers: McpServerConfig[] = [];
  const mcpEnvVars = new Map<string, Record<string, string>>();

  for (const server of configFile.mcpServers) {
    const config: McpServerConfig = {
      ...server,
      name: server.name ?? server.id,
    } as McpServerConfig;

    const resolvedEnv: Record<string, string> = {};

    if (config.transport === "stdio") {
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

  return { mcpServers, mcpEnvVars };
}

/**
 * Resolve the config file path from CLI args and env vars.
 * Returns null for inline JSON or when no config is specified.
 */
export function resolveConfigFilePath(
  env: Record<string, string | undefined>,
  argv: string[]
): string | null {
  const cliConfigPath = parseCliConfigArg(argv);
  if (cliConfigPath) return cliConfigPath;

  const envConfig = env.JOURNAL_GATEWAY_CONFIG ?? null;
  if (envConfig && !envConfig.trimStart().startsWith("{")) {
    return envConfig;
  }

  return null;
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

  const { mcpServers, mcpEnvVars } = resolveConfigFile(configFile, env);

  return { ...base, mcpServers, mcpEnvVars, skillsDir: configFile.skillsDir };
}
