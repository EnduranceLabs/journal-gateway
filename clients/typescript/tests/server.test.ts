import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { GatewayServer, type ConnectedGateway } from "../src/server.js";
import WebSocket, { WebSocketServer } from "ws";

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
          protocolVersion: 2,
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

/**
 * Send version_changed and handle any pull requests from the server.
 * This replaces the old register() helper.
 */
function sendVersionChanged(
  ws: WebSocket,
  integrations: unknown[] = [],
  options: {
    mcpVersion?: string | null;
    skillsVersion?: string | null;
    skills?: unknown[];
  } = {}
): Promise<void> {
  const mcpVersion = options.mcpVersion ?? (integrations.length > 0 ? "abc123" : null);
  const skillsVersion = options.skillsVersion ?? null;
  const skills = options.skills ?? [];

  return new Promise<void>((resolve) => {
    // Set up handler for pull requests before sending version_changed
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "get_tools") {
        ws.send(JSON.stringify({
          type: "tools",
          requestId: msg.requestId,
          integrations,
          mcpVersion,
        }));
      } else if (msg.type === "get_skills") {
        ws.send(JSON.stringify({
          type: "skills",
          requestId: msg.requestId,
          skills,
          skillsVersion,
        }));
      }
    };
    ws.on("message", handler);

    ws.send(JSON.stringify({
      type: "version_changed",
      mcpVersion,
      skillsVersion,
    }));

    // Wait for pulls to complete
    setTimeout(() => {
      ws.removeListener("message", handler);
      resolve();
    }, 100);
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

  it("accepts valid token and connects after version_changed", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await sendVersionChanged(ws, []);
    expect(server.connectedGateways).toHaveLength(1);
    expect(server.connectedGateways[0].protocolVersion).toBe(2);
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
    await sendVersionChanged(ws, [TEST_INTEGRATION]);

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
    await sendVersionChanged(ws, [TEST_INTEGRATION]);

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
    await sendVersionChanged(ws, []);

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
    await sendVersionChanged(ws, []);
    expect(server.connectedGateways).toHaveLength(1);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(disconnected).not.toBeNull();
    expect(disconnected!.id).toBeTruthy();
    expect(server.connectedGateways).toHaveLength(0);
  });

  it("handles concurrent tool calls correctly", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await sendVersionChanged(ws, [TEST_INTEGRATION]);

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

  it("version_changed triggers auto-pull and fires onGatewayConnected", async () => {
    let connected: ConnectedGateway | null = null;
    server.onGatewayConnected = (gw) => {
      connected = gw;
    };

    const ws = await connectAndAuth(server.url, "gw_valid");
    await sendVersionChanged(ws, [TEST_INTEGRATION], { mcpVersion: "v1" });

    expect(connected).not.toBeNull();
    expect(connected!.integrations).toHaveLength(1);
    expect(connected!.integrations[0].tools).toHaveLength(2);
    expect(connected!.mcpVersion).toBe("v1");
    ws.close();
  });

  it("subsequent version_changed fires onGatewayUpdated with pulled data", async () => {
    let updatedGateway: ConnectedGateway | null = null;
    server.onGatewayUpdated = (gw) => { updatedGateway = gw; };

    const ws = await connectAndAuth(server.url, "gw_valid");
    await sendVersionChanged(ws, [TEST_INTEGRATION], { mcpVersion: "v1" });

    // Send another version_changed with different version
    const updatedIntegration = {
      ...TEST_INTEGRATION,
      tools: [
        ...TEST_INTEGRATION.tools,
        { name: "new_tool", description: "New tool", inputSchema: {} },
      ],
    };

    // Handle pull requests for the second version_changed
    const pullHandler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "get_tools") {
        ws.send(JSON.stringify({
          type: "tools",
          requestId: msg.requestId,
          integrations: [updatedIntegration],
          mcpVersion: "v2",
        }));
      }
    };
    ws.on("message", pullHandler);

    ws.send(JSON.stringify({
      type: "version_changed",
      mcpVersion: "v2",
      skillsVersion: null,
    }));

    await new Promise((r) => setTimeout(r, 200));

    expect(updatedGateway).not.toBeNull();
    expect(server.connectedGateways[0].integrations[0].tools).toHaveLength(3);
    expect(server.connectedGateways[0].mcpVersion).toBe("v2");

    ws.removeListener("message", pullHandler);
    ws.close();
  });

  it("availableTools aggregates across integrations", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await sendVersionChanged(ws, [TEST_INTEGRATION]);

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

  it("connected gateway has null version fields when no tools/skills", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await sendVersionChanged(ws, []);
    expect(server.connectedGateways[0].mcpVersion).toBeNull();
    expect(server.connectedGateways[0].skillsVersion).toBeNull();
    ws.close();
  });

  it("connected gateway stores version fields from version_changed", async () => {
    const ws = await connectAndAuth(server.url, "gw_valid");
    await sendVersionChanged(ws, [TEST_INTEGRATION], {
      mcpVersion: "abc123",
      skillsVersion: "def456",
      skills: [{ id: "review", content: "Review PR..." }],
    });

    expect(server.connectedGateways[0].mcpVersion).toBe("abc123");
    expect(server.connectedGateways[0].skillsVersion).toBe("def456");
    ws.close();
  });
});

