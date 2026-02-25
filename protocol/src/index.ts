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
  ToolResultMessageSchema,
  ToolErrorMessageSchema,
  PongMessageSchema,
  VersionChangedMessageSchema,
  VersionsMessageSchema,
  ToolsMessageSchema,
  SkillsMessageSchema,
  GatewayMessageSchema,
  AuthenticatedMessageSchema,
  AuthErrorMessageSchema,
  ToolCallMessageSchema,
  PingMessageSchema,
  GetVersionsMessageSchema,
  GetToolsMessageSchema,
  GetSkillsMessageSchema,
  ServiceMessageSchema,
  type AuthenticateMessage,
  type ToolResultMessage,
  type ToolErrorMessage,
  type PongMessage,
  type VersionChangedMessage,
  type VersionsMessage,
  type ToolsMessage,
  type SkillsMessage,
  type GatewayMessage,
  type AuthenticatedMessage,
  type AuthErrorMessage,
  type ToolCallMessage,
  type PingMessage,
  type GetVersionsMessage,
  type GetToolsMessage,
  type GetSkillsMessage,
  type ServiceMessage,
} from "./messages.js";

export type { IntegrationProvider, GatewayConfig, RegistrationVersions } from "./provider.js";
export { IntegrationNotFoundError } from "./provider.js";
