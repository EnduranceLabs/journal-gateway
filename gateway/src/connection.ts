import WebSocket from "ws";
import {
  ServiceMessageSchema,
  type GatewayMessage,
  type ServiceMessage,
  type GatewayErrorCode,
} from "./types/index.js";
import type { IntegrationProvider, GatewayConfig } from "./types/index.js";
import { IntegrationNotFoundError } from "./types/index.js";
import { Logger } from "./common/logger.js";
import { VERSION } from "./version.js";

const PROTOCOL_VERSION = 1;
const AUTH_TIMEOUT_MS = 10_000;
const REGISTER_TIMEOUT_MS = 30_000;
const TOOL_CALL_TIMEOUT_MS = 60_000;
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;
const RECONNECT_JITTER = 0.25;

export class GatewayConnection {
  private ws: WebSocket | null = null;
  private logger: Logger;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private config: GatewayConfig,
    private provider: IntegrationProvider
  ) {
    this.logger = new Logger(config.logLevel);
  }

  async connect(): Promise<void> {
    this.closed = false;
    await this.establishConnection();
  }

  private async establishConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.logger.info("Connecting to Journal service", {
        url: this.config.url,
      });

      const ws = new WebSocket(this.config.url);
      this.ws = ws;

      let authenticated = false;
      let registered = false;

      const authTimer = setTimeout(() => {
        if (!authenticated) {
          ws.close();
          reject(new Error("Authentication timed out"));
        }
      }, AUTH_TIMEOUT_MS);

      let registerTimer: ReturnType<typeof setTimeout> | null = null;

      ws.on("open", () => {
        this.logger.info("WebSocket connected, authenticating");
        this.send({
          type: "authenticate",
          token: this.config.token,
          protocolVersion: PROTOCOL_VERSION,
          gatewayVersion: VERSION,
        });
      });

      ws.on("message", async (data) => {
        let msg: ServiceMessage;
        try {
          msg = ServiceMessageSchema.parse(JSON.parse(data.toString()));
        } catch (err) {
          this.logger.warn("Received invalid message", {
            error: String(err),
          });
          return;
        }

        switch (msg.type) {
          case "authenticated": {
            clearTimeout(authTimer);
            authenticated = true;
            this.logger.info("Authenticated", {
              organizationId: msg.organizationId,
              organizationName: msg.organizationName,
            });

            const integrations = await this.provider.getRegistrations();
            this.send({ type: "register", integrations });

            registerTimer = setTimeout(() => {
              if (!registered) {
                ws.close();
                reject(new Error("Registration timed out"));
              }
            }, REGISTER_TIMEOUT_MS);
            break;
          }

          case "auth_error": {
            clearTimeout(authTimer);
            this.logger.error("Authentication failed", {
              error: msg.error,
            });
            ws.close();
            reject(new Error(`Authentication failed: ${msg.error}`));
            break;
          }

          case "registered": {
            if (registerTimer) clearTimeout(registerTimer);
            registered = true;
            this.reconnectDelay = RECONNECT_INITIAL_MS;
            this.logger.info("Integrations registered", {
              integrationCount: msg.integrationCount,
              toolCount: msg.toolCount,
              ...(msg.skillCount != null ? { skillCount: msg.skillCount } : {}),
            });
            resolve();
            break;
          }

          case "tool_call": {
            this.handleToolCall(msg.requestId, msg.integrationId, msg.toolName, msg.arguments);
            break;
          }

          case "ping": {
            this.send({ type: "pong" });
            break;
          }
        }
      });

      ws.on("close", () => {
        this.logger.warn("WebSocket disconnected");
        if (!this.closed && registered) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (err) => {
        this.logger.error("WebSocket error", { error: err.message });
        if (!authenticated) {
          clearTimeout(authTimer);
          reject(err);
        }
      });
    });
  }

  private async handleToolCall(
    requestId: string,
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<void> {
    const start = Date.now();

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Tool execution timed out")),
        TOOL_CALL_TIMEOUT_MS
      );
    });

    try {
      const result = await Promise.race([
        this.provider.callTool(integrationId, toolName, args),
        timeout,
      ]);

      this.send({ type: "tool_result", requestId, result });

      this.logger.toolCall({
        integrationId,
        toolName,
        requestId,
        durationMs: Date.now() - start,
        success: true,
      });
    } catch (err) {
      let code: GatewayErrorCode = "EXECUTION_FAILED";
      let message = err instanceof Error ? err.message : String(err);

      if (err instanceof IntegrationNotFoundError) {
        code = "INTEGRATION_NOT_FOUND";
      } else if (message === "Tool execution timed out") {
        code = "TIMEOUT";
      }

      this.send({
        type: "tool_error",
        requestId,
        error: { code, message },
      });

      this.logger.toolCall({
        integrationId,
        toolName,
        requestId,
        durationMs: Date.now() - start,
        success: false,
        error: message,
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER;
    const delay = Math.min(
      this.reconnectDelay * jitter,
      RECONNECT_MAX_MS
    );
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      RECONNECT_MAX_MS
    );

    this.logger.info(`Reconnecting in ${Math.round(delay)}ms`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.establishConnection();
      } catch (err) {
        this.logger.error("Reconnection failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        this.scheduleReconnect();
      }
    }, delay);
  }

  private send(message: GatewayMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.logger.info("Gateway connection closed");
  }
}
