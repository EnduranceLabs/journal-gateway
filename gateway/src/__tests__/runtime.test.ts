import { describe, it, expect, vi, beforeEach } from "vitest";
import { Runtime } from "../runtime.js";
import { IntegrationNotFoundError } from "journal-gateway-protocol";
import type { RuntimeConfig, McpServerConfig, GatewayConfigFile } from "../config.js";
import { EventEmitter } from "node:events";

// Track listeners so we can trigger events in tests
const mcpClientInstances: Array<{
  id: string;
  emitter: EventEmitter;
  getTools: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}> = [];
const startFailures = new Map<string, number>();

function failStarts(id: string, count: number): void {
  startFailures.set(id, count);
}

// Mock McpClient
vi.mock("../mcp-client.js", () => {
  return {
    McpClient: vi.fn().mockImplementation((definition) => {
      const emitter = new EventEmitter();
      const getTools = vi.fn().mockReturnValue([
        {
          name: "query",
          description: "Run SQL",
          inputSchema: { type: "object" },
        },
      ]);
      const defaultFailures = definition.id === "broken"
        ? Number.POSITIVE_INFINITY
        : 0;
      const start = vi.fn().mockImplementation(() => {
        const remaining = startFailures.get(definition.id) ?? defaultFailures;
        if (remaining > 0) {
          if (Number.isFinite(remaining)) {
            startFailures.set(definition.id, remaining - 1);
          }
          return Promise.reject(new Error("Connection closed"));
        }
        return Promise.resolve();
      });
      const stop = vi.fn().mockResolvedValue(undefined);
      const instance = {
        start,
        stop,
        getTools,
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "result" }],
        }),
        isRunning: vi.fn().mockReturnValue(true),
        integrationId: definition.id,
        on: emitter.on.bind(emitter),
        off: emitter.off.bind(emitter),
        emit: emitter.emit.bind(emitter),
      };
      mcpClientInstances.push({ id: definition.id, emitter, getTools, stop });
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

// Mock ConfigWatcher
const configWatcherEmitter = new EventEmitter();
const mockConfigWatcher = {
  startWatching: vi.fn(),
  stopWatching: vi.fn(),
  on: configWatcherEmitter.on.bind(configWatcherEmitter),
  off: configWatcherEmitter.off.bind(configWatcherEmitter),
  emit: configWatcherEmitter.emit.bind(configWatcherEmitter),
};

vi.mock("../config-watcher.js", () => {
  return {
    ConfigWatcher: vi.fn().mockImplementation(() => mockConfigWatcher),
  };
});

// Mock EnvFile
const envFileEmitter = new EventEmitter();
const mockEnvFile = {
  load: vi.fn().mockReturnValue({}),
  startWatching: vi.fn(),
  stopWatching: vi.fn(),
  on: envFileEmitter.on.bind(envFileEmitter),
  off: envFileEmitter.off.bind(envFileEmitter),
  emit: envFileEmitter.emit.bind(envFileEmitter),
};

vi.mock("../env-file.js", () => {
  return {
    EnvFile: vi.fn().mockImplementation(() => mockEnvFile),
  };
});

// Mock resolveConfigFile — import after mocking
vi.mock("../config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config.js")>();
  return {
    ...original,
    resolveConfigFile: vi.fn(original.resolveConfigFile),
  };
});

import { resolveConfigFile } from "../config.js";
const mockResolveConfigFile = vi.mocked(resolveConfigFile);

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
    warnings: [],
  };
}

