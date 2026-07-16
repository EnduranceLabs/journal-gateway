import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpClient } from "../mcp-client.js";
import { Logger } from "../common/logger.js";
import type { McpServerConfig, StdioServerConfig, SseServerConfig, StreamableHttpServerConfig } from "../config.js";

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
      setNotificationHandler: vi.fn(),
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

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
  return {
    SSEClientTransport: vi.fn().mockImplementation(() => ({
      onclose: null,
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  return {
    StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
      onclose: null,
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const testDefinition: StdioServerConfig = {
  id: "test-integration",
  transport: "stdio",
  name: "Test Integration",
  description: "A test integration",
  command: "echo",
  args: ["test"],
  envVars: {},
};

const sseDefinition: SseServerConfig = {
  id: "sse-integration",
  transport: "sse",
  name: "SSE Integration",
  description: "An SSE integration",
  url: "https://mcp.example.com/sse",
  headers: {},
};

const httpDefinition: StreamableHttpServerConfig = {
  id: "http-integration",
  transport: "streamable-http",
  name: "HTTP Integration",
  description: "A streamable HTTP integration",
  url: "https://mcp.example.com/mcp",
  headers: {},
};

const logger = new Logger("error");

describe("McpClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Stdio transport ---

  it("starts and reports running (stdio)", async () => {
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();
    expect(client.isRunning()).toBe(true);
  });

  it("passes only resolved env vars to stdio transport", async () => {
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const originalToken = process.env.JOURNAL_GATEWAY_TOKEN;
    process.env.JOURNAL_GATEWAY_TOKEN = "gw_should_not_leak";

    try {
      const client = new McpClient(
        testDefinition,
        { DATABASE_URL: "postgres://localhost/test" },
        logger
      );
      await client.start();

      const params = vi.mocked(StdioClientTransport).mock.calls[0][0];
      expect(params.env).toEqual({ DATABASE_URL: "postgres://localhost/test" });
      expect(params.env).not.toHaveProperty("JOURNAL_GATEWAY_TOKEN");
    } finally {
      if (originalToken === undefined) {
        delete process.env.JOURNAL_GATEWAY_TOKEN;
      } else {
        process.env.JOURNAL_GATEWAY_TOKEN = originalToken;
      }
    }
  });

  it("getTools returns empty before start", () => {
    const client = new McpClient(testDefinition, {}, logger);
    expect(client.getTools()).toEqual([]);
  });

  it("getTools returns cached tools after start", async () => {
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();
    const tools = client.getTools();
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

  it("getTools returns empty when not started", () => {
    const client = new McpClient(testDefinition, {}, logger);
    expect(client.getTools()).toEqual([]);
  });

  it("exposes integrationId from definition", () => {
    const client = new McpClient(testDefinition, {}, logger);
    expect(client.integrationId).toBe("test-integration");
  });

  it("refreshes cache and emits tools_changed on MCP notifications/tools/list_changed", async () => {
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();

    // Update what listTools returns for the refresh
    const mockClient = vi.mocked(Client).mock.results[0].value;
    mockClient.listTools.mockResolvedValue({
      tools: [
        { name: "query", description: "Execute SQL", inputSchema: { type: "object" } },
        { name: "execute", description: "Run statement", inputSchema: { type: "object" } },
      ],
    });

    const changedPromise = new Promise<void>((resolve) => {
      client.on("tools_changed", resolve);
    });

    // setNotificationHandler was called with (schema, handler)
    expect(mockClient.setNotificationHandler).toHaveBeenCalled();
    const handler = mockClient.setNotificationHandler.mock.calls[0][1];
    await handler();

    await changedPromise;

    // Cache should be updated
    const tools = client.getTools();
    expect(tools).toHaveLength(2);
    expect(tools[1].name).toBe("execute");
  });

  it("retains last-known-good cache when refresh fails", async () => {
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();

    // Verify initial cache
    expect(client.getTools()).toHaveLength(1);

    // Make listTools fail for the refresh
    const mockClient = vi.mocked(Client).mock.results[0].value;
    mockClient.listTools.mockRejectedValue(new Error("Server unreachable"));

    const changedPromise = new Promise<void>((resolve) => {
      client.on("tools_changed", resolve);
    });

    const handler = mockClient.setNotificationHandler.mock.calls[0][1];
    await handler();

    await changedPromise;

    // Cache should still have the old tools
    expect(client.getTools()).toHaveLength(1);
    expect(client.getTools()[0].name).toBe("query");
  });

  it("emits crash event and clears cache when transport closes unexpectedly (stdio)", async () => {
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const client = new McpClient(testDefinition, {}, logger);
    await client.start();

    // Verify tools are cached
    expect(client.getTools()).toHaveLength(1);

    const crashPromise = new Promise<Error>((resolve) => {
      client.on("crash", resolve);
    });

    // Simulate transport close
    const mockTransport = vi.mocked(StdioClientTransport).mock.results[0].value;
    mockTransport.onclose?.();

    const err = await crashPromise;
    expect(err.message).toContain("closed unexpectedly");
    expect(client.isRunning()).toBe(false);
    expect(client.getTools()).toEqual([]);
  });

  // --- SSE transport ---

  it("starts and reports running (sse)", async () => {
    const client = new McpClient(sseDefinition, {}, logger);
    await client.start();
    expect(client.isRunning()).toBe(true);
  });

  it("creates SSEClientTransport with url and headers", async () => {
    const { SSEClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/sse.js"
    );
    const headers = { Authorization: "Bearer sk-123" };
    const client = new McpClient(sseDefinition, headers, logger);
    await client.start();

    expect(vi.mocked(SSEClientTransport)).toHaveBeenCalledWith(
      new URL("https://mcp.example.com/sse"),
      { requestInit: { headers } }
    );
  });

  it("emits crash event when SSE transport closes unexpectedly", async () => {
    const { SSEClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/sse.js"
    );
    const client = new McpClient(sseDefinition, {}, logger);
    await client.start();

    const crashPromise = new Promise<Error>((resolve) => {
      client.on("crash", resolve);
    });

    const mockTransport = vi.mocked(SSEClientTransport).mock.results[0].value;
    mockTransport.onclose?.();

    const err = await crashPromise;
    expect(err.message).toContain("closed unexpectedly");
    expect(client.isRunning()).toBe(false);
  });

  // --- Streamable HTTP transport ---

  it("starts and reports running (streamable-http)", async () => {
    const client = new McpClient(httpDefinition, {}, logger);
    await client.start();
    expect(client.isRunning()).toBe(true);
  });

  it("creates StreamableHTTPClientTransport with url and headers", async () => {
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    const headers = { "X-Api-Key": "my-secret" };
    const client = new McpClient(httpDefinition, headers, logger);
    await client.start();

    expect(vi.mocked(StreamableHTTPClientTransport)).toHaveBeenCalledWith(
      new URL("https://mcp.example.com/mcp"),
      { requestInit: { headers } }
    );
  });

  it("emits crash event when streamable-http transport closes unexpectedly", async () => {
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    const client = new McpClient(httpDefinition, {}, logger);
    await client.start();

    const crashPromise = new Promise<Error>((resolve) => {
      client.on("crash", resolve);
    });

    const mockTransport = vi.mocked(StreamableHTTPClientTransport).mock.results[0].value;
    mockTransport.onclose?.();

    const err = await crashPromise;
    expect(err.message).toContain("closed unexpectedly");
    expect(client.isRunning()).toBe(false);
  });
});
