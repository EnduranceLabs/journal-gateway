import WebSocket from "ws";
import {
  ServiceMessageSchema,
  IntegrationNotFoundError,
  type GatewayMessage,
  type ServiceMessage,
  type GatewayErrorCode,
  type IntegrationProvider,
  type GatewayConfig,
} from "@journal.one/gateway-protocol";
import { Logger } from "./common/logger.js";
import { VERSION } from "./version.js";
import { Telemetry } from "./telemetry.js";
import { AuditLogger } from "./audit.js";

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
  private changeListener: (() => void) | null = null;
  private telemetry: Telemetry | null;
  private audit: AuditLogger | null;

  // Connection lifecycle state
  private firstReady: Promise<void> | null = null;
  private firstReadyResolve: (() => void) | null = null;
  private firstReadyReject: ((err: Error) => void) | null = null;
  private loopPromise: Promise<void> | null = null;
  private sleepResolve: (() => void) | null = null;

  constructor(
    private config: GatewayConfig,
    private provider: IntegrationProvider,
    telemetry?: Telemetry | null,
    audit?: AuditLogger | null
  ) {
    this.logger = new Logger(config.logLevel);
    this.telemetry = telemetry ?? null;
    this.audit = audit ?? null;
  }

  /**
   * Start the connection loop. Resolves when the first successful
   * authentication completes. Rejects only if close() is called before
   * ever authenticating. The loop runs in the background and handles
   * all reconnection automatically.
   *
   * Idempotent: calling connect() while already running returns the
   * same promise. After close(), a new loop can be started.
   */
  connect(): Promise<void> {
    // Already running — return existing promise (same reference)
    if (this.firstReady) return this.firstReady;

    this.firstReady = new Promise<void>((resolve, reject) => {
      this.firstReadyResolve = resolve;
      this.firstReadyReject = reject;
    });

    // Drain any previous loop before starting a new one, preventing
    // two concurrent reconnect loops from the close() → connect() race.
    this.loopPromise = (this.loopPromise ?? Promise.resolve()).then(() => {
      // If close() was called after connect() but before we got here,
      // firstReady will have been cleared — don't start a new loop.
      if (!this.firstReady) return;
      this.closed = false;
      return this.runLoop();
    });
    this.loopPromise.catch(() => {}); // runLoop handles errors internally

    return this.firstReady;
  }

  /**
   * Single reconnect loop — the sole owner of retry logic.
   * Runs until close() is called.
   */
  private async runLoop(): Promise<void> {
    while (!this.closed) {
      try {
        await this.connectOnce();
      } catch (err) {
        this.logger.error("Connection attempt failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (this.closed) break;

      const delay = this.nextDelay();
      this.logger.info(`Reconnecting in ${Math.round(delay)}ms`);
      await this.sleep(delay);
    }
  }

  /**
   * Open a single WebSocket connection. The returned promise resolves
   * when the socket closes (for any reason) — the loop decides whether
   * to retry. Rejects only on synchronous constructor failures where
   * no close event will fire.
   */
  private connectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.logger.info("Connecting to Journal service", {
        url: this.config.url,
      });
      this.audit?.log({
        type: "message",
        direction: "gateway_to_service",
        messageType: "connect",
      });

      // Close any previous WebSocket before creating a new one.
      if (this.ws) {
        try {
          this.ws.removeAllListeners();
          this.ws.on("error", () => {});
          this.ws.close();
        } catch {
          // Ignore errors closing stale socket
        }
        this.ws = null;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.config.url);
      } catch (err) {
        // Sync throw (e.g. unsupported URL scheme) — no WebSocket was
        // created so no "close" event will ever fire.
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.ws = ws;

      let authenticated = false;

      const authTimer = setTimeout(() => {
        if (!authenticated) {
          ws.close();
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

        try {
          switch (msg.type) {
            case "authenticated": {
              clearTimeout(authTimer);
              authenticated = true;
              this.logger.info("Authenticated", {
                organizationId: msg.organizationId,
                organizationName: msg.organizationName,
              });
              this.audit?.log({
                type: "message",
                direction: "service_to_gateway",
                messageType: "authenticated",
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

              // Reset backoff on successful auth
              this.reconnectDelay = RECONNECT_INITIAL_MS;

              // Resolve the first-ready promise (no-op after first time)
              if (this.firstReadyResolve) {
                this.firstReadyResolve();
                this.firstReadyResolve = null;
                this.firstReadyReject = null;
              }

              this.logger.info("Gateway ready");
              break;
            }

            case "auth_error": {
              clearTimeout(authTimer);
              this.logger.error("Authentication failed", {
                error: msg.error,
              });
              this.audit?.log({
                type: "message",
                direction: "service_to_gateway",
                messageType: "auth_error",
              });
              ws.close();
              break;
            }

            case "get_versions": {
              this.audit?.log({
                type: "message",
                direction: "service_to_gateway",
                messageType: "get_versions",
                requestId: msg.requestId,
              });
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
              this.audit?.log({
                type: "message",
                direction: "service_to_gateway",
                messageType: "get_tools",
                requestId: msg.requestId,
              });
              const tools = this.provider.getTools();
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
              this.audit?.log({
                type: "message",
                direction: "service_to_gateway",
                messageType: "get_skills",
                requestId: msg.requestId,
              });
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
              this.audit?.log({
                type: "message",
                direction: "service_to_gateway",
                messageType: "tool_call",
                requestId: msg.requestId,
                integrationId: msg.integrationId,
              });
              this.handleToolCall(msg.requestId, msg.integrationId, msg.toolName, msg.arguments);
              break;
            }

            case "ping": {
              this.send({ type: "pong" });
              break;
            }
          }
        } catch (err) {
          this.logger.error("Error handling message", {
            type: msg.type,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      ws.on("close", () => {
        this.logger.warn("WebSocket disconnected");
        clearTimeout(authTimer);
        this.unsubscribeFromChanges();
        this.ws = null;
        resolve();
      });

      ws.on("error", (err) => {
        this.logger.error("WebSocket error", { error: err.message });
      });
    });
  }

  private nextDelay(): number {
    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER;
    const delay = Math.min(this.reconnectDelay * jitter, RECONNECT_MAX_MS);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      RECONNECT_MAX_MS
    );
    return delay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.sleepResolve = resolve;
      const timer = setTimeout(() => {
        this.sleepResolve = null;
        resolve();
      }, ms);
      // Ensure the timer doesn't keep the process alive during shutdown
      timer.unref();
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

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new ToolTimeoutError()),
        TOOL_CALL_TIMEOUT_MS
      );
    });

    await this.audit?.log({
      type: "tool_call",
      stage: "start",
      integrationId,
      toolName,
      requestId,
    });

    const spanAttrs = {
      integrationId,
      toolName,
      requestId,
    };

    const call = async () => {
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
        this.telemetry?.recordToolCall(Date.now() - start, true);
        await this.audit?.log({
          type: "tool_call",
          stage: "result",
          integrationId,
          toolName,
          requestId,
          durationMs: Date.now() - start,
          outcome: "success",
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
        this.telemetry?.recordToolCall(Date.now() - start, false, code);
        await this.audit?.log({
          type: "tool_call",
          stage: "error",
          integrationId,
          toolName,
          requestId,
          durationMs: Date.now() - start,
          outcome: code,
          errorMessage: message,
        });
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    };

    if (this.telemetry) {
      await this.telemetry.startActiveSpan("gateway.tool_call", spanAttrs, async (span) => {
        await call();
      });
    } else {
      await call();
    }
  }

  private send(message: GatewayMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      this.audit?.log({
        type: "message",
        direction: "gateway_to_service",
        messageType: message.type,
        requestId: "requestId" in message ? (message as { requestId?: string }).requestId : undefined,
        integrationId: "integrationId" in message ? (message as { integrationId?: string }).integrationId : undefined,
      });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribeFromChanges();

    // Reject first-ready promise if never connected, then clear so
    // a subsequent connect() can start a fresh loop.
    if (this.firstReadyReject) {
      this.firstReadyReject(new Error("Connection closed"));
      this.firstReadyResolve = null;
      this.firstReadyReject = null;
    }
    this.firstReady = null;

    // Interrupt sleep so the loop exits promptly
    if (this.sleepResolve) {
      this.sleepResolve();
      this.sleepResolve = null;
    }

    if (this.ws) {
      this.ws.close();
      // Don't null this.ws — let the close handler fire and clean up.
      // The handler sets this.ws = null and resolves connectOnce().
    }

    // Wait for the loop to fully exit so a subsequent connect() cannot
    // race with a still-running loop.
    if (this.loopPromise) {
      await this.loopPromise;
    }

    this.logger.info("Gateway connection closed");
  }
}
