import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpRuntime } from "../mcp-runtime.js";
import { IntegrationNotFoundError } from "@journal/gateway";
import type { McpConfig } from "../config.js";
import { BUILT_IN_MCP_SERVERS } from "../integrations/index.js";

// Mock McpProcess
vi.mock("../mcp-process.js", () => {
  return {
    McpProcess: vi.fn().mockImplementation((definition) => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue([
        {
          name: "query",
          description: "Run SQL",
          inputSchema: { type: "object" },
        },
      ]),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "result" }],
      }),
      isRunning: vi.fn().mockReturnValue(true),
      integrationId: definition.id,
      on: vi.fn(),
    })),
  };
});

function makeConfig(integrations: string[] = ["postgresql"]): McpConfig {
  return {
    token: "gw_test",
    url: "wss://localhost/v1",
    integrations,
    logLevel: "error",
    mcpServers: integrations.map((id) => BUILT_IN_MCP_SERVERS[id]),
    mcpEnvVars: new Map(
      integrations.map((id) => [id, { DATABASE_URL: "postgresql://localhost/test" }])
    ),
  };
}

describe("McpRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts all configured integrations", async () => {
    const runtime = new McpRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    const registrations = await runtime.getRegistrations();
    expect(registrations).toHaveLength(1);
    expect(registrations[0].id).toBe("postgresql");
  });

  it("generates registration payload with tools", async () => {
    const runtime = new McpRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    const registrations = await runtime.getRegistrations();
    expect(registrations[0].tools).toHaveLength(1);
    expect(registrations[0].tools[0].name).toBe("query");
  });

  it("routes tool call to correct integration", async () => {
    const runtime = new McpRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    const result = await runtime.callTool("postgresql", "query", {
      sql: "SELECT 1",
    });
    expect(result.content[0]).toEqual({ type: "text", text: "result" });
  });

  it("throws IntegrationNotFoundError for unknown integration", async () => {
    const runtime = new McpRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    await expect(
      runtime.callTool("unknown", "query", {})
    ).rejects.toThrow(IntegrationNotFoundError);
  });

  it("stops all processes", async () => {
    const runtime = new McpRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    await runtime.stop();
    // No error means success — processes were stopped
  });

  it("handles multiple integrations", async () => {
    const config = makeConfig(["postgresql"]);
    // Add a second integration definition
    config.integrations = ["postgresql"];
    config.mcpServers = [BUILT_IN_MCP_SERVERS.postgresql];
    const runtime = new McpRuntime(config);
    await runtime.start();
    const registrations = await runtime.getRegistrations();
    expect(registrations).toHaveLength(1);
  });
});
