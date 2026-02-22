import { describe, it, expect } from "vitest";
import { parseConfig } from "../config.js";
import type { McpServerConfig } from "../config.js";
import { BUILT_IN_MCP_SERVERS } from "../mcp-servers/index.js";

function makeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    JOURNAL_GATEWAY_TOKEN: "gw_test123",
    JOURNAL_GATEWAY_URL: "wss://gateway.journal.one/v1",
    INTEGRATIONS: "postgresql",
    DATABASE_URL: "postgresql://localhost:5432/test",
    LOG_LEVEL: "info",
    ...overrides,
  };
}

describe("parseConfig", () => {
  it("parses valid config with postgresql integration", () => {
    const config = parseConfig(BUILT_IN_MCP_SERVERS, makeEnv());
    expect(config.token).toBe("gw_test123");
    expect(config.url).toBe("wss://gateway.journal.one/v1");
    expect(config.integrations).toEqual(["postgresql"]);
    expect(config.logLevel).toBe("info");
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].id).toBe("postgresql");
  });

  it("uses default URL when not specified", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).JOURNAL_GATEWAY_URL;
    const config = parseConfig(BUILT_IN_MCP_SERVERS, env);
    expect(config.url).toBe("wss://gateway.journal.one/v1");
  });

  it("uses default log level when not specified", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).LOG_LEVEL;
    const config = parseConfig(BUILT_IN_MCP_SERVERS, env);
    expect(config.logLevel).toBe("info");
  });

  it("parses multiple integrations", () => {
    const config = parseConfig(
      BUILT_IN_MCP_SERVERS,
      makeEnv({
        INTEGRATIONS: "postgresql,sentry",
        SENTRY_AUTH_TOKEN: "sentry_abc",
      })
    );
    expect(config.integrations).toEqual(["postgresql", "sentry"]);
    expect(config.mcpServers).toHaveLength(2);
  });

  it("trims whitespace in integration list", () => {
    const config = parseConfig(
      BUILT_IN_MCP_SERVERS,
      makeEnv({
        INTEGRATIONS: " postgresql , sentry ",
        SENTRY_AUTH_TOKEN: "sentry_abc",
      })
    );
    expect(config.integrations).toEqual(["postgresql", "sentry"]);
  });

  it("resolves per-integration env vars", () => {
    const config = parseConfig(BUILT_IN_MCP_SERVERS, makeEnv());
    const pgEnv = config.mcpEnvVars.get("postgresql");
    expect(pgEnv).toEqual({ DATABASE_URL: "postgresql://localhost:5432/test" });
  });

  it("resolves langfuse env vars", () => {
    const config = parseConfig(
      BUILT_IN_MCP_SERVERS,
      makeEnv({
        INTEGRATIONS: "langfuse",
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
      })
    );
    const env = config.mcpEnvVars.get("langfuse");
    expect(env).toEqual({
      LANGFUSE_PUBLIC_KEY: "pk_test",
      LANGFUSE_SECRET_KEY: "sk_test",
    });
  });

  it("throws on missing JOURNAL_GATEWAY_TOKEN", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).JOURNAL_GATEWAY_TOKEN;
    expect(() => parseConfig(BUILT_IN_MCP_SERVERS, env)).toThrow();
  });

  it("throws on missing INTEGRATIONS", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).INTEGRATIONS;
    expect(() => parseConfig(BUILT_IN_MCP_SERVERS, env)).toThrow();
  });

  it("throws on unknown integration ID", () => {
    expect(() =>
      parseConfig(BUILT_IN_MCP_SERVERS, makeEnv({ INTEGRATIONS: "nonexistent_integration" }))
    ).toThrow('Unknown integration "nonexistent_integration"');
  });

  it("throws on missing required env for integration", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).DATABASE_URL;
    expect(() => parseConfig(BUILT_IN_MCP_SERVERS, env)).toThrow(
      'Integration "postgresql" requires environment variable DATABASE_URL'
    );
  });

  it("throws when langfuse is missing a required key", () => {
    expect(() =>
      parseConfig(
        BUILT_IN_MCP_SERVERS,
        makeEnv({
          INTEGRATIONS: "langfuse",
          LANGFUSE_PUBLIC_KEY: "pk_test",
          // missing LANGFUSE_SECRET_KEY
        })
      )
    ).toThrow("LANGFUSE_SECRET_KEY");
  });

  it("works with a custom catalog", () => {
    const customCatalog: Record<string, McpServerConfig> = {
      custom: {
        id: "custom",
        type: "mcp_server",
        name: "Custom",
        description: "A custom integration",
        command: "npx",
        args: ["-y", "custom-mcp"],
        envVars: { CUSTOM_KEY: "CUSTOM_KEY" },
      },
    };
    const config = parseConfig(
      customCatalog,
      makeEnv({ INTEGRATIONS: "custom", CUSTOM_KEY: "val123" })
    );
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].id).toBe("custom");
    expect(config.mcpEnvVars.get("custom")).toEqual({ CUSTOM_KEY: "val123" });
  });

  it("rejects integrations not in custom catalog", () => {
    const emptyCatalog: Record<string, McpServerConfig> = {};
    expect(() =>
      parseConfig(emptyCatalog, makeEnv({ INTEGRATIONS: "postgresql" }))
    ).toThrow('Unknown integration "postgresql"');
  });
});
