import { z } from "zod";
import { GatewayErrorSchema } from "./errors.js";
import { IntegrationSchema, ToolResultSchema } from "./integrations.js";
import { SkillSchema } from "./skills.js";

// --- Gateway -> Service messages ---

export const AuthenticateMessageSchema = z.object({
  type: z.literal("authenticate"),
  token: z.string(),
  protocolVersion: z.number(),
  gatewayVersion: z.string(),
});

export type AuthenticateMessage = z.infer<typeof AuthenticateMessageSchema>;

export const ToolResultMessageSchema = z.object({
  type: z.literal("tool_result"),
  requestId: z.string(),
  result: ToolResultSchema,
});

export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;

export const ToolErrorMessageSchema = z.object({
  type: z.literal("tool_error"),
  requestId: z.string(),
  error: GatewayErrorSchema,
});

export type ToolErrorMessage = z.infer<typeof ToolErrorMessageSchema>;

export const PongMessageSchema = z.object({
  type: z.literal("pong"),
});

export type PongMessage = z.infer<typeof PongMessageSchema>;

export const VersionChangedMessageSchema = z.object({
  type: z.literal("version_changed"),
  mcpVersion: z.string().nullable(),
  skillsVersion: z.string().nullable(),
});

export type VersionChangedMessage = z.infer<typeof VersionChangedMessageSchema>;

export const VersionsMessageSchema = z.object({
  type: z.literal("versions"),
  requestId: z.string(),
  mcpVersion: z.string().nullable(),
  skillsVersion: z.string().nullable(),
});

export type VersionsMessage = z.infer<typeof VersionsMessageSchema>;

export const ToolsMessageSchema = z.object({
  type: z.literal("tools"),
  requestId: z.string(),
  integrations: z.array(IntegrationSchema),
  mcpVersion: z.string().nullable(),
});

export type ToolsMessage = z.infer<typeof ToolsMessageSchema>;

export const SkillsMessageSchema = z.object({
  type: z.literal("skills"),
  requestId: z.string(),
  skills: z.array(SkillSchema),
  skillsVersion: z.string().nullable(),
});

export type SkillsMessage = z.infer<typeof SkillsMessageSchema>;

export const GatewayMessageSchema = z.discriminatedUnion("type", [
  AuthenticateMessageSchema,
  ToolResultMessageSchema,
  ToolErrorMessageSchema,
  PongMessageSchema,
  VersionChangedMessageSchema,
  VersionsMessageSchema,
  ToolsMessageSchema,
  SkillsMessageSchema,
]);

export type GatewayMessage = z.infer<typeof GatewayMessageSchema>;

// --- Service -> Gateway messages ---

export const AuthenticatedMessageSchema = z.object({
  type: z.literal("authenticated"),
  organizationId: z.string(),
  organizationName: z.string().optional(),
});

export type AuthenticatedMessage = z.infer<typeof AuthenticatedMessageSchema>;

export const AuthErrorMessageSchema = z.object({
  type: z.literal("auth_error"),
  error: z.string(),
});

export type AuthErrorMessage = z.infer<typeof AuthErrorMessageSchema>;

export const ToolCallMessageSchema = z.object({
  type: z.literal("tool_call"),
  requestId: z.string(),
  integrationId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.unknown()),
  /** W3C Trace Context traceparent header for distributed tracing. */
  traceparent: z.string().optional(),
  /** W3C Trace Context tracestate header for distributed tracing. */
  tracestate: z.string().optional(),
});

export type ToolCallMessage = z.infer<typeof ToolCallMessageSchema>;

export const PingMessageSchema = z.object({
  type: z.literal("ping"),
});

export type PingMessage = z.infer<typeof PingMessageSchema>;

export const GetVersionsMessageSchema = z.object({
  type: z.literal("get_versions"),
  requestId: z.string(),
});

export type GetVersionsMessage = z.infer<typeof GetVersionsMessageSchema>;

export const GetToolsMessageSchema = z.object({
  type: z.literal("get_tools"),
  requestId: z.string(),
});

export type GetToolsMessage = z.infer<typeof GetToolsMessageSchema>;

export const GetSkillsMessageSchema = z.object({
  type: z.literal("get_skills"),
  requestId: z.string(),
});

export type GetSkillsMessage = z.infer<typeof GetSkillsMessageSchema>;

export const ServiceMessageSchema = z.discriminatedUnion("type", [
  AuthenticatedMessageSchema,
  AuthErrorMessageSchema,
  ToolCallMessageSchema,
  PingMessageSchema,
  GetVersionsMessageSchema,
  GetToolsMessageSchema,
  GetSkillsMessageSchema,
]);

export type ServiceMessage = z.infer<typeof ServiceMessageSchema>;
