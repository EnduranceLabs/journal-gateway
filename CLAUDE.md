# Architecture

## Core Principle
Single `gateway/` package. No monorepo. Keep it simple — it's one product.

## Structure
- `gateway/src/types/` — Protocol types (Zod schemas). Integration is the umbrella type
  that can carry tools, skills, or both.
- `gateway/src/common/` — Shared utilities (logger).
- `gateway/src/connection.ts` — WebSocket connection to Journal service. Handles
  authentication, registration, tool call routing, reconnection.
- `gateway/src/runtime.ts` — Runtime that manages MCP clients and skills. Implements
  IntegrationProvider.
- `gateway/src/mcp-client.ts` — Spawns and manages individual MCP server subprocesses.
- `gateway/src/skill-client.ts` — Loads skill files (raw Markdown) from a directory.
- `gateway/src/config.ts` — Configuration parsing from environment variables.
- `gateway/src/main.ts` — CLI entry point.

## Adding MCP Servers
Users configure MCP servers via the `MCP_SERVERS` environment variable (JSON array).
No built-in catalog — all MCP servers are user-configured.

## Adding Skills
Skill files (raw Markdown) go in the directory specified by `SKILLS_DIR`.
Skills are `{ id, content }` — the id is derived from the filename, content is the
raw file contents. No YAML parsing at the gateway level.

## IntegrationProvider Interface
The Runtime implements this interface to provide capabilities to the connection:
- `getRegistrations()` — return available integrations (each may have tools, skills, or both)
- `callTool(integrationId, toolName, args)` — execute a tool call
- `start()` / `stop()` — lifecycle management
