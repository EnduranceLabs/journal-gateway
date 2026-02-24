# Architecture

## Core Principle
Small workspace: `protocol/` for shared types, `gateway/` for the runtime, client
libraries for the service side. Keep it simple.

## Structure
- `protocol/` — `@journal/gateway-protocol` package. Pure Zod schemas and TypeScript
  types shared by both gateway and client libraries (Integration, ToolResult, message
  schemas, IntegrationProvider, GatewayConfig, errors).
- `gateway/src/common/` — Shared utilities (logger).
- `gateway/src/connection.ts` — WebSocket connection to Journal service. Handles
  authentication, registration, tool call routing, ping/pong, refresh_registrations,
  and reconnection with exponential backoff.
- `gateway/src/runtime.ts` — Runtime that manages MCP clients and skills. Implements
  IntegrationProvider.
- `gateway/src/mcp-client.ts` — Spawns and manages individual MCP server subprocesses.
- `gateway/src/skill-client.ts` — Loads skill files (raw Markdown) from a directory.
- `gateway/src/config.ts` — Parses operational env vars and loads the gateway config file
  (`--config` or `JOURNAL_GATEWAY_CONFIG`). Validates with Zod, resolves envVars mappings.
- `gateway/src/main.ts` — CLI entry point.

## Gateway Config File
All MCP servers and skills are configured via a single JSON config file with two top-level
fields: `mcpServers` (array of server definitions) and `skillsDir` (path string).
The config file is pointed to by `--config <path>` CLI arg or `JOURNAL_GATEWAY_CONFIG`
env var (file path or inline JSON). Secrets stay in real env vars — the `envVars` mapping
in each server definition resolves from the host environment at startup.

## Client Libraries
- `clients/typescript/` — `@journal/gateway-client` npm package. Implements the
  service side of the protocol: runs a WebSocket server, authenticates gateways,
  receives registrations, and provides a `callTool()` API.
- `clients/python/` — `journal-gateway-client` PyPI package. Same functionality
  as the TypeScript client, using `websockets` and `asyncio`.
- `testing/integration/` — Integration tests that spin up the real gateway +
  client library and verify end-to-end tool calls.

## IntegrationProvider Interface
The Runtime implements this interface to provide capabilities to the connection:
- `getRegistrations()` — return available integrations (each may have tools, skills, or both)
- `callTool(integrationId, toolName, args)` — execute a tool call
- `start()` / `stop()` — lifecycle management
