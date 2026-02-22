# Architecture

## Core Principle
The gateway core (`packages/gateway/`) is a stable, minimal library. It CANNOT be updated
once deployed. Keep it small. No built-in integrations, no MCP code, no CLI logic.

## Three-Layer Architecture
- `packages/types/` — Protocol types (Zod schemas). Stable.
- `packages/gateway/` — Core connection library. Accepts an IntegrationProvider interface.
  Handles WebSocket, authentication, registration, tool call routing, reconnection. Stable.
- `packages/mcp/` — MCP integration provider + CLI. Implements IntegrationProvider by
  spawning MCP server subprocesses. Contains the built-in integration catalog and CLI
  entry point. This is the layer that changes when adding integrations.

## Adding Integrations
New integrations go in `packages/mcp/src/integrations/`. NEVER modify `packages/gateway/`.

## IntegrationProvider Interface
External code implements this interface to provide tools to the gateway:
- `getRegistrations()` — return available integrations and their tools
- `callTool(integrationId, toolName, args)` — execute a tool call
- `start()` / `stop()` — lifecycle management
