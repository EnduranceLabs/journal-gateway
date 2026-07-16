import {
  IntegrationNotFoundError,
  type Integration,
  type Skill,
  type ToolResult,
  type IntegrationProvider,
  type GatewayVersions,
} from "journal-gateway-protocol";
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

const MCP_RETRY_INITIAL_MS = 5_000;
const MCP_RETRY_MAX_MS = 60_000;
const MCP_RETRY_MULTIPLIER = 2;

interface McpRetryState {
  definition: McpServerConfig;
  env: Record<string, string>;
  attempt: number;
  timer: ReturnType<typeof setTimeout>;
}

export class Runtime extends EventEmitter<RuntimeEvents> implements IntegrationProvider {
  private processes = new Map<string, McpClient>();
  private retrying = new Map<string, McpRetryState>();
  private logger: Logger;
  private skillClient: SkillClient;
  private mcpVersion: string | null = null;
  private skillsVersion: string | null = null;
  private changeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private telemetry: Telemetry | null = null;
  private audit: AuditLogger | null = null;

  private configWatcher: ConfigWatcher;
  private envFile: EnvFile;
  private currentConfigFile: GatewayConfigFile;
  private configReloadTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingConfigFile: GatewayConfigFile | undefined;
  private stopped = true;

  constructor(
    private config: RuntimeConfig,
    configFilePath?: string | null,
    envFilePath?: string | null,
    private observers?: { telemetry?: Telemetry | null; audit?: AuditLogger | null }
  ) {
    super();
    this.logger = new Logger(config.logLevel);
    this.skillClient = new SkillClient(config.skillsDir, this.logger);
    this.configWatcher = new ConfigWatcher(configFilePath ?? null, this.logger);
    this.envFile = new EnvFile(envFilePath ?? null);
    this.telemetry = observers?.telemetry ?? null;
    this.audit = observers?.audit ?? null;

    // Build initial config file snapshot
    this.currentConfigFile = {
      mcpServers: [...config.mcpServers],
      skillsDir: config.skillsDir,
    };
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.logger.info("Starting runtime", {
      mcpServers: this.config.mcpServers.map((s) => s.id),
      ...(this.config.skillsDir ? { skillsDir: this.config.skillsDir } : {}),
    });

    for (const definition of this.config.mcpServers) {
      const env = this.config.mcpEnvVars.get(definition.id) ?? {};
      await this.startMcpClientWithRetry(definition, env, {
        failureMessage: `Failed to start integration "${definition.id}", skipping for now`,
      });
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
    this.stopped = true;
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
    for (const id of Array.from(this.retrying.keys())) {
      this.cancelMcpRetry(id);
    }

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
      this.handleMcpCrash(definition, env, mcpClient, error).catch((err) => {
        this.logger.error(`Error handling crash for integration "${definition.id}"`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    mcpClient.on("tools_changed", () => {
      this.logger.info(`Integration "${definition.id}" tools changed`);
      this.scheduleChangeCheck();
    });

    try {
      await mcpClient.start();
    } catch (err) {
      await mcpClient.stop().catch(() => {});
      throw err;
    }
    await this.audit?.log({
      type: "process",
      action: "start",
      integrationId: definition.id,
    });
    this.processes.set(definition.id, mcpClient);
  }

  private async handleMcpCrash(
    definition: McpServerConfig,
    env: Record<string, string>,
    mcpClient: McpClient,
    error: Error
  ): Promise<void> {
    if (this.processes.get(definition.id) !== mcpClient) return;

    this.logger.error(`Integration "${definition.id}" crashed`, {
      error: error.message,
    });
    this.processes.delete(definition.id);
    await this.audit?.log({
      type: "process",
      action: "stop",
      integrationId: definition.id,
    });
    await mcpClient.stop().catch(() => {});
    this.scheduleChangeCheck();

    if (!this.stopped) {
      this.scheduleMcpRetry(definition, env, 1);
    }
  }

  private async startMcpClientWithRetry(
    definition: McpServerConfig,
    env: Record<string, string>,
    options: {
      failureMessage: string;
      attempt?: number;
      notifyOnSuccess?: boolean;
    }
  ): Promise<boolean> {
    try {
      await this.startMcpClient(definition, env);
      this.cancelMcpRetry(definition.id);
      if (options.notifyOnSuccess) {
        this.scheduleChangeCheck();
      }
      return true;
    } catch (err) {
      this.logger.error(options.failureMessage, {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!this.stopped) {
        this.scheduleMcpRetry(definition, env, (options.attempt ?? 0) + 1);
      }
      return false;
    }
  }

  private scheduleMcpRetry(
    definition: McpServerConfig,
    env: Record<string, string>,
    attempt: number
  ): void {
    this.cancelMcpRetry(definition.id);

    const delay = Math.min(
      MCP_RETRY_INITIAL_MS * MCP_RETRY_MULTIPLIER ** Math.max(0, attempt - 1),
      MCP_RETRY_MAX_MS
    );
    const timer = setTimeout(() => {
      const retry = this.retrying.get(definition.id);
      if (!retry || this.stopped) return;
      if (this.processes.has(definition.id)) {
        this.cancelMcpRetry(definition.id);
        return;
      }

      this.retrying.delete(definition.id);
      this.logger.info(`Retrying MCP server "${definition.id}"`, {
        attempt,
      });
      this.startMcpClientWithRetry(retry.definition, retry.env, {
        attempt,
        notifyOnSuccess: true,
        failureMessage: `Retry failed for integration "${definition.id}"`,
      }).catch((err) => {
        this.logger.error(`Retry failed for integration "${definition.id}"`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, delay);
    (timer as { unref?: () => void }).unref?.();

    this.retrying.set(definition.id, { definition, env, attempt, timer });
  }

  private cancelMcpRetry(id: string): void {
    const retry = this.retrying.get(id);
    if (!retry) return;
    clearTimeout(retry.timer);
    this.retrying.delete(id);
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
    const currentServerMap = new Map(this.config.mcpServers.map((s) => [s.id, s]));

    // Determine removed, added, and potentially changed servers
    const removed = [...currentIds].filter((id) => !newIds.has(id));
    const added = [...newIds].filter((id) => !currentIds.has(id));
    const common = [...currentIds].filter((id) => newIds.has(id));

    // Stop removed servers
    for (const id of removed) {
      this.logger.info(`Removing MCP server "${id}"`);
      this.cancelMcpRetry(id);
      await this.stopMcpClient(id);
    }

    // Check common servers for config or env changes
    for (const id of common) {
      const oldServer = currentServerMap.get(id)!;
      const newServer = newServerMap.get(id)!;
      const oldEnv = this.config.mcpEnvVars.get(id) ?? {};
      const newResolvedEnv = mcpEnvVars.get(id) ?? {};

      if (
        !serverConfigEqual(oldServer, newServer) ||
        !envEqual(oldEnv, newResolvedEnv)
      ) {
        this.logger.info(`Restarting MCP server "${id}" due to config/env change`);
        this.cancelMcpRetry(id);
        await this.stopMcpClient(id);
        await this.startMcpClientWithRetry(newServer, newResolvedEnv, {
          failureMessage: `Failed to restart MCP server "${id}"`,
        });
      }
    }

    // Start added servers
    for (const id of added) {
      const server = newServerMap.get(id)!;
      const resolvedEnv = mcpEnvVars.get(id) ?? {};
      this.logger.info(`Adding MCP server "${id}"`);
      await this.startMcpClientWithRetry(server, resolvedEnv, {
        failureMessage: `Failed to start MCP server "${id}"`,
      });
    }

    // Update current state
    this.config.mcpServers = mcpServers;
    this.config.mcpEnvVars = mcpEnvVars;
    this.currentConfigFile = configFile;

    // Recompute versions and notify
    this.scheduleChangeCheck();
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
