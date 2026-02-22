import { describe, it, expect } from "vitest";
import { parseConfig } from "../config.js";
import type { McpServerConfig } from "../config.js";
import { BUILT_IN_MCP_SERVERS } from "../integrations/index.js";

const testCatalog: Record<string, McpServerConfig> = {
  "test-db": {
    id: "test-db",
    type: "mcp_server",
    name: "Test DB",
    description: "A test database integration",
    command: "npx",
    args: ["-y", "@test/mcp-db"],
    envVars: { DATABASE_URL: "DATABASE_URL" },
  },
  "test-obs": {
    id: "test-obs",
    type: "mcp_server",
    name: "Test Observability",
    description: "A test observability integration",
    command: "npx",
    args: ["-y", "@test/mcp-obs"],
    envVars: {
      OBS_PUBLIC_KEY: "OBS_PUBLIC_KEY",
      OBS_SECRET_KEY: "OBS_SECRET_KEY",
    },
  },
};

function makeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    JOURNAL_GATEWAY_TOKEN: "gw_test123",
    JOURNAL_GATEWAY_URL: "wss://gateway.journal.one/v1",
    INTEGRATIONS: "test-db",
    DATABASE_URL: "postgresql://localhost:5432/test",
    LOG_LEVEL: "info",
    ...overrides,
  };
}

describe("parseConfig", () => {
  it("parses valid config with a single integration", () => {
    const config = parseConfig(testCatalog, makeEnv());
    expect(config.token).toBe("gw_test123");
    expect(config.url).toBe("wss://gateway.journal.one/v1");
    expect(config.integrations).toEqual(["test-db"]);
    expect(config.logLevel).toBe("info");
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].id).toBe("test-db");
  });

  it("uses default URL when not specified", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).JOURNAL_GATEWAY_URL;
    const config = parseConfig(testCatalog, env);
    expect(config.url).toBe("wss://gateway.journal.one/v1");
  });

  it("uses default log level when not specified", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).LOG_LEVEL;
    const config = parseConfig(testCatalog, env);
    expect(config.logLevel).toBe("info");
  });

  it("parses multiple integrations", () => {
    const config = parseConfig(
      testCatalog,
      makeEnv({
        INTEGRATIONS: "test-db,test-obs",
        OBS_PUBLIC_KEY: "pk_test",
        OBS_SECRET_KEY: "sk_test",
      })
    );
    expect(config.integrations).toEqual(["test-db", "test-obs"]);
    expect(config.mcpServers).toHaveLength(2);
  });

  it("trims whitespace in integration list", () => {
    const config = parseConfig(
      testCatalog,
      makeEnv({
        INTEGRATIONS: " test-db , test-obs ",
        OBS_PUBLIC_KEY: "pk_test",
        OBS_SECRET_KEY: "sk_test",
      })
    );
    expect(config.integrations).toEqual(["test-db", "test-obs"]);
  });

  it("resolves per-integration env vars", () => {
    const config = parseConfig(testCatalog, makeEnv());
    const dbEnv = config.mcpEnvVars.get("test-db");
    expect(dbEnv).toEqual({ DATABASE_URL: "postgresql://localhost:5432/test" });
  });

  it("resolves multi-key env vars", () => {
    const config = parseConfig(
      testCatalog,
      makeEnv({
        INTEGRATIONS: "test-obs",
        OBS_PUBLIC_KEY: "pk_test",
        OBS_SECRET_KEY: "sk_test",
      })
    );
    const env = config.mcpEnvVars.get("test-obs");
    expect(env).toEqual({
      OBS_PUBLIC_KEY: "pk_test",
      OBS_SECRET_KEY: "sk_test",
    });
  });

  it("throws on missing JOURNAL_GATEWAY_TOKEN", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).JOURNAL_GATEWAY_TOKEN;
    expect(() => parseConfig(testCatalog, env)).toThrow();
  });

  it("throws on missing INTEGRATIONS", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).INTEGRATIONS;
    expect(() => parseConfig(testCatalog, env)).toThrow();
  });

  it("throws on unknown integration ID", () => {
    expect(() =>
      parseConfig(testCatalog, makeEnv({ INTEGRATIONS: "nonexistent_integration" }))
    ).toThrow('Unknown integration "nonexistent_integration"');
  });

  it("throws on missing required env for integration", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).DATABASE_URL;
    expect(() => parseConfig(testCatalog, env)).toThrow(
      'Integration "test-db" requires environment variable DATABASE_URL'
    );
  });

  it("throws when integration is missing a required key", () => {
    expect(() =>
      parseConfig(
        testCatalog,
        makeEnv({
          INTEGRATIONS: "test-obs",
          OBS_PUBLIC_KEY: "pk_test",
          // missing OBS_SECRET_KEY
        })
      )
    ).toThrow("OBS_SECRET_KEY");
  });

  it("built-in catalog is empty", () => {
    expect(Object.keys(BUILT_IN_MCP_SERVERS)).toHaveLength(0);
  });

  it("rejects integrations not in catalog", () => {
    const emptyCatalog: Record<string, McpServerConfig> = {};
    expect(() =>
      parseConfig(emptyCatalog, makeEnv({ INTEGRATIONS: "anything" }))
    ).toThrow('Unknown integration "anything"');
  });
});
