import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "./config.js";
import type { ToolDefinition, ToolResult, ContentBlock } from "@journal-edge/types";
import { Logger } from "./logger.js";
import { EventEmitter } from "node:events";

export interface McpProcessEvents {
  crash: [error: Error];
}

export class McpProcess extends EventEmitter<McpProcessEvents> {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private running = false;

  constructor(
    private definition: McpServerConfig,
    private env: Record<string, string>,
    private logger: Logger
  ) {
    super();
  }

  async start(): Promise<void> {
    this.logger.info(`Starting MCP process for integration "${this.definition.id}"`, {
      command: this.definition.command,
      args: this.definition.args,
    });

    this.transport = new StdioClientTransport({
      command: this.definition.command,
      args: this.definition.args,
      env: { ...process.env, ...this.env } as Record<string, string>,
    });

    this.client = new Client(
      { name: `journal-gateway/${this.definition.id}`, version: "0.1.0" },
      { capabilities: {} }
    );

    this.transport.onclose = () => {
      if (this.running) {
        this.running = false;
        const err = new Error(
          `MCP process for integration "${this.definition.id}" exited unexpectedly`
        );
        this.logger.error(err.message);
        this.emit("crash", err);
      }
    };

    await this.client.connect(this.transport);
    this.running = true;

    this.logger.info(
      `MCP process for integration "${this.definition.id}" started successfully`
    );
  }

  async listTools(): Promise<ToolDefinition[]> {
    if (!this.client) throw new Error("MCP process not started");

    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.client) throw new Error("MCP process not started");

    const result = await this.client.callTool({ name, arguments: args });

    const content: ContentBlock[] = (
      result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    ).map((block) => {
      if (block.type === "image") {
        return {
          type: "image" as const,
          data: block.data ?? "",
          mimeType: block.mimeType ?? "image/png",
        };
      }
      return { type: "text" as const, text: block.text ?? "" };
    });

    return {
      content,
      isError: result.isError === true ? true : undefined,
    };
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.client = null;
    this.logger.info(
      `MCP process for integration "${this.definition.id}" stopped`
    );
  }

  isRunning(): boolean {
    return this.running;
  }

  get integrationId(): string {
    return this.definition.id;
  }
}