describe("GatewayServer (external server mode)", () => {
  let gateway: GatewayServer;
  let httpServer: HttpServer;
  let wss: WebSocketServer;
  let port: number;
  let serverSockets: WebSocket[];

  beforeEach(async () => {
    serverSockets = [];
    gateway = new GatewayServer({
      validateToken: async (token) =>
        token === "gw_valid"
          ? { organizationId: "org_1", organizationName: "Test Org" }
          : null,
      pingIntervalMs: 0,
    });

    // Create an external HTTP + WS server and pipe connections to GatewayServer
    httpServer = createServer();
    wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (req, socket, head) => {
      if (req.url === "/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          serverSockets.push(ws);
          gateway.handleConnection(ws);
        });
      } else {
        socket.destroy();
      }
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === "object" && addr !== null ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    gateway.shutdown();
    wss.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("accepts connections via handleConnection", async () => {
    const ws = await connectAndAuth(`ws://localhost:${port}/ws`, "gw_valid");
    await sendVersionChanged(ws, [TEST_INTEGRATION]);

    expect(gateway.connectedGateways).toHaveLength(1);
    expect(gateway.connectedGateways[0].organizationId).toBe("org_1");
    ws.close();
  });

  it("rejects invalid token via handleConnection", async () => {
    await expect(
      connectAndAuth(`ws://localhost:${port}/ws`, "gw_bad")
    ).rejects.toThrow("Auth failed");
  });

  it("tool calls work via handleConnection", async () => {
    const ws = await connectAndAuth(`ws://localhost:${port}/ws`, "gw_valid");
    await sendVersionChanged(ws, [TEST_INTEGRATION]);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "tool_call") {
        ws.send(
          JSON.stringify({
            type: "tool_result",
            requestId: msg.requestId,
            result: {
              content: [{ type: "text", text: `got: ${msg.arguments.x}` }],
            },
          })
        );
      }
    });

    const result = await gateway.callToolForOrg(
      "org_1",
      "test-integration",
      "echo",
      { x: 42 }
    );
    expect(result.content[0]).toEqual({ type: "text", text: "got: 42" });
    ws.close();
  });

  it("shutdown cleans up connections without closing external server", async () => {
    let disconnected = false;
    gateway.onGatewayDisconnected = () => { disconnected = true; };

    const ws = await connectAndAuth(`ws://localhost:${port}/ws`, "gw_valid");
    await sendVersionChanged(ws, []);
    expect(gateway.connectedGateways).toHaveLength(1);

    gateway.shutdown();
    await new Promise((r) => setTimeout(r, 100));

    expect(gateway.connectedGateways).toHaveLength(0);
    expect(disconnected).toBe(true);

    // HTTP server is still running — can accept new connections
    const ws2 = await connectAndAuth(`ws://localhost:${port}/ws`, "gw_valid");
    await sendVersionChanged(ws2, []);
    expect(gateway.connectedGateways).toHaveLength(1);
    ws2.close();
  });

  it("socket error events do not crash and are surfaced via onSocketError", async () => {
    // An unhandled "error" event on the server-side socket would throw at the
    // process level and take down the host service (JO-6988 class of failure).
    const errors: Array<{ error: Error; gatewayId: string | null }> = [];
    gateway = new GatewayServer({
      validateToken: async (token) =>
        token === "gw_valid" ? { organizationId: "org_1" } : null,
      pingIntervalMs: 0,
      onSocketError: (error, gw) => errors.push({ error, gatewayId: gw?.id ?? null }),
    });
    httpServer.removeAllListeners("upgrade");
    httpServer.on("upgrade", (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        serverSockets.push(ws);
        gateway.handleConnection(ws);
      });
    });

    const ws = await connectAndAuth(`ws://localhost:${port}/ws`, "gw_valid");
    await sendVersionChanged(ws, []);
    expect(serverSockets).toHaveLength(1);

    // With no "error" listener this emit would throw (unhandled 'error').
    expect(() =>
      serverSockets[0].emit("error", new Error("read ECONNRESET"))
    ).not.toThrow();

    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe("read ECONNRESET");
    expect(errors[0].gatewayId).toBe(gateway.connectedGateways[0].id);
    ws.close();
  });

  it("startHeartbeat sends pings", async () => {
    // Recreate with heartbeat enabled
    gateway.shutdown();
    gateway = new GatewayServer({
      validateToken: async (token) =>
        token === "gw_valid" ? { organizationId: "org_1" } : null,
      pingIntervalMs: 100,
    });
    gateway.startHeartbeat();

    // Re-wire the upgrade handler to the new gateway instance
    httpServer.removeAllListeners("upgrade");
    httpServer.on("upgrade", (req, socket, head) => {
      if (req.url === "/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          gateway.handleConnection(ws);
        });
      } else {
        socket.destroy();
      }
    });

    const ws = await connectAndAuth(`ws://localhost:${port}/ws`, "gw_valid");
    await sendVersionChanged(ws, []);

    const pings: number[] = [];
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ping") {
        pings.push(Date.now());
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });

    await new Promise((r) => setTimeout(r, 350));
    expect(pings.length).toBeGreaterThanOrEqual(2);
    ws.close();
  });
});
