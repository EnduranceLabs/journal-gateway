import { describe, it, expect } from "vitest";
import {
  GatewayMessageSchema,
  ServiceMessageSchema,
  AuthenticateMessageSchema,
  RegisterMessageSchema,
  ToolResultMessageSchema,
  ToolErrorMessageSchema,
  PongMessageSchema,
  RegistrationsChangedMessageSchema,
  AuthenticatedMessageSchema,
  AuthErrorMessageSchema,
  RegisteredMessageSchema,
  ToolCallMessageSchema,
  PingMessageSchema,
} from "@journal/gateway-protocol";

describe("Gateway → Service messages", () => {
  it("parses authenticate message", () => {
    const msg = {
      type: "authenticate",
      token: "gw_abc123",
      protocolVersion: 1,
      gatewayVersion: "0.1.0",
    };
    expect(AuthenticateMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses register message", () => {
    const msg = {
      type: "register",
      integrations: [
        {
          id: "postgresql",
          name: "PostgreSQL",
          description: "Query databases",
          tools: [
            {
              name: "query",
              description: "Run SQL",
              inputSchema: { type: "object" },
            },
          ],
        },
      ],
    };
    expect(RegisterMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses register message with version fields", () => {
    const msg = {
      type: "register",
      integrations: [],
      mcpVersion: "abcdef0123456789",
      skillsVersion: "9876543210fedcba",
    };
    expect(RegisterMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses register message without version fields", () => {
    const msg = {
      type: "register",
      integrations: [],
    };
    const parsed = RegisterMessageSchema.parse(msg);
    expect(parsed.mcpVersion).toBeUndefined();
    expect(parsed.skillsVersion).toBeUndefined();
  });

  it("parses registrations_changed message", () => {
    const msg = {
      type: "registrations_changed",
      integrations: [
        {
          id: "pg",
          name: "PostgreSQL",
          description: "DB",
          tools: [{ name: "query", description: "Run SQL", inputSchema: {} }],
        },
      ],
      mcpVersion: "abcdef0123456789",
    };
    expect(RegistrationsChangedMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses registrations_changed via gateway union", () => {
    const msg = {
      type: "registrations_changed",
      integrations: [],
    };
    expect(() => GatewayMessageSchema.parse(msg)).not.toThrow();
  });

  it("parses register message with skills inside integration", () => {
    const msg = {
      type: "register",
      integrations: [
        {
          id: "skills",
          name: "Skills",
          description: "Loaded skills",
          tools: [],
          skills: [
            {
              id: "review-pr",
              content: "You are reviewing a pull request. Follow these steps...",
            },
          ],
        },
      ],
    };
    expect(RegisterMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses tool_result message", () => {
    const msg = {
      type: "tool_result",
      requestId: "req_123",
      result: {
        content: [{ type: "text", text: "hello" }],
      },
    };
    expect(ToolResultMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses tool_result with isError", () => {
    const msg = {
      type: "tool_result",
      requestId: "req_123",
      result: {
        content: [{ type: "text", text: "error occurred" }],
        isError: true,
      },
    };
    expect(ToolResultMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses tool_error message", () => {
    const msg = {
      type: "tool_error",
      requestId: "req_123",
      error: {
        code: "EXECUTION_FAILED",
        message: "something went wrong",
      },
    };
    expect(ToolErrorMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses pong message", () => {
    const msg = { type: "pong" };
    expect(PongMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses all gateway message types via discriminated union", () => {
    const messages = [
      {
        type: "authenticate",
        token: "gw_test",
        protocolVersion: 1,
        gatewayVersion: "0.1.0",
      },
      {
        type: "register",
        integrations: [],
      },
      {
        type: "tool_result",
        requestId: "req_1",
        result: { content: [{ type: "text", text: "ok" }] },
      },
      {
        type: "tool_error",
        requestId: "req_2",
        error: { code: "TIMEOUT", message: "timed out" },
      },
      { type: "pong" },
      { type: "registrations_changed", integrations: [] },
    ];

    for (const msg of messages) {
      expect(() => GatewayMessageSchema.parse(msg)).not.toThrow();
    }
  });

  it("rejects authenticate with missing token", () => {
    const msg = {
      type: "authenticate",
      protocolVersion: 1,
      gatewayVersion: "0.1.0",
    };
    expect(() => AuthenticateMessageSchema.parse(msg)).toThrow();
  });

  it("rejects tool_error with invalid error code", () => {
    const msg = {
      type: "tool_error",
      requestId: "req_123",
      error: { code: "INVALID_CODE", message: "nope" },
    };
    expect(() => ToolErrorMessageSchema.parse(msg)).toThrow();
  });
});

describe("Service → Gateway messages", () => {
  it("parses authenticated message", () => {
    const msg = {
      type: "authenticated",
      organizationId: "org_123",
      organizationName: "Acme",
    };
    expect(AuthenticatedMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses authenticated without optional organizationName", () => {
    const msg = {
      type: "authenticated",
      organizationId: "org_123",
    };
    expect(AuthenticatedMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses auth_error message", () => {
    const msg = {
      type: "auth_error",
      error: "Invalid token",
    };
    expect(AuthErrorMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses registered message", () => {
    const msg = {
      type: "registered",
      integrationCount: 2,
      toolCount: 5,
    };
    expect(RegisteredMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses registered message with skillCount", () => {
    const msg = {
      type: "registered",
      integrationCount: 1,
      toolCount: 3,
      skillCount: 2,
    };
    expect(RegisteredMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses tool_call message", () => {
    const msg = {
      type: "tool_call",
      requestId: "req_abc",
      integrationId: "postgresql",
      toolName: "query",
      arguments: { sql: "SELECT 1" },
    };
    expect(ToolCallMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses ping message", () => {
    const msg = { type: "ping" };
    expect(PingMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses all service message types via discriminated union", () => {
    const messages = [
      { type: "authenticated", organizationId: "org_1" },
      { type: "auth_error", error: "bad token" },
      { type: "registered", integrationCount: 1, toolCount: 3 },
      {
        type: "tool_call",
        requestId: "req_1",
        integrationId: "pg",
        toolName: "query",
        arguments: {},
      },
      { type: "ping" },
    ];

    for (const msg of messages) {
      expect(() => ServiceMessageSchema.parse(msg)).not.toThrow();
    }
  });

  it("rejects unknown message type in service union", () => {
    const msg = { type: "unknown_type", data: "something" };
    expect(() => ServiceMessageSchema.parse(msg)).toThrow();
  });

  it("rejects unknown message type in gateway union", () => {
    const msg = { type: "not_a_real_type" };
    expect(() => GatewayMessageSchema.parse(msg)).toThrow();
  });
});
