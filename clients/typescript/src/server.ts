import { WebSocketServer, WebSocket } from "ws";
import type { Integration, ToolDefinition, ToolResult, Skill } from "./types.js";
import { GatewayMessageSchema } from "./types.js";

export interface TokenValidationResult {
  organizationId: string;
  organizationName?: string;
}

export interface TraceContext {
  traceparent: string;
  tracestate?: string;
}

export interface GatewayServerOptions {
  /**
   * Port to bind when using {@link GatewayServer.start}.
   * Pass `0` to let the OS pick an available port.
   * Not used when feeding connections externally via {@link GatewayServer.handleConnection}.
   */
  port?: number;
  validateToken: (token: string) => Promise<TokenValidationResult | null>;
  pingIntervalMs?: number;
  pullTimeoutMs?: number;
  /**
   * Optional hook to extract W3C trace context from the active span for
   * propagation to the gateway. Called when sending tool_call messages.
   * Return `null` when no active trace context is available.
   */
  getTraceContext?: () => TraceContext | null;
  /**
   * Called when a gateway socket emits an `error` event (e.g. ECONNRESET).
   * `gateway` is `null` if the socket errored before completing the
   * handshake. When not provided, socket errors are dropped — the library
   * never logs on its own.
   */
  onSocketError?: (error: Error, gateway: ConnectedGateway | null) => void;
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

  get availableTools(): Array<{ integrationId: string; name: string; description: string }> {
    const tools: Array<{ integrationId: string; name: string; description: string }> = [];
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
  onGatewayDisconnected?: (
    gateway: ConnectedGateway,
    closeCode?: number,
    closeReason?: string,
  ) => void;

  /**
   * Start a standalone WebSocket server on the configured port.
   *
   * If you want to manage the HTTP server yourself (e.g. Fastify, Express),
   * skip this method and instead call {@link startHeartbeat} then pass each
   * incoming WebSocket to {@link handleConnection}.
   */
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

      this.startHeartbeat();
    });
  }

  /**
   * Stop the standalone WebSocket server created by {@link start}.
   *
   * If you manage the HTTP server yourself, use {@link shutdown} instead.
   */
  async stop(): Promise<void> {
    this.shutdown();

    return new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
        this.wss = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Start the heartbeat ping timer.
   *
   * Called automatically by {@link start}. Call this manually when using
   * {@link handleConnection} directly with an external HTTP server.
   */
  startHeartbeat(): void {
    if (this.pingTimer) return;
    const interval = this.options.pingIntervalMs ?? 30_000;
    if (interval > 0) {
      this.pingTimer = setInterval(() => this.sendPings(), interval);
    }
  }

  /**
   * Clean up all gateway connections and timers.
   *
   * Use this instead of {@link stop} when you manage the HTTP server yourself
   * and don't need to close the internal WebSocketServer.
   */
  shutdown(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    for (const [connId, entry] of this.gateways.entries()) {
      if (entry.pongTimer) clearTimeout(entry.pongTimer);
      for (const pending of entry.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Server shutting down"));
      }
      for (const pull of entry.pendingPulls.values()) {
        clearTimeout(pull.timer);
        pull.reject(new Error("Server shutting down"));
      }
      // Remove before closing so the ws close handler doesn't double-fire
      this.gateways.delete(connId);
      this.onGatewayDisconnected?.(entry.gateway);
      entry.ws.close();
    }
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

    return this.callToolOnEntry(targetEntry, integrationId, toolName, args, timeoutMs);
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

      const traceCtx = this.options.getTraceContext?.() ?? null;
      entry.ws.send(
        JSON.stringify({
          type: "tool_call",
          requestId,
          integrationId,
          toolName,
          arguments: args,
          ...(traceCtx?.traceparent
            ? { traceparent: traceCtx.traceparent }
            : {}),
          ...(traceCtx?.tracestate
            ? { tracestate: traceCtx.tracestate }
            : {}),
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

  private resolvePull(connId: string, requestId: string, data: unknown): void {
    const entry = this.gateways.get(connId);
    if (!entry) return;
    const pull = entry.pendingPulls.get(requestId);
    if (pull) {
      clearTimeout(pull.timer);
      entry.pendingPulls.delete(requestId);
      pull.resolve(data);
    }
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

    const data = await this.sendPull(connId, "get_tools") as {
      integrations: Integration[];
      mcpVersion: string | null;
    };

    entry.gateway.integrations = [
      ...data.integrations,
      ...entry.gateway.integrations.filter((i) => i.id === "skills"),
    ];
    entry.gateway.mcpVersion = data.mcpVersion;
  }

  private async pullSkills(connId: string): Promise<void> {
    const entry = this.gateways.get(connId);
    if (!entry) return;

    const data = await this.sendPull(connId, "get_skills") as {
      skills: Skill[];
      skillsVersion: string | null;
    };

    // Build skills integration if any skills exist
    const nonSkillIntegrations = entry.gateway.integrations.filter((i) => i.id !== "skills");
    if (data.skills.length > 0) {
      nonSkillIntegrations.push({
        id: "skills",
        name: "Skills",
        description: "Gateway skills",
        tools: [],
        skills: data.skills,
      });
    }
    entry.gateway.integrations = nonSkillIntegrations;
    entry.gateway.skillsVersion = data.skillsVersion;
  }

  /**
   * Handle a new gateway WebSocket connection.
   *
   * Called automatically for connections received by the internal
   * WebSocketServer when using {@link start}. Call this manually to feed
   * connections from an external HTTP server (e.g. a Fastify websocket route).
   */
  handleConnection(ws: WebSocket): void {
    const connId = `gw_${++this.connCounter}`;
    let authenticated = false;
    let organizationId = "";
    let protocolVersion = 0;
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
          this.resolvePull(connId, msg.requestId, {
            mcpVersion: msg.mcpVersion,
            skillsVersion: msg.skillsVersion,
          });
          break;
        }

        case "tools": {
          this.resolvePull(connId, msg.requestId, {
            integrations: msg.integrations,
            mcpVersion: msg.mcpVersion,
          });
          break;
        }

        case "skills": {
          this.resolvePull(connId, msg.requestId, {
            skills: msg.skills,
            skillsVersion: msg.skillsVersion,
          });
          break;
        }
      }
    });

    // An "error" event with no listener crashes the host process.
    ws.on("error", (err: Error) => {
      this.options.onSocketError?.(err, this.gateways.get(connId)?.gateway ?? null);
    });

    ws.on("close", (code: number, reason: Buffer) => {
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
        const reasonStr = reason?.toString() || undefined;
        this.onGatewayDisconnected?.(entry.gateway, code, reasonStr);
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
