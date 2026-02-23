import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseConfig, GatewayConfigFileSchema } from "../config.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";

const mockReadFileSync = vi.mocked(readFileSync);

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    JOURNAL_GATEWAY_TOKEN: "gw_test123",
    ...overrides,
  };
}

beforeEach(() => {
  mockReadFileSync.mockReset();
});

describe("parseConfig", () => {
  // --- Operational env vars ---

  it("requires JOURNAL_GATEWAY_TOKEN", () => {
    expect(() => parseConfig({}, [])).toThrow();
  });

  it("uses default URL when not specified", () => {
    const config = parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: "{}" }), []);
    expect(config.url).toBe("wss://gateway.journal.one/v1");
  });

  it("uses default log level when not specified", () => {
    const config = parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: "{}" }), []);
    expect(config.logLevel).toBe("info");
  });

  it("respects custom URL and log level", () => {
    const config = parseConfig(
      baseEnv({
        JOURNAL_GATEWAY_URL: "wss://custom.example.com/v1",
        LOG_LEVEL: "debug",
        JOURNAL_GATEWAY_CONFIG: "{}",
      }),
      []
    );
    expect(config.url).toBe("wss://custom.example.com/v1");
    expect(config.logLevel).toBe("debug");
  });

  // --- Config file loading ---

  it("loads config from --config file path", () => {
    const configJson = JSON.stringify({
      mcpServers: [{ id: "pg", command: "npx", args: ["-y", "pg-server"] }],
      skillsDir: "/opt/skills",
    });
    mockReadFileSync.mockReturnValue(configJson);

    const config = parseConfig(baseEnv(), ["node", "main.js", "--config", "/tmp/gw.json"]);
    expect(mockReadFileSync).toHaveBeenCalledWith("/tmp/gw.json", "utf-8");
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].id).toBe("pg");
    expect(config.skillsDir).toBe("/opt/skills");
  });

  it("loads config from JOURNAL_GATEWAY_CONFIG file path", () => {
    const configJson = JSON.stringify({ skillsDir: "/opt/skills" });
    mockReadFileSync.mockReturnValue(configJson);

    const config = parseConfig(
      baseEnv({ JOURNAL_GATEWAY_CONFIG: "/etc/gateway.json" }),
      []
    );
    expect(mockReadFileSync).toHaveBeenCalledWith("/etc/gateway.json", "utf-8");
    expect(config.skillsDir).toBe("/opt/skills");
  });

  it("parses inline JSON from JOURNAL_GATEWAY_CONFIG", () => {
    const inline = JSON.stringify({
      mcpServers: [{ id: "test", command: "echo" }],
    });
    const config = parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: inline }), []);
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].id).toBe("test");
    // readFileSync should NOT be called for inline JSON
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("--config takes precedence over JOURNAL_GATEWAY_CONFIG env var", () => {
    const fileConfig = JSON.stringify({ skillsDir: "/from-file" });
    mockReadFileSync.mockReturnValue(fileConfig);

    const config = parseConfig(
      baseEnv({ JOURNAL_GATEWAY_CONFIG: '{"skillsDir": "/from-env"}' }),
      ["node", "main.js", "--config", "/tmp/gw.json"]
    );
    expect(config.skillsDir).toBe("/from-file");
  });

  // --- Schema validation ---

  it("rejects server missing id", () => {
    const inline = JSON.stringify({
      mcpServers: [{ command: "echo" }],
    });
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: inline }), [])
    ).toThrow();
  });

  it("rejects server missing command", () => {
    const inline = JSON.stringify({
      mcpServers: [{ id: "test" }],
    });
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: inline }), [])
    ).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const inline = JSON.stringify({
      mcpServers: [{ id: "minimal", command: "echo" }],
    });
    const config = parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: inline }), []);
    const server = config.mcpServers[0];
    expect(server.name).toBe("minimal"); // defaults to id
    expect(server.description).toBe("");
    expect(server.args).toEqual([]);
    expect(server.envVars).toEqual({});
  });

  it("accepts empty {} as valid config", () => {
    const config = parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: "{}" }), []);
    expect(config.mcpServers).toEqual([]);
    expect(config.skillsDir).toBeNull();
  });

  // --- Env var resolution ---

  it("resolves envVars mapping from real environment", () => {
    const inline = JSON.stringify({
      mcpServers: [
        { id: "db", command: "npx", envVars: { DATABASE_URL: "DATABASE_URL" } },
      ],
    });
    const config = parseConfig(
      baseEnv({
        JOURNAL_GATEWAY_CONFIG: inline,
        DATABASE_URL: "postgresql://localhost:5432/test",
      }),
      []
    );
    const dbEnv = config.mcpEnvVars.get("db");
    expect(dbEnv).toEqual({ DATABASE_URL: "postgresql://localhost:5432/test" });
  });

  it("throws when a required env var is missing", () => {
    const inline = JSON.stringify({
      mcpServers: [
        { id: "db", command: "npx", envVars: { DATABASE_URL: "DATABASE_URL" } },
      ],
    });
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: inline }), [])
    ).toThrow('MCP server "db" requires environment variable DATABASE_URL');
  });

  // --- Edge cases ---

  it("throws when config file does not exist", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() =>
      parseConfig(baseEnv(), ["node", "main.js", "--config", "/nonexistent.json"])
    ).toThrow("Cannot read config file: /nonexistent.json");
  });

  it("throws when config file contains invalid JSON", () => {
    mockReadFileSync.mockReturnValue("not json {{{");
    expect(() =>
      parseConfig(baseEnv(), ["node", "main.js", "--config", "/bad.json"])
    ).toThrow("Config file is not valid JSON: /bad.json");
  });

  it("throws when JOURNAL_GATEWAY_CONFIG env is invalid JSON", () => {
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: "{bad json" }), [])
    ).toThrow("JOURNAL_GATEWAY_CONFIG is not valid JSON");
  });

  it("warns when no servers or skills are configured", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: "{}" }), []);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("no mcpServers or skillsDir configured")
    );
    spy.mockRestore();
  });

  it("does not warn when servers or skills are configured", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const inline = JSON.stringify({ skillsDir: "/opt/skills" });
    parseConfig(baseEnv({ JOURNAL_GATEWAY_CONFIG: inline }), []);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("GatewayConfigFileSchema", () => {
  it("validates a full config", () => {
    const result = GatewayConfigFileSchema.parse({
      mcpServers: [
        {
          id: "pg",
          command: "npx",
          args: ["-y", "pg-server"],
          name: "PostgreSQL",
          description: "Query databases",
          envVars: { DATABASE_URL: "DATABASE_URL" },
        },
      ],
      skillsDir: "/opt/skills",
    });
    expect(result.mcpServers).toHaveLength(1);
    expect(result.skillsDir).toBe("/opt/skills");
  });

  it("applies defaults for empty object", () => {
    const result = GatewayConfigFileSchema.parse({});
    expect(result.mcpServers).toEqual([]);
    expect(result.skillsDir).toBeNull();
  });
});
