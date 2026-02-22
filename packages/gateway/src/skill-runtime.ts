import type { SkillRegistration, ToolResult } from "@journal-edge/types";
import type { GatewayConfig } from "./config.js";
import { McpProcess } from "./mcp-process.js";
import { Logger } from "./logger.js";

export class SkillRuntime {
  private processes = new Map<string, McpProcess>();
  private logger: Logger;

  constructor(private config: GatewayConfig) {
    this.logger = new Logger(config.logLevel);
  }

  async start(): Promise<void> {
    this.logger.info("Starting skill runtime", {
      skills: this.config.skills,
    });

    for (const definition of this.config.skillDefinitions) {
      const env = this.config.skillEnvVars.get(definition.id) ?? {};
      const process = new McpProcess(definition, env, this.logger);

      process.on("crash", (error) => {
        this.logger.error(`Skill "${definition.id}" crashed`, {
          error: error.message,
        });
      });

      await process.start();
      this.processes.set(definition.id, process);
    }

    this.logger.info("Skill runtime started", {
      skillCount: this.processes.size,
    });
  }

  async getRegistration(): Promise<SkillRegistration[]> {
    const registrations: SkillRegistration[] = [];

    for (const definition of this.config.skillDefinitions) {
      const process = this.processes.get(definition.id);
      if (!process || !process.isRunning()) continue;

      const tools = await process.listTools();
      registrations.push({
        type: "mcp_server",
        id: definition.id,
        name: definition.name,
        description: definition.description,
        tools,
      });
    }

    return registrations;
  }

  async callTool(
    skillId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const process = this.processes.get(skillId);
    if (!process) {
      throw new SkillNotFoundError(skillId);
    }
    if (!process.isRunning()) {
      throw new SkillNotFoundError(skillId, "Skill process is not running");
    }

    return process.callTool(toolName, args);
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping skill runtime");
    const stops = Array.from(this.processes.values()).map((p) => p.stop());
    await Promise.allSettled(stops);
    this.processes.clear();
    this.logger.info("Skill runtime stopped");
  }
}

export class SkillNotFoundError extends Error {
  constructor(skillId: string, detail?: string) {
    super(detail ?? `Skill "${skillId}" is not registered on this gateway`);
    this.name = "SkillNotFoundError";
  }
}
