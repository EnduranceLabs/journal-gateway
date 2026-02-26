import type { Integration, ToolResult } from "./integrations.js";
import type { Skill } from "./skills.js";

export interface GatewayVersions {
  mcpVersion: string | null;
  skillsVersion: string | null;
}

export interface IntegrationProvider {
  getTools(): Integration[];
  getSkills(): Skill[];
  getVersions(): GatewayVersions;
  callTool(integrationId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
  on?(event: "versions_changed", listener: () => void): void;
  off?(event: "versions_changed", listener: () => void): void;
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
