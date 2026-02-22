import { WebSocketServer, WebSocket } from "ws";
import type { Integration, ToolResult } from "./types.js";
import { GatewayMessageSchema } from "./types.js";

export interface TokenValidationResult {
  organizationId: string;
  organizationName?: string;
}

export interface GatewayServerOptions {
  port?: number;
  validateToken: (token: string) => Promise<TokenValidationResult | null>;
  pingIntervalMs?: number;
}

export interface ConnectedGateway {
  id: string;
  protocolVersion: number;
  gatewayVersion: string;
  integrations: Integration[];
}

interface PendingCall {
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface GatewayEntry {
  ws: WebSocket;
  gateway: ConnectedGateway;
  pending: Map<string, PendingCall>;
  pongTimer: ReturnType<typeof setTimeout> | null;
}

export class GatewayServer {
  private wss: WebSocketServer | null = null;
  private gateways = new Map<string, GatewayEntry>();
  private _port: number;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connCounter = 0;
  private reqCounter = 0;

  constructor(private options: GatewayServerOptions) {
    this._port = options.port ?? 0;
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

  private handleConnection(ws: WebSocket): void {
    const connId = `gw_${++this.connCounter}`;
    let authenticated = false;
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

        case "register": {
          if (!authenticated) {
            ws.close();
            return;
          }

          const integrations = msg.integrations;
          let toolCount = 0;
          let skillCount = 0;
          for (const integration of integrations) {
            toolCount += integration.tools.length;
            skillCount += integration.skills?.length ?? 0;
          }

          ws.send(
            JSON.stringify({
              type: "registered",
              integrationCount: integrations.length,
              toolCount,
              skillCount,
            })
          );

          const gateway: ConnectedGateway = {
            id: connId,
            protocolVersion,
            gatewayVersion,
            integrations,
          };

          const entry: GatewayEntry = {
            ws,
            gateway,
            pending: new Map(),
            pongTimer: null,
          };

          this.gateways.set(connId, entry);
          this.onGatewayConnected?.(gateway);
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
