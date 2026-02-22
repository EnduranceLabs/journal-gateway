# Journal Gateway Skills

## What Are Skills?

Skills are prompt/workflow templates that guide agent behavior. They are bundled inside integrations alongside tools:

| | Tools | Skills |
|---|---|---|
| **Purpose** | Provide callable actions (query a DB, call an API) | Provide instructions that shape agent behavior |
| **Mechanism** | Tool calls routed through `IntegrationProvider` | Prompt templates sent at registration, used by the service |
| **Runtime** | Invoked on each `tool_call` message | Read once at startup, sent during `register` |

Both tools and skills travel inside `Integration` objects. An integration can carry tools, skills, or both. Skills are useful for encoding organizational workflows, code review standards, deployment checklists, and other repeatable patterns that agents should follow.

## Skill Schema

The canonical definition is the `SkillSchema` Zod type in `packages/types/src/skills.ts`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Unique identifier (derived from filename) |
| `name` | `string` | yes | Display name |
| `description` | `string` | yes | Short description of what the skill does |
| `instructions` | `string` | yes | Full prompt instructions for the agent |
| `metadata` | `object` | no | Optional categorization |
| `metadata.tags` | `string[]` | no | Tags for filtering/discovery |
| `metadata.category` | `string` | no | Skill category |

## Skill File Format

Skills are authored as Markdown files with YAML front matter. Each `.md` file in the skills directory becomes one skill.

```markdown
---
name: Review PR
description: Reviews a pull request for code quality
tags: code-review, git
category: development
---

You are reviewing a pull request. Follow these steps:

1. Read the diff carefully
2. Check for correctness, security, and readability
3. Leave inline comments on specific lines
4. Summarize your review with an overall assessment
```

### Field mapping

| Source | Skill field |
|--------|------------|
| Filename (without `.md`) | `id` |
| Front matter `name` | `name` |
| Front matter `description` | `description` |
| Front matter `tags` (comma-separated) | `metadata.tags` |
| Front matter `category` | `metadata.category` |
| Markdown body | `instructions` |

### Requirements

- `name` and `description` are required in the front matter
- The Markdown body (instructions) must be non-empty
- Files missing any of these are silently skipped

## Configuration

Set the `SKILLS_DIR` environment variable to a directory containing skill files:

```bash
SKILLS_DIR=/opt/journal/skills journal-gateway
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SKILLS_DIR` | no | — | Path to directory containing `.md` skill files |

At least one of `INTEGRATIONS` or `SKILLS_DIR` must be set. The gateway can run with only skills (no integrations) or with both.

## How Skills Flow

```
Skill files (.md)
      │
      ▼
 SkillLoader.load()         ← reads directory, parses front matter
      │
      ▼
 SkillLoader.getIntegrations()  ← returns Integration[] with skills inside
      │
      ▼
 IntegrationProvider         ← merges skill integrations with tool integrations
      │
      ▼
 GatewayConnection           ← sends unified `register` message
      │
      ▼
 Journal Service             ← makes skills available to agents
```

1. At startup, `SkillLoader` reads all `.md` files from `SKILLS_DIR`
2. It parses YAML front matter and Markdown body into `Skill` objects
3. `getIntegrations()` wraps the skills into an `Integration` object (with `tools: []` and `skills: [...]`)
4. The CLI composes a unified `IntegrationProvider` that merges MCP integrations with skill integrations
5. During connection, `GatewayConnection` calls `getRegistrations()` and sends all integrations in the `register` message
6. The service makes these skills available to agents in the organization

## Architecture

Skills are bundled as an integration. The `SkillLoader` in `packages/skills/` loads Markdown files and returns them as an `Integration` object with skills attached. The CLI in `packages/mcp/` composes this with MCP tool integrations into a single `IntegrationProvider`.

```
packages/types/     ← Skill Zod schema + Integration schema (with optional skills)
packages/gateway/   ← IntegrationProvider interface (skills travel inside integrations)
packages/skills/    ← SkillLoader implementation (returns Integration[])
packages/mcp/       ← CLI composes SkillLoader + McpRuntime into one provider
```
