import { z } from "zod";

export const GATEWAY_ERROR_CODES = [
  "SKILL_NOT_FOUND",
  "TOOL_NOT_FOUND",
  "EXECUTION_FAILED",
  "TIMEOUT",
] as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

export const GatewayErrorCodeSchema = z.enum(GATEWAY_ERROR_CODES);

export const GatewayErrorSchema = z.object({
  code: GatewayErrorCodeSchema,
  message: z.string(),
});

export type GatewayError = z.infer<typeof GatewayErrorSchema>;
