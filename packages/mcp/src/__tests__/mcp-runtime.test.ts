import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpRuntime } from "../mcp-runtime.js";
import { IntegrationNotFoundError } from "@journal/gateway";
import type { McpConfig, McpServerConfig } from "../config.js";

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

const testIntegration: McpServerConfig = {
  id: "test-db",
  type: "mcp_server",
  name: "Test DB",
  description: "A test database integration",
  command: "npx",
  args: ["-y", "@test/mcp-db"],
  envVars: { DATABASE_URL: "DATABASE_URL" },
};

function makeConfig(integrations: McpServerConfig[] = [testIntegration]): McpConfig {
  return {
    token: "gw_test",
    url: "wss://localhost/v1",
    integrations: integrations.map((i) => i.id),
    logLevel: "error",
    mcpServers: integrations,
    mcpEnvVars: new Map(
      integrations.map((i) => [i.id, { DATABASE_URL: "postgresql://localhost/test" }])
    ),
    skillsDir: null,
  };
}

describe("McpRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts all configured integrations", async () => {
    const runtime = new McpRuntime(makeConfig());
    await runtime.start();
    const registrations = await runtime.getRegistrations();
    expect(registrations).toHaveLength(1);
    expect(registrations[0].id).toBe("test-db");
  });

  it("generates registration payload with tools", async () => {
    const runtime = new McpRuntime(makeConfig());
    await runtime.start();
    const registrations = await runtime.getRegistrations();
    expect(registrations[0].tools).toHaveLength(1);
    expect(registrations[0].tools[0].name).toBe("query");
  });

  it("routes tool call to correct integration", async () => {
    const runtime = new McpRuntime(makeConfig());
    await runtime.start();
    const result = await runtime.callTool("test-db", "query", {
      sql: "SELECT 1",
    });
    expect(result.content[0]).toEqual({ type: "text", text: "result" });
  });

  it("throws IntegrationNotFoundError for unknown integration", async () => {
    const runtime = new McpRuntime(makeConfig());
    await runtime.start();
    await expect(
      runtime.callTool("unknown", "query", {})
    ).rejects.toThrow(IntegrationNotFoundError);
  });

  it("stops all processes", async () => {
    const runtime = new McpRuntime(makeConfig());
    await runtime.start();
    await runtime.stop();
  });

  it("starts with no integrations", async () => {
    const runtime = new McpRuntime(makeConfig([]));
    await runtime.start();
    const registrations = await runtime.getRegistrations();
    expect(registrations).toHaveLength(0);
  });
});
