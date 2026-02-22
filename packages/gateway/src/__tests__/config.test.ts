import { describe, it, expect } from "vitest";
import { parseConfig } from "../config.js";
import type { SkillDefinition } from "../config.js";
import { BUILT_IN_SKILLS } from "../skills/index.js";

function makeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    JOURNAL_GATEWAY_TOKEN: "gw_test123",
    JOURNAL_GATEWAY_URL: "wss://gateway.journal.one/v1",
    SKILLS: "postgresql",
    DATABASE_URL: "postgresql://localhost:5432/test",
    LOG_LEVEL: "info",
    ...overrides,
  };
}

describe("parseConfig", () => {
  it("parses valid config with postgresql skill", () => {
    const config = parseConfig(BUILT_IN_SKILLS, makeEnv());
    expect(config.token).toBe("gw_test123");
    expect(config.url).toBe("wss://gateway.journal.one/v1");
    expect(config.skills).toEqual(["postgresql"]);
    expect(config.logLevel).toBe("info");
    expect(config.skillDefinitions).toHaveLength(1);
    expect(config.skillDefinitions[0].id).toBe("postgresql");
  });

  it("uses default URL when not specified", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).JOURNAL_GATEWAY_URL;
    const config = parseConfig(BUILT_IN_SKILLS, env);
    expect(config.url).toBe("wss://gateway.journal.one/v1");
  });

  it("uses default log level when not specified", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).LOG_LEVEL;
    const config = parseConfig(BUILT_IN_SKILLS, env);
    expect(config.logLevel).toBe("info");
  });

  it("parses multiple skills", () => {
    const config = parseConfig(
      BUILT_IN_SKILLS,
      makeEnv({
        SKILLS: "postgresql,sentry",
        SENTRY_AUTH_TOKEN: "sentry_abc",
      })
    );
    expect(config.skills).toEqual(["postgresql", "sentry"]);
    expect(config.skillDefinitions).toHaveLength(2);
  });

  it("trims whitespace in skill list", () => {
    const config = parseConfig(
      BUILT_IN_SKILLS,
      makeEnv({
        SKILLS: " postgresql , sentry ",
        SENTRY_AUTH_TOKEN: "sentry_abc",
      })
    );
    expect(config.skills).toEqual(["postgresql", "sentry"]);
  });

  it("resolves per-skill env vars", () => {
    const config = parseConfig(BUILT_IN_SKILLS, makeEnv());
    const pgEnv = config.skillEnvVars.get("postgresql");
    expect(pgEnv).toEqual({ DATABASE_URL: "postgresql://localhost:5432/test" });
  });

  it("resolves langfuse env vars", () => {
    const config = parseConfig(
      BUILT_IN_SKILLS,
      makeEnv({
        SKILLS: "langfuse",
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
      })
    );
    const env = config.skillEnvVars.get("langfuse");
    expect(env).toEqual({
      LANGFUSE_PUBLIC_KEY: "pk_test",
      LANGFUSE_SECRET_KEY: "sk_test",
    });
  });

  it("throws on missing JOURNAL_GATEWAY_TOKEN", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).JOURNAL_GATEWAY_TOKEN;
    expect(() => parseConfig(BUILT_IN_SKILLS, env)).toThrow();
  });

  it("throws on missing SKILLS", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).SKILLS;
    expect(() => parseConfig(BUILT_IN_SKILLS, env)).toThrow();
  });

  it("throws on unknown skill ID", () => {
    expect(() =>
      parseConfig(BUILT_IN_SKILLS, makeEnv({ SKILLS: "nonexistent_skill" }))
    ).toThrow('Unknown skill "nonexistent_skill"');
  });

  it("throws on missing required env for skill", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).DATABASE_URL;
    expect(() => parseConfig(BUILT_IN_SKILLS, env)).toThrow(
      'Skill "postgresql" requires environment variable DATABASE_URL'
    );
  });

  it("throws when langfuse is missing a required key", () => {
    expect(() =>
      parseConfig(
        BUILT_IN_SKILLS,
        makeEnv({
          SKILLS: "langfuse",
          LANGFUSE_PUBLIC_KEY: "pk_test",
          // missing LANGFUSE_SECRET_KEY
        })
      )
    ).toThrow("LANGFUSE_SECRET_KEY");
  });

  it("works with a custom catalog", () => {
    const customCatalog: Record<string, SkillDefinition> = {
      custom: {
        id: "custom",
        type: "mcp_server",
        name: "Custom",
        description: "A custom skill",
        command: "npx",
        args: ["-y", "custom-mcp"],
        envVars: { CUSTOM_KEY: "CUSTOM_KEY" },
      },
    };
    const config = parseConfig(
      customCatalog,
      makeEnv({ SKILLS: "custom", CUSTOM_KEY: "val123" })
    );
    expect(config.skillDefinitions).toHaveLength(1);
    expect(config.skillDefinitions[0].id).toBe("custom");
    expect(config.skillEnvVars.get("custom")).toEqual({ CUSTOM_KEY: "val123" });
  });

  it("rejects skills not in custom catalog", () => {
    const emptyCatalog: Record<string, SkillDefinition> = {};
    expect(() =>
      parseConfig(emptyCatalog, makeEnv({ SKILLS: "postgresql" }))
    ).toThrow('Unknown skill "postgresql"');
  });
});
