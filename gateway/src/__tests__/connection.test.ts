import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayConnection } from "../connection.js";
import type { GatewayConfig, IntegrationProvider, GatewayVersions, Skill } from "@journal.one/gateway-protocol";
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
    this.readyState = 3;
    this.emit("close");
  }
}

// vi.mock is hoisted — can't reference top-level variables in the factory.
// Use mockWsFactory indirection so tests can override constructor behavior.
vi.mock("ws", () => {
  const ctor = vi.fn().mockImplementation((url: string) => {
    if (mockWsFactory) return mockWsFactory(url);
    const ws = new MockWebSocket(url);
    mockWsInstances.push(ws);
    return ws;
  });
  (ctor as unknown as Record<string, unknown>).OPEN = 1;
  return { default: ctor };
});

let mockWsInstances: MockWebSocket[] = [];
let mockWsFactory: ((url: string) => MockWebSocket) | null = null;

const config: GatewayConfig = {
  token: "gw_test123",
  url: "wss://localhost/v1",
  logLevel: "error",
};

function createMockProvider(): IntegrationProvider & {
  _emitter: EventEmitter;
  _versions: GatewayVersions;
} {
  const emitter = new EventEmitter();
  const versions: GatewayVersions = {
    mcpVersion: "abcdef0123456789",
    skillsVersion: null,
  };

  return {
    getTools: vi.fn().mockReturnValue([
      {
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
    getSkills: vi.fn().mockReturnValue([]),
    getVersions: vi.fn().mockImplementation(() => ({ ...versions })),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "result" }],
    }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    _emitter: emitter,
    _versions: versions,
  };
}

/** Helper: authenticate the first (or Nth) mock ws instance. */
function authenticate(ws: MockWebSocket): void {
  ws.emit("message", JSON.stringify({
    type: "authenticated",
    organizationId: "org_123",
    organizationName: "Test Org",
  }));
}

