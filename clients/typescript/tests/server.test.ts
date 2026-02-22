import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GatewayServer, type ConnectedGateway } from "../src/server.js";
import WebSocket from "ws";

function connectAndAuth(
  url: string,
  token: string
): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "authenticate",
          token,
          protocolVersion: 1,
          gatewayVersion: "0.1.0-test",
        })
      );
    });
    ws.once("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "authenticated") {
        resolve(ws);
      } else {
        reject(new Error(`Auth failed: ${msg.error ?? "unknown"}`));
      }
    });
    ws.on("error", reject);
  });
}

function register(
  ws: WebSocket,
  integrations: unknown[] = []
): Promise<void> {
  return new Promise<void>((resolve) => {
    ws.send(JSON.stringify({ type: "register", integrations }));
    ws.once("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "registered") {
        resolve();
      }
    });
  });
}

const TEST_INTEGRATION = {
  id: "test-integration",
  name: "Test",
  description: "Test integration",
  tools: [
    { name: "echo", description: "Echo tool", inputSchema: {} },
    { name: "fail", description: "Fail tool", inputSchema: {} },
  ],
};

describe("GatewayServer", () => {
  let server: GatewayServer;

  beforeEach(async () => {
    server = new GatewayServer({
      port: 0,
      validateToken: async (token) =>
        token === "gw_valid"
          ? { organizationId: "org_1", organizationName: "Test Org" }
          : null,
      pingIntervalMs: 0,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("accepts valid token and registers", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await register(ws, []);
    expect(server.connectedGateways).toHaveLength(1);
    expect(server.connectedGateways[0].protocolVersion).toBe(1);
    expect(server.connectedGateways[0].gatewayVersion).toBe("0.1.0-test");
    ws.close();
  });

  it("rejects invalid token", async () => {
    await expect(connectAndAuth(server.url, "gw_invalid")).rejects.toThrow(
      "Auth failed"
    );
  });

  it("callTool returns result", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await register(ws, [TEST_INTEGRATION]);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "tool_call") {
        ws.send(
          JSON.stringify({
            type: "tool_result",
            requestId: msg.requestId,
            result: {
              content: [
                {
                  type: "text",
                  text: `echo: ${JSON.stringify(msg.arguments)}`,
                },
              ],
            },
          })
        );
      }
    });

    const result = await server.callTool("test-integration", "echo", {
      hello: "world",
    });
    expect(result.content[0]).toEqual({
      type: "text",
      text: 'echo: {"hello":"world"}',
    });
    ws.close();
  });

  it("callTool returns error", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await register(ws, [TEST_INTEGRATION]);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "tool_call") {
        ws.send(
          JSON.stringify({
            type: "tool_error",
            requestId: msg.requestId,
            error: {
              code: "EXECUTION_FAILED",
              message: "Something went wrong",
            },
          })
        );
      }
    });

    await expect(
      server.callTool("test-integration", "fail", {})
    ).rejects.toThrow(
      "Tool error [EXECUTION_FAILED]: Something went wrong"
    );
    ws.close();
  });

  it("callTool throws when no gateway has integration", async () => {
    await expect(
      server.callTool("nonexistent", "tool", {})
    ).rejects.toThrow('No gateway has integration "nonexistent"');
  });

  it("sends pings and receives pongs", async () => {
    await server.stop();
    server = new GatewayServer({
      port: 0,
      validateToken: async (token) =>
        token === "gw_valid" ? { organizationId: "org_1" } : null,
      pingIntervalMs: 100,
    });
    await server.start();

    const ws = await connectAndAuth(server.url, "gw_valid");
    await register(ws, []);

    const pingsReceived: number[] = [];
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ping") {
        pingsReceived.push(Date.now());
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });

    await new Promise((r) => setTimeout(r, 350));
    expect(pingsReceived.length).toBeGreaterThanOrEqual(2);
    ws.close();
  });

  it("fires onGatewayDisconnected when gateway closes", async () => {
    let disconnected: ConnectedGateway | null = null;
    server.onGatewayDisconnected = (gw) => {
      disconnected = gw;
    };

    const ws = await connectAndAuth(server.url, "gw_valid");
    await register(ws, []);
    expect(server.connectedGateways).toHaveLength(1);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(disconnected).not.toBeNull();
    expect(disconnected!.id).toBeTruthy();
    expect(server.connectedGateways).toHaveLength(0);
  });

  it("handles concurrent tool calls correctly", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await register(ws, [TEST_INTEGRATION]);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "tool_call") {
        setTimeout(() => {
          ws.send(
            JSON.stringify({
              type: "tool_result",
              requestId: msg.requestId,
              result: {
                content: [
                  { type: "text", text: `result-${msg.arguments.id}` },
                ],
              },
            })
          );
        }, 10);
      }
    });

    const [r1, r2, r3] = await Promise.all([
      server.callTool("test-integration", "echo", { id: 1 }),
      server.callTool("test-integration", "echo", { id: 2 }),
      server.callTool("test-integration", "echo", { id: 3 }),
    ]);

    expect(r1.content[0]).toEqual({ type: "text", text: "result-1" });
    expect(r2.content[0]).toEqual({ type: "text", text: "result-2" });
    expect(r3.content[0]).toEqual({ type: "text", text: "result-3" });
    ws.close();
  });

  it("availableTools aggregates across integrations", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await register(ws, [TEST_INTEGRATION]);

    expect(server.availableTools).toEqual([
      {
        integrationId: "test-integration",
        name: "echo",
        description: "Echo tool",
      },
      {
        integrationId: "test-integration",
        name: "fail",
        description: "Fail tool",
      },
    ]);
    ws.close();
  });
});
