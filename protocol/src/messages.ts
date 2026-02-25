import { z } from "zod";
import { GatewayErrorSchema } from "./errors.js";
import { IntegrationSchema, ToolResultSchema } from "./integrations.js";

// --- Gateway → Service messages ---

export const AuthenticateMessageSchema = z.object({
  type: z.literal("authenticate"),
  token: z.string(),
  protocolVersion: z.number(),
  gatewayVersion: z.string(),
});

export type AuthenticateMessage = z.infer<typeof AuthenticateMessageSchema>;

export const RegisterMessageSchema = z.object({
  type: z.literal("register"),
  integrations: z.array(IntegrationSchema),
  mcpVersion: z.string().optional(),
  skillsVersion: z.string().optional(),
});

export type RegisterMessage = z.infer<typeof RegisterMessageSchema>;

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

export const RegistrationsChangedMessageSchema = z.object({
  type: z.literal("registrations_changed"),
  integrations: z.array(IntegrationSchema),
  mcpVersion: z.string().optional(),
  skillsVersion: z.string().optional(),
});

export type RegistrationsChangedMessage = z.infer<typeof RegistrationsChangedMessageSchema>;

export const GatewayMessageSchema = z.discriminatedUnion("type", [
  AuthenticateMessageSchema,
  RegisterMessageSchema,
  ToolResultMessageSchema,
  ToolErrorMessageSchema,
  PongMessageSchema,
  RegistrationsChangedMessageSchema,
]);

export type GatewayMessage = z.infer<typeof GatewayMessageSchema>;

// --- Service → Gateway messages ---

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

export const RegisteredMessageSchema = z.object({
  type: z.literal("registered"),
  integrationCount: z.number(),
  toolCount: z.number(),
  skillCount: z.number().optional(),
});

export type RegisteredMessage = z.infer<typeof RegisteredMessageSchema>;

export const ToolCallMessageSchema = z.object({
  type: z.literal("tool_call"),
  requestId: z.string(),
  integrationId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.unknown()),
});

export type ToolCallMessage = z.infer<typeof ToolCallMessageSchema>;

export const PingMessageSchema = z.object({
  type: z.literal("ping"),
});

export type PingMessage = z.infer<typeof PingMessageSchema>;

export const RefreshRegistrationsMessageSchema = z.object({
  type: z.literal("refresh_registrations"),
});

export type RefreshRegistrationsMessage = z.infer<typeof RefreshRegistrationsMessageSchema>;

export const ServiceMessageSchema = z.discriminatedUnion("type", [
  AuthenticatedMessageSchema,
  AuthErrorMessageSchema,
  RegisteredMessageSchema,
  ToolCallMessageSchema,
  PingMessageSchema,
  RefreshRegistrationsMessageSchema,
]);

export type ServiceMessage = z.infer<typeof ServiceMessageSchema>;
