import { describe, it, expect, vi } from "vitest";
import { parseConfig } from "../config.js";

function makeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    JOURNAL_GATEWAY_TOKEN: "gw_test123",
    JOURNAL_GATEWAY_URL: "wss://gateway.journal.one/v1",
    LOG_LEVEL: "info",
    SKILLS_DIR: "/path/to/skills",
    ...overrides,
  };
}

describe("parseConfig", () => {
  it("parses valid config with skills only", () => {
    const config = parseConfig(makeEnv());
    expect(config.token).toBe("gw_test123");
    expect(config.url).toBe("wss://gateway.journal.one/v1");
    expect(config.logLevel).toBe("info");
    expect(config.skillsDir).toBe("/path/to/skills");
    expect(config.mcpServers).toHaveLength(0);
  });

  it("uses default URL when not specified", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).JOURNAL_GATEWAY_URL;
    const config = parseConfig(env);
    expect(config.url).toBe("wss://gateway.journal.one/v1");
  });

  it("uses default log level when not specified", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).LOG_LEVEL;
    const config = parseConfig(env);
    expect(config.logLevel).toBe("info");
  });

  it("throws on missing JOURNAL_GATEWAY_TOKEN", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).JOURNAL_GATEWAY_TOKEN;
    expect(() => parseConfig(env)).toThrow();
  });

  it("warns when neither MCP_SERVERS nor SKILLS_DIR is set", () => {
    const env = makeEnv();
    delete (env as Record<string, string | undefined>).SKILLS_DIR;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = parseConfig(env);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("neither MCP_SERVERS nor SKILLS_DIR is set")
    );
    expect(config.mcpServers).toEqual([]);
    expect(config.skillsDir).toBeNull();
    spy.mockRestore();
  });

  it("parses MCP_SERVERS JSON config", () => {
    const servers = [
      {
        id: "test-db",
        command: "npx",
        args: ["-y", "@test/mcp-db"],
        name: "Test DB",
        description: "A test database",
        envVars: { DATABASE_URL: "DATABASE_URL" },
      },
    ];
    const config = parseConfig(
      makeEnv({
        MCP_SERVERS: JSON.stringify(servers),
        DATABASE_URL: "postgresql://localhost:5432/test",
      })
    );
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].id).toBe("test-db");
    expect(config.mcpServers[0].command).toBe("npx");
  });

  it("resolves per-server env vars", () => {
    const servers = [
      {
        id: "test-db",
        command: "npx",
        args: [],
        envVars: { DATABASE_URL: "DATABASE_URL" },
      },
    ];
    const config = parseConfig(
      makeEnv({
        MCP_SERVERS: JSON.stringify(servers),
        DATABASE_URL: "postgresql://localhost:5432/test",
      })
    );
    const dbEnv = config.mcpEnvVars.get("test-db");
    expect(dbEnv).toEqual({ DATABASE_URL: "postgresql://localhost:5432/test" });
  });

  it("throws on missing required env for MCP server", () => {
    const servers = [
      {
        id: "test-db",
        command: "npx",
        args: [],
        envVars: { DATABASE_URL: "DATABASE_URL" },
      },
    ];
    expect(() =>
      parseConfig(makeEnv({ MCP_SERVERS: JSON.stringify(servers) }))
    ).toThrow('MCP server "test-db" requires environment variable DATABASE_URL');
  });

  it("throws on invalid MCP_SERVERS JSON", () => {
    expect(() =>
      parseConfig(makeEnv({ MCP_SERVERS: "not json" }))
    ).toThrow("MCP_SERVERS must be valid JSON");
  });

  it("throws on non-array MCP_SERVERS", () => {
    expect(() =>
      parseConfig(makeEnv({ MCP_SERVERS: '{"id": "test"}' }))
    ).toThrow("MCP_SERVERS must be a JSON array");
  });

  it("throws when MCP server missing id or command", () => {
    expect(() =>
      parseConfig(makeEnv({ MCP_SERVERS: '[{"name": "test"}]' }))
    ).toThrow("Each MCP server must have an id and command");
  });

  it("sets skillsDir to null when SKILLS_DIR is not set", () => {
    const servers = [{ id: "test", command: "echo", args: [] }];
    const env = makeEnv({ MCP_SERVERS: JSON.stringify(servers) });
    delete (env as Record<string, string | undefined>).SKILLS_DIR;
    const config = parseConfig(env);
    expect(config.skillsDir).toBeNull();
  });

  it("includes skillsDir when SKILLS_DIR is set", () => {
    const config = parseConfig(makeEnv({ SKILLS_DIR: "/opt/skills" }));
    expect(config.skillsDir).toBe("/opt/skills");
  });

  it("allows MCP_SERVERS with no envVars", () => {
    const servers = [{ id: "simple", command: "echo", args: ["hello"] }];
    const config = parseConfig(
      makeEnv({ MCP_SERVERS: JSON.stringify(servers) })
    );
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].envVars).toEqual({});
  });
});
