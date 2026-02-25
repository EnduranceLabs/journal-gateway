import type { Integration, ToolResult } from "./integrations.js";

export interface RegistrationVersions {
  mcpVersion: string | null;
  skillsVersion: string | null;
}

export interface IntegrationProvider {
  getRegistrations(): Promise<Integration[]>;
  getVersions(): RegistrationVersions;
  callTool(integrationId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
  on?(event: "registrations_changed", listener: () => void): void;
  off?(event: "registrations_changed", listener: () => void): void;
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
