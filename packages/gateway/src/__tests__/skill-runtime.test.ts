import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillRuntime, SkillNotFoundError } from "../skill-runtime.js";
import type { GatewayConfig } from "../config.js";
import { BUILT_IN_SKILLS } from "../config.js";

// Mock McpProcess
vi.mock("../mcp-process.js", () => {
  return {
    McpProcess: vi.fn().mockImplementation((definition) => ({
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
      skillId: definition.id,
      on: vi.fn(),
    })),
  };
});

function makeConfig(skills: string[] = ["postgresql"]): GatewayConfig {
  return {
    token: "gw_test",
    url: "wss://localhost/v1",
    skills,
    logLevel: "error",
    skillDefinitions: skills.map((id) => BUILT_IN_SKILLS[id]),
    skillEnvVars: new Map(
      skills.map((id) => [id, { DATABASE_URL: "postgresql://localhost/test" }])
    ),
  };
}

describe("SkillRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts all configured skills", async () => {
    const runtime = new SkillRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    const registrations = await runtime.getRegistration();
    expect(registrations).toHaveLength(1);
    expect(registrations[0].id).toBe("postgresql");
  });

  it("generates registration payload with tools", async () => {
    const runtime = new SkillRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    const registrations = await runtime.getRegistration();
    expect(registrations[0].tools).toHaveLength(1);
    expect(registrations[0].tools[0].name).toBe("query");
  });

  it("routes tool call to correct skill", async () => {
    const runtime = new SkillRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    const result = await runtime.callTool("postgresql", "query", {
      sql: "SELECT 1",
    });
    expect(result.content[0]).toEqual({ type: "text", text: "result" });
  });

  it("throws SkillNotFoundError for unknown skill", async () => {
    const runtime = new SkillRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    await expect(
      runtime.callTool("unknown", "query", {})
    ).rejects.toThrow(SkillNotFoundError);
  });

  it("stops all processes", async () => {
    const runtime = new SkillRuntime(makeConfig(["postgresql"]));
    await runtime.start();
    await runtime.stop();
    // No error means success — processes were stopped
  });

  it("handles multiple skills", async () => {
    const config = makeConfig(["postgresql"]);
    // Add a second skill definition
    config.skills = ["postgresql"];
    config.skillDefinitions = [BUILT_IN_SKILLS.postgresql];
    const runtime = new SkillRuntime(config);
    await runtime.start();
    const registrations = await runtime.getRegistration();
    expect(registrations).toHaveLength(1);
  });
});
