import { z } from "zod";

export interface McpServerConfig {
  id: string;
  type: "mcp_server";
  name: string;
  description: string;
  command: string;
  args: string[];
  envVars: Record<string, string>;
}

const GatewayConfigSchema = z.object({
  token: z.string().min(1, "JOURNAL_GATEWAY_TOKEN is required"),
  url: z.string().url(),
  integrations: z.array(z.string()).min(1, "At least one integration must be specified"),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema> & {
  mcpServers: McpServerConfig[];
  mcpEnvVars: Map<string, Record<string, string>>;
};

export function parseConfig(
  catalog: Record<string, McpServerConfig>,
  env: Record<string, string | undefined> = process.env
): GatewayConfig {
  const token = env.JOURNAL_GATEWAY_TOKEN ?? "";
  const url = env.JOURNAL_GATEWAY_URL ?? "wss://gateway.journal.one/v1";
  const integrationsRaw = env.INTEGRATIONS ?? "";
  const logLevel = (env.LOG_LEVEL ?? "info") as
    | "debug"
    | "info"
    | "warn"
    | "error";

  const integrations = integrationsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const base = GatewayConfigSchema.parse({ token, url, integrations, logLevel });

  const mcpServers: McpServerConfig[] = [];
  const mcpEnvVars = new Map<string, Record<string, string>>();

  for (const integrationId of base.integrations) {
    const definition = catalog[integrationId];
    if (!definition) {
      throw new Error(
        `Unknown integration "${integrationId}". Available integrations: ${Object.keys(catalog).join(", ")}`
      );
    }

    const resolvedEnv: Record<string, string> = {};
    for (const [ourKey, childKey] of Object.entries(definition.envVars)) {
      const value = env[ourKey];
      if (!value) {
        throw new Error(
          `Integration "${integrationId}" requires environment variable ${ourKey}`
        );
      }
      resolvedEnv[childKey] = value;
    }

    mcpServers.push(definition);
    mcpEnvVars.set(integrationId, resolvedEnv);
  }

  return { ...base, mcpServers, mcpEnvVars };
}
