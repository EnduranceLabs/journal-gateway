import type { Integration, ToolResult } from "@journal-edge/types";
import type { GatewayConfig } from "./config.js";
import { McpProcess } from "./mcp-process.js";
import { Logger } from "./logger.js";

export class ToolRuntime {
  private processes = new Map<string, McpProcess>();
  private logger: Logger;

  constructor(private config: GatewayConfig) {
    this.logger = new Logger(config.logLevel);
  }

  async start(): Promise<void> {
    this.logger.info("Starting tool runtime", {
      integrations: this.config.integrations,
    });

    for (const definition of this.config.mcpServers) {
      const env = this.config.mcpEnvVars.get(definition.id) ?? {};
      const process = new McpProcess(definition, env, this.logger);

      process.on("crash", (error) => {
        this.logger.error(`Integration "${definition.id}" crashed`, {
          error: error.message,
        });
      });

      await process.start();
      this.processes.set(definition.id, process);
    }

    this.logger.info("Tool runtime started", {
      integrationCount: this.processes.size,
    });
  }

  async getRegistration(): Promise<Integration[]> {
    const registrations: Integration[] = [];

    for (const definition of this.config.mcpServers) {
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
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const process = this.processes.get(integrationId);
    if (!process) {
      throw new IntegrationNotFoundError(integrationId);
    }
    if (!process.isRunning()) {
      throw new IntegrationNotFoundError(integrationId, "Integration process is not running");
    }

    return process.callTool(toolName, args);
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping tool runtime");
    const stops = Array.from(this.processes.values()).map((p) => p.stop());
    await Promise.allSettled(stops);
    this.processes.clear();
    this.logger.info("Tool runtime stopped");
  }
}

export class IntegrationNotFoundError extends Error {
  constructor(integrationId: string, detail?: string) {
    super(detail ?? `Integration "${integrationId}" is not registered on this gateway`);
    this.name = "IntegrationNotFoundError";
  }
}
