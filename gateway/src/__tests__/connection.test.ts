import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayConnection } from "../connection.js";
import type { GatewayConfig, IntegrationProvider, GatewayVersions, Skill } from "@journal/gateway-protocol";
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

let mockWsInstances: MockWebSocket[] = [];

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
    getTools: vi.fn().mockResolvedValue([
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

describe("GatewayConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWsInstances = [];
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
    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
      organizationName: "Test Org",
    }));

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

    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));

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
    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));
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

    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));
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

    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));
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

  it("responds to get_skills", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));
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

    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));
    await connectPromise;

    // Close should unsubscribe
    await conn.close();

    // Verify no listeners remain
    expect(provider._emitter.listenerCount("versions_changed")).toBe(0);
  });

  it("handles auth error", async () => {
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

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
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Complete connection
    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
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
    const provider = createMockProvider();
    const conn = new GatewayConnection(config, provider);

    const connectPromise = conn.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstances[0];

    // Complete connection
    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));
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
    ws.emit("message", JSON.stringify({
      type: "authenticated",
      organizationId: "org_123",
    }));

    await connectPromise;
    await conn.close();
  });
});
