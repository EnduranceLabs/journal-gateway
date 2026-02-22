# Architecture

## Core Principle
The gateway core (`packages/gateway/`) is a stable, minimal library. It CANNOT be updated
once deployed. Keep it small. No built-in integrations, no MCP code, no CLI logic.

## Four-Layer Architecture
- `packages/types/` — Protocol types (Zod schemas, including Skill). Stable.
- `packages/gateway/` — Core connection library. Accepts IntegrationProvider and optional
  SkillProvider interfaces. Handles WebSocket, authentication, registration, tool call
  routing, reconnection. Stable.
- `packages/skills/` — Skill loading from Markdown files. Implements SkillProvider.
  Orthogonal to MCP — skills are prompt templates, not callable tools.
- `packages/mcp/` — MCP integration provider + CLI. Implements IntegrationProvider by
  spawning MCP server subprocesses. Contains the built-in integration catalog and CLI
  entry point. Wires SkillLoader from `packages/skills/`.

## Adding Integrations
New integrations go in `packages/mcp/src/integrations/`. NEVER modify `packages/gateway/`.

## Adding Skills
Skill files (Markdown with YAML front matter) go in the directory specified by `SKILLS_DIR`.
See `spec/skills.md` for the file format.

## IntegrationProvider Interface
External code implements this interface to provide tools to the gateway:
- `getRegistrations()` — return available integrations and their tools
- `callTool(integrationId, toolName, args)` — execute a tool call
- `start()` / `stop()` — lifecycle management

## SkillProvider Interface
External code implements this interface to provide skills to the gateway:
- `getSkills()` — return available skills (prompt templates)
