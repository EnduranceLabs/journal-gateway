# Architecture

## Core Principle
Small workspace: `protocol/` for shared types, `gateway/` for the runtime, client
libraries for the service side. Keep it simple.

## Structure
- `protocol/` — `@journal/gateway-protocol` package. Pure Zod schemas and TypeScript
  types shared by both gateway and client libraries (Integration, ToolResult, Skill,
  message schemas, IntegrationProvider, GatewayConfig, errors).
- `gateway/src/common/` — Shared utilities (logger).
- `gateway/src/connection.ts` — WebSocket connection to Journal service. Handles
  authentication, sends `version_changed` after auth, responds to pull requests
  (`get_versions`, `get_tools`, `get_skills`), routes tool calls, handles ping/pong,
  and reconnects with exponential backoff. Protocol version 2 (pull-based).
- `gateway/src/runtime.ts` — Runtime that manages MCP clients and skills. Implements
  IntegrationProvider with `getTools()` and `getSkills()`. Tracks content-hash
  versions (mcpVersion/skillsVersion) and emits `versions_changed` when tools or
  skills change at runtime.
- `gateway/src/mcp-client.ts` — Spawns and manages individual MCP server subprocesses.
  Listens for MCP `notifications/tools/list_changed` and emits `tools_changed`.
- `gateway/src/skill-client.ts` — Loads skill files (raw Markdown) from a directory.
  Watches the skills directory with `fs.watch` and emits `skills_changed` on `.md`
  file changes. Exposes `getSkills()` for direct skill access and `getIntegrations()`
  for version hash computation.
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
  auto-pulls tools/skills on `version_changed`, and provides `callTool()`,
  `getVersions()`, `getTools()`, and `getSkills()` APIs.
- `clients/python/` — `journal-gateway-client` PyPI package. Same functionality
  as the TypeScript client, using `websockets` and `asyncio`.
- `testing/integration/` — Integration tests that spin up the real gateway +
  client library and verify end-to-end tool calls.

## IntegrationProvider Interface
The Runtime implements this interface to provide capabilities to the connection:
- `getTools()` — return MCP tool integrations
- `getSkills()` — return skills (synchronous — loaded in memory)
- `getVersions()` — return `{ mcpVersion, skillsVersion }` content hashes (null if empty)
- `callTool(integrationId, toolName, args)` — execute a tool call
- `start()` / `stop()` — lifecycle management
- `on/off("versions_changed")` — optional event for proactive change notification

## Change Detection
The gateway detects tool/skill changes at runtime and notifies the service:
- MCP: listens for `notifications/tools/list_changed` from MCP SDK + crash events
- Skills: `fs.watch` on the skills directory (`.md` files only)
- Both paths debounce 500ms, recompute content-hash versions, and emit
  `versions_changed` only if a version actually changed
- The connection subscribes to this event and sends a lightweight `version_changed`
  message (fire-and-forget push with just version hashes, not full integrations)
- The service then decides what to pull based on which versions changed
