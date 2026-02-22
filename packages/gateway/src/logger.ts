export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: number;

  constructor(level: LogLevel = "info") {
    this.level = LOG_LEVELS[level];
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }

  toolCall(params: {
    integrationId: string;
    toolName: string;
    requestId: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }): void {
    this.log(params.success ? "info" : "error", "tool_call", {
      integrationId: params.integrationId,
      toolName: params.toolName,
      requestId: params.requestId,
      durationMs: params.durationMs,
      success: params.success,
      ...(params.error ? { error: params.error } : {}),
    });
  }

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    if (LOG_LEVELS[level] < this.level) return;

    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };

    const output = JSON.stringify(entry);
    if (level === "error") {
      process.stderr.write(output + "\n");
    } else {
      process.stdout.write(output + "\n");
    }
  }
}
