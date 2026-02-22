import type { Integration, ToolResult } from "@journal-edge/types";
import type { IntegrationProvider } from "@journal/gateway";
import { IntegrationNotFoundError, Logger } from "@journal/gateway";
import type { McpConfig } from "./config.js";
import { McpProcess } from "./mcp-process.js";

export class McpRuntime implements IntegrationProvider {
  private processes = new Map<string, McpProcess>();
  private logger: Logger;

  constructor(private config: McpConfig) {
    this.logger = new Logger(config.logLevel);
  }

  async start(): Promise<void> {
    this.logger.info("Starting MCP runtime", {
      integrations: this.config.integrations,
    });

    for (const definition of this.config.mcpServers) {
      const env = this.config.mcpEnvVars.get(definition.id) ?? {};
      const mcpProcess = new McpProcess(definition, env, this.logger);

      mcpProcess.on("crash", (error) => {
        this.logger.error(`Integration "${definition.id}" crashed`, {
          error: error.message,
        });
      });

      await mcpProcess.start();
      this.processes.set(definition.id, mcpProcess);
    }

    this.logger.info("MCP runtime started", {
      integrationCount: this.processes.size,
    });
  }

  async getRegistrations(): Promise<Integration[]> {
    const registrations: Integration[] = [];

    for (const definition of this.config.mcpServers) {
      const mcpProcess = this.processes.get(definition.id);
      if (!mcpProcess || !mcpProcess.isRunning()) continue;

      const tools = await mcpProcess.listTools();
      registrations.push({
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
    const mcpProcess = this.processes.get(integrationId);
    if (!mcpProcess) {
      throw new IntegrationNotFoundError(integrationId);
    }
    if (!mcpProcess.isRunning()) {
      throw new IntegrationNotFoundError(integrationId, "Integration process is not running");
    }

    return mcpProcess.callTool(toolName, args);
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping MCP runtime");
    const stops = Array.from(this.processes.values()).map((p) => p.stop());
    await Promise.allSettled(stops);
    this.processes.clear();
    this.logger.info("MCP runtime stopped");
  }
}
