export {
  GATEWAY_ERROR_CODES,
  GatewayErrorCodeSchema,
  GatewayErrorSchema,
  type GatewayError,
  type GatewayErrorCode,
} from "./errors.js";

export { SkillSchema, type Skill } from "./skills.js";

export {
  ToolDefinitionSchema,
  IntegrationSchema,
  TextContentSchema,
  ImageContentSchema,
  ContentBlockSchema,
  ToolResultSchema,
  type ToolDefinition,
  type Integration,
  type TextContent,
  type ImageContent,
  type ContentBlock,
  type ToolResult,
} from "./integrations.js";

export {
  AuthenticateMessageSchema,
  RegisterMessageSchema,
  ToolResultMessageSchema,
  ToolErrorMessageSchema,
  PongMessageSchema,
  RegistrationsChangedMessageSchema,
  GatewayMessageSchema,
  AuthenticatedMessageSchema,
  AuthErrorMessageSchema,
  RegisteredMessageSchema,
  ToolCallMessageSchema,
  PingMessageSchema,
  RefreshRegistrationsMessageSchema,
  ServiceMessageSchema,
  type AuthenticateMessage,
  type RegisterMessage,
  type ToolResultMessage,
  type ToolErrorMessage,
  type PongMessage,
  type RegistrationsChangedMessage,
  type GatewayMessage,
  type AuthenticatedMessage,
  type AuthErrorMessage,
  type RegisteredMessage,
  type ToolCallMessage,
  type PingMessage,
  type RefreshRegistrationsMessage,
  type ServiceMessage,
} from "./messages.js";

export type { IntegrationProvider, GatewayConfig, RegistrationVersions } from "./provider.js";
export { IntegrationNotFoundError } from "./provider.js";
