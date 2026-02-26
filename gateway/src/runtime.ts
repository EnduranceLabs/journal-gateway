import {
  IntegrationNotFoundError,
  type Integration,
  type Skill,
  type ToolResult,
  type IntegrationProvider,
  type GatewayVersions,
} from "@journal.one/gateway-protocol";
import { EventEmitter } from "node:events";
import { Logger } from "./common/logger.js";
import {
  type RuntimeConfig,
  type McpServerConfig,
  type GatewayConfigFile,
  resolveConfigFile,
} from "./config.js";
import { McpClient } from "./mcp-client.js";
import { SkillClient } from "./skill-client.js";
import { computeVersionHash } from "./version-hash.js";
import { ConfigWatcher } from "./config-watcher.js";
import { EnvFile } from "./env-file.js";
import { Telemetry } from "./telemetry.js";
import { AuditLogger } from "./audit.js";

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
  private telemetry: Telemetry | null = null;
  private audit: AuditLogger | null = null;

  private configWatcher: ConfigWatcher;
  private envFile: EnvFile;
  private currentEnv: Record<string, string | undefined>;
  private currentConfigFile: GatewayConfigFile;
  private configReloadTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingConfigFile: GatewayConfigFile | undefined;

  constructor(
    private config: RuntimeConfig,
    configFilePath?: string | null,
    envFilePath?: string | null,
    private observers?: { telemetry?: Telemetry | null; audit?: AuditLogger | null }
  ) {
    super();
    this.logger = new Logger(config.logLevel);
    this.skillClient = new SkillClient(config.skillsDir);
    this.configWatcher = new ConfigWatcher(configFilePath ?? null);
    this.envFile = new EnvFile(envFilePath ?? null);
    this.telemetry = observers?.telemetry ?? null;
    this.audit = observers?.audit ?? null;

    // Build initial env and config file snapshot
    const envVars = this.envFile.load();
    this.currentEnv = { ...envVars, ...process.env };
    this.currentConfigFile = {
      mcpServers: config.mcpServers.map((s) => this.toConfigFileServer(s)),
      skillsDir: config.skillsDir,
    };
  }

  async start(): Promise<void> {
    this.logger.info("Starting runtime", {
      mcpServers: this.config.mcpServers.map((s) => s.id),
      ...(this.config.skillsDir ? { skillsDir: this.config.skillsDir } : {}),
    });

    for (const definition of this.config.mcpServers) {
      const env = this.config.mcpEnvVars.get(definition.id) ?? {};
      await this.startMcpClient(definition, env);
    }

    await this.skillClient.load();

    this.skillClient.on("skills_changed", () => {
      this.logger.info("Skills changed on disk");
      this.scheduleChangeCheck();
    });
    this.skillClient.startWatching();

    // Subscribe to config file changes
    this.configWatcher.on("config_changed", (configFile) => {
      this.logger.info("Config file changed on disk");
      this.scheduleConfigReload(configFile);
    });
    this.configWatcher.startWatching();

    // Subscribe to env file changes
    this.envFile.on("env_changed", () => {
      this.logger.info("Env file changed on disk");
      this.scheduleConfigReload();
    });
    this.envFile.startWatching();

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

  getTools(): Integration[] {
    const integrations: Integration[] = [];

    for (const definition of this.config.mcpServers) {
      const mcpClient = this.processes.get(definition.id);
      if (!mcpClient) continue;

      const tools = mcpClient.getTools();
      if (tools.length === 0 && !mcpClient.isRunning()) continue;

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

    if (this.configReloadTimer) {
      clearTimeout(this.configReloadTimer);
      this.configReloadTimer = null;
    }

    this.configWatcher.stopWatching();
    this.envFile.stopWatching();
    this.skillClient.stopWatching();

    const stops = Array.from(this.processes.values()).map((p) => p.stop());
    await Promise.allSettled(stops);
    this.processes.clear();
    this.logger.info("Runtime stopped");
  }

  private async startMcpClient(
    definition: McpServerConfig,
    env: Record<string, string>
  ): Promise<void> {
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
    await this.audit?.log({
      type: "process",
      action: "start",
      integrationId: definition.id,
    });
    this.processes.set(definition.id, mcpClient);
  }

  private async stopMcpClient(id: string): Promise<void> {
    const client = this.processes.get(id);
    if (client) {
      await client.stop();
      this.processes.delete(id);
      await this.audit?.log({
        type: "process",
        action: "stop",
        integrationId: id,
      });
    }
  }

  private scheduleConfigReload(configFile?: GatewayConfigFile): void {
    // Preserve the most recent config file across debounced calls.
    // An env_changed (no configFile) should not erase a pending config_changed.
    if (configFile) {
      this.pendingConfigFile = configFile;
    }
    if (this.configReloadTimer) clearTimeout(this.configReloadTimer);
    this.configReloadTimer = setTimeout(() => {
      this.configReloadTimer = null;
      const pending = this.pendingConfigFile;
      this.pendingConfigFile = undefined;
      this.processChanges(pending).catch((err) => {
        this.logger.error("Config reload failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 500);
  }

  private async processChanges(newConfigFile?: GatewayConfigFile): Promise<void> {
    // Rebuild env: .env file values + process.env (process.env wins)
    const envVars = this.envFile.load();
    const newEnv: Record<string, string | undefined> = { ...envVars, ...process.env };

    // Use new config file if provided, otherwise use current
    const configFile = newConfigFile ?? this.currentConfigFile;

    // Re-resolve config against new env
    let mcpServers: McpServerConfig[];
    let mcpEnvVars: Map<string, Record<string, string>>;
    try {
      const resolved = resolveConfigFile(configFile, newEnv);
      mcpServers = resolved.mcpServers;
      mcpEnvVars = resolved.mcpEnvVars;
    } catch (err) {
      this.logger.warn("Failed to resolve config, keeping current state", {
        error: err instanceof Error ? err.message : String(err),
      });
      await this.audit?.log({
        type: "config",
        source: newConfigFile ? "config_file" : "env_file",
        status: "skipped",
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    await this.audit?.log({
      type: "config",
      source: newConfigFile ? "config_file" : "env_file",
      status: "applied",
    });

    // Warn if skillsDir changed
    if (configFile.skillsDir !== this.currentConfigFile.skillsDir) {
      this.logger.warn(
        "skillsDir changes are not hot-reloaded. Restart the gateway to apply."
      );
    }

    // Build lookup maps for diffing
    const currentIds = new Set(this.config.mcpServers.map((s) => s.id));
    const newIds = new Set(mcpServers.map((s) => s.id));
    const newServerMap = new Map(mcpServers.map((s) => [s.id, s]));
    const newEnvMap = mcpEnvVars;
    const currentServerMap = new Map(this.config.mcpServers.map((s) => [s.id, s]));

    // Determine removed, added, and potentially changed servers
    const removed = [...currentIds].filter((id) => !newIds.has(id));
    const added = [...newIds].filter((id) => !currentIds.has(id));
    const common = [...currentIds].filter((id) => newIds.has(id));

    // Stop removed servers
    for (const id of removed) {
      this.logger.info(`Removing MCP server "${id}"`);
      await this.stopMcpClient(id);
    }

    // Check common servers for config or env changes
    for (const id of common) {
      const oldServer = currentServerMap.get(id)!;
      const newServer = newServerMap.get(id)!;
      const oldEnv = this.config.mcpEnvVars.get(id) ?? {};
      const newResolvedEnv = newEnvMap.get(id) ?? {};

      if (
        !serverConfigEqual(oldServer, newServer) ||
        !envEqual(oldEnv, newResolvedEnv)
      ) {
        this.logger.info(`Restarting MCP server "${id}" due to config/env change`);
        await this.stopMcpClient(id);
        try {
          await this.startMcpClient(newServer, newResolvedEnv);
        } catch (err) {
          this.logger.error(`Failed to restart MCP server "${id}"`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Start added servers
    for (const id of added) {
      const server = newServerMap.get(id)!;
      const resolvedEnv = newEnvMap.get(id) ?? {};
      this.logger.info(`Adding MCP server "${id}"`);
      try {
        await this.startMcpClient(server, resolvedEnv);
      } catch (err) {
        this.logger.error(`Failed to start MCP server "${id}"`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Update current state
    this.config.mcpServers = mcpServers;
    this.config.mcpEnvVars = mcpEnvVars;
    this.currentConfigFile = configFile;
    this.currentEnv = newEnv;

    // Recompute versions and notify
    this.scheduleChangeCheck();
  }

  /**
   * Convert a McpServerConfig back to the shape stored in GatewayConfigFile.
   * Used to build the initial currentConfigFile snapshot.
   */
  private toConfigFileServer(
    server: McpServerConfig
  ): GatewayConfigFile["mcpServers"][number] {
    return server;
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
    const mcpIntegrations = this.getTools();
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

function serverConfigEqual(a: McpServerConfig, b: McpServerConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function envEqual(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i] || a[aKeys[i]] !== b[bKeys[i]]) return false;
  }
  return true;
}
