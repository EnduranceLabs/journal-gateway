import WebSocket from "ws";
import {
  ServiceMessageSchema,
  IntegrationNotFoundError,
  type GatewayMessage,
  type ServiceMessage,
  type GatewayErrorCode,
  type IntegrationProvider,
  type GatewayConfig,
} from "@journal/gateway-protocol";
import { Logger } from "./common/logger.js";
import { VERSION } from "./version.js";

const PROTOCOL_VERSION = 2;
const AUTH_TIMEOUT_MS = 10_000;
const TOOL_CALL_TIMEOUT_MS = 60_000;

class ToolTimeoutError extends Error {
  constructor() {
    super("Tool execution timed out");
    this.name = "ToolTimeoutError";
  }
}
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
  private changeListener: (() => void) | null = null;

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
      let ready = false;

      const authTimer = setTimeout(() => {
        if (!authenticated) {
          ws.close();
          reject(new Error("Authentication timed out"));
        }
      }, AUTH_TIMEOUT_MS);

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

            // Send initial version_changed (fire-and-forget)
            const versions = this.provider.getVersions();
            this.send({
              type: "version_changed",
              mcpVersion: versions.mcpVersion,
              skillsVersion: versions.skillsVersion,
            });

            // Subscribe to provider change events
            this.subscribeToChanges(ws);

            // Connection is ready
            ready = true;
            this.reconnectDelay = RECONNECT_INITIAL_MS;
            this.logger.info("Gateway ready");
            resolve();
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

          case "get_versions": {
            const versions = this.provider.getVersions();
            this.send({
              type: "versions",
              requestId: msg.requestId,
              mcpVersion: versions.mcpVersion,
              skillsVersion: versions.skillsVersion,
            });
            break;
          }

          case "get_tools": {
            const tools = await this.provider.getTools();
            const versions = this.provider.getVersions();
            this.send({
              type: "tools",
              requestId: msg.requestId,
              integrations: tools,
              mcpVersion: versions.mcpVersion,
            });
            break;
          }

          case "get_skills": {
            const skills = this.provider.getSkills();
            const versions = this.provider.getVersions();
            this.send({
              type: "skills",
              requestId: msg.requestId,
              skills,
              skillsVersion: versions.skillsVersion,
            });
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
        this.unsubscribeFromChanges();
        if (!this.closed && ready) {
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

  private subscribeToChanges(ws: WebSocket): void {
    this.unsubscribeFromChanges();

    if (!this.provider.on) return;

    this.changeListener = () => {
      if (ws.readyState !== WebSocket.OPEN) return;

      this.logger.info("Provider versions changed, notifying service");
      const versions = this.provider.getVersions();
      this.send({
        type: "version_changed",
        mcpVersion: versions.mcpVersion,
        skillsVersion: versions.skillsVersion,
      });
    };

    this.provider.on("versions_changed", this.changeListener);
  }

  private unsubscribeFromChanges(): void {
    if (this.changeListener && this.provider.off) {
      this.provider.off("versions_changed", this.changeListener);
      this.changeListener = null;
    }
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
        () => reject(new ToolTimeoutError()),
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
      } else if (err instanceof ToolTimeoutError) {
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
    this.unsubscribeFromChanges();
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
