import { describe, it, expect } from "vitest";
import {
  GatewayMessageSchema,
  ServiceMessageSchema,
  AuthenticateMessageSchema,
  ToolResultMessageSchema,
  ToolErrorMessageSchema,
  PongMessageSchema,
  VersionChangedMessageSchema,
  VersionsMessageSchema,
  ToolsMessageSchema,
  SkillsMessageSchema,
  AuthenticatedMessageSchema,
  AuthErrorMessageSchema,
  ToolCallMessageSchema,
  PingMessageSchema,
  GetVersionsMessageSchema,
  GetToolsMessageSchema,
  GetSkillsMessageSchema,
} from "@journal/gateway-protocol";

describe("Gateway → Service messages", () => {
  it("parses authenticate message", () => {
    const msg = {
      type: "authenticate",
      token: "gw_abc123",
      protocolVersion: 2,
      gatewayVersion: "0.1.0",
    };
    expect(AuthenticateMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses version_changed message", () => {
    const msg = {
      type: "version_changed",
      mcpVersion: "abcdef0123456789",
      skillsVersion: null,
    };
    expect(VersionChangedMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses version_changed with both null versions", () => {
    const msg = {
      type: "version_changed",
      mcpVersion: null,
      skillsVersion: null,
    };
    expect(VersionChangedMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses version_changed with both versions", () => {
    const msg = {
      type: "version_changed",
      mcpVersion: "abcdef0123456789",
      skillsVersion: "9876543210fedcba",
    };
    expect(VersionChangedMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses versions response message", () => {
    const msg = {
      type: "versions",
      requestId: "pull_1",
      mcpVersion: "abcdef0123456789",
      skillsVersion: null,
    };
    expect(VersionsMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses tools response message", () => {
    const msg = {
      type: "tools",
      requestId: "pull_2",
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
      mcpVersion: "abcdef0123456789",
    };
    expect(ToolsMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses tools response with empty integrations", () => {
    const msg = {
      type: "tools",
      requestId: "pull_3",
      integrations: [],
      mcpVersion: null,
    };
    expect(ToolsMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses skills response message", () => {
    const msg = {
      type: "skills",
      requestId: "pull_4",
      skills: [
        {
          id: "review-pr",
          content: "You are reviewing a pull request. Follow these steps...",
        },
      ],
      skillsVersion: "9876543210fedcba",
    };
    expect(SkillsMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses skills response with empty skills", () => {
    const msg = {
      type: "skills",
      requestId: "pull_5",
      skills: [],
      skillsVersion: null,
    };
    expect(SkillsMessageSchema.parse(msg)).toEqual(msg);
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
        protocolVersion: 2,
        gatewayVersion: "0.1.0",
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
      { type: "version_changed", mcpVersion: null, skillsVersion: null },
      { type: "versions", requestId: "p1", mcpVersion: null, skillsVersion: null },
      { type: "tools", requestId: "p2", integrations: [], mcpVersion: null },
      { type: "skills", requestId: "p3", skills: [], skillsVersion: null },
    ];

    for (const msg of messages) {
      expect(() => GatewayMessageSchema.parse(msg)).not.toThrow();
    }
  });

  it("rejects authenticate with missing token", () => {
    const msg = {
      type: "authenticate",
      protocolVersion: 2,
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

  it("parses get_versions message", () => {
    const msg = { type: "get_versions", requestId: "pull_1" };
    expect(GetVersionsMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses get_tools message", () => {
    const msg = { type: "get_tools", requestId: "pull_2" };
    expect(GetToolsMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses get_skills message", () => {
    const msg = { type: "get_skills", requestId: "pull_3" };
    expect(GetSkillsMessageSchema.parse(msg)).toEqual(msg);
  });

  it("parses all service message types via discriminated union", () => {
    const messages = [
      { type: "authenticated", organizationId: "org_1" },
      { type: "auth_error", error: "bad token" },
      {
        type: "tool_call",
        requestId: "req_1",
        integrationId: "pg",
        toolName: "query",
        arguments: {},
      },
      { type: "ping" },
      { type: "get_versions", requestId: "p1" },
      { type: "get_tools", requestId: "p2" },
      { type: "get_skills", requestId: "p3" },
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
