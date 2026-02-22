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
  catalog: Record<string, SkillDefinition>,
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
    const definition = catalog[skillId];
    if (!definition) {
      throw new Error(
        `Unknown skill "${skillId}". Available skills: ${Object.keys(catalog).join(", ")}`
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
