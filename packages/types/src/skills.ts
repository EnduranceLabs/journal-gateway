import { z } from "zod";

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const McpServerSkillSchema = z.object({
  type: z.literal("mcp_server"),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tools: z.array(ToolDefinitionSchema),
});

export type McpServerSkill = z.infer<typeof McpServerSkillSchema>;

export const AgentSkillSchema = z.object({
  type: z.literal("agent_skill"),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tools: z.array(ToolDefinitionSchema),
});

export type AgentSkill = z.infer<typeof AgentSkillSchema>;

export const SkillRegistrationSchema = z.discriminatedUnion("type", [
  McpServerSkillSchema,
  AgentSkillSchema,
]);

export type SkillRegistration = z.infer<typeof SkillRegistrationSchema>;

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
