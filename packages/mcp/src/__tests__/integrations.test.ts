import { describe, it, expect } from "vitest";
import {
  BUILT_IN_MCP_SERVERS,
  postgresql,
  railway,
  sentry,
  langfuse,
  clickhouse,
} from "../integrations/index.js";

describe("BUILT_IN_MCP_SERVERS catalog", () => {
  it("has all expected built-in integrations", () => {
    const expectedIntegrations = [
      "postgresql",
      "railway",
      "sentry",
      "langfuse",
      "clickhouse",
    ];
    expect(Object.keys(BUILT_IN_MCP_SERVERS).sort()).toEqual(expectedIntegrations.sort());
  });

  it("has ids matching their keys", () => {
    for (const [key, config] of Object.entries(BUILT_IN_MCP_SERVERS)) {
      expect(config.id).toBe(key);
    }
  });

  it("individual exports match catalog entries", () => {
    expect(BUILT_IN_MCP_SERVERS.postgresql).toBe(postgresql);
    expect(BUILT_IN_MCP_SERVERS.railway).toBe(railway);
    expect(BUILT_IN_MCP_SERVERS.sentry).toBe(sentry);
    expect(BUILT_IN_MCP_SERVERS.langfuse).toBe(langfuse);
    expect(BUILT_IN_MCP_SERVERS.clickhouse).toBe(clickhouse);
  });

  it("all integrations have type mcp_server", () => {
    for (const config of Object.values(BUILT_IN_MCP_SERVERS)) {
      expect(config.type).toBe("mcp_server");
    }
  });
});
