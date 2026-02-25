import { describe, it, expect, vi, beforeEach } from "vitest";
import { Runtime } from "../runtime.js";
import { IntegrationNotFoundError } from "@journal.one/gateway-protocol";
import type { RuntimeConfig, McpServerConfig } from "../config.js";
import { EventEmitter } from "node:events";

// Track listeners so we can trigger events in tests
const mcpClientInstances: Array<{
  id: string;
  emitter: EventEmitter;
  listTools: ReturnType<typeof vi.fn>;
}> = [];

// Mock McpClient
vi.mock("../mcp-client.js", () => {
  return {
    McpClient: vi.fn().mockImplementation((definition) => {
      const emitter = new EventEmitter();
      const listTools = vi.fn().mockResolvedValue([
        {
          name: "query",
          description: "Run SQL",
          inputSchema: { type: "object" },
        },
      ]);
      const instance = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        listTools,
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "result" }],
        }),
        isRunning: vi.fn().mockReturnValue(true),
        integrationId: definition.id,
        on: emitter.on.bind(emitter),
        off: emitter.off.bind(emitter),
        emit: emitter.emit.bind(emitter),
      };
      mcpClientInstances.push({ id: definition.id, emitter, listTools });
      return instance;
    }),
  };
});

// Mock SkillClient
const skillClientEmitter = new EventEmitter();
const mockSkillClient = {
  load: vi.fn().mockResolvedValue(undefined),
  getIntegrations: vi.fn().mockReturnValue([]),
  getSkills: vi.fn().mockReturnValue([]),
  startWatching: vi.fn(),
  stopWatching: vi.fn(),
  on: skillClientEmitter.on.bind(skillClientEmitter),
  off: skillClientEmitter.off.bind(skillClientEmitter),
  emit: skillClientEmitter.emit.bind(skillClientEmitter),
};

vi.mock("../skill-client.js", () => {
  return {
    SkillClient: vi.fn().mockImplementation(() => mockSkillClient),
  };
});

const testIntegration: McpServerConfig = {
  id: "test-db",
  transport: "stdio",
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
    mcpClientInstances.length = 0;
    skillClientEmitter.removeAllListeners();
    mockSkillClient.getSkills.mockReturnValue([]);
    mockSkillClient.getIntegrations.mockReturnValue([]);
  });

  it("starts all configured integrations", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    const tools = await runtime.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe("test-db");
  });

  it("generates tool integrations with tools", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    const tools = await runtime.getTools();
    expect(tools[0].tools).toHaveLength(1);
    expect(tools[0].tools[0].name).toBe("query");
  });

  it("getSkills returns empty array by default", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    const skills = runtime.getSkills();
    expect(skills).toEqual([]);
  });

  it("getSkills returns skills from skill client", async () => {
    const testSkills = [
      { id: "review-pr", content: "Review a PR..." },
      { id: "deploy", content: "Deploy steps..." },
    ];
    mockSkillClient.getSkills.mockReturnValue(testSkills);

    const runtime = new Runtime(makeConfig());
    await runtime.start();
    const skills = runtime.getSkills();
    expect(skills).toEqual(testSkills);
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
    const tools = await runtime.getTools();
    expect(tools).toHaveLength(0);
  });

  it("getVersions returns null versions before start", () => {
    const runtime = new Runtime(makeConfig());
    const versions = runtime.getVersions();
    expect(versions.mcpVersion).toBeNull();
    expect(versions.skillsVersion).toBeNull();
  });

  it("getVersions returns real hashes after start", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    const versions = runtime.getVersions();
    expect(versions.mcpVersion).not.toBeNull();
    expect(versions.mcpVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(versions.skillsVersion).toBeNull(); // no skills configured
  });

  it("emits versions_changed on tool change", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    const changedPromise = new Promise<void>((resolve) => {
      runtime.on("versions_changed", resolve);
    });

    // Update listTools to return different tools
    const mcpInstance = mcpClientInstances[0];
    mcpInstance.listTools.mockResolvedValue([
      { name: "query", description: "Run SQL", inputSchema: { type: "object" } },
      { name: "execute", description: "Execute SQL", inputSchema: { type: "object" } },
    ]);

    // Trigger tools_changed on the MCP client
    mcpInstance.emitter.emit("tools_changed");

    await changedPromise;

    const versions = runtime.getVersions();
    expect(versions.mcpVersion).not.toBeNull();
  });

  it("does not emit when versions unchanged", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    let emitted = false;
    runtime.on("versions_changed", () => { emitted = true; });

    // Trigger tools_changed without changing the actual tools
    const mcpInstance = mcpClientInstances[0];
    mcpInstance.emitter.emit("tools_changed");

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 700));
    expect(emitted).toBe(false);
  });

  it("routes tool calls to correct integration across multiple integrations", async () => {
    const secondIntegration: McpServerConfig = {
      id: "second-db",
      transport: "stdio",
      name: "Second DB",
      description: "Another database",
      command: "npx",
      args: ["-y", "@test/mcp-db2"],
      envVars: {},
    };

    const config = makeConfig([testIntegration, secondIntegration]);
    const runtime = new Runtime(config);
    await runtime.start();

    const tools = await runtime.getTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.id)).toEqual(["test-db", "second-db"]);

    // Both integrations should be callable
    const result = await runtime.callTool("second-db", "query", { sql: "SELECT 2" });
    expect(result.content[0]).toEqual({ type: "text", text: "result" });

    await runtime.stop();
  });

  it("debounces rapid change events", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    let emitCount = 0;
    runtime.on("versions_changed", () => { emitCount++; });

    // Update tools so version will change
    const mcpInstance = mcpClientInstances[0];
    let toolCount = 1;

    // Fire multiple rapid events, each with slightly different tools
    for (let i = 0; i < 5; i++) {
      toolCount++;
      const tools = Array.from({ length: toolCount }, (_, j) => ({
        name: `tool_${j}`,
        description: `Tool ${j}`,
        inputSchema: { type: "object" },
      }));
      mcpInstance.listTools.mockResolvedValue(tools);
      mcpInstance.emitter.emit("tools_changed");
    }

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 800));
    expect(emitCount).toBe(1);
  });
});
