import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./config.js";
import { ContentBlockSchema, type ToolDefinition, type ToolResult, type ContentBlock } from "journal-gateway-protocol";
import { Logger } from "./common/logger.js";
import { VERSION } from "./version.js";
import { EventEmitter } from "node:events";

export interface McpClientEvents {
  crash: [error: Error];
  tools_changed: [];
}

export class McpClient extends EventEmitter<McpClientEvents> {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private running = false;
  private cachedTools: ToolDefinition[] = [];

  constructor(
    private definition: McpServerConfig,
    private env: Record<string, string>,
    private logger: Logger
  ) {
    super();
  }

  private createTransport(): Transport {
    switch (this.definition.transport) {
      case "stdio":
        return new StdioClientTransport({
          command: this.definition.command,
          args: this.definition.args,
          env: { ...process.env, ...this.env } as Record<string, string>,
        });

      case "sse":
        return new SSEClientTransport(new URL(this.definition.url), {
          requestInit: { headers: this.env },
        });

      case "streamable-http":
        return new StreamableHTTPClientTransport(
          new URL(this.definition.url),
          { requestInit: { headers: this.env } }
        );
    }
  }

  async start(): Promise<void> {
    this.logger.info(
      `Starting MCP ${this.definition.transport} transport for integration "${this.definition.id}"`,
      this.definition.transport === "stdio"
        ? { command: this.definition.command, args: this.definition.args }
        : { url: this.definition.url }
    );

    this.transport = this.createTransport();

    this.client = new Client(
      { name: `journal-gateway/${this.definition.id}`, version: VERSION },
      { capabilities: {} }
    );

    this.transport.onclose = () => {
      if (this.running) {
        this.running = false;
        this.cachedTools = [];
        const err = new Error(
          `MCP ${this.definition.transport} transport for integration "${this.definition.id}" closed unexpectedly`
        );
        this.logger.error(err.message);
        this.emit("crash", err);
      }
    };

    await this.client.connect(this.transport);
    this.running = true;

    try {
      this.cachedTools = await this.fetchTools();
    } catch {
      this.logger.warn(`Initial tool fetch failed for "${this.definition.id}"`);
    }

    this.client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        this.logger.info(
          `MCP server "${this.definition.id}" reported tools changed`
        );
        await this.refreshTools();
        this.emit("tools_changed");
      }
    );

    this.logger.info(
      `MCP ${this.definition.transport} transport for integration "${this.definition.id}" started successfully`
    );
  }

  getTools(): ToolDefinition[] {
    return this.cachedTools;
  }

  private async fetchTools(): Promise<ToolDefinition[]> {
    if (!this.client) throw new Error("MCP process not started");

    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  private async refreshTools(): Promise<void> {
    try {
      this.cachedTools = await this.fetchTools();
    } catch {
      this.logger.warn(`Tool refresh failed for "${this.definition.id}", keeping last-known-good`);
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.client) throw new Error("MCP process not started");

    const result = await this.client.callTool({ name, arguments: args });

    const content: ContentBlock[] = (result.content as unknown[]).map((block) => {
      const parsed = ContentBlockSchema.safeParse(block);
      if (parsed.success) return parsed.data;
      // Fall back to text for unrecognised content blocks
      const raw = block as Record<string, unknown>;
      return { type: "text" as const, text: String(raw.text ?? "") };
    });

    return {
      content,
      isError: result.isError === true ? true : undefined,
    };
  }

  async stop(): Promise<void> {
    this.running = false;
    this.cachedTools = [];
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.client = null;
    this.logger.info(
      `MCP ${this.definition.transport} transport for integration "${this.definition.id}" stopped`
    );
  }

  isRunning(): boolean {
    return this.running;
  }

  get integrationId(): string {
    return this.definition.id;
  }
}
