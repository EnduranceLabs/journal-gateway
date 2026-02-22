import type { Integration, ToolResult } from "./types/index.js";
import type { IntegrationProvider } from "./types/index.js";
import { IntegrationNotFoundError } from "./types/index.js";
import { Logger } from "./common/logger.js";
import type { RuntimeConfig } from "./config.js";
import { McpClient } from "./mcp-client.js";
import { SkillClient } from "./skill-client.js";

export class Runtime implements IntegrationProvider {
  private processes = new Map<string, McpClient>();
  private logger: Logger;
  private skillClient: SkillClient;

  constructor(private config: RuntimeConfig) {
    this.logger = new Logger(config.logLevel);
    this.skillClient = new SkillClient(config.skillsDir);
  }

  async start(): Promise<void> {
    this.logger.info("Starting runtime", {
      mcpServers: this.config.mcpServers.map((s) => s.id),
      ...(this.config.skillsDir ? { skillsDir: this.config.skillsDir } : {}),
    });

    for (const definition of this.config.mcpServers) {
      const env = this.config.mcpEnvVars.get(definition.id) ?? {};
      const mcpClient = new McpClient(definition, env, this.logger);

      mcpClient.on("crash", (error) => {
        this.logger.error(`Integration "${definition.id}" crashed`, {
          error: error.message,
        });
      });

      await mcpClient.start();
      this.processes.set(definition.id, mcpClient);
    }

    await this.skillClient.load();

    this.logger.info("Runtime started", {
      integrationCount: this.processes.size,
    });
  }

  async getRegistrations(): Promise<Integration[]> {
    const registrations: Integration[] = [];

    for (const definition of this.config.mcpServers) {
      const mcpClient = this.processes.get(definition.id);
      if (!mcpClient || !mcpClient.isRunning()) continue;

      const tools = await mcpClient.listTools();
      registrations.push({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        tools,
      });
    }

    return [...registrations, ...this.skillClient.getIntegrations()];
  }

  async callTool(
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const mcpClient = this.processes.get(integrationId);
    if (!mcpClient) {
      throw new IntegrationNotFoundError(integrationId);
    }
    if (!mcpClient.isRunning()) {
      throw new IntegrationNotFoundError(integrationId, "Integration process is not running");
    }

    return mcpClient.callTool(toolName, args);
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping runtime");
    const stops = Array.from(this.processes.values()).map((p) => p.stop());
    await Promise.allSettled(stops);
    this.processes.clear();
    this.logger.info("Runtime stopped");
  }
}
