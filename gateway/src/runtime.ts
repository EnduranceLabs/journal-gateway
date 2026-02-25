import {
  IntegrationNotFoundError,
  type Integration,
  type Skill,
  type ToolResult,
  type IntegrationProvider,
  type GatewayVersions,
} from "@journal/gateway-protocol";
import { EventEmitter } from "node:events";
import { Logger } from "./common/logger.js";
import type { RuntimeConfig } from "./config.js";
import { McpClient } from "./mcp-client.js";
import { SkillClient } from "./skill-client.js";
import { computeVersionHash } from "./version-hash.js";

export interface RuntimeEvents {
  versions_changed: [];
}

export class Runtime extends EventEmitter<RuntimeEvents> implements IntegrationProvider {
  private processes = new Map<string, McpClient>();
  private logger: Logger;
  private skillClient: SkillClient;
  private mcpVersion: string | null = null;
  private skillsVersion: string | null = null;
  private changeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private config: RuntimeConfig) {
    super();
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
        this.scheduleChangeCheck();
      });

      mcpClient.on("tools_changed", () => {
        this.logger.info(`Integration "${definition.id}" tools changed`);
        this.scheduleChangeCheck();
      });

      await mcpClient.start();
      this.processes.set(definition.id, mcpClient);
    }

    await this.skillClient.load();

    this.skillClient.on("skills_changed", () => {
      this.logger.info("Skills changed on disk");
      this.scheduleChangeCheck();
    });
    this.skillClient.startWatching();

    // Compute initial versions
    await this.recomputeVersions();

    this.logger.info("Runtime started", {
      integrationCount: this.processes.size,
    });
  }

  getVersions(): GatewayVersions {
    return {
      mcpVersion: this.mcpVersion,
      skillsVersion: this.skillsVersion,
    };
  }

  async getTools(): Promise<Integration[]> {
    const integrations: Integration[] = [];

    for (const definition of this.config.mcpServers) {
      const mcpClient = this.processes.get(definition.id);
      if (!mcpClient || !mcpClient.isRunning()) continue;

      const tools = await mcpClient.listTools();
      integrations.push({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        tools,
      });
    }

    return integrations;
  }

  getSkills(): Skill[] {
    return this.skillClient.getSkills();
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

    if (this.changeDebounceTimer) {
      clearTimeout(this.changeDebounceTimer);
      this.changeDebounceTimer = null;
    }

    this.skillClient.stopWatching();

    const stops = Array.from(this.processes.values()).map((p) => p.stop());
    await Promise.allSettled(stops);
    this.processes.clear();
    this.logger.info("Runtime stopped");
  }

  private scheduleChangeCheck(): void {
    if (this.changeDebounceTimer) clearTimeout(this.changeDebounceTimer);
    this.changeDebounceTimer = setTimeout(async () => {
      this.changeDebounceTimer = null;
      const changed = await this.recomputeVersions();
      if (changed) {
        this.emit("versions_changed");
      }
    }, 500);
  }

  private async recomputeVersions(): Promise<boolean> {
    const mcpIntegrations = await this.getTools();
    const skillIntegrations = this.skillClient.getIntegrations();

    const newMcpVersion = computeVersionHash(mcpIntegrations);
    const newSkillsVersion = computeVersionHash(skillIntegrations);

    const changed =
      newMcpVersion !== this.mcpVersion ||
      newSkillsVersion !== this.skillsVersion;

    this.mcpVersion = newMcpVersion;
    this.skillsVersion = newSkillsVersion;

    return changed;
  }
}
