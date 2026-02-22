import { describe, it, expect } from "vitest";
import { BUILT_IN_MCP_SERVERS } from "../integrations/index.js";

describe("BUILT_IN_MCP_SERVERS catalog", () => {
  it("starts empty", () => {
    expect(Object.keys(BUILT_IN_MCP_SERVERS)).toHaveLength(0);
  });

  it("has ids matching their keys", () => {
    for (const [key, config] of Object.entries(BUILT_IN_MCP_SERVERS)) {
      expect(config.id).toBe(key);
    }
  });

  it("all integrations have type mcp_server", () => {
    for (const config of Object.values(BUILT_IN_MCP_SERVERS)) {
      expect(config.type).toBe("mcp_server");
    }
  });
});
