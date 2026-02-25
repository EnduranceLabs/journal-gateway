import { WebSocketServer, WebSocket } from "ws";
import type { Integration, ToolDefinition, ToolResult, Skill } from "./types.js";
import { GatewayMessageSchema } from "./types.js";

export interface TokenValidationResult {
  organizationId: string;
  organizationName?: string;
}

export interface GatewayServerOptions {
  port?: number;
  validateToken: (token: string) => Promise<TokenValidationResult | null>;
  pingIntervalMs?: number;
  pullTimeoutMs?: number;
}

export interface ConnectedGateway {
  id: string;
  organizationId: string;
  protocolVersion: number;
  gatewayVersion: string;
  integrations: Integration[];
  mcpVersion: string | null;
  skillsVersion: string | null;
}

interface PendingCall {
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingPull {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface GatewayEntry {
  ws: WebSocket;
  gateway: ConnectedGateway;
  pending: Map<string, PendingCall>;
  pendingPulls: Map<string, PendingPull>;
  pongTimer: ReturnType<typeof setTimeout> | null;
}

export class GatewayServer {
  private wss: WebSocketServer | null = null;
  private gateways = new Map<string, GatewayEntry>();
  private _port: number;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connCounter = 0;
  private reqCounter = 0;
  private pullCounter = 0;
  private pullTimeoutMs: number;

  constructor(private options: GatewayServerOptions) {
    this._port = options.port ?? 0;
    this.pullTimeoutMs = options.pullTimeoutMs ?? 30_000;
  }

  get port(): number {
    return this._port;
  }

  get url(): string {
    return `ws://localhost:${this._port}`;
  }

  get connectedGateways(): ConnectedGateway[] {
    return Array.from(this.gateways.values()).map((g) => g.gateway);
  }

  get availableTools(): Array<{
    integrationId: string;
    name: string;
    description: string;
  }> {
    const tools: Array<{
      integrationId: string;
      name: string;
      description: string;
    }> = [];
    for (const { gateway } of this.gateways.values()) {
      for (const integration of gateway.integrations) {
        for (const tool of integration.tools) {
          tools.push({
            integrationId: integration.id,
            name: tool.name,
            description: tool.description,
          });
        }
      }
    }
    return tools;
  }

  onGatewayConnected?: (gateway: ConnectedGateway) => void;
  onGatewayUpdated?: (gateway: ConnectedGateway) => void;
  onGatewayDisconnected?: (gateway: ConnectedGateway) => void;

  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wss = new WebSocketServer({ port: this._port }, () => {
        const addr = this.wss!.address();
        if (typeof addr === "object" && addr !== null) {
          this._port = addr.port;
        }
        resolve();
      });

      this.wss.on("connection", (ws) => this.handleConnection(ws));

      const interval = this.options.pingIntervalMs ?? 30_000;
      if (interval > 0) {
        this.pingTimer = setInterval(() => this.sendPings(), interval);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    for (const entry of this.gateways.values()) {
      if (entry.pongTimer) clearTimeout(entry.pongTimer);
      for (const pending of entry.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Server shutting down"));
      }
      for (const pull of entry.pendingPulls.values()) {
        clearTimeout(pull.timer);
        pull.reject(new Error("Server shutting down"));
      }
      entry.ws.close();
    }
    this.gateways.clear();

    return new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  async callTool(
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = 90_000
  ): Promise<ToolResult> {
    let targetEntry: GatewayEntry | undefined;
    for (const entry of this.gateways.values()) {
      if (entry.gateway.integrations.some((i) => i.id === integrationId)) {
        targetEntry = entry;
        break;
      }
    }

    if (!targetEntry) {
      throw new Error(`No gateway has integration "${integrationId}"`);
    }

    const requestId = `req_${++this.reqCounter}`;
    const entry = targetEntry;

    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(requestId);
        reject(new Error(`Tool call timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      entry.pending.set(requestId, { resolve, reject, timer });

      entry.ws.send(
        JSON.stringify({
          type: "tool_call",
          requestId,
          integrationId,
          toolName,
          arguments: args,
        })
      );
    });
  }

  /** Check if any gateway is connected for the given organization. */
  hasGatewayForOrg(organizationId: string): boolean {
    for (const { gateway } of this.gateways.values()) {
      if (gateway.organizationId === organizationId) return true;
    }
    return false;
  }

  /** Get all connected gateways for an organization. */
  getGatewaysForOrg(organizationId: string): ConnectedGateway[] {
    const result: ConnectedGateway[] = [];
    for (const { gateway } of this.gateways.values()) {
      if (gateway.organizationId === organizationId) {
        result.push(gateway);
      }
    }
    return result;
  }

  /** Get deduplicated tools across all gateways for an organization. */
  getToolsForOrg(
    organizationId: string
  ): Array<{ integrationId: string; tool: ToolDefinition }> {
    const seen = new Set<string>();
    const tools: Array<{ integrationId: string; tool: ToolDefinition }> = [];
    for (const { gateway } of this.gateways.values()) {
      if (gateway.organizationId !== organizationId) continue;
      for (const integration of gateway.integrations) {
        for (const tool of integration.tools) {
          const key = `${integration.id}.${tool.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            tools.push({ integrationId: integration.id, tool });
          }
        }
      }
    }
    return tools;
  }

  /** Pull current versions from a gateway. */
  async getVersions(gatewayId: string): Promise<{ mcpVersion: string | null; skillsVersion: string | null }> {
    const data = await this.sendPull(gatewayId, "get_versions");
    return data as { mcpVersion: string | null; skillsVersion: string | null };
  }

  /** Pull tools from a gateway. */
  async getTools(gatewayId: string): Promise<{ integrations: Integration[]; mcpVersion: string | null }> {
    const data = await this.sendPull(gatewayId, "get_tools");
    return data as { integrations: Integration[]; mcpVersion: string | null };
  }

  /** Pull skills from a gateway. */
  async getSkills(gatewayId: string): Promise<{ skills: Skill[]; skillsVersion: string | null }> {
    const data = await this.sendPull(gatewayId, "get_skills");
    return data as { skills: Skill[]; skillsVersion: string | null };
  }

  /**
   * Call a tool on any gateway for the given organization that provides the
   * requested integration. Picks a random candidate for load balancing and
   * retries on a different one if the call fails with a connection error.
   */
  async callToolForOrg(
    organizationId: string,
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = 90_000
  ): Promise<ToolResult> {
    const candidates: GatewayEntry[] = [];
    for (const entry of this.gateways.values()) {
      if (
        entry.gateway.organizationId === organizationId &&
        entry.gateway.integrations.some((i) => i.id === integrationId)
      ) {
        candidates.push(entry);
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        `No gateway for org "${organizationId}" has integration "${integrationId}"`
      );
    }

    // Shuffle candidates for load balancing
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    let lastError: Error | undefined;
    for (const entry of candidates) {
      try {
        return await this.callToolOnEntry(
          entry,
          integrationId,
          toolName,
          args,
          timeoutMs
        );
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry on connection-level errors
        if (!lastError.message.includes("Gateway disconnected")) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error("All gateway candidates failed");
  }

  private callToolOnEntry(
    entry: GatewayEntry,
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<ToolResult> {
    const requestId = `req_${++this.reqCounter}`;

    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(requestId);
        reject(new Error(`Tool call timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      entry.pending.set(requestId, { resolve, reject, timer });

      entry.ws.send(
        JSON.stringify({
          type: "tool_call",
          requestId,
          integrationId,
          toolName,
          arguments: args,
        })
      );
    });
  }

  private sendPull(gatewayId: string, type: string): Promise<unknown> {
    const entry = this.gateways.get(gatewayId);
    if (!entry) {
      return Promise.reject(new Error(`Gateway "${gatewayId}" not found`));
    }

    const requestId = `pull_${++this.pullCounter}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pendingPulls.delete(requestId);
        reject(new Error(`Pull ${type} timed out`));
      }, this.pullTimeoutMs);

      entry.pendingPulls.set(requestId, { resolve, reject, timer });

      entry.ws.send(JSON.stringify({ type, requestId }));
    });
  }

  private async autoPull(connId: string): Promise<void> {
    const entry = this.gateways.get(connId);
    if (!entry) return;

    const pulls: Promise<void>[] = [];

    if (entry.gateway.mcpVersion !== null) {
      pulls.push(this.pullTools(connId));
    }
    if (entry.gateway.skillsVersion !== null) {
      pulls.push(this.pullSkills(connId));
    }

    await Promise.all(pulls);
  }

  private async pullTools(connId: string): Promise<void> {
    const entry = this.gateways.get(connId);
    if (!entry) return;

    const requestId = `pull_${++this.pullCounter}`;

    const data = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pendingPulls.delete(requestId);
        reject(new Error("Pull get_tools timed out"));
      }, this.pullTimeoutMs);

      entry.pendingPulls.set(requestId, { resolve, reject, timer });
      entry.ws.send(JSON.stringify({ type: "get_tools", requestId }));
    });

