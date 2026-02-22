import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayConnection } from "../connection.js";
import type { GatewayConfig } from "../config.js";
import { SkillRuntime } from "../skill-runtime.js";
import { EventEmitter } from "node:events";

// Mock ws
class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];

  constructor(public url: string) {
    super();
    // Simulate connection opening
    setTimeout(() => this.emit("open"), 0);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close");
  }
}

vi.mock("ws", () => {
  const ctor = vi.fn().mockImplementation((url: string) => {
    const ws = new MockWebSocket(url);
    mockWsInstances.push(ws);
    return ws;
  });
  // Expose static OPEN so connection.ts readyState check works
  (ctor as unknown as Record<string, unknown>).OPEN = 1;
  return { default: ctor };
});

// Mock SkillRuntime
vi.mock("../skill-runtime.js", () => {
  return {
    SkillRuntime: vi.fn().mockImplementation(() => ({
      getRegistration: vi.fn().mockResolvedValue([
        {
          type: "mcp_server",
          id: "postgresql",
          name: "PostgreSQL",
          description: "Query databases",
          tools: [
            {
              name: "query",
              description: "Run SQL",
              inputSchema: { type: "object" },
            },
          ],
        },
      ]),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "result" }],
      }),
    })),
    SkillNotFoundError: class SkillNotFoundError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "SkillNotFoundError";
      }
    },
  };
});

let mockWsInstances: MockWebSocket[] = [];

const config: GatewayConfig = {
  token: "gw_test123",
  url: "wss://localhost/v1",
  skills: ["postgresql"],
  logLevel: "error",
  skillDefinitions: [],
  skillEnvVars: new Map(),
};

describe("GatewayConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWsInstances = [];
  });

  afterEach(async () => {
    // Cleanup
  });

  it("completes full connection lifecycle", async () => {
    const runtime = new SkillRuntime(config);
    const conn = new GatewayConnection(config, runtime);

    const connectPromise = conn.connect();

    // Wait for WS to be created
    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Verify authenticate was sent
    expect(ws.sent).toHaveLength(1);
    const authMsg = JSON.parse(ws.sent[0]);
    expect(authMsg.type).toBe("authenticate");
    expect(authMsg.token).toBe("gw_test123");
    expect(authMsg.protocolVersion).toBe(1);

    // Service responds with authenticated
    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
      organizationName: "Test Org",
    }));

    // Wait for register to be sent
    await new Promise((r) => setTimeout(r, 10));
    expect(ws.sent).toHaveLength(2);
    const registerMsg = JSON.parse(ws.sent[1]);
    expect(registerMsg.type).toBe("register");
    expect(registerMsg.skills).toHaveLength(1);

    // Service responds with registered
    ws.emit("message", JSON.stringify({
      type: "registered",
      skillCount: 1,
      toolCount: 1,
    }));

    await connectPromise;
    await conn.close();
  });

  it("handles auth error", async () => {
    const runtime = new SkillRuntime(config);
    const conn = new GatewayConnection(config, runtime);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    ws.emit("message", JSON.stringify({
      type: "auth_error",
      error: "Invalid token",
    }));

    await expect(connectPromise).rejects.toThrow("Authentication failed: Invalid token");
  });

  it("responds to ping with pong", async () => {
    const runtime = new SkillRuntime(config);
    const conn = new GatewayConnection(config, runtime);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Complete connection
    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));
    await new Promise((r) => setTimeout(r, 10));
    ws.emit("message", JSON.stringify({
      type: "registered",
      skillCount: 1,
      toolCount: 1,
    }));
    await connectPromise;

    // Send ping
    ws.emit("message", JSON.stringify({ type: "ping" }));

    await new Promise((r) => setTimeout(r, 10));
    const pongMsg = ws.sent.find((s) => JSON.parse(s).type === "pong");
    expect(pongMsg).toBeDefined();
    expect(JSON.parse(pongMsg!)).toEqual({ type: "pong" });

    await conn.close();
  });

  it("handles tool_call and sends tool_result", async () => {
    const runtime = new SkillRuntime(config);
    const conn = new GatewayConnection(config, runtime);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Complete connection
    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));
    await new Promise((r) => setTimeout(r, 10));
    ws.emit("message", JSON.stringify({
      type: "registered",
      skillCount: 1,
      toolCount: 1,
    }));
    await connectPromise;

    // Send tool_call
    ws.emit("message", JSON.stringify({
      type: "tool_call",
      requestId: "req_abc",
      skillId: "postgresql",
      toolName: "query",
      arguments: { sql: "SELECT 1" },
    }));

    // Wait for async tool call handling
    await new Promise((r) => setTimeout(r, 50));

    const resultMsg = ws.sent.find((s) => JSON.parse(s).type === "tool_result");
    expect(resultMsg).toBeDefined();
    const parsed = JSON.parse(resultMsg!);
    expect(parsed.requestId).toBe("req_abc");
    expect(parsed.result.content[0].text).toBe("result");

    await conn.close();
  });

  it("ignores invalid messages gracefully", async () => {
    const runtime = new SkillRuntime(config);
    const conn = new GatewayConnection(config, runtime);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Send invalid message — should not throw
    ws.emit("message", JSON.stringify({ type: "unknown_garbage" }));
    ws.emit("message", "not json at all{{{");

    // Complete connection normally
    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));
    await new Promise((r) => setTimeout(r, 10));
    ws.emit("message", JSON.stringify({
      type: "registered",
      skillCount: 1,
      toolCount: 1,
    }));

    await connectPromise;
    await conn.close();
  });
});
