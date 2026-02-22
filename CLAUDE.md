# Architecture

## Core Principle
The gateway core (`packages/gateway/`) is a stable, minimal library. It CANNOT be updated
once deployed. Keep it small. No built-in integrations, no MCP code, no CLI logic.

## Four-Layer Architecture
- `packages/types/` — Protocol types (Zod schemas). Integration is the umbrella type
  that can carry tools, skills, or both. Stable.
- `packages/gateway/` — Core connection library. Accepts a single IntegrationProvider
  interface. Handles WebSocket, authentication, registration, tool call routing,
  reconnection. Stable.
- `packages/skills/` — Skill loading from Markdown files. Returns Integration[] with
  skills embedded. Orthogonal to MCP — skills are prompt templates, not callable tools.
- `packages/mcp/` — MCP integration provider + CLI. Implements IntegrationProvider by
  spawning MCP server subprocesses. Contains the built-in integration catalog and CLI
  entry point. Composes McpRuntime + SkillLoader into a unified provider.

## Adding Integrations
New integrations go in `packages/mcp/src/integrations/`. NEVER modify `packages/gateway/`.

## Adding Skills
Skill files (Markdown with YAML front matter) go in the directory specified by `SKILLS_DIR`.
See `spec/skills.md` for the file format.

## IntegrationProvider Interface
External code implements this interface to provide capabilities to the gateway:
- `getRegistrations()` — return available integrations (each may have tools, skills, or both)
- `callTool(integrationId, toolName, args)` — execute a tool call
- `start()` / `stop()` — lifecycle management