    const typed = data as { integrations: Integration[]; mcpVersion: string | null };
    entry.gateway.integrations = [
      ...typed.integrations,
      ...entry.gateway.integrations.filter((i) => i.id === "skills"),
    ];
    entry.gateway.mcpVersion = typed.mcpVersion;
  }

  private async pullSkills(connId: string): Promise<void> {
    const entry = this.gateways.get(connId);
    if (!entry) return;

    const requestId = `pull_${++this.pullCounter}`;

    const data = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pendingPulls.delete(requestId);
        reject(new Error("Pull get_skills timed out"));
      }, this.pullTimeoutMs);

      entry.pendingPulls.set(requestId, { resolve, reject, timer });
      entry.ws.send(JSON.stringify({ type: "get_skills", requestId }));
    });

    const typed = data as { skills: Skill[]; skillsVersion: string | null };
    // Build skills integration if any skills exist
    const nonSkillIntegrations = entry.gateway.integrations.filter((i) => i.id !== "skills");
    if (typed.skills.length > 0) {
      nonSkillIntegrations.push({
        id: "skills",
        name: "Skills",
        description: "Gateway skills",
        tools: [],
        skills: typed.skills,
      });
    }
    entry.gateway.integrations = nonSkillIntegrations;
    entry.gateway.skillsVersion = typed.skillsVersion;
  }

  private handleConnection(ws: WebSocket): void {
    const connId = `gw_${++this.connCounter}`;
    let authenticated = false;
    let organizationId = "";
    let protocolVersion = 1;
    let gatewayVersion = "unknown";

    const authTimer = setTimeout(() => {
      if (!authenticated) {
        ws.close();
      }
    }, 10_000);

    ws.on("message", async (data) => {
      let msg;
      try {
        msg = GatewayMessageSchema.parse(JSON.parse(data.toString()));
      } catch {
        return;
      }

      switch (msg.type) {
        case "authenticate": {
          const result = await this.options.validateToken(msg.token);
          if (result) {
            clearTimeout(authTimer);
            authenticated = true;
            organizationId = result.organizationId;
            protocolVersion = msg.protocolVersion;
            gatewayVersion = msg.gatewayVersion;
            ws.send(
              JSON.stringify({
                type: "authenticated",
                organizationId: result.organizationId,
                ...(result.organizationName
                  ? { organizationName: result.organizationName }
                  : {}),
              })
            );
          } else {
            clearTimeout(authTimer);
            ws.send(
              JSON.stringify({
                type: "auth_error",
                error: "Invalid token",
              })
            );
            ws.close();
          }
          break;
        }

        case "version_changed": {
          if (!authenticated) {
            ws.close();
            return;
          }

          const mcpVersion = msg.mcpVersion;
          const skillsVersion = msg.skillsVersion;

          const existing = this.gateways.get(connId);
          if (existing) {
            // Subsequent version_changed: update versions and pull what changed
            const mcpChanged = mcpVersion !== existing.gateway.mcpVersion;
            const skillsChanged = skillsVersion !== existing.gateway.skillsVersion;

            existing.gateway.mcpVersion = mcpVersion;
            existing.gateway.skillsVersion = skillsVersion;

            const pulls: Promise<void>[] = [];
            if (mcpChanged && mcpVersion !== null) {
              pulls.push(this.pullTools(connId));
            } else if (mcpChanged && mcpVersion === null) {
              // MCP removed: clear tool integrations
              existing.gateway.integrations = existing.gateway.integrations.filter(
                (i) => i.id === "skills"
              );
            }
            if (skillsChanged && skillsVersion !== null) {
              pulls.push(this.pullSkills(connId));
            } else if (skillsChanged && skillsVersion === null) {
              // Skills removed: clear skills integrations
              existing.gateway.integrations = existing.gateway.integrations.filter(
                (i) => i.id !== "skills"
              );
            }

            if (pulls.length > 0) {
              await Promise.all(pulls);
            }
            this.onGatewayUpdated?.(existing.gateway);
          } else {
            // First version_changed: create gateway entry, auto-pull, then fire connected
            const gateway: ConnectedGateway = {
              id: connId,
              organizationId,
              protocolVersion,
              gatewayVersion,
              integrations: [],
              mcpVersion,
              skillsVersion,
            };

            const entry: GatewayEntry = {
              ws,
              gateway,
              pending: new Map(),
              pendingPulls: new Map(),
              pongTimer: null,
            };

            this.gateways.set(connId, entry);

            // Auto-pull and then fire connected callback
            await this.autoPull(connId);
            this.onGatewayConnected?.(gateway);
          }
          break;
        }

        case "tool_result": {
          const entry = this.gateways.get(connId);
          if (!entry) return;
          const pending = entry.pending.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            entry.pending.delete(msg.requestId);
            pending.resolve(msg.result);
          }
          break;
        }

        case "tool_error": {
          const entry = this.gateways.get(connId);
          if (!entry) return;
          const pending = entry.pending.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            entry.pending.delete(msg.requestId);
            pending.reject(
              new Error(
                `Tool error [${msg.error.code}]: ${msg.error.message}`
              )
            );
          }
          break;
        }

        case "pong": {
          const entry = this.gateways.get(connId);
          if (entry?.pongTimer) {
            clearTimeout(entry.pongTimer);
            entry.pongTimer = null;
          }
          break;
        }

        case "versions": {
          const entry = this.gateways.get(connId);
          if (!entry) return;
          const pull = entry.pendingPulls.get(msg.requestId);
          if (pull) {
            clearTimeout(pull.timer);
            entry.pendingPulls.delete(msg.requestId);
            pull.resolve({
              mcpVersion: msg.mcpVersion,
              skillsVersion: msg.skillsVersion,
            });
          }
          break;
        }

        case "tools": {
          const entry = this.gateways.get(connId);
          if (!entry) return;
          const pull = entry.pendingPulls.get(msg.requestId);
          if (pull) {
            clearTimeout(pull.timer);
            entry.pendingPulls.delete(msg.requestId);
            pull.resolve({
              integrations: msg.integrations,
              mcpVersion: msg.mcpVersion,
            });
          }
          break;
        }

        case "skills": {
          const entry = this.gateways.get(connId);
          if (!entry) return;
          const pull = entry.pendingPulls.get(msg.requestId);
          if (pull) {
            clearTimeout(pull.timer);
            entry.pendingPulls.delete(msg.requestId);
            pull.resolve({
              skills: msg.skills,
              skillsVersion: msg.skillsVersion,
            });
          }
          break;
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      const entry = this.gateways.get(connId);
      if (entry) {
        if (entry.pongTimer) clearTimeout(entry.pongTimer);
        for (const pending of entry.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Gateway disconnected"));
        }
        for (const pull of entry.pendingPulls.values()) {
          clearTimeout(pull.timer);
          pull.reject(new Error("Gateway disconnected"));
        }
        this.gateways.delete(connId);
        this.onGatewayDisconnected?.(entry.gateway);
      }
    });
  }

  private sendPings(): void {
    for (const entry of this.gateways.values()) {
      entry.ws.send(JSON.stringify({ type: "ping" }));
      if (entry.pongTimer) clearTimeout(entry.pongTimer);
      entry.pongTimer = setTimeout(() => {
        entry.ws.close();
      }, 10_000);
    }
  }
}
