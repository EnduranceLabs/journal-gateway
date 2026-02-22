import { z } from "zod";

export interface SkillDefinition {
  id: string;
  type: "mcp_server";
  name: string;
  description: string;
  command: string;
  args: string[];
  envVars: Record<string, string>;
}

export const BUILT_IN_SKILLS: Record<string, SkillDefinition> = {
  postgresql: {
    id: "postgresql",
    type: "mcp_server",
    name: "PostgreSQL",
    description: "Query and inspect PostgreSQL databases",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    envVars: { DATABASE_URL: "DATABASE_URL" },
  },
  railway: {
    id: "railway",
    type: "mcp_server",
    name: "Railway",
    description: "Manage Railway deployments and services",
    command: "npx",
    args: ["-y", "@railway/mcp-server"],
    envVars: { RAILWAY_TOKEN: "RAILWAY_API_TOKEN" },
  },
  sentry: {
    id: "sentry",
    type: "mcp_server",
    name: "Sentry",
    description: "Query Sentry errors and performance data",
    command: "npx",
    args: ["-y", "@sentry/mcp-server"],
    envVars: { SENTRY_AUTH_TOKEN: "SENTRY_AUTH_TOKEN" },
  },
  langfuse: {
    id: "langfuse",
    type: "mcp_server",
    name: "Langfuse",
    description: "Access Langfuse observability data",
    command: "npx",
    args: ["-y", "mcp-langfuse"],
    envVars: {
      LANGFUSE_PUBLIC_KEY: "LANGFUSE_PUBLIC_KEY",
      LANGFUSE_SECRET_KEY: "LANGFUSE_SECRET_KEY",
    },
  },
  clickhouse: {
    id: "clickhouse",
    type: "mcp_server",
    name: "ClickHouse",
    description: "Query ClickHouse analytics databases",
    command: "npx",
    args: ["-y", "@journal/mcp-clickhouse"],
    envVars: {
      CLICKHOUSE_URL: "CLICKHOUSE_URL",
      CLICKHOUSE_USERNAME: "CLICKHOUSE_USERNAME",
      CLICKHOUSE_PASSWORD: "CLICKHOUSE_PASSWORD",
    },
  },
};

const GatewayConfigSchema = z.object({
  token: z.string().min(1, "JOURNAL_GATEWAY_TOKEN is required"),
  url: z.string().url(),
  skills: z.array(z.string()).min(1, "At least one skill must be specified"),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema> & {
  skillDefinitions: SkillDefinition[];
  skillEnvVars: Map<string, Record<string, string>>;
};

export function parseConfig(
  env: Record<string, string | undefined> = process.env
): GatewayConfig {
  const token = env.JOURNAL_GATEWAY_TOKEN ?? "";
  const url = env.JOURNAL_GATEWAY_URL ?? "wss://gateway.journal.one/v1";
  const skillsRaw = env.SKILLS ?? "";
  const logLevel = (env.LOG_LEVEL ?? "info") as
    | "debug"
    | "info"
    | "warn"
    | "error";

  const skills = skillsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const base = GatewayConfigSchema.parse({ token, url, skills, logLevel });

  const skillDefinitions: SkillDefinition[] = [];
  const skillEnvVars = new Map<string, Record<string, string>>();

  for (const skillId of base.skills) {
    const definition = BUILT_IN_SKILLS[skillId];
    if (!definition) {
      throw new Error(
        `Unknown skill "${skillId}". Available skills: ${Object.keys(BUILT_IN_SKILLS).join(", ")}`
      );
    }

    const resolvedEnv: Record<string, string> = {};
    for (const [ourKey, childKey] of Object.entries(definition.envVars)) {
      const value = env[ourKey];
      if (!value) {
        throw new Error(
          `Skill "${skillId}" requires environment variable ${ourKey}`
        );
      }
      resolvedEnv[childKey] = value;
    }

    skillDefinitions.push(definition);
    skillEnvVars.set(skillId, resolvedEnv);
  }

  return { ...base, skillDefinitions, skillEnvVars };
}
