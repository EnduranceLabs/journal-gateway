import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpClient } from "../mcp-client.js";
import { Logger } from "../common/logger.js";
import type { McpServerConfig } from "../config.js";

// Mock @modelcontextprotocol/sdk
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: "query",
            description: "Execute SQL",
            inputSchema: { type: "object", properties: { sql: { type: "string" } } },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: '[{"count": 42}]' }],
        isError: false,
      }),
    })),
  };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  return {
    StdioClientTransport: vi.fn().mockImplementation(() => ({
      onclose: null,
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const testDefinition: McpServerConfig = {
  id: "test-integration",
  type: "mcp_server",
  name: "Test Integration",
  description: "A test integration",
  command: "echo",
  args: ["test"],
  envVars: {},
};

const logger = new Logger("error");

describe("McpClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts and reports running", async () => {
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();
    expect(client.isRunning()).toBe(true);
  });

  it("lists tools from MCP server", async () => {
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("query");
    expect(tools[0].description).toBe("Execute SQL");
  });

  it("calls a tool and returns result", async () => {
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();
    const result = await client.callTool("query", { sql: "SELECT 1" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: '[{"count": 42}]',
    });
  });

  it("stops and reports not running", async () => {
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();
    await client.stop();
    expect(client.isRunning()).toBe(false);
  });

  it("throws when calling tool before start", async () => {
    const client = new McpClient(testDefinition, {}, logger);
    await expect(client.callTool("query", {})).rejects.toThrow(
      "MCP process not started"
    );
  });

  it("throws when listing tools before start", async () => {
    const client = new McpClient(testDefinition, {}, logger);
    await expect(client.listTools()).rejects.toThrow(
      "MCP process not started"
    );
  });

  it("exposes integrationId from definition", () => {
    const client = new McpClient(testDefinition, {}, logger);
    expect(client.integrationId).toBe("test-integration");
  });

  it("emits crash event when transport closes unexpectedly", async () => {
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();

    const crashPromise = new Promise<Error>((resolve) => {
      client.on("crash", resolve);
    });

    // Simulate transport close
    const mockTransport = vi.mocked(StdioClientTransport).mock.results[0].value;
    mockTransport.onclose?.();

    const err = await crashPromise;
    expect(err.message).toContain("exited unexpectedly");
    expect(client.isRunning()).toBe(false);
  });
});