describe("Runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpClientInstances.length = 0;
    startFailures.clear();
    skillClientEmitter.removeAllListeners();
    configWatcherEmitter.removeAllListeners();
    envFileEmitter.removeAllListeners();
    mockSkillClient.getSkills.mockReturnValue([]);
    mockSkillClient.getIntegrations.mockReturnValue([]);
    mockEnvFile.load.mockReturnValue({});
  });

  it("starts all configured integrations", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    const tools = await runtime.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe("test-db");
  });

  it("skips an integration that fails to start and keeps the healthy ones", async () => {
    const broken: McpServerConfig = { ...testIntegration, id: "broken" };
    const runtime = new Runtime(makeConfig([broken, testIntegration]));

    try {
      await expect(runtime.start()).resolves.toBeUndefined();

      const tools = await runtime.getTools();
      expect(tools.map((t) => t.id)).toEqual(["test-db"]);

      // The failed client is stopped (cleanup), the healthy one is not.
      const brokenInstance = mcpClientInstances.find((i) => i.id === "broken");
      expect(brokenInstance).toBeDefined();
    } finally {
      await runtime.stop();
    }
  });

  it("retries an integration that failed during startup", async () => {
    vi.useFakeTimers();
    failStarts("flaky", 1);
    const flaky: McpServerConfig = { ...testIntegration, id: "flaky" };
    const runtime = new Runtime(makeConfig([flaky]));

    try {
      await runtime.start();
      expect(await runtime.getTools()).toHaveLength(0);

      const changedPromise = new Promise<void>((resolve) => {
        runtime.on("versions_changed", resolve);
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(500);
      await changedPromise;

      const tools = await runtime.getTools();
      expect(tools.map((t) => t.id)).toEqual(["flaky"]);
      expect(mcpClientInstances.filter((i) => i.id === "flaky")).toHaveLength(2);
    } finally {
      await runtime.stop();
      vi.useRealTimers();
    }
  });

  it("removes and retries an integration that crashes after startup", async () => {
    vi.useFakeTimers();
    const runtime = new Runtime(makeConfig());

    try {
      await runtime.start();
      expect(await runtime.getTools()).toHaveLength(1);

      const removedPromise = new Promise<void>((resolve) => {
        runtime.once("versions_changed", resolve);
      });

      const crashed = mcpClientInstances[0];
      crashed.emitter.emit("crash", new Error("transport closed"));
      await vi.advanceTimersByTimeAsync(500);
      await removedPromise;

      expect(crashed.stop).toHaveBeenCalled();
      expect(await runtime.getTools()).toHaveLength(0);

      const restoredPromise = new Promise<void>((resolve) => {
        runtime.once("versions_changed", resolve);
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(500);
      await restoredPromise;

      const tools = await runtime.getTools();
      expect(tools.map((t) => t.id)).toEqual(["test-db"]);
      expect(mcpClientInstances.filter((i) => i.id === "test-db")).toHaveLength(2);
    } finally {
      await runtime.stop();
      vi.useRealTimers();
    }
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

    // Update getTools to return different tools
    const mcpInstance = mcpClientInstances[0];
    mcpInstance.getTools.mockReturnValue([
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
      mcpInstance.getTools.mockReturnValue(tools);
      mcpInstance.emitter.emit("tools_changed");
    }

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 800));
    expect(emitCount).toBe(1);
  });
});

describe("Runtime hot-reload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpClientInstances.length = 0;
    startFailures.clear();
    skillClientEmitter.removeAllListeners();
    configWatcherEmitter.removeAllListeners();
    envFileEmitter.removeAllListeners();
    mockSkillClient.getSkills.mockReturnValue([]);
    mockSkillClient.getIntegrations.mockReturnValue([]);
    mockEnvFile.load.mockReturnValue({});
  });

  it("config change adds new server", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    expect(mcpClientInstances).toHaveLength(1);

    // Emit config_changed with an additional server
    const newConfigFile: GatewayConfigFile = {
      mcpServers: [
        { transport: "stdio", id: "test-db", name: "Test DB", description: "A test database integration", command: "npx", args: ["-y", "@test/mcp-db"], envVars: { DATABASE_URL: "DATABASE_URL" } },
        { transport: "stdio", id: "new-server", name: "New Server", description: "", command: "node", args: [], envVars: {} },
      ],
      skillsDir: null,
    };

    mockResolveConfigFile.mockReturnValue({
      mcpServers: [
        { ...testIntegration },
        { id: "new-server", transport: "stdio" as const, name: "New Server", description: "", command: "node", args: [], envVars: {} },
      ],
      mcpEnvVars: new Map([
        ["test-db", { DATABASE_URL: "postgresql://localhost/test" }],
        ["new-server", {}],
      ]),
    });

    configWatcherEmitter.emit("config_changed", newConfigFile);

    // Wait for config reload debounce (500ms) + change check debounce (500ms)
    await new Promise((r) => setTimeout(r, 1200));

    // New server should have been started
    expect(mcpClientInstances).toHaveLength(2);
    expect(mcpClientInstances[1].id).toBe("new-server");

    const tools = await runtime.getTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.id)).toEqual(["test-db", "new-server"]);

    await runtime.stop();
  });

  it("config change removes server", async () => {
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

    expect(mcpClientInstances).toHaveLength(2);

    // Emit config_changed with only the first server
    const newConfigFile: GatewayConfigFile = {
      mcpServers: [
        { transport: "stdio", id: "test-db", name: "Test DB", description: "A test database integration", command: "npx", args: ["-y", "@test/mcp-db"], envVars: { DATABASE_URL: "DATABASE_URL" } },
      ],
      skillsDir: null,
    };

    mockResolveConfigFile.mockReturnValue({
      mcpServers: [{ ...testIntegration }],
      mcpEnvVars: new Map([["test-db", { DATABASE_URL: "postgresql://localhost/test" }]]),
    });

    configWatcherEmitter.emit("config_changed", newConfigFile);

    await new Promise((r) => setTimeout(r, 1200));

    // The removed server's stop should have been called
    const removedInstance = mcpClientInstances.find((i) => i.id === "second-db");
    expect(removedInstance).toBeDefined();

    const tools = await runtime.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe("test-db");

    await runtime.stop();
  });

  it("config change modifies server restarts it", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    const originalInstance = mcpClientInstances[0];

    // Emit config_changed with a modified command
    const modifiedServer: McpServerConfig = {
      ...testIntegration,
      command: "new-command",
    };

    const newConfigFile: GatewayConfigFile = {
      mcpServers: [
        { transport: "stdio", id: "test-db", name: "Test DB", description: "A test database integration", command: "new-command", args: ["-y", "@test/mcp-db"], envVars: { DATABASE_URL: "DATABASE_URL" } },
      ],
      skillsDir: null,
    };

    mockResolveConfigFile.mockReturnValue({
      mcpServers: [modifiedServer],
      mcpEnvVars: new Map([["test-db", { DATABASE_URL: "postgresql://localhost/test" }]]),
    });

    configWatcherEmitter.emit("config_changed", newConfigFile);

    await new Promise((r) => setTimeout(r, 1200));

    // Old client should have been stopped and a new one started
    expect(mcpClientInstances).toHaveLength(2); // original + new
    expect(mcpClientInstances[1].id).toBe("test-db");

    await runtime.stop();
  });

  it("env change restarts affected servers", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    // Env file now returns a different value
    mockEnvFile.load.mockReturnValue({ DATABASE_URL: "postgresql://new-host/test" });

    mockResolveConfigFile.mockReturnValue({
      mcpServers: [{ ...testIntegration }],
      mcpEnvVars: new Map([["test-db", { DATABASE_URL: "postgresql://new-host/test" }]]),
    });

    envFileEmitter.emit("env_changed");

    await new Promise((r) => setTimeout(r, 1200));

    // Server should be restarted due to env change
    expect(mcpClientInstances).toHaveLength(2); // original + restarted
    expect(mcpClientInstances[1].id).toBe("test-db");

    await runtime.stop();
  });

  it("env change with no affected servers does not restart", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    // Env file changes but resolved env is the same
    mockEnvFile.load.mockReturnValue({ UNRELATED_VAR: "value" });

    mockResolveConfigFile.mockReturnValue({
      mcpServers: [{ ...testIntegration }],
      mcpEnvVars: new Map([["test-db", { DATABASE_URL: "postgresql://localhost/test" }]]),
    });

    envFileEmitter.emit("env_changed");

    await new Promise((r) => setTimeout(r, 1200));

    // No restart — still only 1 instance
    expect(mcpClientInstances).toHaveLength(1);

    await runtime.stop();
  });

  it("config resolve error keeps current state", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    // resolveConfigFile throws
    mockResolveConfigFile.mockImplementation(() => {
      throw new Error("Missing env var");
    });

    const newConfigFile: GatewayConfigFile = {
      mcpServers: [
        { transport: "stdio", id: "bad-server", name: "Bad", description: "", command: "echo", args: [], envVars: { MISSING: "MISSING" } },
      ],
      skillsDir: null,
    };

    configWatcherEmitter.emit("config_changed", newConfigFile);

    await new Promise((r) => setTimeout(r, 1200));

    // No change — still 1 instance
    expect(mcpClientInstances).toHaveLength(1);
    const tools = await runtime.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe("test-db");

    await runtime.stop();
  });

  it("emits versions_changed after add/remove", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    const changedPromise = new Promise<void>((resolve) => {
      runtime.on("versions_changed", resolve);
    });

    // Add a new server
    const newConfigFile: GatewayConfigFile = {
      mcpServers: [
        { transport: "stdio", id: "test-db", name: "Test DB", description: "A test database integration", command: "npx", args: ["-y", "@test/mcp-db"], envVars: { DATABASE_URL: "DATABASE_URL" } },
        { transport: "stdio", id: "added", name: "Added", description: "", command: "node", args: [], envVars: {} },
      ],
      skillsDir: null,
    };

    mockResolveConfigFile.mockReturnValue({
      mcpServers: [
        { ...testIntegration },
        { id: "added", transport: "stdio" as const, name: "Added", description: "", command: "node", args: [], envVars: {} },
      ],
      mcpEnvVars: new Map([
        ["test-db", { DATABASE_URL: "postgresql://localhost/test" }],
        ["added", {}],
      ]),
    });

    configWatcherEmitter.emit("config_changed", newConfigFile);

    await changedPromise;

    await runtime.stop();
  });

  it("stop cleans up watchers", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();
    await runtime.stop();

    expect(mockConfigWatcher.stopWatching).toHaveBeenCalled();
    expect(mockEnvFile.stopWatching).toHaveBeenCalled();
  });

  it("env_changed after config_changed within debounce preserves config change", async () => {
    const runtime = new Runtime(makeConfig());
    await runtime.start();

    expect(mcpClientInstances).toHaveLength(1);

    // Config change adds a new server
    const newConfigFile: GatewayConfigFile = {
      mcpServers: [
        { transport: "stdio", id: "test-db", name: "Test DB", description: "A test database integration", command: "npx", args: ["-y", "@test/mcp-db"], envVars: { DATABASE_URL: "DATABASE_URL" } },
        { transport: "stdio", id: "new-server", name: "New Server", description: "", command: "node", args: [], envVars: {} },
      ],
      skillsDir: null,
    };

    mockResolveConfigFile.mockReturnValue({
      mcpServers: [
        { ...testIntegration },
        { id: "new-server", transport: "stdio" as const, name: "New Server", description: "", command: "node", args: [], envVars: {} },
      ],
      mcpEnvVars: new Map([
        ["test-db", { DATABASE_URL: "postgresql://localhost/test" }],
        ["new-server", {}],
      ]),
    });

    // Fire config_changed, then env_changed within the debounce window
    configWatcherEmitter.emit("config_changed", newConfigFile);
    envFileEmitter.emit("env_changed");

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 1200));

    // The config change should NOT be lost — new server should appear
    expect(mcpClientInstances).toHaveLength(2);
    expect(mcpClientInstances[1].id).toBe("new-server");

    // resolveConfigFile should have been called with the new config file, not the old one
    expect(mockResolveConfigFile).toHaveBeenLastCalledWith(
      newConfigFile,
      expect.anything()
    );

    await runtime.stop();
  });
});
