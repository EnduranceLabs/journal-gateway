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
  private maxBytes: number | null;
  private maxFiles: number | null;

  constructor(options: AuditOptions = {}) {
    this.filePath = options.filePath ?? null;
    this.enabled = options.enabled ?? true;
    this.maxBytes = options.maxBytes ?? null;
    this.maxFiles = options.maxFiles ?? null;
  }

  async log(event: AuditEvent): Promise<void> {
    if (!this.enabled) return;

    const entry = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    if (this.filePath) {
      const line = JSON.stringify(entry) + "\n";
      await this.appendWithRotation(line);
    }
  }

  private async appendWithRotation(line: string): Promise<void> {
    if (!this.filePath) return;
    if (!this.maxBytes || !this.maxFiles || this.maxBytes <= 0 || this.maxFiles < 1) {
      appendFile(this.filePath, line).catch(() => {});
      return;
    }
    try {
      const stat = await import("node:fs/promises").then((m) => m.stat(this.filePath!)).catch(() => null);
      if (stat && stat.size + Buffer.byteLength(line) > this.maxBytes) {
        await this.rotate();
      }
      await appendFile(this.filePath, line);
    } catch {
      // Swallow audit errors to avoid impacting runtime
    }
  }

  private async rotate(): Promise<void> {
    if (!this.filePath || !this.maxFiles) return;
    const { rename, rm, access } = await import("node:fs/promises");
    // Delete the oldest file if it exists
    const oldest = `${this.filePath}.${this.maxFiles}`;
    await access(oldest).then(() => rm(oldest)).catch(() => {});
    // Shift files
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = `${this.filePath}.${i}`;
      const dest = `${this.filePath}.${i + 1}`;
      await rename(src, dest).catch(() => {});
    }
    // Move current to .1
    await rename(this.filePath, `${this.filePath}.1`).catch(() => {});
  }
}
