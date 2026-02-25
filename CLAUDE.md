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
  proactive `registrations_changed` push, and reconnection with exponential backoff.
- `gateway/src/runtime.ts` — Runtime that manages MCP clients and skills. Implements
  IntegrationProvider. Tracks content-hash versions (mcpVersion/skillsVersion) and
  emits `registrations_changed` when tools or skills change at runtime.
- `gateway/src/mcp-client.ts` — Spawns and manages individual MCP server subprocesses.
  Listens for MCP `notifications/tools/list_changed` and emits `tools_changed`.
- `gateway/src/skill-client.ts` — Loads skill files (raw Markdown) from a directory.
  Watches the skills directory with `fs.watch` and emits `skills_changed` on `.md` file changes.
- `gateway/src/version-hash.ts` — Computes stable content hashes (SHA-256, 16 hex chars)
  over integration arrays for change detection.
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
- `getVersions()` — return `{ mcpVersion, skillsVersion }` content hashes (null if empty)
- `callTool(integrationId, toolName, args)` — execute a tool call
- `start()` / `stop()` — lifecycle management
- `on/off("registrations_changed")` — optional event for proactive change notification

## Change Detection
The gateway detects tool/skill changes at runtime and proactively notifies the service:
- MCP: listens for `notifications/tools/list_changed` from MCP SDK + crash events
- Skills: `fs.watch` on the skills directory (`.md` files only)
- Both paths debounce 500ms, recompute content-hash versions, and emit
  `registrations_changed` only if a version actually changed
- The connection subscribes to this event and sends a `registrations_changed`
  message (fire-and-forget push with full integrations + versions)
