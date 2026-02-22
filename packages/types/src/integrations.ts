import { z } from "zod";

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const McpServerIntegrationSchema = z.object({
  type: z.literal("mcp_server"),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tools: z.array(ToolDefinitionSchema),
});

export type McpServerIntegration = z.infer<typeof McpServerIntegrationSchema>;

export const AgentIntegrationSchema = z.object({
  type: z.literal("agent"),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tools: z.array(ToolDefinitionSchema),
});

export type AgentIntegration = z.infer<typeof AgentIntegrationSchema>;

export const IntegrationSchema = z.discriminatedUnion("type", [
  McpServerIntegrationSchema,
  AgentIntegrationSchema,
]);

export type Integration = z.infer<typeof IntegrationSchema>;

export const TextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export type TextContent = z.infer<typeof TextContentSchema>;

export const ImageContentSchema = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
});

export type ImageContent = z.infer<typeof ImageContentSchema>;

export const ContentBlockSchema = z.discriminatedUnion("type", [
  TextContentSchema,
  ImageContentSchema,
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const ToolResultSchema = z.object({
  content: z.array(ContentBlockSchema),
  isError: z.boolean().optional(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;
