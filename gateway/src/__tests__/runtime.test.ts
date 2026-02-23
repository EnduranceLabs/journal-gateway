import { describe, it, expect, vi, beforeEach } from "vitest";
import { Runtime } from "../runtime.js";
import { IntegrationNotFoundError } from "@journal/gateway-protocol";
import type { RuntimeConfig, McpServerConfig } from "../config.js";

// Mock McpClient
vi.mock("../mcp-client.js", () => {
  return {
    McpClient: vi.fn().mockImplementation((definition) => ({
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

// Mock SkillClient
vi.mock("../skill-client.js", () => {
  return {
    SkillClient: vi.fn().mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      getIntegrations: vi.fn().mockReturnValue([]),
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

function makeConfig(integrations: McpServerConfig[] = [testIntegration]): RuntimeConfig {
  return {
    token: "gw_test",
    url: "wss://localhost/v1",
    logLevel: "error",
    mcpServers: integrations,
    mcpEnvVars: new Map(
      integrations.map((i) => [i.id, { DATABASE_URL: "postgresql://localhost/test" }])
    ),
    skillsDir: null,
  };
}

describe("Runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts all configured integrations", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    const registrations = await runtime.getRegistrations();
    expect(registrations).toHaveLength(1);
    expect(registrations[0].id).toBe("test-db");
  });

  it("generates registration payload with tools", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    const registrations = await runtime.getRegistrations();
    expect(registrations[0].tools).toHaveLength(1);
    expect(registrations[0].tools[0].name).toBe("query");
  });

  it("routes tool call to correct integration", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    const result = await runtime.callTool("test-db", "query", {
      sql: "SELECT 1",
    });
    expect(result.content[0]).toEqual({ type: "text", text: "result" });
  });

  it("throws IntegrationNotFoundError for unknown integration", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    await expect(
      runtime.callTool("unknown", "query", {})
    ).rejects.toThrow(IntegrationNotFoundError);
  });

  it("stops all processes", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    await runtime.stop();
  });

  it("starts with no integrations", async () => {
    const runtime = new Runtime(makeConfig([]));
    await runtime.start();
    const registrations = await runtime.getRegistrations();
    expect(registrations).toHaveLength(0);
  });
});
