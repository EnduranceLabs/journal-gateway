import { z } from "zod";
import { SkillSchema } from "./skills.js";

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const IntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tools: z.array(ToolDefinitionSchema),
  /** Present only on the synthesized "skills" integration built by the client library. */
  skills: z.array(SkillSchema).optional(),
});

export type Integration = z.infer<typeof IntegrationSchema>;

export const TextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export type TextContent = z.infer<typeof TextContentSchema>;

export const ImageContentSchema = z.object({
  type: z.literal("image"),
  /** Base64-encoded image data. */
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
