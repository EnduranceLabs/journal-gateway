import { appendFile } from "node:fs/promises";
import { Telemetry } from "./telemetry.js";

type AuditEvent =
  | {
      type: "tool_call";
      stage: "start" | "result" | "error";
      integrationId: string;
      toolName: string;
      requestId: string;
      durationMs?: number;
      outcome?: string;
      errorMessage?: string;
    }
  | {
      type: "message";
      direction: "gateway_to_service" | "service_to_gateway";
      messageType: string;
      requestId?: string;
      integrationId?: string;
    }
  | {
      type: "process";
      action: "start" | "stop" | "restart";
      integrationId: string;
    }
  | {
      type: "config";
      source: "config_file" | "env_file";
      status: "applied" | "skipped";
      reason?: string;
    };

interface AuditOptions {
  filePath?: string | null;
  enabled?: boolean;
}

/**
 * Redaction-first audit logger. Only metadata is recorded—no secrets or tool arguments.
 */
export class AuditLogger {
  private filePath: string | null;
  private enabled: boolean;

  constructor(options: AuditOptions = {}) {
    this.filePath = options.filePath ?? null;
    this.enabled = options.enabled ?? true;
  }

  async log(event: AuditEvent): Promise<void> {
    if (!this.enabled) return;

    const entry = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    if (this.filePath) {
      const line = JSON.stringify(entry) + "\n";
      appendFile(this.filePath, line).catch(() => {});
    }
  }
}
