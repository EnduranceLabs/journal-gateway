import { z } from "zod";
import type { GatewayConfig } from "./types/index.js";

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

const ConfigSchema = z.object({
  token: z.string().min(1, "JOURNAL_GATEWAY_TOKEN is required"),
  url: z.string().url(),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
});

export function parseConfig(
  env: Record<string, string | undefined> = process.env
): RuntimeConfig {
  const token = env.JOURNAL_GATEWAY_TOKEN ?? "";
  const url = env.JOURNAL_GATEWAY_URL ?? "wss://gateway.journal.one/v1";
  const skillsDir = env.SKILLS_DIR ?? null;
  const logLevel = (env.LOG_LEVEL ?? "info") as
    | "debug"
    | "info"
    | "warn"
    | "error";

  const mcpServersRaw = env.MCP_SERVERS ?? null;

  if (!mcpServersRaw && !skillsDir) {
    throw new Error("At least one MCP server (MCP_SERVERS) or a skills directory (SKILLS_DIR) must be specified");
  }

  const base = ConfigSchema.parse({ token, url, logLevel });

  const mcpServers: McpServerConfig[] = [];
  const mcpEnvVars = new Map<string, Record<string, string>>();

  if (mcpServersRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mcpServersRaw);
    } catch {
      throw new Error("MCP_SERVERS must be valid JSON");
    }

    if (!Array.isArray(parsed)) {
      throw new Error("MCP_SERVERS must be a JSON array");
    }

    for (const server of parsed) {
      if (!server.id || !server.command) {
        throw new Error("Each MCP server must have an id and command");
      }

      const config: McpServerConfig = {
        id: server.id,
        type: "mcp_server",
        name: server.name ?? server.id,
        description: server.description ?? "",
        command: server.command,
        args: server.args ?? [],
        envVars: server.envVars ?? {},
      };

      const resolvedEnv: Record<string, string> = {};
      for (const [ourKey, childKey] of Object.entries(config.envVars)) {
        const value = env[ourKey];
        if (!value) {
          throw new Error(
            `MCP server "${config.id}" requires environment variable ${ourKey}`
          );
        }
        resolvedEnv[childKey as string] = value;
      }

      mcpServers.push(config);
      mcpEnvVars.set(config.id, resolvedEnv);
    }
  }

  return { ...base, mcpServers, mcpEnvVars, skillsDir };
}
