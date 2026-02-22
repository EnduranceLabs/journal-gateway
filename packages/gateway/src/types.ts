import type { Integration, ToolResult } from "@journal-edge/types";

export interface IntegrationProvider {
  getRegistrations(): Promise<Integration[]>;
  callTool(integrationId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class IntegrationNotFoundError extends Error {
  constructor(integrationId: string, detail?: string) {
    super(detail ?? `Integration "${integrationId}" is not registered`);
    this.name = "IntegrationNotFoundError";
  }
}

export interface GatewayConfig {
  token: string;
  url: string;
  logLevel: "debug" | "info" | "warn" | "error";
}