describe("GatewayConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWsInstances = [];
    mockWsFactory = null;
  });

  afterEach(async () => {
    // Cleanup
  });

  it("completes full connection lifecycle", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    // Wait for WS to be created
    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Verify authenticate was sent
    expect(ws.sent).toHaveLength(1);
    const authMsg = JSON.parse(ws.sent[0]);
    expect(authMsg.type).toBe("authenticate");
    expect(authMsg.token).toBe("gw_test123");
    expect(authMsg.protocolVersion).toBe(2);

    // Service responds with authenticated
    authenticate(ws);

    // Wait for version_changed to be sent and connection to resolve
    await connectPromise;

    expect(ws.sent).toHaveLength(2);
    const versionMsg = JSON.parse(ws.sent[1]);
    expect(versionMsg.type).toBe("version_changed");
    expect(versionMsg.mcpVersion).toBe("abcdef0123456789");
    expect(versionMsg.skillsVersion).toBeNull();

    await conn.close();
  });

  it("sends version_changed after auth with versions", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    authenticate(ws);
    await connectPromise;

    const versionMsg = JSON.parse(ws.sent[1]);
    expect(versionMsg.type).toBe("version_changed");
    expect(versionMsg.mcpVersion).toBe("abcdef0123456789");
    expect(versionMsg.skillsVersion).toBeNull();

    await conn.close();
  });

  it("sends version_changed on provider versions_changed event", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Complete connection
    authenticate(ws);
    await connectPromise;

    // Clear sent messages
    ws.sent.length = 0;

    // Emit versions_changed from provider
    provider._emitter.emit("versions_changed");

    await new Promise((r) => setTimeout(r, 10));
    expect(ws.sent).toHaveLength(1);
    const changeMsg = JSON.parse(ws.sent[0]);
    expect(changeMsg.type).toBe("version_changed");
    expect(changeMsg.mcpVersion).toBe("abcdef0123456789");

    await conn.close();
  });

  it("responds to get_versions", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    authenticate(ws);
    await connectPromise;

    ws.sent.length = 0;

    ws.emit("message", JSON.stringify({
      type: "get_versions",
      requestId: "pull_1",
    }));

    await new Promise((r) => setTimeout(r, 10));
    expect(ws.sent).toHaveLength(1);
    const versionsMsg = JSON.parse(ws.sent[0]);
    expect(versionsMsg.type).toBe("versions");
    expect(versionsMsg.requestId).toBe("pull_1");
    expect(versionsMsg.mcpVersion).toBe("abcdef0123456789");
    expect(versionsMsg.skillsVersion).toBeNull();

    await conn.close();
  });

  it("responds to get_tools", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    authenticate(ws);
    await connectPromise;

    ws.sent.length = 0;

    ws.emit("message", JSON.stringify({
      type: "get_tools",
      requestId: "pull_2",
    }));

    await new Promise((r) => setTimeout(r, 10));
    expect(ws.sent).toHaveLength(1);
    const toolsMsg = JSON.parse(ws.sent[0]);
    expect(toolsMsg.type).toBe("tools");
    expect(toolsMsg.requestId).toBe("pull_2");
    expect(toolsMsg.integrations).toHaveLength(1);
    expect(toolsMsg.integrations[0].id).toBe("postgresql");
    expect(toolsMsg.mcpVersion).toBe("abcdef0123456789");

    await conn.close();
  });

  it("always responds to get_tools even when provider returns empty", async () => {
    const provider = createMockProvider();
    (provider.getTools as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const conn = new GatewayConnection(config, provider);
    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    authenticate(ws);
    await connectPromise;

    ws.sent.length = 0;

    ws.emit("message", JSON.stringify({
      type: "get_tools",
      requestId: "pull_empty",
    }));

    await new Promise((r) => setTimeout(r, 10));
    // With cache-first approach, getTools() is infallible — always responds
    expect(ws.sent).toHaveLength(1);
    const toolsMsg = JSON.parse(ws.sent[0]);
    expect(toolsMsg.type).toBe("tools");
    expect(toolsMsg.requestId).toBe("pull_empty");
    expect(toolsMsg.integrations).toEqual([]);

    await conn.close();
  });

  it("responds to get_skills", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    authenticate(ws);
    await connectPromise;

    ws.sent.length = 0;

    ws.emit("message", JSON.stringify({
      type: "get_skills",
      requestId: "pull_3",
    }));

    await new Promise((r) => setTimeout(r, 10));
    expect(ws.sent).toHaveLength(1);
    const skillsMsg = JSON.parse(ws.sent[0]);
    expect(skillsMsg.type).toBe("skills");
    expect(skillsMsg.requestId).toBe("pull_3");
    expect(skillsMsg.skills).toEqual([]);
    expect(skillsMsg.skillsVersion).toBeNull();

    await conn.close();
  });

  it("cleans up change listener on close", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    authenticate(ws);
    await connectPromise;

    // Close should unsubscribe
    await conn.close();

    // Verify no listeners remain
    expect(provider._emitter.listenerCount("versions_changed")).toBe(0);
  });

  it("handles auth error and retries", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Send auth error — ws will close, loop will retry
    ws.emit("message", JSON.stringify({
      type: "auth_error",
      error: "Invalid token",
    }));

    // Wait for reconnect (backoff ~1s)
    await new Promise((r) => setTimeout(r, 1500));
    expect(mockWsInstances.length).toBeGreaterThanOrEqual(2);

    // Authenticate on the second attempt
    const ws2 = mockWsInstances[mockWsInstances.length - 1];
    await new Promise((r) => setTimeout(r, 10));
    authenticate(ws2);

    // connect() should resolve now
    await connectPromise;

    await conn.close();
  });

  it("responds to ping with pong", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Complete connection
    authenticate(ws);
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
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Complete connection
    authenticate(ws);
    await connectPromise;

    // Send tool_call
    ws.emit("message", JSON.stringify({
      type: "tool_call",
      requestId: "req_abc",
      integrationId: "postgresql",
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

  it("reconnects after unexpected close", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws1 = mockWsInstances[0];

    // Complete initial connection
    authenticate(ws1);
    await connectPromise;

    // Simulate unexpected disconnect
    ws1.emit("close");

    // Wait for reconnect attempt (initial delay ~1s, but we check a new WS is created)
    await new Promise((r) => setTimeout(r, 1500));
    expect(mockWsInstances.length).toBeGreaterThanOrEqual(2);

    await conn.close();
  });

  it("does not reconnect after explicit close", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    authenticate(ws);
    await connectPromise;

    // Explicitly close, then wait
    await conn.close();

    const countBefore = mockWsInstances.length;
    await new Promise((r) => setTimeout(r, 1500));
    expect(mockWsInstances.length).toBe(countBefore);
  });

  it("close then connect does not produce two loops", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    // First connection
    const p1 = conn.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws1 = mockWsInstances[0];
    authenticate(ws1);
    await p1;

    // Close and immediately reconnect
    await conn.close();
    const p2 = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws2 = mockWsInstances[mockWsInstances.length - 1];
    authenticate(ws2);
    await p2;

    // Only one new WS should have been created for the second connect.
    // ws1 (original) + ws2 (reconnect) = 2 total, not 3+.
    expect(mockWsInstances).toHaveLength(2);

    await conn.close();
  });

  it("close in-flight followed by immediate connect starts one new loop", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    // Establish first connection
    const p1 = conn.connect();
    await new Promise((r) => setTimeout(r, 10));
    authenticate(mockWsInstances[0]);
    await p1;

    // Start close but don't await — immediately reconnect
    const closePromise = conn.close();
    const p2 = conn.connect();

    // Let close drain and new loop start
    await closePromise;
    await new Promise((r) => setTimeout(r, 10));
    const ws2 = mockWsInstances[mockWsInstances.length - 1];
    authenticate(ws2);
    await p2;

    // Original + new = 2 total (no extra from races)
    expect(mockWsInstances).toHaveLength(2);

    await conn.close();
  });

  it("sends tool_error for unknown integration", async () => {
    const provider = createMockProvider();
    (provider.callTool as ReturnType<typeof vi.fn>).mockRejectedValue(
      new (await import("@journal.one/gateway-protocol")).IntegrationNotFoundError("unknown")
    );

    const conn = new GatewayConnection(config, provider);
    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    authenticate(ws);
    await connectPromise;

    ws.emit("message", JSON.stringify({
      type: "tool_call",
      requestId: "req_err",
      integrationId: "unknown",
      toolName: "query",
      arguments: {},
    }));

    await new Promise((r) => setTimeout(r, 50));
    const errorMsg = ws.sent.find((s) => JSON.parse(s).type === "tool_error");
    expect(errorMsg).toBeDefined();
    const parsed = JSON.parse(errorMsg!);
    expect(parsed.requestId).toBe("req_err");
    expect(parsed.error.code).toBe("INTEGRATION_NOT_FOUND");
  });

  it("ignores invalid messages gracefully", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Send invalid message — should not throw
    ws.emit("message", JSON.stringify({ type: "unknown_garbage" }));
    ws.emit("message", "not json at all{{{");

    // Complete connection normally
    authenticate(ws);

    await connectPromise;
    await conn.close();
  });

  it("recovers from WebSocket constructor sync throw", async () => {
    const provider = createMockProvider();

    // First call throws synchronously, second succeeds normally
    let callCount = 0;
    mockWsFactory = (url: string) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Invalid URL");
      }
      const ws = new MockWebSocket(url);
      mockWsInstances.push(ws);
      return ws;
    };

    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    // Wait for retry after sync throw (backoff ~1s)
    await new Promise((r) => setTimeout(r, 1500));

    // Second attempt should have created a ws
    expect(mockWsInstances.length).toBeGreaterThanOrEqual(1);
    const ws = mockWsInstances[mockWsInstances.length - 1];
    await new Promise((r) => setTimeout(r, 10));
    authenticate(ws);

    await connectPromise;
    await conn.close();
  });

  it("close() before first auth rejects connect()", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));

    // Close before authenticating
    await conn.close();

    await expect(connectPromise).rejects.toThrow("Connection closed");
  });

  it("connect() is idempotent — second call returns same promise", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const p1 = conn.connect();
    const p2 = conn.connect();

    // Same promise — no duplicate loops
    expect(p2).toBe(p1);

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Only one WebSocket was created
    expect(mockWsInstances).toHaveLength(1);

    authenticate(ws);
    await p1;

    await conn.close();
  });
});
